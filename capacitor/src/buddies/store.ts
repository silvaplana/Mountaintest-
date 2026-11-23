/**
 * Buddies, bloc 1 : copie locale des Buddy Groups et file d'attente (spec/buddies.md §3.1).
 * Même fonctionnement côté Kotlin (Buddies.kt) : les garder identiques. Serveur : deploy/comptes/buddies.py.
 *
 * - L'appli n'affiche que la copie locale : sans réseau tout s'ouvre, avec l'heure de la dernière synchro.
 * - Chaque action (créer un groupe, inviter, quitter…) est une opération gardée sur le téléphone, appliquée
 *   tout de suite à l'écran (marquée 🕓), et envoyée au serveur dès qu'il y a du réseau.
 * - Ce qu'on voit = la dernière version du serveur + les opérations pas encore envoyées.
 * - Identifiants et codes d'invitation choisis par le téléphone : on peut inviter par SMS sans réseau,
 *   et renvoyer une opération ne fait jamais de doublon.
 */
import { envoyer as envoyerFichier, oublier as oublierFichier } from './album';
import { api, connecte, lire as lireCompte, nomAffiche, suivre as suivreCompte } from '../compte/auth';

export const LIEN_INVITATION = 'https://silvaplana.cloud/mountaintest/rejoindre.html?c=';
const CLE = 'buddies';

export type Canal = 'sms' | 'mail' | 'contacts' | 'qr' | 'lien';
export type Buddy = { id: string; pseudo: string; photo: string | null; role?: 'admin' | 'membre' };
export type Invitation = { id: string; code: string; canal: Canal; nom: string; contact: string; par: string; attente?: boolean };
export type Groupe = {
  id: string; nom: string; nature: 'bande' | 'me_time'; photo: string | null; modifie_le: string;
  membres: Buddy[]; invitations: Invitation[]; attente?: boolean;
};
/** Carnet d'un Buddy Time (spec §5.8) : le texte de chaque buddy, une fiche par jour (facultative), ce que la trace ne dit pas. */
export type Recit = { par: Buddy; texte: string; modifie_le: string; attente?: boolean };
/** Ce qui est tapé à la main : duree en minutes, distance et denivele en mètres (null : pris dans la trace du jour). */
export type Fiche = { jour: string; nom: string; depart: string; duree: number | null; distance: number | null; denivele: number | null };
export type CarnetBuddy = { difficulte: string; meteo: string; conditions: string; recits: Recit[]; fiches: Fiche[] };
export const carnetVide = (): CarnetBuddy => ({ difficulte: '', meteo: '', conditions: '', recits: [], fiches: [] });
/** Buddy Time (spec §5.4). Dates du calendrier AAAA-MM-JJ. */
export type Sortie = {
  id: string; groupe: string; nom: string; photo: string | null; debut: string; fin: string; lieu: string; modifie_le: string;
  participants: Buddy[]; invitations: Invitation[]; carnet?: CarnetBuddy; attente?: boolean;
};
/** Trace partagée dans un Buddy Time ou un Buddy Group (panneau de partage, spec §3.4). */
export type TraceBuddy = {
  id: string; sortie: string | null; groupe: string | null; nom: string; ligne: [number, number][]; mot: string;
  par: Buddy; cree_le: string; attente?: boolean;
};
/** Planning de saison (spec §5.5) : dates proposées à une bande ; `dates` = [[début, fin], …]. */
export type Etat3 = 'oui' | 'peut' | 'non';
export type Dispo = { qui: string; debut: string; etat: Etat3; mot: string };
export type Planning = {
  id: string; groupe: string; nom: string; par: Buddy; dates: [string, string][]; limite: string; modifie_le: string;
  dispos: Dispo[]; attente?: boolean;
};
/** Photo de l'album d'un Buddy Time (spec §5.8). prise_le : heure locale AAAA-MM-JJTHH:MM:SS. */
export type PhotoBuddy = {
  id: string; sortie: string; par: Buddy; prise_le: string; lon: number | null; lat: number | null; etoile: boolean;
  envoyee: boolean; modifie_le: string; attente?: boolean;
};
/** Buddy count (spec §5.10) : une dépense d'un Buddy Time ; montant en centimes, pour = identifiants des buddies. */
export type Depense = {
  id: string; sortie: string; titre: string; montant: number; paye_par: string; pour: string[]; jour: string; par: string; modifie_le: string;
  attente?: boolean;
};
/** 🏨 Hébergement proposé dans un Buddy Time (§5.11) : ♥ de chacun (identifiants), ✅ retenu. Prix par nuit, en euros. */
export type Hebergement = {
  id: string; sortie: string; nom: string; nature: string; prix_nuit: number | null; adresse: string; url: string; resume: string;
  lon: number | null; lat: number | null; retenu: boolean; par: string; coeurs: string[]; cree_le?: string; modifie_le: string; attente?: boolean;
};
/** 💬 Message d'un Buddy Group ou d'un Buddy Time (§5.6) : texte, « je suis ici » (point) ou photo de l'album. */
export type MessageBuddy = {
  id: string; groupe: string | null; sortie: string | null; par: string; nature: 'texte' | 'point' | 'photo'; texte: string;
  lon: number | null; lat: number | null; photo: string | null; cree_le: string; attente?: boolean;
};
/** 📍 Position d'un buddy dans un Buddy Time (§5.9) : son épingle (ms) et sa dernière position. */
export type Position = {
  sortie: string; qui: string; depuis: number; jusqu: number; lon: number | null; lat: number | null; alt: number | null; prise_le: number | null;
  attente?: boolean;
};
export type Op = { id: string; type: string; t: number; [k: string]: unknown };

