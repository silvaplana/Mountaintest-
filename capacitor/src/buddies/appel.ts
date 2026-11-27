/**
 * 📞 Appels de groupe (spec/buddies.md §5.7, écrans 10 et 24) : l'état de l'appel, sans écran.
 * Le son passe par LiveKit (sur le VPS) ; le serveur des comptes donne le jeton d'entrée et fait sonner les autres.
 * Même rôle côté Kotlin (Appel.kt).
 */
import { Room, RoomEvent, Track, type Participant, type RemoteTrack } from 'livekit-client';
import { api } from '../compte/auth';
import { envoyerMessage, synchroniser } from './store';

export type Dest = { groupe?: string; sortie?: string };
type Reponse = { id: string; groupe: string | null; sortie: string | null; en_ligne: string[]; url: string; jeton: string; nouveau?: boolean };
/** Ce que dit la sonnerie (message Firebase, ou appel en cours vu par la synchro). */
export type Sonnerie = { appel: string; de: string; nom: string; groupe?: string; sortie?: string };
export type Voix = { id: string; pseudo: string };

export type EtatAppel = {
  id: string; nom: string; dest: Dest;
  /** sonne : écran 10 ; appel : j'appelle, personne n'a encore répondu ; en_ligne : on se parle. */
  phase: 'sonne' | 'connexion' | 'appel' | 'en_ligne';
  de?: string; debut?: number; voix: Voix[]; parle: string[]; muet: boolean;
  /** « Julie a décroché » / « Luc a raccroché », affiché quelques secondes dans la barre. */
  annonce?: { texte: string; jusqua: number };
  /** 🗺 « Suis ma carte » : je montre ma carte aux autres. */
  jeMontre?: boolean;
  /** Celui dont je suis la carte (une seule personne montre à la fois). */
  suit?: Voix | null;
  /** 🗺 Carte montrée depuis la messagerie : salle muette (pas de voix), `carte` = le message « carte » du fil. */
  muette?: boolean; carte?: string;
  /** Ma carte s'allumera dès que quelqu'un décroche (touchée pendant « Appel pour… »). */
  carteDesQue?: boolean;
};

/** Les calques de la carte, les mêmes chez ceux qui suivent. */
export type Calques = { pente: boolean; ombres: boolean; drones: boolean; meteo: boolean };

/** Ce qui passe entre les téléphones pour « Suis ma carte » (spec/buddies.md §7.10). */
export type MsgCarte = (
  | { carte: { c: [number, number]; z: number; b: number; p: number; fond: string; cq?: Calques } }
  | { traces: { id: number; nom: string; couleur: string; ligne: [number, number][] }[] }
  /** Le trait que je dessine, en direct ([] : fini). */
  | { trait: [number, number][] }
  /** La trace dont j'ai ouvert le profil (null : fermé). */
  | { profil: { id: number; nom: string; couleur: string; ligne: [number, number][] } | null }
  | { carteFin: true }
  /** Posés à l'envoi : `s`, l'époque de cette carte (une par « j'allume ») ; `n`, le numéro du message dans l'époque. */
) & { s?: number; n?: number };

/** Sans réponse au bout d'une minute, l'appel s'arrête seul. */
export const ATTENTE_MS = 60_000;

let etat: EtatAppel | null = null;
let salle: Room | null = null;
let minuteur: ReturnType<typeof setTimeout> | undefined;
const abonnes = new Set<(e: EtatAppel | null) => void>();
const doigts = new Set<(p: { lon: number; lat: number; qui: string }) => void>();
const cartes = new Set<(m: MsgCarte, de: Voix) => void>();
const arrivees = new Set<() => void>();
const sons: HTMLMediaElement[] = [];
/** J'ai lancé l'appel : j'entends la tonalité tant que personne n'a décroché. */
let jAppelle = false;
/** 🗺 Lancé depuis la messagerie : je montre ma carte dès que quelqu'un décroche. */
let montrerDesQue = false;
let audio: AudioContext | null = null;
let tonalite: ReturnType<typeof setInterval> | undefined;

