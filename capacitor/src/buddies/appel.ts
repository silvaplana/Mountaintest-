/**
 * 📞 Appels de groupe (spec/buddies.md §5.7, écrans 10 et 24) : l'état de l'appel, sans écran.
 * Le son passe par LiveKit (sur le VPS) ; le serveur des comptes donne le jeton d'entrée et fait sonner les autres.
 * Même rôle côté Kotlin (Appel.kt).
 */
import { Room, RoomEvent, Track, type Participant, type RemoteTrack } from 'livekit-client';
import { api } from '../compte/auth';

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
};

/** Sans réponse au bout d'une minute, l'appel s'arrête seul. */
export const ATTENTE_MS = 60_000;

let etat: EtatAppel | null = null;
let salle: Room | null = null;
let minuteur: ReturnType<typeof setTimeout> | undefined;
const abonnes = new Set<(e: EtatAppel | null) => void>();
const doigts = new Set<(p: { lon: number; lat: number; qui: string }) => void>();
const sons: HTMLMediaElement[] = [];
/** J'ai lancé l'appel : j'entends la tonalité tant que personne n'a décroché. */
let jAppelle = false;
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
function tonaliteSelon(e: EtatAppel | null) {
  const faut = jAppelle && !!e && (e.phase === 'connexion' || e.phase === 'appel');
  if (faut && !tonalite) { bip([440], 1.5, 0.15); tonalite = setInterval(() => bip([440], 1.5, 0.15), 5000); }
  if (!faut && tonalite) { clearInterval(tonalite); tonalite = undefined; }
}

export const appelEnCours = () => etat;
export function suivreAppel(f: (e: EtatAppel | null) => void) { abonnes.add(f); return () => { abonnes.delete(f); }; }
/** 👉 Montrer du doigt : un point touché par un autre pendant l'appel. */
export function suivreDoigts(f: (p: { lon: number; lat: number; qui: string }) => void) { doigts.add(f); return () => { doigts.delete(f); }; }
function changer(e: EtatAppel | null) { etat = e; tonaliteSelon(e); abonnes.forEach((f) => f(e)); }

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
  changer({ ...e, phase: 'connexion' });
  try {
    const r = await api<Reponse>('POST', `/appels/${e.id}/rejoindre`);
    if (appelEnCours()?.phase === 'connexion') await entrer(r, e.nom);
  } catch (err) { changer(null); throw err; }
}

async function entrer(r: Reponse, nom: string) {
  const room = new Room({ adaptiveStream: false, dynacast: false });
  salle = room;
  const voix = () => [...room.remoteParticipants.values()].map((p) => ({ id: p.identity, pseudo: p.name || '?' }));
  let pret = false; // celui qui rejoint ne se fait pas annoncer ceux déjà là
  const maj = () => {
    if (!etat || salle !== room) return;
    const v = voix();
    const ensemble = v.length > 0;
    // Quelqu'un décroche ou raccroche : un son, une vibration et son nom dans la barre.
    const avant = new Set(etat.voix.map((x) => x.id)), apres = new Set(v.map((x) => x.id));
    const arrives = v.filter((x) => !avant.has(x.id)), partis = etat.voix.filter((x) => !apres.has(x.id));
    let annonce = etat.annonce;
    if (!pret && !jAppelle) { /* rien à annoncer */ } else if (arrives.length) {
      bip([660, 880], 0.15); navigator.vibrate?.(200);
      annonce = { texte: `${arrives.map((x) => x.pseudo).join(' et ')} ${arrives.length > 1 ? 'ont' : 'a'} décroché`, jusqua: Date.now() + 4000 };
    } else if (partis.length) {
      bip([660, 440], 0.15);
      annonce = { texte: `${partis.map((x) => x.pseudo).join(' et ')} ${partis.length > 1 ? 'ont' : 'a'} raccroché`, jusqua: Date.now() + 4000 };
    }
    changer({ ...etat, voix: v, annonce, phase: ensemble ? 'en_ligne' : etat.phase === 'en_ligne' ? 'en_ligne' : 'appel',
      debut: etat.debut ?? (ensemble ? Date.now() : undefined) });
  };
  room.on(RoomEvent.ParticipantConnected, maj).on(RoomEvent.ParticipantDisconnected, maj)
    .on(RoomEvent.ActiveSpeakersChanged, (ps: Participant[]) => { if (etat && salle === room) changer({ ...etat, parle: ps.map((p) => p.identity) }); })
    .on(RoomEvent.TrackSubscribed, (t: RemoteTrack) => { if (t.kind === Track.Kind.Audio) { const el = t.attach(); el.style.display = 'none'; document.body.appendChild(el); sons.push(el); } })
    .on(RoomEvent.TrackUnsubscribed, (t: RemoteTrack) => { t.detach().forEach((el) => el.remove()); })
    .on(RoomEvent.DataReceived, (data: Uint8Array, p?: Participant) => {
      try {
        const m = JSON.parse(new TextDecoder().decode(data)) as { doigt?: [number, number] };
        if (m.doigt) doigts.forEach((f) => f({ lon: m.doigt![0], lat: m.doigt![1], qui: p?.name || '?' }));
      } catch { /* message inconnu : ignoré */ }
    })
    .on(RoomEvent.Disconnected, () => { if (salle === room) fini(); });
  changer({ id: r.id, nom, dest: { groupe: r.groupe ?? undefined, sortie: r.sortie ?? undefined }, phase: 'appel', voix: [], parle: [], muet: false });
  await room.connect(r.url, r.jeton);
  await room.localParticipant.setMicrophoneEnabled(true);
  void room.startAudio().catch(() => undefined);
  void api('POST', `/appels/${r.id}/presence`, { en_ligne: true }).catch(() => undefined);
  maj();
  pret = true;
  // J'appelle et personne ne répond : on raccroche seul au bout d'une minute.
  clearTimeout(minuteur);
  minuteur = setTimeout(() => { if (etat?.phase === 'appel' && salle === room) void raccrocher(); }, ATTENTE_MS);
}

function fini() {
  const id = etat?.id;
  clearTimeout(minuteur);
  sons.splice(0).forEach((el) => el.remove());
  salle = null;
  jAppelle = false;
  changer(null);
  if (id) void api('POST', `/appels/${id}/presence`, { en_ligne: false }).catch(() => undefined);
}

export async function raccrocher() {
  const room = salle;
  if (!room) { changer(null); return; }
  fini(); // salle oubliée d'abord : la déconnexion qui suit ne refait pas fini()
  await room.disconnect().catch(() => undefined);
}

export async function couperMicro(muet: boolean) {
  if (!salle || !etat) return;
  await salle.localParticipant.setMicrophoneEnabled(!muet);
  changer({ ...etat, muet });
}

/** 👉 Montrer du doigt un endroit de la carte aux autres. */
export function montrer(lon: number, lat: number) {
  if (!salle || etat?.phase !== 'en_ligne') return false;
  const d = new TextEncoder().encode(JSON.stringify({ doigt: [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5] }));
  void salle.localParticipant.publishData(d, { reliable: true });
  doigts.forEach((f) => f({ lon, lat, qui: '' }));
  return true;
}