export type Etat = {
  /** Dernière version reçue du serveur. */
  serveur: Groupe[];
  sorties: Sortie[];
  traces: TraceBuddy[];
  plannings: Planning[];
  photos: PhotoBuddy[];
  depenses?: Depense[];
  positions?: Position[];
  hebergements?: Hebergement[];
  messages?: MessageBuddy[];
  /** 💬 Dernière lecture de chaque conversation (ms), par identifiant de Buddy Group ou de Buddy Time. */
  lus?: Record<string, number>;
  /** Mes photos annoncées dont le fichier n'est pas encore parti. */
  envois?: string[];
  curseur?: string;
  /** Mon identifiant côté serveur. */
  moi?: string;
  /** Opérations faites sur le téléphone, pas encore envoyées. */
  attente: Op[];
  /** Dernière synchro réussie (ms). */
  synchro?: number;
  /** Dernière ouverture de Buddies (ms) : pastille de 👥. */
  vu?: number;
};

// ------------------------------------------------------------------ stockage

let memoire: Etat | null = null;
const vide = (): Etat => ({ serveur: [], sorties: [], traces: [], plannings: [], photos: [], attente: [] });
export function lire(): Etat {
  if (memoire) return memoire;
  try { memoire = { ...vide(), ...JSON.parse(localStorage.getItem(CLE) ?? '{}') as Etat }; } catch { memoire = vide(); }
  return memoire;
}
function ecrire(e: Etat) {
  memoire = e;
  try { localStorage.setItem(CLE, JSON.stringify(e)); } catch { /* stockage plein ou bloqué */ }
  for (const f of abonnes) f(e);
}
const abonnes = new Set<(e: Etat) => void>();
export function suivre(f: (e: Etat) => void) { abonnes.add(f); return () => { abonnes.delete(f); }; }

// Déconnexion : on oublie les Buddies de ce compte. Connexion : on envoie ce qui attendait (un lien d'invitation ouvert avant).
let etaitConnecte = connecte();
suivreCompte((c) => {
  const maintenant = !!c.refresh;
  if (!maintenant && (lire().serveur.length || lire().attente.length)) ecrire(vide());
  if (maintenant && !etaitConnecte) setTimeout(() => void synchroniser().catch(() => undefined), 0);
  etaitConnecte = maintenant;
});

// ------------------------------------------------------------------ outils

export function uuid(): string { return crypto.randomUUID(); }
/** Code d'invitation : 20 caractères au hasard (120 bits), assez pour ne pas être deviné. */
export function nouveauCode(): string {
  const a = new Uint8Array(15); crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_');
}
export const lien = (code: string) => LIEN_INVITATION + code;

function moiBuddy(e: Etat): Buddy {
  const c = lireCompte();
  return { id: e.moi ?? 'moi', pseudo: nomAffiche(c), photo: c.profil?.photo ?? null, role: 'admin' };
}