/** Un bip : fréquences jouées l'une après l'autre (durée de chacune en secondes). */
function bip(freqs: number[], d: number, volume = 0.25) {
  if (!audio) return;
  const t0 = audio.currentTime;
  freqs.forEach((f, i) => {
    const o = audio!.createOscillator(), g = audio!.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(volume, t0 + i * d);
    g.gain.setValueAtTime(0, t0 + (i + 1) * d);
    o.connect(g).connect(audio!.destination);
    o.start(t0 + i * d); o.stop(t0 + (i + 1) * d);
  });
}
/** Tonalité de retour d'appel à la française : 440 Hz, 1,5 s toutes les 5 s. */
export function tonaliteDoitSonner(jappelle: boolean, e: EtatAppel | null) {
  return jappelle && !!e && !e.muette && (e.phase === 'connexion' || e.phase === 'appel') && !e.voix.length;
}
function tonaliteSelon(e: EtatAppel | null) {
  // Dès que quelqu'un est là, plus de tonalité (Seb, 27/11 : elle continuait parfois après le décroché).
  const faut = tonaliteDoitSonner(jAppelle, e);
  if (faut && !tonalite) { bip([440], 1.5, 0.15); tonalite = setInterval(() => bip([440], 1.5, 0.15), 5000); }
  if (!faut && tonalite) { clearInterval(tonalite); tonalite = undefined; }
}

export const appelEnCours = () => etat;
export function suivreAppel(f: (e: EtatAppel | null) => void) { abonnes.add(f); return () => { abonnes.delete(f); }; }
/** 👉 Montrer du doigt : un point touché par un autre pendant l'appel. */
export function suivreDoigts(f: (p: { lon: number; lat: number; qui: string }) => void) { doigts.add(f); return () => { doigts.delete(f); }; }
/** 🗺 Les messages « Suis ma carte » reçus, et l'arrivée d'un buddy (pour lui renvoyer ma carte). */
export function suivreCartes(f: (m: MsgCarte, de: Voix) => void, arrive: () => void) {
  cartes.add(f); arrivees.add(arrive);
  return () => { cartes.delete(f); arrivees.delete(arrive); };
}
function changer(e: EtatAppel | null) {
  const avant = etat;
  etat = e;
  // 🗺 En appel, j'allume ou j'éteins ma carte : ceux qui sont en ligne reçoivent une notification (Seb, 27/11).
  if (avant && !avant.muette && avant.phase === 'en_ligne' && !!avant.jeMontre !== !!(e && e.id === avant.id && e.jeMontre)) {
    void api('POST', `/appels/${avant.id}/carte`, { on: !avant.jeMontre }).catch(() => undefined);
  } else if (e && !e.muette && e.phase === 'en_ligne' && e.jeMontre && (!avant || avant.id !== e.id || avant.phase !== 'en_ligne')) {
    void api('POST', `/appels/${e.id}/carte`, { on: true }).catch(() => undefined);
  }
  tonaliteSelon(e); abonnes.forEach((f) => f(e));
}