/** Buddy Times et traces partagées tels qu'affichés (version du serveur + opérations en attente). */
export function vue(e: Etat): {
  sorties: Sortie[]; traces: TraceBuddy[]; plannings: Planning[]; photos: PhotoBuddy[]; depenses: Depense[]; hebergements: Hebergement[];
  messages: MessageBuddy[];
} {
  const groupes = appliquer(e);
  const meTime = groupes.find((g) => g.nature === 'me_time')!;
  const sorties: Sortie[] = e.sorties.map((x) => ({ ...x, invitations: [...x.invitations] }));
  const traces: TraceBuddy[] = [...e.traces];
  const plannings: Planning[] = (e.plannings ?? []).map((p) => ({ ...p, dispos: [...p.dispos] }));
  const moi = e.moi ?? 'moi';
  let photos: PhotoBuddy[] = (e.photos ?? []).map((x) => ({ ...x }));
  let depenses: Depense[] = [...(e.depenses ?? [])];
  let hebergements: Hebergement[] = (e.hebergements ?? []).map((h) => ({ ...h, coeurs: [...h.coeurs] }));
  let messages: MessageBuddy[] = [...(e.messages ?? [])];
  const quand = (op: Op) => new Date(op.t).toISOString();
  for (const op of e.attente) {
    if (op.type === 'creer_sortie' && !sorties.some((x) => x.id === op.sortie)) {
      const g = groupes.find((x) => x.id === op.groupe) ?? meTime;
      const qui = new Set([...(op.participants as string[] ?? []), e.moi ?? 'moi']);
      sorties.push({ id: String(op.sortie), groupe: g.id, nom: String(op.nom), photo: (op.photo as string) ?? null, debut: String(op.debut),
        fin: String(op.fin), lieu: String(op.lieu ?? ''), modifie_le: quand(op), attente: true,
        participants: [moiBuddy(e), ...g.membres.filter((m) => qui.has(m.id) && m.id !== (e.moi ?? 'moi'))], invitations: [] });
    } else if (op.type === 'inviter' && op.sortie) {
      const x = sorties.find((y) => y.id === op.sortie);
      if (x && !x.invitations.some((i) => i.id === op.invitation)) x.invitations.push({ id: String(op.invitation), code: String(op.code),
        canal: op.canal as Canal, nom: String(op.nom ?? ''), contact: String(op.contact ?? ''), par: e.moi ?? 'moi', attente: true });
    } else if (op.type === 'partager_trace' && !traces.some((t) => t.id === op.trace)) {
      traces.push({ id: String(op.trace), sortie: (op.sortie as string) ?? null, groupe: (op.groupe as string) ?? null, nom: String(op.nom),
        ligne: op.ligne as [number, number][], mot: String(op.mot ?? ''), par: moiBuddy(e), cree_le: quand(op), attente: true });
      const x = sorties.find((y) => y.id === op.sortie);
      if (x) x.modifie_le = quand(op);
    } else if (op.type === 'creer_planning' && !plannings.some((p) => p.id === op.planning)) {
      plannings.push({ id: String(op.planning), groupe: String(op.groupe), nom: String(op.nom), par: moiBuddy(e),
        dates: op.dates as [string, string][], limite: String(op.limite), modifie_le: quand(op), dispos: [], attente: true });
    } else if (op.type === 'dispo') {
      const p = plannings.find((x) => x.id === op.planning);
      if (!p) continue;
      p.dispos = p.dispos.filter((d) => !(d.qui === moi && d.debut === op.debut));
      if (op.etat) p.dispos.push({ qui: moi, debut: String(op.debut), etat: op.etat as Etat3, mot: String(op.mot ?? '') });
      p.attente = true;
    } else if (op.type === 'ajouter_photo' && !photos.some((x) => x.id === op.photo)) {
      photos.push({ id: String(op.photo), sortie: String(op.sortie), par: moiBuddy(e), prise_le: String(op.prise_le),
        lon: (op.lon as number) ?? null, lat: (op.lat as number) ?? null, etoile: false, envoyee: false, modifie_le: quand(op), attente: true });
      const x = sorties.find((y) => y.id === op.sortie);
      if (x) x.modifie_le = quand(op);
    } else if (op.type === 'etoile') {
      photos = photos.map((x) => x.id === op.photo ? { ...x, etoile: !!op.etoile } : x);
    } else if (op.type === 'retirer_photo') {
      photos = photos.filter((x) => x.id !== op.photo);
    } else if (op.type === 'depense') {
      const avant = depenses.find((x) => x.id === op.depense);
      const d: Depense = { id: String(op.depense), sortie: avant?.sortie ?? String(op.sortie), titre: String(op.titre), montant: Number(op.montant),
        paye_par: String(op.paye_par), pour: op.pour as string[], jour: String(op.jour), par: avant?.par ?? moi, modifie_le: quand(op), attente: true };
      depenses = [...depenses.filter((x) => x.id !== d.id), d];
    } else if (op.type === 'retirer_depense') {
      depenses = depenses.filter((x) => x.id !== op.depense);
    } else if (op.type === 'proposer_hebergement' && !hebergements.some((h) => h.id === op.hebergement)) {
      hebergements.push({ id: String(op.hebergement), sortie: String(op.sortie), nom: String(op.nom), nature: String(op.nature ?? ''),
        prix_nuit: op.prix_nuit == null ? null : Math.round(Number(op.prix_nuit)), adresse: String(op.adresse ?? ''), url: String(op.url ?? ''),
        resume: String(op.resume ?? ''), lon: (op.lon as number) ?? null, lat: (op.lat as number) ?? null, retenu: false, par: moi, coeurs: [],
        modifie_le: quand(op), attente: true });
    } else if (op.type === 'coeur') {
      hebergements = hebergements.map((h) => h.id !== op.hebergement ? h
        : { ...h, coeurs: [...h.coeurs.filter((c) => c !== moi), ...(op.coeur ? [moi] : [])], attente: true });
    } else if (op.type === 'retenir_hebergement') {
      const h = hebergements.find((x) => x.id === op.hebergement);
      if (h) hebergements = hebergements.map((x) => x.id === h.id ? { ...x, retenu: !!op.retenu, attente: true }
        : x.sortie === h.sortie && op.retenu ? { ...x, retenu: false } : x);
    } else if (op.type === 'retirer_hebergement') {
      hebergements = hebergements.filter((h) => h.id !== op.hebergement);
    } else if (op.type === 'message' && !messages.some((m) => m.id === op.message)) {
      messages.push({ id: String(op.message), groupe: (op.groupe as string) ?? null, sortie: (op.sortie as string) ?? null, par: moi,
        nature: op.nature as MessageBuddy['nature'], texte: String(op.texte ?? ''), lon: (op.lon as number) ?? null, lat: (op.lat as number) ?? null,
        photo: (op.photo as string) ?? null, cree_le: quand(op), attente: true });
    } else if (op.type === 'retirer_message') {
      messages = messages.filter((m) => m.id !== op.message);
    } else if (op.type === 'recit' || op.type === 'fiche' || op.type === 'carnet') {
      const k = sorties.findIndex((y) => y.id === op.sortie);
      if (k < 0) continue;
      const c = { ...carnetVide(), ...sorties[k].carnet };
      if (op.type === 'recit') {
        c.recits = c.recits.filter((r) => r.par.id !== moi);
        if (op.texte) c.recits.push({ par: moiBuddy(e), texte: String(op.texte), modifie_le: quand(op), attente: true });
      } else if (op.type === 'fiche') {
        const f: Fiche = { jour: String(op.jour), nom: String(op.nom ?? ''), depart: String(op.depart ?? ''),
          duree: (op.duree as number) ?? null, distance: (op.distance as number) ?? null, denivele: (op.denivele as number) ?? null };
        c.fiches = [...c.fiches.filter((x) => x.jour !== f.jour), ...(ficheVide(f) ? [] : [f])].sort((a, b) => a.jour.localeCompare(b.jour));
      } else {
        c.difficulte = String(op.difficulte ?? ''); c.meteo = String(op.meteo ?? ''); c.conditions = String(op.conditions ?? '');
      }
      sorties[k] = { ...sorties[k], carnet: c, modifie_le: quand(op), attente: true };
    }
  }
  // Mes fichiers pas encore partis : 🕓 sur la photo.
  const envois = new Set(e.envois ?? []);
  photos = photos.map((x) => envois.has(x.id) ? { ...x, attente: true } : x).sort((a, b) => a.prise_le.localeCompare(b.prise_le));
  // Le plus récemment actif en haut.
  return { sorties: sorties.sort((a, b) => b.modifie_le.localeCompare(a.modifie_le)), traces,
    plannings: plannings.sort((a, b) => b.modifie_le.localeCompare(a.modifie_le)), photos,
    depenses: depenses.sort((a, b) => b.jour.localeCompare(a.jour) || b.modifie_le.localeCompare(a.modifie_le)),
    // Le retenu en haut, puis les plus aimés, puis les moins chers.
    hebergements: hebergements.sort((a, b) => Number(b.retenu) - Number(a.retenu) || b.coeurs.length - a.coeurs.length
      || (a.prix_nuit ?? Infinity) - (b.prix_nuit ?? Infinity)),
    messages: messages.sort((a, b) => a.cree_le.localeCompare(b.cree_le)) };
}

/** 📍 Positions telles qu'affichées : celles du serveur, avec mon épingle et ma dernière position en attente. */
export function positions(e: Etat): Position[] {
  const moi = e.moi ?? 'moi';
  let l = (e.positions ?? []).map((p) => ({ ...p }));
  for (const op of e.attente) {
    if (op.type !== 'epingle' && op.type !== 'position') continue;
    const sortie = String(op.sortie);
    let p = l.find((x) => x.sortie === sortie && x.qui === moi);
    if (op.type === 'epingle' && op.enfoncee) {
      const n: Position = { sortie, qui: moi, depuis: Number(op.quand), jusqu: Number(op.jusqu), lon: p?.lon ?? null, lat: p?.lat ?? null,
        alt: p?.alt ?? null, prise_le: p?.prise_le ?? null, attente: true };
      l = [...l.filter((x) => x !== p), n];
    } else if (op.type === 'epingle' && p) {
      p.jusqu = Math.min(p.jusqu, Number(op.quand)); p.attente = true;
    } else if (op.type === 'position' && p && Number(op.prise_le) > (p.prise_le ?? 0)
      && Number(op.prise_le) >= p.depuis - 60_000 && Number(op.prise_le) <= p.jusqu + 60_000) {
      Object.assign(p, { lon: op.lon, lat: op.lat, alt: op.alt ?? null, prise_le: Number(op.prise_le), attente: true });
    }
  }
  return l;
}
/** Le Buddy Time où mon épingle est enfoncée en ce moment (un seul à la fois). */
export function monEpingle(e: Etat = lire(), t = Date.now()): Position | undefined {
  const moi = e.moi ?? 'moi';
  return positions(e).filter((p) => p.qui === moi && p.depuis <= t + 60_000 && p.jusqu > t).sort((a, b) => b.depuis - a.depuis)[0];
}