/** « 3:12 » */
export function duree(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/** « Julie parle… · Luc » : qui parle d'abord, puis les autres en ligne. */
export function enLigne(e: EtatAppel): string {
  const parle = e.voix.filter((v) => e.parle.includes(v.id));
  const autres = e.voix.filter((v) => !e.parle.includes(v.id));
  return [parle.length ? `${parle.map((v) => v.pseudo).join(', ')} parle${parle.length > 1 ? 'nt' : ''}…` : '', autres.map((v) => v.pseudo).join(', ')]
    .filter(Boolean).join(' · ') || 'personne encore';
}

/** 📞 J'appelle un groupe ou une sortie (ou je rejoins l'appel déjà en cours). */
export async function appeler(dest: Dest, nom: string) {
  if (etat?.muette) await raccrocher(); // la carte montrée en s'écrivant s'arrête : on passe à l'appel
  if (etat) return;
  // Créé pendant le toucher sur 📞 : sinon Android refuse de jouer le son.
  try { audio ??= new AudioContext(); void audio.resume(); } catch { audio = null; }
  jAppelle = true;
  changer({ id: '', nom, dest, phase: 'connexion', voix: [], parle: [], muet: false });
  try {
    const r = await api<Reponse>('POST', '/appels', dest);
    if (appelEnCours()?.phase === 'connexion') await entrer(r, nom); // sinon : raccroché pendant la connexion
  } catch (e) { jAppelle = false; changer(null); throw e; }
}

/** L'écran 10 : un buddy m'appelle. */
export function sonner(s: Sonnerie) {
  if (etat?.muette) void raccrocher(); // une carte suivie en s'écrivant cède la place à l'appel
  if (etat) return; // déjà en appel : on ne coupe pas
  changer({ id: s.appel, nom: s.nom, dest: { groupe: s.groupe || undefined, sortie: s.sortie || undefined }, phase: 'sonne', de: s.de,
    voix: [], parle: [], muet: false });
  clearTimeout(minuteur);
  minuteur = setTimeout(() => { if (etat?.phase === 'sonne') changer(null); }, 45_000);
}
/** L'appelant a raccroché avant ma réponse. */
export function finSonnerie(appel: string) { if (etat?.phase === 'sonne' && etat.id === appel) changer(null); }
export const refuser = () => { if (etat?.phase === 'sonne') changer(null); };

export async function decrocher() {
  const e = etat;
  if (!e || e.phase !== 'sonne') return;
  jAppelle = false; // je réponds : pas de tonalité chez moi
  changer({ ...e, phase: 'connexion' });
  try {
    const r = await api<Reponse>('POST', `/appels/${e.id}/rejoindre`);
    if (appelEnCours()?.phase === 'connexion') await entrer(r, e.nom);
  } catch (err) { changer(null); throw err; }
}

async function entrer(r: Reponse, nom: string, muette?: { carte: string; montre: boolean }) {
  const room = new Room({ adaptiveStream: false, dynacast: false });
  salle = room;
  const voix = () => [...room.remoteParticipants.values()].map((p) => ({ id: p.identity, pseudo: p.name || '?' }));
  let pret = false; // celui qui rejoint ne se fait pas annoncer ceux déjà là
  const annonces = new Set<string>(); // ceux dont l'arrivée a déjà été annoncée dans cet appel
  const maj = () => {
    if (!etat || salle !== room) return;
    const v = voix();
    const ensemble = v.length > 0;
    // Quelqu'un décroche ou raccroche : un son, une vibration et son nom dans la barre.
    const avant = new Set(etat.voix.map((x) => x.id)), apres = new Set(v.map((x) => x.id));
    const arrives = v.filter((x) => !avant.has(x.id)), partis = etat.voix.filter((x) => !apres.has(x.id));
    let annonce = etat.annonce;
    if (arrives.length) arrivees.forEach((f) => f());
    // Un buddy dont la connexion saute (PC, réseau faible) repart et revient sans cesse : « tou-dou, tou-dou… » en boucle
    // (Seb, 27/11). On n'annonce une arrivée qu'une fois, et un départ seulement s'il dure 5 s.
    const nouveaux = arrives.filter((x) => !annonces.has(x.id));
    arrives.forEach((x) => annonces.add(x.id));
    if (muette || (!pret && !jAppelle)) { /* rien à annoncer */ } else if (nouveaux.length) {
      bip([660, 880], 0.15); navigator.vibrate?.(200);
      annonce = { texte: `${nouveaux.map((x) => x.pseudo).join(' et ')} ${nouveaux.length > 1 ? 'ont' : 'a'} décroché`, jusqua: Date.now() + 4000 };
    } else if (partis.length) {
      setTimeout(() => {
        const vraiment = partis.filter((x) => !voix().some((y) => y.id === x.id) && annonces.has(x.id));
        if (!vraiment.length || !etat || salle !== room) return;
        vraiment.forEach((x) => annonces.delete(x.id));
        bip([660, 440], 0.15);
        changer({ ...etat, annonce: { texte: `${vraiment.map((x) => x.pseudo).join(' et ')} ${vraiment.length > 1 ? 'ont' : 'a'} raccroché`, jusqua: Date.now() + 4000 } });
      }, 5000);
    }
    const montre = etat.jeMontre || (montrerDesQue && ensemble);
    if (montre) montrerDesQue = false;
    const suit = etat.suit && apres.has(etat.suit.id) ? etat.suit : null;
    // Carte suivie depuis la messagerie : celui qui montrait est parti, on quitte la salle.
    if (muette && etat.suit && !suit) { void raccrocher(); return; }
    changer({ ...etat, voix: v, annonce, jeMontre: montre, suit, phase: ensemble || muette ? 'en_ligne' : etat.phase === 'en_ligne' ? 'en_ligne' : 'appel',
      debut: etat.debut ?? (ensemble ? Date.now() : undefined) });
  };
  room.on(RoomEvent.ParticipantConnected, maj).on(RoomEvent.ParticipantDisconnected, maj)
    .on(RoomEvent.ActiveSpeakersChanged, (ps: Participant[]) => { if (etat && salle === room) changer({ ...etat, parle: ps.map((p) => p.identity) }); })
    .on(RoomEvent.TrackSubscribed, (t: RemoteTrack) => { if (t.kind === Track.Kind.Audio) { const el = t.attach(); el.style.display = 'none'; document.body.appendChild(el); sons.push(el); } })
    .on(RoomEvent.TrackUnsubscribed, (t: RemoteTrack) => { t.detach().forEach((el) => el.remove()); })
    .on(RoomEvent.DataReceived, (data: Uint8Array, p?: Participant) => {
      try {
        const m = JSON.parse(new TextDecoder().decode(data)) as { doigt?: [number, number] } & Partial<Record<'carte' | 'traces' | 'carteFin' | 'trait' | 'profil', unknown>>;
        if (m.doigt) doigts.forEach((f) => f({ lon: m.doigt![0], lat: m.doigt![1], qui: p?.name || '?' }));
        if (p && (m.carte || m.traces || m.carteFin || m.trait || 'profil' in m)) recevoirCarte(m as MsgCarte, { id: p.identity, pseudo: p.name || '?' });
      } catch { /* message inconnu : ignoré */ }
    })
    .on(RoomEvent.Disconnected, () => { if (salle === room) fini(); });
  if (muette) {
    changer({ id: r.id, nom, dest: { groupe: r.groupe ?? undefined, sortie: r.sortie ?? undefined }, phase: 'en_ligne', voix: [], parle: [], muet: true,
      muette: true, carte: muette.carte, jeMontre: muette.montre });
    await room.connect(r.url, r.jeton);
    if (salle !== room) { void room.disconnect().catch(() => undefined); return; }
    maj();
    pret = true;
    // Je suis une carte et personne ne la montre (plus) : on quitte au bout de 8 s.
    if (!muette.montre) {
      clearTimeout(minuteur);
      minuteur = setTimeout(() => { if (etat?.muette && !etat.suit && salle === room) { void raccrocher(); carteAbsente.forEach((f) => f()); } }, 8000);
    }
    return;
  }
  changer({ id: r.id, nom, dest: { groupe: r.groupe ?? undefined, sortie: r.sortie ?? undefined }, phase: 'appel', voix: [], parle: [], muet: false });
  await room.connect(r.url, r.jeton);
  // Raccroché pendant la connexion (« Appel pour… », Seb 27/11) : surtout ne pas allumer le micro après coup.
  if (salle !== room) { void room.disconnect().catch(() => undefined); return; }
  await room.localParticipant.setMicrophoneEnabled(true);
  if (salle !== room) { void room.disconnect().catch(() => undefined); return; }
  void room.startAudio().catch(() => undefined);
  void api('POST', `/appels/${r.id}/presence`, { en_ligne: true }).catch(() => undefined);
  maj();
  pret = true;
  // J'appelle et personne ne répond : on raccroche seul au bout d'une minute.
  clearTimeout(minuteur);
  minuteur = setTimeout(() => { if (etat?.phase === 'appel' && salle === room) void raccrocher(); }, ATTENTE_MS);
}

function fini() {
  // 🗺 Je partageais ma carte en s'écrivant : « Seb a arrêté de partager sa carte » part dans le fil (Seb, 27/11).
  if (etat?.muette && etat.jeMontre && etat.carte) {
    envoyerMessage(etat.dest, { nature: 'carte_fin', texte: etat.carte });
    void synchroniser().catch(() => undefined);
  }
  const id = etat?.muette ? undefined : etat?.id;
  clearTimeout(minuteur);
  sons.splice(0).forEach((el) => el.remove());
  salle = null;
  jAppelle = false;
  montrerDesQue = false;
  ignore = null;
  enAttente.clear(); enRoute.clear();
  epoque = epoqueVue = numero = suitEpoque = 0; finies.clear(); recus.clear();
  changer(null);
  if (id) void api('POST', `/appels/${id}/presence`, { en_ligne: false }).catch(() => undefined);
}

export async function raccrocher() {
  const room = salle;
  if (!room) { jAppelle = false; changer(null); return; } // raccroché avant la salle : la prochaine sonnerie reçue n'aura pas la tonalité
  fini(); // salle oubliée d'abord : la déconnexion qui suit ne refait pas fini()
  await room.disconnect().catch(() => undefined);
}

export async function couperMicro(muet: boolean) {
  if (!salle || !etat) return;
  await salle.localParticipant.setMicrophoneEnabled(!muet);
  changer({ ...etat, muet });
}

/**
 * 🗺 Depuis la messagerie : en appel, j'allume ma carte ; sinon j'appelle la bande et ma carte s'allume dès que
 * quelqu'un décroche (« Suis ma carte » passe par l'appel).
 */
/** 🗺 Pendant « Appel pour… » (Seb, 27/11) : ma carte s'allumera chez eux dès qu'ils décrochent ; un 2e appui annule. */
export function montrerMaCarteDesQue() {
  if (!etat || etat.phase === 'en_ligne' || etat.muette) return;
  montrerDesQue = !montrerDesQue;
  changer({ ...etat, carteDesQue: montrerDesQue });
}

export async function montrerMaCarteA(dest: Dest, nom: string) {
  if (etat) { if (etat.phase === 'en_ligne') montrerMaCarte(true); else { montrerDesQue = true; changer({ ...etat, carteDesQue: true }); } return; }
  await appeler(dest, nom);
  const e = etat as EtatAppel | null; if (e) { montrerDesQue = true; changer({ ...e, carteDesQue: true }); }
}

/**
 * 🗺 Depuis la messagerie, sans appel (Seb, 27/11) : un message « carte » part dans le fil, j'entre dans sa salle muette
 * et je montre ma carte ; ceux qui touchent « Suivre » sur le message entrent dans la même salle.
 */
export async function proposerMaCarte(dest: Dest, nom: string, creer: () => Promise<string>) {
  if (etat) return;
  const carte = await creer();
  const r = await api<{ id: string; url: string; jeton: string }>('POST', `/cartes/${carte}`);
  if (etat) return;
  await entrer({ id: r.id, groupe: dest.groupe ?? null, sortie: dest.sortie ?? null, en_ligne: [], url: r.url, jeton: r.jeton }, nom, { carte, montre: true });
}
/** 🗺 « Suivre » sur un message « carte » du fil. */
export async function suivreUneCarte(carte: string, dest: Dest, nom: string) {
  if (etat?.carte === carte) return;
  if (etat && !etat.muette) throw new Error('Tu es déjà en appel');
  if (etat) await raccrocher();
  const r = await api<{ id: string; url: string; jeton: string }>('POST', `/cartes/${carte}`);
  await entrer({ id: r.id, groupe: dest.groupe ?? null, sortie: dest.sortie ?? null, en_ligne: [], url: r.url, jeton: r.jeton }, nom, { carte, montre: false });
}
const carteAbsente = new Set<() => void>();
/** Prévenu quand on a touché Suivre mais que personne ne montre plus cette carte. */
export function siCarteAbsente(f: () => void) { carteAbsente.add(f); return () => { carteAbsente.delete(f); }; }

/** 🗺 J'allume ou j'éteins « Suis ma carte ». */
export function montrerMaCarte(on: boolean) {
  if (!salle || etat?.phase !== 'en_ligne') return;
  if (etat.muette && !on) { envoyerCarte({ carteFin: true }); void raccrocher(); return; }
  changer({ ...etat, jeMontre: on, suit: on ? null : etat.suit });
  if (!on) envoyerCarte({ carteFin: true });
}
/**
 * File d'envoi de « Suis ma carte » (Seb, 27/11 : le suivi se figeait au bout de quelques secondes). Producteur-
 * consommateur, mais sans file qui grossit : par nature de message (vue, traces, trait, profil), on ne garde que le
 * DERNIER état, et un seul envoi est en route à la fois. Si le réseau ralentit, les états intermédiaires sautent
 * (le trait de l'instant t remplace celui de t-1) au lieu de s'empiler. La vue part en « rapide » (perte acceptée,
 * jamais de bouchon) ; le reste en « sûr ». Un envoi sûr bloqué plus de 6 s repart en rapide.
 */
const enAttente = new Map<string, MsgCarte>();
const enRoute = new Map<string, number>();
/**
 * Ordre des messages de carte. Le canal « rapide » ne garde pas l'ordre, et il est distinct du canal « sûr » : une
 * vue pouvait arriver après la fin de la carte (le buddy se remettait à suivre quelqu'un qui ne montre plus rien,
 * pour toujours), ou une vieille vue après une neuve. Chaque « j'allume » ouvre une époque `s`, plus grande que
 * toutes celles vues dans l'appel (horloge de Lamport : l'heure du téléphone ne sert que de point de départ) ;
 * chaque message y porte un numéro `n`. Celui qui reçoit jette ce qui est d'une époque finie ou d'un numéro dépassé.
 * Deux buddies qui allument en même temps : la plus grande époque garde la main, l'autre s'éteint (avant, chacun
 * s'éteignait en recevant l'autre, et plus personne ne montrait). Un message sans `s` (ancienne version) passe comme avant.
 */
let epoque = 0, epoqueVue = 0, numero = 0, suitEpoque = 0;
const finies = new Map<string, number>();
const recus = new Map<string, { s: number; n: number }>();
const natureCarte = (m: MsgCarte) => Object.keys(m)[0];
function publier(m: MsgCarte, reliable: boolean) {
  if (!salle) return Promise.resolve();
  return salle.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(m)), { reliable }).catch(() => undefined);
}
function pousser(k: string) {
  const m = enAttente.get(k);
  if (!m || enRoute.has(k) || !salle) return;
  enAttente.delete(k);
  const debut = Date.now();
  enRoute.set(k, debut);
  const bouchon = setTimeout(() => { void publier(m, false); }, 6000);
  void publier(m, true).finally(() => {
    clearTimeout(bouchon);
    if (enRoute.get(k) === debut) enRoute.delete(k);
    pousser(k);
  });
}
export function envoyerCarte(m: MsgCarte) {
  if (!salle || etat?.phase !== 'en_ligne') return;
  const k = natureCarte(m);
  // Ma carte est éteinte : un mouvement de carte encore en route (l'écran se met à jour un instant après) ne part plus.
  if (k !== 'carteFin' && !etat.jeMontre) return;
  if (k !== 'carteFin' && !epoque) epoque = Math.max(Date.now(), epoqueVue + 1);
  m = { ...m, s: epoque, n: ++numero };
  if (k === 'carte') { void publier(m, false); return; }
  if (k === 'carteFin') { enAttente.clear(); epoque = 0; } // rien de vieux ne doit arriver après la fin
  enAttente.set(k, m);
  pousser(k);
}
/** Pour les tests : vider la file. */
export function _viderFileCarte() { enAttente.clear(); enRoute.clear(); epoque = epoqueVue = numero = suitEpoque = 0; finies.clear(); recus.clear(); }
/** Pour les tests : un message de carte arrive d'un buddy. */
export function _recevoirCarte(m: MsgCarte, de: Voix) { recevoirCarte(m, de); }
/** « Reprendre ma carte » : je ne suis plus personne (jusqu'à ce qu'un buddy rallume sa carte). */
let ignore: string | null = null;
export function reprendreMaCarte() {
  if (!etat?.suit) return;
  if (etat.muette) { void raccrocher(); return; }
  ignore = etat.suit.id;
  changer({ ...etat, suit: null });
}
function recevoirCarte(m: MsgCarte, de: Voix) {
  if (!etat) return;
  const s = m.s ?? 0, n = m.n ?? 0;
  epoqueVue = Math.max(epoqueVue, s);
  if ('carteFin' in m) {
    if (s && s < (etat.suit?.id === de.id ? suitEpoque : 0)) return; // la fin d'une carte d'avant : il a rallumé depuis
    if (s) finies.set(de.id, Math.max(s, finies.get(de.id) ?? 0));
    if (ignore === de.id) ignore = null;
    if (etat.suit?.id === de.id) changer({ ...etat, suit: null });
    if (etat.muette && !etat.jeMontre && !etat.suit) { void raccrocher(); return; }
  } else {
    if (s && s <= (finies.get(de.id) ?? 0)) return; // en retard : cette carte est finie
    const k = `${de.id} ${natureCarte(m)}`, d = recus.get(k);
    if (s && n && d && d.s === s && n <= d.n) return; // doublon, ou plus vieux que le dernier reçu
    if (s && n) recus.set(k, { s, n });
    // J'ai allumé après lui : je garde la main, c'est lui qui s'éteindra en recevant la mienne.
    const moi = String(salle?.localParticipant.identity ?? '');
    if (etat.jeMontre && s && epoque && (s < epoque || (s === epoque && de.id < moi))) return;
    // Je suis déjà une carte allumée après la sienne : la sienne s'éteint.
    if (s && etat.suit && etat.suit.id !== de.id && s < suitEpoque) return;
    if (ignore !== de.id) {
      // Un autre montre sa carte : la mienne s'éteint, une seule à la fois.
      if (etat.suit?.id !== de.id || etat.jeMontre) { epoque = 0; changer({ ...etat, suit: de, jeMontre: false }); }
      suitEpoque = s;
    }
  }
  if (ignore !== de.id) cartes.forEach((f) => f(m, de));
}

/** 👉 Montrer du doigt un endroit de la carte aux autres. */
export function montrer(lon: number, lat: number) {
  if (!salle || etat?.phase !== 'en_ligne') return false;
  const d = new TextEncoder().encode(JSON.stringify({ doigt: [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5] }));
  void salle.localParticipant.publishData(d, { reliable: true });
  doigts.forEach((f) => f({ lon, lat, qui: '' }));
  return true;
}