/** Aujourd'hui en AAAA-MM-JJ (heure du téléphone). */
export function aujourdhui(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Le Buddy Time en cours, sinon le prochain : en grand en haut de la liste. */
export function prochaine(sorties: Sortie[], auj = aujourdhui()): Sortie | undefined {
  return sorties.filter((x) => x.fin >= auj).sort((a, b) => a.debut.localeCompare(b.debut))[0];
}
/** Nombre de jours avant le départ (0 = aujourd'hui ; négatif = déjà parti). */
export function joursAvant(x: Sortie, auj = aujourdhui()) {
  return Math.round((Date.parse(x.debut) - Date.parse(auj)) / 86400e3);
}

// ------------------------------------------------------------------ planning de saison (§5.5)

const iso = (d: Date) => aujourdhui(d);
/**
 * Dates proposées d'un mois à l'autre (« 2026-12 » à « 2027-03 ») : les week-ends (samedi-dimanche),
 * ou tous les jours (« à la carte » part de tous les jours, aucun coché).
 */
export function datesPlanning(de: string, a: string, mode: 'weekends' | 'jours'): [string, string][] {
  const [y0, m0] = de.split('-').map(Number); const [y1, m1] = a.split('-').map(Number);
  const out: [string, string][] = [];
  for (let d = new Date(y0, m0 - 1, 1); d < new Date(y1, m1, 1); d.setDate(d.getDate() + 1)) {
    if (mode === 'jours') out.push([iso(d), iso(d)]);
    else if (d.getDay() === 6) { const dim = new Date(d); dim.setDate(d.getDate() + 1); out.push([iso(d), iso(dim)]); }
  }
  return out;
}
/** Mes dates encore à remplir (pas passées). */
export function aRemplir(p: Planning, moi: string, auj = aujourdhui()) {
  return p.dates.filter(([d, f]) => f >= auj && !p.dispos.some((x) => x.qui === moi && x.debut === d)).length;
}
/** Une ligne du planning devenue Buddy Time : le Buddy Time du groupe qui part ce jour-là. */
export const sortieDeLigne = (sorties: Sortie[], p: Planning, debut: string) => sorties.find((x) => x.groupe === p.groupe && x.debut === debut);

// ------------------------------------------------------------------ album (§5.8)

/** Photos rangées par jour du Buddy Time : « Jour 1 », « Jour 2 »… (avant ou après : jour 0 ou au-delà). */
export function parJour(photos: PhotoBuddy[], x: Sortie) {
  const jours = new Map<string, PhotoBuddy[]>();
  for (const p of photos) { const j = p.prise_le.slice(0, 10); jours.set(j, [...(jours.get(j) ?? []), p]); }
  return [...jours.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([jour, l]) => ({ jour, n: Math.round((Date.parse(jour) - Date.parse(x.debut)) / 86400e3) + 1, photos: l }));
}

// ------------------------------------------------------------------ carnet (§5.8)

export const ficheVide = (f: Omit<Fiche, 'jour'>) => !f.nom && !f.depart && f.duree == null && f.distance == null && f.denivele == null;

/** Applique les opérations en attente à la version du serveur : ce que montre l'écran. */
export function appliquer(e: Etat): Groupe[] {
  const gs: Groupe[] = e.serveur.map((g) => ({ ...g, membres: [...g.membres], invitations: [...g.invitations] }));
  const trouver = (id: unknown) => gs.find((g) => g.id === id);
  const quand = (op: Op) => new Date(op.t).toISOString();
  for (const op of e.attente) {
    const g = trouver(op.groupe);
    switch (op.type) {
      case 'creer_groupe':
        if (!g) gs.push({ id: String(op.groupe), nom: String(op.nom), nature: 'bande', photo: (op.photo as string) ?? null,
          modifie_le: quand(op), membres: [moiBuddy(e)], invitations: [], attente: true });
        break;
      case 'inviter':
        if (!op.sortie && g && !g.invitations.some((i) => i.id === op.invitation)) {
          g.invitations.push({ id: String(op.invitation), code: String(op.code), canal: op.canal as Canal, nom: String(op.nom ?? ''),
            contact: String(op.contact ?? ''), par: e.moi ?? 'moi', attente: true });
          g.modifie_le = quand(op);
        }
        break;
      case 'annuler_invitation':
        for (const x of gs) x.invitations = x.invitations.filter((i) => i.id !== op.invitation);
        break;
      case 'quitter':
        if (g) gs.splice(gs.indexOf(g), 1);
        break;
      case 'retirer':
        if (g) g.membres = g.membres.filter((m) => m.id !== op.buddy);
        break;
      case 'nommer_admin':
        if (g) g.membres = g.membres.map((m) => m.id === op.buddy ? { ...m, role: 'admin' } : m);
        break;
    }
  }
  // Me Time existe toujours, même avant la première synchro.
  if (!gs.some((g) => g.nature === 'me_time')) {
    gs.push({ id: 'me-time', nom: 'Me Time', nature: 'me_time', photo: null, modifie_le: new Date(0).toISOString(), membres: [moiBuddy(e)], invitations: [] });
  }
  // Façon WhatsApp : le plus récemment actif en haut.
  return gs.sort((a, b) => b.modifie_le.localeCompare(a.modifie_le));
}

/** Invitations reçues (liens ouverts) qui attendent le réseau pour faire entrer dans le groupe. */
export const rejointsEnAttente = (e: Etat = lire()) => e.attente.filter((o) => o.type === 'rejoindre');

/** Nombre de Buddy Groups qui ont bougé depuis la dernière ouverture de Buddies (pastille de 👥). */
export function nouveautes(e: Etat = lire()): number {
  const vu = e.vu ?? 0;
  return e.serveur.filter((g) => Date.parse(g.modifie_le) > vu && g.nature === 'bande').length
    + e.sorties.filter((x) => Date.parse(x.modifie_le) > vu).length
    + (e.plannings ?? []).filter((x) => Date.parse(x.modifie_le) > vu).length;
}
export function marquerVu() { ecrire({ ...lire(), vu: Date.now() }); }

export const estAdmin = (g: Groupe, e: Etat = lire()) => g.membres.some((m) => (m.id === e.moi || m.id === 'moi') && m.role === 'admin');

// ------------------------------------------------------------------ actions (tout de suite à l'écran)

function ajouter(...ops: Omit<Op, 'id' | 't'>[]) {
  const t = Date.now();
  ecrire({ ...lire(), attente: [...lire().attente, ...ops.map((o) => ({ ...o, id: uuid(), t }) as Op)] });
  void synchroniser().catch(() => undefined);
}

export type NouvelleInvitation = { canal: Canal; nom: string; contact: string; code: string };

/** Nouveau Buddy Group avec ses premières invitations (déjà envoyées par SMS, mail ou QR). */
export function creerGroupe(nom: string, photo: string | null, invitations: NouvelleInvitation[]): string {
  const n = nom.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!n) throw new Error('Donne un nom au Buddy Group');
  const groupe = uuid();
  ajouter({ type: 'creer_groupe', groupe, nom: n, photo },
    ...invitations.map((i) => ({ type: 'inviter', groupe, invitation: uuid(), ...i })));
  return groupe;
}
export const inviter = (groupe: string, i: NouvelleInvitation) => ajouter({ type: 'inviter', groupe, invitation: uuid(), ...i });

export type NouvelleSortie = { groupe: string; nom: string; photo: string | null; debut: string; fin: string; lieu: string; participants: string[] };
/** Nouveau Buddy Time ; dans Me Time, les copains invités à l'unité (`invitations`). */
export function creerSortie(n: NouvelleSortie, invitations: NouvelleInvitation[] = []): string {
  const nom = n.nom.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!nom) throw new Error('Donne un nom au Buddy Time');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(n.debut)) throw new Error('Choisis la date de départ');
  const fin = n.fin && n.fin >= n.debut ? n.fin : n.debut;
  const sortie = uuid();
  ajouter({ type: 'creer_sortie', sortie, ...n, nom, fin },
    ...invitations.map((i) => ({ type: 'inviter', sortie, invitation: uuid(), ...i })));
  return sortie;
}
/** Partager une trace dans des Buddy Times et des Buddy Groups (un envoi par destination). */
export function partagerTrace(nom: string, ligne: [number, number][], mot: string, dest: { sorties: string[]; groupes: string[] }) {
  const pts = ligne.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]);
  ajouter(...dest.sorties.map((sortie) => ({ type: 'partager_trace', trace: uuid(), sortie, nom, ligne: pts, mot })),
    ...dest.groupes.map((groupe) => ({ type: 'partager_trace', trace: uuid(), groupe, nom, ligne: pts, mot })));
}
/** Publier un planning de saison pour une bande. */
export function creerPlanning(n: { groupe: string; nom: string; dates: [string, string][]; limite: string }): string {
  const nom = n.nom.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!nom) throw new Error('Donne un nom au planning');
  if (!n.dates.length) throw new Error('Coche au moins une date');
  const planning = uuid();
  ajouter({ type: 'creer_planning', planning, ...n, nom, dates: [...n.dates].sort((a, b) => a[0].localeCompare(b[0])) });
  return planning;
}
/** Ma réponse pour une date (etat vide : j'efface). */
export const repondre = (planning: string, debut: string, etat: Etat3 | '', mot = '') =>
  ajouter({ type: 'dispo', planning, debut, etat, mot: mot.trim().slice(0, 200) });
/** Déposer des photos déjà réduites et gardées sur le téléphone (album.ts) : elles partent au retour du réseau. */
export function deposerPhotos(sortie: string, l: { photo: string; prise_le: string; lon: number | null; lat: number | null }[]) {
  if (!l.length) return;
  ecrire({ ...lire(), envois: [...(lire().envois ?? []), ...l.map((x) => x.photo)] });
  ajouter(...l.map((x) => ({ type: 'ajouter_photo', sortie, ...x })));
}
export const mettreEtoile = (photo: string, etoile: boolean) => ajouter({ type: 'etoile', photo, etoile });
export function retirerPhoto(photo: string) {
  ecrire({ ...lire(), envois: (lire().envois ?? []).filter((x) => x !== photo) });
  ajouter({ type: 'retirer_photo', photo });
  void oublierFichier(photo);
}
/**
 * Enregistrer le carnet (écran 14) : seulement ce qui a changé. Mon texte (vide : je l'efface), les fiches des jours
 * (toute vide : elle disparaît), difficulté, météo et conditions.
 */
export function enregistrerCarnet(sortie: string, ch: { recit?: string; fiches?: Fiche[]; carnet?: { difficulte: string; meteo: string; conditions: string } }) {
  const ops: Omit<Op, 'id' | 't'>[] = [];
  if (ch.recit != null) ops.push({ type: 'recit', sortie, texte: ch.recit.trim().slice(0, 5000) });
  for (const f of ch.fiches ?? []) ops.push({ type: 'fiche', sortie, ...f, nom: f.nom.trim().slice(0, 80) });
  if (ch.carnet) ops.push({ type: 'carnet', sortie, difficulte: ch.carnet.difficulte.trim(), meteo: ch.carnet.meteo.trim(), conditions: ch.carnet.conditions.trim() });
  if (ops.length) ajouter(...ops);
}
/** Buddy count : ajouter (sans `depense`) ou corriger une dépense ; montant en centimes. Rend son identifiant. */
export function enregistrerDepense(d: { depense?: string; sortie: string; titre: string; montant: number; paye_par: string; pour: string[]; jour: string }) {
  if (!(d.montant > 0)) throw new Error('Indique le montant');
  if (!d.pour.length) throw new Error('Coche au moins un buddy');
  const depense = d.depense ?? uuid();
  ajouter({ type: 'depense', ...d, depense, titre: d.titre.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Dépense', montant: Math.round(d.montant) });
  return depense;
}
/** L'épingle se relève seule ce soir à 22 h (à minuit si on l'enfonce après 21 h). */
export function finEpingle(d = new Date()): number {
  const f = new Date(d); f.setHours(22, 0, 0, 0);
  if (d.getHours() >= 21) f.setHours(23, 59, 59, 0);
  return f.getTime();
}
/** 📍 Enfoncer l'épingle dans ce Buddy Time (et la relever ailleurs : une seule à la fois). */
export function enfoncerEpingle(sortie: string, t = Date.now()) {
  const autre = monEpingle(lire(), t);
  ajouter(...(autre && autre.sortie !== sortie ? [{ type: 'epingle', sortie: autre.sortie, enfoncee: false, quand: t }] : []),
    { type: 'epingle', sortie, enfoncee: true, quand: t, jusqu: finEpingle(new Date(t)) });
}
export const releverEpingle = (sortie: string, t = Date.now()) => ajouter({ type: 'epingle', sortie, enfoncee: false, quand: t });
/** Une position du GPS pendant que l'épingle est enfoncée : seule la dernière attend le réseau. */
export function envoyerPosition(f: { lat: number; lon: number; alt?: number | null; t: number }) {
  const p = monEpingle(lire(), f.t);
  if (!p) return;
  const op = { type: 'position', sortie: p.sortie, lat: Math.round(f.lat * 1e6) / 1e6, lon: Math.round(f.lon * 1e6) / 1e6,
    alt: f.alt == null ? null : Math.round(f.alt), prise_le: f.t, id: uuid(), t: Date.now() } as Op;
  ecrire({ ...lire(), attente: [...lire().attente.filter((o) => o.type !== 'position'), op] });
  void synchroniser().catch(() => undefined);
}
/** 🏨 Proposer un hébergement (trouvé par la recherche) dans un ou plusieurs Buddy Times. */
export function proposerHebergement(sorties: string[], h: { nom: string; nature: string; prix_nuit: number | null; adresse: string; url: string;
  resume: string; lon: number | null; lat: number | null }) {
  if (sorties.length) ajouter(...sorties.map((sortie) => ({ type: 'proposer_hebergement', hebergement: uuid(), sortie, ...h,
    nom: h.nom.trim().slice(0, 80), nature: h.nature.slice(0, 40), adresse: h.adresse.slice(0, 160), resume: h.resume.slice(0, 300),
    url: /^https?:\/\//.test(h.url) ? h.url.slice(0, 500) : '' })));
}
/** 💬 Envoyer dans la conversation d'un Buddy Group ou d'un Buddy Time ; part au retour du réseau. */
export function envoyerMessage(dest: { groupe?: string; sortie?: string }, m: { nature?: MessageBuddy['nature']; texte?: string; lon?: number; lat?: number; photo?: string }) {
  const texte = (m.texte ?? '').trim().slice(0, 2000);
  const nature = m.nature ?? 'texte';
  if (nature === 'texte' && !texte) return;
  ajouter({ type: 'message', message: uuid(), ...(dest.sortie ? { sortie: dest.sortie } : { groupe: dest.groupe }), nature, texte,
    ...(m.lon != null && m.lat != null ? { lon: Math.round(m.lon * 1e6) / 1e6, lat: Math.round(m.lat * 1e6) / 1e6 } : {}),
    ...(m.photo ? { photo: m.photo } : {}) });
}
export const retirerMessage = (message: string) => ajouter({ type: 'retirer_message', message });
/** Conversation lue jusqu'à maintenant. */
export function marquerLu(cle: string, t = Date.now()) { ecrire({ ...lire(), lus: { ...lire().lus, [cle]: t } }); }
/** Messages des autres arrivés depuis ma dernière lecture de cette conversation. */
export function nonLus(e: Etat, cle: string, messages: MessageBuddy[]): number {
  const moi = e.moi ?? 'moi', lu = e.lus?.[cle] ?? 0;
  return messages.filter((m) => (m.groupe === cle || m.sortie === cle) && m.par !== moi && new Date(m.cree_le).getTime() > lu).length;
}
export const mettreCoeur = (hebergement: string, coeur: boolean) => ajouter({ type: 'coeur', hebergement, coeur });
export const retenirHebergement = (hebergement: string, retenu: boolean) => ajouter({ type: 'retenir_hebergement', hebergement, retenu });
export const retirerHebergement = (hebergement: string) => ajouter({ type: 'retirer_hebergement', hebergement });
export const retirerDepense = (depense: string) => ajouter({ type: 'retirer_depense', depense });
export const annulerInvitation = (invitation: string) => ajouter({ type: 'annuler_invitation', invitation });
export const quitter = (groupe: string) => ajouter({ type: 'quitter', groupe });
export const retirer = (groupe: string, buddy: string) => ajouter({ type: 'retirer', groupe, buddy });
export const nommerAdmin = (groupe: string, buddy: string) => ajouter({ type: 'nommer_admin', groupe, buddy });
/** Lien d'invitation ouvert (fr.assomoutain.rando://rejoindre?c=…). */
export function rejoindre(code: string) {
  if (!code || lire().attente.some((o) => o.type === 'rejoindre' && o.code === code)) return;
  ajouter({ type: 'rejoindre', code });
}

// ------------------------------------------------------------------ synchro

type Reponse = {
  curseur: string; moi: string; ids: string[]; groupes: Groupe[]; refus: { id: string; raison: string }[];
  ids_sorties: string[]; sorties: Sortie[]; ids_traces: string[]; traces: TraceBuddy[];
  ids_plannings: string[]; plannings: Planning[]; ids_photos: string[]; photos: PhotoBuddy[]; ids_depenses: string[]; depenses: Depense[];
  positions?: Position[];
  ids_hebergements?: string[]; hebergements?: Hebergement[];
  ids_messages?: string[]; messages?: MessageBuddy[];
};
/** Garde la version reçue de chaque objet encore visible ; `manque` si un objet n'a jamais été reçu. */
function fusion<T extends { id: string }>(avant: T[], recus: T[], ids: string[]) {
  const parId = new Map(avant.map((x) => [x.id, x]));
  for (const x of recus) parId.set(x.id, x);
  return { liste: ids.map((id) => parId.get(id)).filter((x): x is T => !!x), manque: ids.some((id) => !parId.has(id)) };
}
let enCours: Promise<string[]> | null = null;

/**
 * Envoie la file d'attente et reçoit les nouveautés. Rend les raisons des opérations refusées (à montrer).
 * Sans réseau : HorsLigne (de auth.ts), rien n'est perdu.
 */
export function synchroniser(): Promise<string[]> {
  if (!connecte()) return Promise.resolve([]);
  enCours ??= (async () => {
    try {
      const avant = lire();
      const ops = avant.attente;
      const r = await api<Reponse>('POST', '/buddies/sync', { ops: ops.map(({ t: _t, ...o }) => o), depuis: avant.curseur ?? null });
      const e = lire();
      const g = fusion(e.serveur, r.groupes, r.ids);
      const so = fusion(e.sorties ?? [], r.sorties ?? [], r.ids_sorties ?? []);
      const tr = fusion(e.traces ?? [], r.traces ?? [], r.ids_traces ?? []);
      const pl = fusion(e.plannings ?? [], r.plannings ?? [], r.ids_plannings ?? []);
      const ph = fusion(e.photos ?? [], r.photos ?? [], r.ids_photos ?? []);
      const dp = fusion(e.depenses ?? [], r.depenses ?? [], r.ids_depenses ?? []);
      const hb = fusion(e.hebergements ?? [], r.hebergements ?? [], r.ids_hebergements ?? []);
      const mg = fusion(e.messages ?? [], r.messages ?? [], r.ids_messages ?? []);
      const envoyees = new Set(ops.map((o) => o.id));
      // Un objet connu du serveur mais jamais reçu : on redemandera tout à la prochaine synchro.
      const manque = g.manque || so.manque || tr.manque || pl.manque || ph.manque || dp.manque || hb.manque || mg.manque;
      ecrire({
        ...e, moi: r.moi, curseur: manque ? undefined : r.curseur, synchro: Date.now(),
        serveur: g.liste, sorties: so.liste, traces: tr.liste, plannings: pl.liste, photos: ph.liste, depenses: dp.liste,
        positions: r.positions ?? e.positions, hebergements: hb.liste, messages: mg.liste,
        attente: e.attente.filter((o) => !envoyees.has(o.id)),
      });
      await envoyerPhotos(new Set(r.ids_photos ?? [])).catch(() => undefined); // sans réseau : au prochain tour
      return r.refus.map((x) => x.raison);
    } finally { enCours = null; }
  })();
  return enCours;
}

/** Fichiers de mes photos annoncées et acceptées par le serveur ; une photo refusée est oubliée. */
async function envoyerPhotos(connues: Set<string>) {
  for (const id of lire().envois ?? []) {
    const annoncee = lire().attente.some((o) => o.type === 'ajouter_photo' && o.photo === id);
    if (connues.has(id)) await envoyerFichier(id);
    else if (annoncee) continue;
    ecrire({ ...lire(), envois: (lire().envois ?? []).filter((x) => x !== id) });
  }
}

/** Pour les tests. */
export function _reinitialiser() { memoire = null; abonnes.clear(); enCours = null; }
