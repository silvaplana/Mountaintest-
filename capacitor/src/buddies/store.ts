/**
 * Buddies, bloc 1 : copie locale des groupes et file d'attente (spec/buddies.md §3.1).
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
import { envoyer as envoyerFichierMessage, oublier as oublierFichierMessage } from './fichiers';
import { api, connecte, lire as lireCompte, nomAffiche, suivre as suivreCompte } from '../compte/auth';

export const LIEN_INVITATION = 'https://silvaplana.cloud/mountaintest/rejoindre.html?c=';
const CLE = 'buddies';

export type Canal = 'sms' | 'mail' | 'contacts' | 'qr' | 'lien';
/** role : dans un groupe (spec §7.17) ; un seul admin_principal, le créateur, qui peut transmettre. */
export type Buddy = { id: string; pseudo: string; photo: string | null; role?: 'admin_principal' | 'admin' | 'membre' };
export type Invitation = { id: string; code: string; canal: Canal; nom: string; contact: string; par: string; attente?: boolean };
export type Groupe = {
  /** duo : discussion à deux (§7.13), sans nom : on montre l'autre buddy. */
  id: string; nom: string; nature: 'bande' | 'me_time' | 'duo'; photo: string | null; modifie_le: string;
  membres: Buddy[]; invitations: Invitation[]; attente?: boolean;
};
/** Carnet d'une sortie (spec §5.8) : le texte de chaque buddy, une fiche par jour (facultative), ce que la trace ne dit pas. */
export type Recit = { par: Buddy; texte: string; modifie_le: string; attente?: boolean };
/** Ce qui est tapé à la main : duree en minutes, distance et denivele en mètres (null : pris dans la trace du jour). */
export type Fiche = { jour: string; nom: string; depart: string; duree: number | null; distance: number | null; denivele: number | null };
export type CarnetBuddy = { difficulte: string; meteo: string; conditions: string; recits: Recit[]; fiches: Fiche[] };
export const carnetVide = (): CarnetBuddy => ({ difficulte: '', meteo: '', conditions: '', recits: [], fiches: [] });
/** Sortie (spec §5.4). Dates du calendrier AAAA-MM-JJ. */
export type Sortie = {
  id: string; groupe: string; nom: string; photo: string | null; debut: string; fin: string; lieu: string; modifie_le: string;
  /** Qui l'a créé (le serveur l'envoie ; absent sur une sortie pas encore synchronisé : c'est moi). */
  par?: string;
  participants: Buddy[]; invitations: Invitation[]; carnet?: CarnetBuddy; attente?: boolean;
};
/** Trace partagée dans une sortie ou un groupe (panneau de partage, spec §3.4). */
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
/** Photo de l'album d'une sortie (spec §5.8). prise_le : heure locale AAAA-MM-JJTHH:MM:SS. */
export type PhotoBuddy = {
  id: string; sortie: string; par: Buddy; prise_le: string; lon: number | null; lat: number | null; etoile: boolean;
  envoyee: boolean; modifie_le: string; attente?: boolean;
  /** 🎥 Film d'un survol 3D : petite et grande sont sa couverture, le film est la taille « video » (album.ts). */
  video?: boolean;
};
/**
 * Buddy count (spec §5.10, §7.20) : une dépense ; montant en centimes, pour = identifiants des buddies.
 * `sortie` = ce à quoi elle appartient : la sortie, ou le Buddy count de groupe (alors `count` aussi), pour que les
 * calculs (count.ts) servent aux deux.
 */
export type Depense = {
  id: string; sortie: string; count?: string | null; titre: string; montant: number; paye_par: string; pour: string[]; jour: string; par: string; modifie_le: string;
  attente?: boolean;
};
/** Un Buddy count (Seb, 26/11, §7.20) : de groupe (`groupe`, avec un nom) ou de sortie (`sortie`) ; ouvert ou fermé. */
export type BuddyCountEtat = {
  id: string; groupe: string | null; sortie: string | null; nom: string; ferme: boolean; supprime: boolean; par?: string; cree_le: string;
  modifie_le: string; attente?: boolean;
};
/** 🏨 Hébergement proposé dans une sortie (§5.11) : ♥ de chacun (identifiants), ✅ retenu. Prix par nuit, en euros. */
export type Hebergement = {
  id: string; sortie: string; nom: string; nature: string; prix_nuit: number | null; adresse: string; url: string; resume: string;
  lon: number | null; lat: number | null; retenu: boolean; par: string; coeurs: string[]; cree_le?: string; modifie_le: string; attente?: boolean;
};
/** 💬 Message d'un groupe ou d'une sortie (§5.6) : texte, « je suis ici » (point) ou photo de l'album. */
export type MessageBuddy = {
  id: string; groupe: string | null; sortie: string | null; par: string; nature: 'texte' | 'point' | 'photo' | 'fichier' | 'sondage'; texte: string;
  lon: number | null; lat: number | null; photo: string | null; cree_le: string; attente?: boolean;
  /** 🐻 Réponse de Bud (§5.12), demandée par `par`. */
  bud?: boolean;
  /** Comme la messagerie d'AppBase : réponse à un message, « modifié », supprimé chez tous, réactions (une par buddy). */
  repond_a?: string | null; edite?: boolean; supprime?: boolean; reactions?: { qui: string; emoji: string }[];
  /** Étape 3 : fichier joint (photo, vidéo, document), sondage, transféré. */
  fichier?: FichierMessage | null; sondage?: Sondage | null; transfere?: boolean;
};
export type FichierMessage = { id: string; nom: string; mime: string; taille: number; envoye: boolean };
export type Sondage = { question: string; multiple: boolean; options: string[]; votes: { qui: string; option: number }[] };
/** ✓✓ Un buddy de mes conversations : sa dernière synchro (« reçu ») et jusqu'où il a lu chacune (« lu », bleu). */
export type Lecture = { qui: string; vu_le: string | null; lus: Record<string, string> };
/** 🚗 Une voiture garée (Seb, 26/11) : la mienne ou celle d'un buddy de mes groupes ; finie à `jusqu` (minuit). */
export type Voiture = { qui: string; lat: number; lon: number; garee_le: number; jusqu: number };
/** 📍 Position d'un buddy dans une sortie (§5.9) ou, hors sortie, dans un groupe (§7.14) : son épingle (ms)
 * et sa dernière position. */
export type Position = {
  sortie?: string; groupe?: string; qui: string; depuis: number; jusqu: number; lon: number | null; lat: number | null; alt: number | null; prise_le: number | null;
  attente?: boolean;
};
export type Op = { id: string; type: string; t: number; [k: string]: unknown };

/** 🐻 Une action faite par Bud à ma demande, et de quoi l'annuler. */
export type ActionBud =
  | { genre: 'depense'; id: string; texte: string }
  | { genre: 'sortie'; id: string; texte: string }
  | { genre: 'suppression'; copie: Sortie; texte: string }
  | { genre: 'renommage'; id: string; avant: string; texte: string }
  | { genre: 'dispo'; planning: string; debut: string; avant: { etat: Etat3 | ''; mot: string }; texte: string };

export type AppelBuddy = { id: string; groupe: string | null; sortie: string | null; par: string; en_ligne: string[]; debut: string; fini: boolean };

export type Etat = {
  /** Dernière version reçue du serveur. */
  serveur: Groupe[];
  sorties: Sortie[];
  traces: TraceBuddy[];
  plannings: Planning[];
  photos: PhotoBuddy[];
  depenses?: Depense[];
  counts?: BuddyCountEtat[];
  positions?: Position[];
  voitures?: Voiture[];
  hebergements?: Hebergement[];
  messages?: MessageBuddy[];
  /** 📞 Appels en cours dans mes groupes et sorties (d'après la dernière synchro). */
  appels?: AppelBuddy[];
  /** 💶 Comment rembourser (Seb 26/11) : par sortie où je dois de l'argent, l'IBAN et le Wero de ceux à qui je dois. */
  paiements?: Record<string, Record<string, { iban?: string; wero?: string }>>;
  /** 🐻 Ce que Bud a fait à ma demande, par message de Bud (pour « Annuler » sur ce téléphone). */
  actionsBud?: Record<string, { faites: ActionBud[]; annule?: boolean }>;
  /** 💬 Dernière lecture de chaque conversation (ms), par identifiant de groupe ou de sortie. */
  lus?: Record<string, number>;
  /** ✓✓ Ce que les autres ont reçu et lu (d'après la dernière synchro). */
  lectures?: Lecture[];
  /** « écrit… » : qui tape dans quelle conversation (d'après la dernière synchro). */
  ecrivent?: { cle: string; qui: string }[];
  /** Mes photos annoncées dont le fichier n'est pas encore parti. */
  envois?: string[];
  /** Mes fichiers joints à des messages, pas encore partis (étape 3). */
  envoisFichiers?: string[];
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
  return { id: e.moi ?? 'moi', pseudo: nomAffiche(c), photo: c.profil?.photo ?? null, role: 'admin_principal' };
}

/** Sorties et traces partagées tels qu'affichés (version du serveur + opérations en attente). */
export function vue(e: Etat): {
  sorties: Sortie[]; traces: TraceBuddy[]; plannings: Planning[]; photos: PhotoBuddy[]; depenses: Depense[]; hebergements: Hebergement[];
  messages: MessageBuddy[];
} {
  const groupes = appliquer(e);

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
      const g = groupes.find((x) => x.id === op.groupe) ?? { id: String(op.groupe), membres: [] as Buddy[] };
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
        lon: (op.lon as number) ?? null, lat: (op.lat as number) ?? null, etoile: false, envoyee: false, modifie_le: quand(op), attente: true,
        ...(op.video ? { video: true } : {}) });
      const x = sorties.find((y) => y.id === op.sortie);
      if (x) x.modifie_le = quand(op);
    } else if (op.type === 'etoile') {
      photos = photos.map((x) => x.id === op.photo ? { ...x, etoile: !!op.etoile } : x);
    } else if (op.type === 'placer_photo') {
      photos = photos.map((x) => x.id === op.photo ? { ...x, lon: op.lon as number, lat: op.lat as number } : x);
    } else if (op.type === 'retirer_photo') {
      photos = photos.filter((x) => x.id !== op.photo);
    } else if (op.type === 'depense') {
      const avant = depenses.find((x) => x.id === op.depense);
      const d: Depense = { id: String(op.depense), sortie: avant?.sortie ?? String(op.count ?? op.sortie), count: avant?.count ?? (op.count ? String(op.count) : null), titre: String(op.titre), montant: Number(op.montant),
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
        photo: (op.photo as string) ?? null, cree_le: quand(op), attente: true, ...(op.bud ? { bud: true } : {}),
        repond_a: (op.repond_a as string) ?? null, reactions: [], transfere: !!op.transfere,
        fichier: op.fichier ? { ...(op.fichier as FichierMessage), envoye: !!(op.fichier as FichierMessage).envoye } : null,
        sondage: op.sondage ? { ...(op.sondage as Omit<Sondage, 'votes'>), votes: [] } : null });
    } else if (op.type === 'renommer_sortie') {
      const k = sorties.findIndex((y) => y.id === op.sortie);
      if (k >= 0) sorties[k] = { ...sorties[k], nom: String(op.nom), attente: true };
    } else if (op.type === 'remettre_sortie' && op.copie && !sorties.some((x) => x.id === op.sortie)) {
      sorties.push(op.copie as Sortie);
    } else if (op.type === 'retirer_sortie' || op.type === 'supprimer_sortie') {
      const i = sorties.findIndex((x) => x.id === op.sortie);
      if (i >= 0) sorties.splice(i, 1);
    } else if (op.type === 'retirer_message') {
      messages = messages.map((m) => m.id === op.message ? { ...m, supprime: true, texte: '', reactions: [], attente: true } : m);
    } else if (op.type === 'modifier_message') {
      messages = messages.map((m) => m.id === op.message ? { ...m, texte: String(op.texte), edite: true, attente: true } : m);
    } else if (op.type === 'voter') {
      messages = messages.map((m) => m.id !== op.message || !m.sondage ? m
        : { ...m, sondage: { ...m.sondage, votes: [...m.sondage.votes.filter((v) => v.qui !== moi), ...(op.options as number[]).map((option) => ({ qui: moi, option }))] } });
    } else if (op.type === 'reagir') {
      messages = messages.map((m) => m.id !== op.message ? m
        : { ...m, reactions: [...(m.reactions ?? []).filter((r) => r.qui !== moi), ...(op.emoji ? [{ qui: moi, emoji: String(op.emoji) }] : [])] });
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
    const dest = cible(op);
    let p = l.find((x) => x.qui === moi && memeCible(x, dest));
    if (op.type === 'epingle' && op.enfoncee) {
      const n: Position = { ...dest, qui: moi, depuis: Number(op.quand), jusqu: Number(op.jusqu), lon: p?.lon ?? null, lat: p?.lat ?? null,
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
/** 📍 Où va ma position : une sortie ou un groupe. */
export type CiblePosition = { sortie: string; groupe?: undefined } | { groupe: string; sortie?: undefined };
const cible = (o: { [k: string]: unknown }): CiblePosition => (o.groupe ? { groupe: String(o.groupe) } : { sortie: String(o.sortie) });
export const memeCible = (a: { sortie?: string; groupe?: string }, b: CiblePosition) => (b.groupe ? a.groupe === b.groupe : a.sortie === b.sortie);
/** Là où mon épingle est enfoncée en ce moment : une sortie, ou un ou plusieurs groupes (même heure de fin). */
export function mesEpingles(e: Etat = lire(), t = Date.now()): Position[] {
  const moi = e.moi ?? 'moi';
  return positions(e).filter((p) => p.qui === moi && p.depuis <= t + 60_000 && p.jusqu > t).sort((a, b) => b.depuis - a.depuis);
}
export const monEpingle = (e: Etat = lire(), t = Date.now()): Position | undefined => mesEpingles(e, t)[0];

/** Aujourd'hui en AAAA-MM-JJ (heure du téléphone). */
export function aujourdhui(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** La sortie en cours, sinon le prochain : en grand en haut de la liste. */
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
/** Une ligne du planning devenue sortie : la sortie du groupe qui part ce jour-là. */
export const sortieDeLigne = (sorties: Sortie[], p: Planning, debut: string) => sorties.find((x) => x.groupe === p.groupe && x.debut === debut);

// ------------------------------------------------------------------ album (§5.8)

/** Photos rangées par jour de la sortie : « Jour 1 », « Jour 2 »… (avant ou après : jour 0 ou au-delà).
 * Les films passent devant, dans un groupe à part (jour '' ; Seb, 25/11 : le film du parcours en premier). */
export function parJour(photos: PhotoBuddy[], x: Sortie) {
  const jours = new Map<string, PhotoBuddy[]>();
  const films = photos.filter((p) => p.video).sort((a, b) => b.prise_le.localeCompare(a.prise_le));
  for (const p of photos) { if (p.video) continue; const j = p.prise_le.slice(0, 10); jours.set(j, [...(jours.get(j) ?? []), p]); }
  const l = [...jours.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([jour, l]) => ({ jour, n: Math.round((Date.parse(jour) - Date.parse(x.debut)) / 86400e3) + 1, photos: l }));
  return films.length ? [{ jour: '', n: 0, photos: films }, ...l] : l;
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
      case 'duo':
        if (!g) gs.push({ id: String(op.groupe), nom: '', nature: 'duo', photo: null, modifie_le: quand(op), invitations: [], attente: true,
          membres: [moiBuddy(e), { id: String(op.buddy), pseudo: String(op.pseudo ?? ''), photo: (op.photo as string) ?? null, role: 'membre' }] });
        break;
      case 'renommer_groupe':
        if (g) { g.nom = String(op.nom); g.attente = true; }
        break;
      case 'nommer_admin':
        if (g) g.membres = g.membres.map((m) => m.id === op.buddy ? { ...m, role: 'admin' } : m);
        break;
      case 'retirer_admin':
        if (g) g.membres = g.membres.map((m) => m.id === op.buddy ? { ...m, role: 'membre' } : m);
        break;
      case 'transmettre':
        if (g) g.membres = g.membres.map((m) => m.id === op.buddy ? { ...m, role: 'admin_principal' }
          : m.role === 'admin_principal' ? { ...m, role: 'admin' } : m);
        break;
    }
  }
  // Façon WhatsApp : le plus récemment actif en haut.
  return gs.sort((a, b) => b.modifie_le.localeCompare(a.modifie_le));
}

/** Invitations reçues (liens ouverts) qui attendent le réseau pour faire entrer dans le groupe. */
export const rejointsEnAttente = (e: Etat = lire()) => e.attente.filter((o) => o.type === 'rejoindre');

/** Nombre de groupes qui ont bougé depuis la dernière ouverture de Buddies (pastille de 👥). */
export function nouveautes(e: Etat = lire()): number {
  const vu = e.vu ?? 0;
  return e.serveur.filter((g) => Date.parse(g.modifie_le) > vu && g.nature === 'bande').length
    + e.sorties.filter((x) => Date.parse(x.modifie_le) > vu).length
    + (e.plannings ?? []).filter((x) => Date.parse(x.modifie_le) > vu).length;
}
export function marquerVu() { ecrire({ ...lire(), vu: Date.now() }); }

/** Rôles dans un groupe (spec §7.17), lus seulement ici : l'admin principal est aussi admin. */
const monRole = (g: Groupe, e: Etat) => g.membres.find((m) => m.id === e.moi || m.id === 'moi')?.role;
export const estAdmin = (g: Groupe, e: Etat = lire()) => ['admin', 'admin_principal'].includes(monRole(g, e) ?? '');
export const estAdminPrincipal = (g: Groupe, e: Etat = lire()) => monRole(g, e) === 'admin_principal';
/** Retirer une chose d'une sortie (photo, dépense, hébergement) : celui qui l'a apportée, ou un admin du groupe (Seb, 26 novembre). */
export function peutRetirer(par: string | undefined, sortie: string, e: Etat = lire()): boolean {
  if (!par || par === (e.moi ?? 'moi')) return true;
  const so = e.sorties.find((x) => x.id === sortie);
  const gid = so?.groupe ?? mesCounts(e).find((c) => c.id === sortie)?.groupe;
  const g = gid ? appliquer(e).find((x) => x.id === gid) : undefined;
  return !!g && estAdmin(g, e);
}

// ------------------------------------------------------------------ actions (tout de suite à l'écran)

function ajouter(...ops: Omit<Op, 'id' | 't'>[]) {
  const t = Date.now();
  ecrire({ ...lire(), attente: [...lire().attente, ...ops.map((o) => ({ ...o, id: uuid(), t }) as Op)] });
  void synchroniser().catch(() => undefined);
}

export type NouvelleInvitation = { canal: Canal; nom: string; contact: string; code: string };

/** Nouveau groupe avec ses premières invitations (déjà envoyées par SMS, mail ou QR). */
export function creerGroupe(nom: string, photo: string | null, invitations: NouvelleInvitation[]): string {
  const n = nom.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!n) throw new Error('Donne un nom au groupe');
  const groupe = uuid();
  ajouter({ type: 'creer_groupe', groupe, nom: n, photo },
    ...invitations.map((i) => ({ type: 'inviter', groupe, invitation: uuid(), ...i })));
  return groupe;
}
export const inviter = (groupe: string, i: NouvelleInvitation) => ajouter({ type: 'inviter', groupe, invitation: uuid(), ...i });
/** Inviter à une sortie (son lien partagé par l'appui long, Seb 26/11) : on en devient partant. */
export const inviterSortie = (sortie: string, i: NouvelleInvitation) => ajouter({ type: 'inviter', sortie, invitation: uuid(), ...i });

export type NouvelleSortie = { groupe: string; nom: string; photo: string | null; debut: string; fin: string; lieu: string; participants: string[] };
/** Nouvelle sortie ; dans Me Time, les copains invités à l'unité (`invitations`). */
export function creerSortie(n: NouvelleSortie, invitations: NouvelleInvitation[] = []): string {
  const nom = n.nom.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!nom) throw new Error('Donne un nom à la sortie');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(n.debut)) throw new Error('Choisis la date de départ');
  const fin = n.fin && n.fin >= n.debut ? n.fin : n.debut;
  const sortie = uuid();
  ajouter({ type: 'creer_sortie', sortie, ...n, nom, fin },
    ...invitations.map((i) => ({ type: 'inviter', sortie, invitation: uuid(), ...i })));
  return sortie;
}
/** Partager une trace dans des sorties et des groupes (un envoi par destination). */
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
export function deposerPhotos(sortie: string, l: { photo: string; prise_le: string; lon: number | null; lat: number | null; video?: boolean }[]) {
  if (!l.length) return;
  ecrire({ ...lire(), envois: [...(lire().envois ?? []), ...l.map((x) => x.photo)] });
  ajouter(...l.map((x) => ({ type: 'ajouter_photo', sortie, ...x })));
}
export const mettreEtoile = (photo: string, etoile: boolean) => ajouter({ type: 'etoile', photo, etoile });
/** 📍 Place (ou replace) une photo sur la carte. */
export const placerPhoto = (photo: string, lon: number, lat: number) => ajouter({ type: 'placer_photo', photo, lon, lat });
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
  // Un Buddy count de groupe : `sortie` est son identifiant ; le serveur le reçoit en `count`.
  const { sortie, ...reste } = d;
  const ou = mesCounts().some((c) => c.id === sortie && c.groupe) ? { count: sortie } : { sortie };
  ajouter({ type: 'depense', ...reste, ...ou, depense, titre: d.titre.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Dépense', montant: Math.round(d.montant) });
  return depense;
}
/** Les Buddy counts connus (serveur + changements en attente), supprimés compris. */
export function mesCounts(e: Etat = lire()): BuddyCountEtat[] {
  let l = (e.counts ?? []).map((c) => ({ ...c }));
  for (const op of e.attente) {
    if (op.type !== 'buddy_count') continue;
    let c = l.find((x) => x.id === op.count || (op.sortie && x.sortie === op.sortie));
    if (!c) {
      c = { id: String(op.count), groupe: op.groupe ? String(op.groupe) : null, sortie: op.sortie ? String(op.sortie) : null, nom: String(op.nom ?? ''),
        ferme: false, supprime: false, par: e.moi, cree_le: new Date(op.t).toISOString(), modifie_le: '' };
      l = [...l, c];
    }
    if (op.nom != null && c.groupe) c.nom = String(op.nom);
    if (op.ferme != null) c.ferme = !!op.ferme;
    if (op.supprime != null) c.supprime = !!op.supprime;
    c.modifie_le = new Date(op.t).toISOString(); c.attente = true;
  }
  return l;
}
/** ＋ Buddy count dans un groupe : rend son identifiant. */
export function creerCount(groupe: string, nom: string): string {
  const count = uuid();
  ajouter({ type: 'buddy_count', count, groupe, nom: nom.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Buddy count' });
  return count;
}
/** Fermer, rouvrir, renommer ou supprimer un Buddy count (`id` : celui de groupe, ou la sortie). */
export function changerCount(id: string, ch: { nom?: string; ferme?: boolean; supprime?: boolean }) {
  const c = mesCounts().find((x) => x.id === id || x.sortie === id);
  const vise = c ? { count: c.id, ...(c.sortie ? { sortie: c.sortie } : {}) } : { count: uuid(), sortie: id };
  ajouter({ type: 'buddy_count', ...vise, ...ch });
}

/** L'épingle se relève seule ce soir à 19 h (Seb, 26/11 ; à minuit si on l'enfonce après 18 h). */
export function finEpingle(d = new Date()): number {
  const f = new Date(d); f.setHours(19, 0, 0, 0);
  if (d.getHours() >= 18) f.setHours(23, 59, 59, 0);
  return f.getTime();
}
/** 🚗 Les voitures garées en ce moment (la mienne en attente du réseau comprise). */
export function voitures(e: Etat = lire(), t = Date.now()): Voiture[] {
  const moi = e.moi ?? 'moi';
  let l = (e.voitures ?? []).map((v) => ({ ...v }));
  for (const op of e.attente) {
    if (op.type !== 'voiture') continue;
    const v = l.find((x) => x.qui === moi);
    if (op.garee) l = [...l.filter((x) => x !== v), { qui: moi, lat: Number(op.lat), lon: Number(op.lon), garee_le: Number(op.garee_le), jusqu: Number(op.jusqu) }];
    else if (v && Number(op.quand) >= v.garee_le) v.jusqu = Math.min(v.jusqu, Number(op.quand));
  }
  return l.filter((v) => v.garee_le <= t + 60_000 && v.jusqu > t);
}
export const maVoiture = (e: Etat = lire(), t = Date.now()) => voitures(e, t).find((v) => v.qui === (e.moi ?? 'moi'));
/** Minuit ce soir : la voiture ne dure qu'une journée (Seb, 26/11). */
const minuit = (t: number) => { const d = new Date(t); d.setHours(24, 0, 0, 0); return d.getTime(); };
/** 🚗 Garer ma voiture ici (appui long) ; vue par mes buddies jusqu'à minuit. */
export function garerVoiture(p: { lat: number; lon: number }, t = Date.now()) {
  ajouter({ type: 'voiture', garee: true, lat: Math.round(p.lat * 1e6) / 1e6, lon: Math.round(p.lon * 1e6) / 1e6, garee_le: t, jusqu: minuit(t) });
}
export function enleverVoiture(t = Date.now()) { ajouter({ type: 'voiture', garee: false, quand: t }); }
/** 📍 Enfoncer l'épingle dans cette sortie ou ces groupes (et la relever ailleurs : une seule épingle à la fois). */
export function enfoncerEpingle(cibles: CiblePosition[], t = Date.now()) {
  const avant = mesEpingles(lire(), t).filter((p) => !cibles.some((c) => memeCible(p, c)));
  const dest = (p: { sortie?: string; groupe?: string }) => (p.groupe ? { groupe: p.groupe } : { sortie: p.sortie });
  ajouter(...avant.map((p) => ({ type: 'epingle', ...dest(p), enfoncee: false, quand: t })),
    ...cibles.map((c) => ({ type: 'epingle', ...dest(c), enfoncee: true, quand: t, jusqu: finEpingle(new Date(t)) })));
}
/** Relever l'épingle (partout si aucune cible n'est donnée). */
export function releverEpingle(c?: CiblePosition, t = Date.now()) {
  const l = c ? [c] : mesEpingles(lire(), t).map(cible);
  if (l.length) ajouter(...l.map((x) => ({ type: 'epingle', ...x, enfoncee: false, quand: t })));
}
/** Une position du GPS pendant que l'épingle est enfoncée : seule la dernière attend le réseau, vers chaque cible. */
export function envoyerPosition(f: { lat: number; lon: number; alt?: number | null; t: number }) {
  const ps = mesEpingles(lire(), f.t);
  if (!ps.length) return;
  const ops = ps.map((p) => ({ type: 'position', ...cible(p), lat: Math.round(f.lat * 1e6) / 1e6, lon: Math.round(f.lon * 1e6) / 1e6,
    alt: f.alt == null ? null : Math.round(f.alt), prise_le: f.t, id: uuid(), t: Date.now() }) as Op);
  ecrire({ ...lire(), attente: [...lire().attente.filter((o) => o.type !== 'position'), ...ops] });
  void synchroniser().catch(() => undefined);
}
/** 🏨 Proposer un hébergement (trouvé par la recherche) dans un ou plusieurs sorties. */
export function proposerHebergement(sorties: string[], h: { nom: string; nature: string; prix_nuit: number | null; adresse: string; url: string;
  resume: string; lon: number | null; lat: number | null }) {
  if (sorties.length) ajouter(...sorties.map((sortie) => ({ type: 'proposer_hebergement', hebergement: uuid(), sortie, ...h,
    nom: h.nom.trim().slice(0, 80), nature: h.nature.slice(0, 40), adresse: h.adresse.slice(0, 160), resume: h.resume.slice(0, 300),
    url: /^https?:\/\//.test(h.url) ? h.url.slice(0, 500) : '' })));
}
/** 💬 Envoyer dans la conversation d'un groupe ou d'une sortie ; part au retour du réseau. */
export function envoyerMessage(dest: { groupe?: string; sortie?: string }, m: { nature?: MessageBuddy['nature']; texte?: string; lon?: number; lat?: number; photo?: string; bud?: boolean;
  repond_a?: string; fichier?: FichierMessage; sondage?: Omit<Sondage, 'votes'>; transfere?: boolean }) {
  const texte = (m.texte ?? '').trim().slice(0, 2000);
  const nature = m.nature ?? 'texte';
  if (nature === 'texte' && !texte) return '';
  const message = uuid();
  ajouter({ type: 'message', message, ...(dest.sortie ? { sortie: dest.sortie } : { groupe: dest.groupe }), nature, texte,
    ...(m.lon != null && m.lat != null ? { lon: Math.round(m.lon * 1e6) / 1e6, lat: Math.round(m.lat * 1e6) / 1e6 } : {}),
    ...(m.photo ? { photo: m.photo } : {}), ...(m.bud ? { bud: true } : {}), ...(m.repond_a ? { repond_a: m.repond_a } : {}),
    ...(m.fichier ? { fichier: m.fichier } : {}), ...(m.sondage ? { sondage: m.sondage } : {}), ...(m.transfere ? { transfere: true } : {}) });
  if (m.fichier && !m.transfere) ecrire({ ...lire(), envoisFichiers: [...(lire().envoisFichiers ?? []), m.fichier.id] });
  return message;
}
/** Annuler une sortie qu'on vient de créer (le serveur refuse si elle a déjà servi). */
export const retirerSortie = (sortie: string) => ajouter({ type: 'retirer_sortie', sortie });
/** ✏ Changer le nom d'une sortie (tout buddy qui la voit). */
export function renommerSortie(sortie: string, nom: string) {
  const n = nom.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!n) throw new Error('Donne un nom à la sortie');
  ajouter({ type: 'renommer_sortie', sortie, nom: n });
  return n;
}
/** ✏ Changer le nom d'un groupe (tout membre). */
export function renommerGroupe(groupe: string, nom: string) {
  const n = nom.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!n) throw new Error('Il faut un nom');
  ajouter({ type: 'renommer_groupe', groupe, nom: n });
  return n;
}
/** 🐻 Bud supprime une sortie (§7.12) : caché de tous ; le serveur refuse si je ne l'ai pas créé ni n'administre la bande. */
export const supprimerSortie = (sortie: string) => ajouter({ type: 'supprimer_sortie', sortie });
/** « Annuler » : il revient (la copie le remontre tout de suite, avant la synchro). */
export const remettreSortie = (copie: Sortie) => ajouter({ type: 'remettre_sortie', sortie: copie.id, copie });
/** 🐻 Garder ce que Bud a fait (message de Bud → actions), ou le marquer annulé. */
export function noterActionsBud(message: string, faites: ActionBud[], annule = false) {
  ecrire({ ...lire(), actionsBud: { ...lire().actionsBud, [message]: { faites, annule } } });
}
/** Supprimer : chez tous, « Ce message a été supprimé ». */
export const retirerMessage = (message: string) => ajouter({ type: 'retirer_message', message });
/** Modifier son message, 15 minutes après l'envoi au plus (le serveur refuse après). */
export const modifierMessage = (message: string, texte: string) => ajouter({ type: 'modifier_message', message, texte: texte.trim().slice(0, 2000) });
export const DELAI_MODIFIER = 15 * 60_000;
/** Voter à un sondage : mes réponses remplacent les précédentes ([] retire mon vote). */
export const voter = (message: string, options: number[]) => ajouter({ type: 'voter', message, options });
/** Transférer (comme AppBase) : le message part dans chaque conversation choisie, marqué « Transféré ». */
export function transferer(ms: MessageBuddy[], dests: { groupe?: string; sortie?: string }[]) {
  for (const d of dests) for (const m of ms) {
    if (m.supprime || m.sondage || m.nature === 'photo') continue;
    envoyerMessage(d, { nature: m.nature, texte: m.texte, transfere: true, ...(m.nature === 'point' ? { lon: m.lon!, lat: m.lat! } : {}),
      ...(m.fichier ? { fichier: m.fichier } : {}) });
  }
}
/** Réagir (une émoji par buddy ; null la retire). */
export const reagir = (message: string, emoji: string | null) => ajouter({ type: 'reagir', message, emoji: emoji ?? '' });
/** Conversation lue jusqu'à maintenant ; `jusqu` (heure du serveur du dernier message) part aussi aux autres : ✓✓ bleues. */
export function marquerLu(cle: string, jusqu?: string) {
  ecrire({ ...lire(), lus: { ...lire().lus, [cle]: jusqu ? Date.parse(jusqu) : Date.now() } });
  if (jusqu && cle !== 'me-time') ajouter({ type: 'lu', cle, jusqu });
}
// ------------------------------------------------------------------ discussions à deux (§7.13)

const ESPACE_DUO = '0b6d8f4e-2c1a-4e57-9f3d-6a1e5c7b9d20';
/** UUID version 5 (SHA-1), le même que uuid.uuid5 du serveur : la discussion à deux a le même identifiant partout. */
export async function uuid5(nom: string, espace = ESPACE_DUO): Promise<string> {
  const ns = espace.replace(/-/g, '').match(/../g)!.map((h) => parseInt(h, 16));
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', new Uint8Array([...ns, ...new TextEncoder().encode(nom)])));
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
/** Ouvre la discussion à deux avec ce buddy (toujours la même), la crée au besoin ; rend son identifiant. */
export async function ouvrirDuo(b: Buddy): Promise<string> {
  const moi = lire().moi;
  if (!moi) throw new Error('Il faut le réseau une première fois');
  const id = await uuid5([moi, b.id].sort().join(':'));
  if (!appliquer(lire()).some((g) => g.id === id)) ajouter({ type: 'duo', groupe: id, buddy: b.id, pseudo: b.pseudo, photo: b.photo });
  return id;
}
/** Mes buddies (ceux de mes groupes), par ordre alphabétique, avec leurs bandes. */
export function contacts(e: Etat = lire()): { b: Buddy; bandes: string[] }[] {
  const moi = e.moi ?? 'moi';
  const l = new Map<string, { b: Buddy; bandes: string[] }>();
  for (const g of appliquer(e).filter((x) => x.nature === 'bande')) {
    for (const b of g.membres) if (b.id !== moi && b.id !== 'moi') { const c = l.get(b.id) ?? { b, bandes: [] }; c.bandes.push(g.nom); l.set(b.id, c); }
  }
  return [...l.values()].sort((a, b) => a.b.pseudo.localeCompare(b.b.pseudo, 'fr'));
}
/** Le nom d'une conversation : celui de la bande, ou l'autre buddy pour une discussion à deux. */
export function autreDuDuo(g: Groupe, e: Etat = lire()): Buddy | undefined {
  return g.nature === 'duo' ? g.membres.find((b) => b.id !== (e.moi ?? 'moi') && b.id !== 'moi') : undefined;
}
/** « en ligne » (synchro il y a moins de 30 s), sinon « vu aujourd'hui à 10 h 42 » (comme AppBase). */
export function presence(qui: string, lectures: Lecture[], maintenant = Date.now()): string | null {
  const vu = lectures.find((l) => l.qui === qui)?.vu_le;
  if (!vu) return null;
  const t = Date.parse(vu);
  if (maintenant - t < 30_000) return 'en ligne';
  const d = new Date(t), auj = new Date(maintenant), hier = new Date(maintenant - 86_400_000);
  const h = `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === auj.toDateString()) return `vu aujourd’hui à ${h}`;
  if (d.toDateString() === hier.toDateString()) return `vu hier à ${h}`;
  return `vu le ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
}
let dernierEcrit = 0;
/** Je tape : « écrit… » chez les autres (au plus toutes les 5 s, jamais mis en file d'attente). */
export function signalerEcrit(cle: string) {
  if (!connecte() || Date.now() - dernierEcrit < 5000 || cle === 'me-time') return;
  dernierEcrit = Date.now();
  void api('POST', '/buddies/ecrit', { cle }).catch(() => undefined);
}

/** Coches d'un de mes messages : 🕓 pas parti, ✓ envoyé, ✓✓ reçu par tous, ✓✓ bleues lu par tous. */
export function statut(m: MessageBuddy, autres: string[], lectures: Lecture[]): 'attente' | 'envoye' | 'recu' | 'lu' {
  if (m.attente) return 'attente';
  const t = Date.parse(m.cree_le);
  const de = autres.map((q) => lectures.find((l) => l.qui === q));
  if (!de.length || de.some((l) => !l)) return 'envoye';
  const cle = m.sortie ?? m.groupe ?? '';
  if (de.every((l) => l!.lus[cle] && Date.parse(l!.lus[cle]) >= t)) return 'lu';
  return de.every((l) => l!.vu_le && Date.parse(l!.vu_le) >= t) ? 'recu' : 'envoye';
}
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
export const retirerAdmin = (groupe: string, buddy: string) => ajouter({ type: 'retirer_admin', groupe, buddy });
/** L'admin principal passe son rôle (il reste admin). */
export const transmettre = (groupe: string, buddy: string) => ajouter({ type: 'transmettre', groupe, buddy });
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
  counts?: BuddyCountEtat[];
  positions?: Position[];
  voitures?: Voiture[];
  ids_hebergements?: string[]; hebergements?: Hebergement[];
  ids_messages?: string[]; messages?: MessageBuddy[]; lectures?: Lecture[]; ecrivent?: { cle: string; qui: string }[];
  appels?: AppelBuddy[];
  paiements?: Etat['paiements'];
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
      // Dépense d'un Buddy count de groupe : `sortie` porte son identifiant (voir Depense).
      const dp = fusion(e.depenses ?? [], (r.depenses ?? []).map((d) => (d.count ? { ...d, sortie: d.count } : d)), r.ids_depenses ?? []);
      const hb = fusion(e.hebergements ?? [], r.hebergements ?? [], r.ids_hebergements ?? []);
      const mg = fusion(e.messages ?? [], r.messages ?? [], r.ids_messages ?? []);
      const envoyees = new Set(ops.map((o) => o.id));
      // Un objet connu du serveur mais jamais reçu : on redemandera tout à la prochaine synchro.
      const manque = g.manque || so.manque || tr.manque || pl.manque || ph.manque || dp.manque || hb.manque || mg.manque;
      ecrire({
        ...e, moi: r.moi, curseur: manque ? undefined : r.curseur, synchro: Date.now(),
        serveur: g.liste, sorties: so.liste, traces: tr.liste, plannings: pl.liste, photos: ph.liste, depenses: dp.liste,
        counts: r.counts ?? e.counts, positions: r.positions ?? e.positions, voitures: r.voitures ?? e.voitures, hebergements: hb.liste, messages: mg.liste, appels: r.appels ?? [], paiements: r.paiements ?? e.paiements,
        lectures: r.lectures ?? e.lectures, ecrivent: r.ecrivent ?? [],
        attente: e.attente.filter((o) => !envoyees.has(o.id)),
      });
      await envoyerPhotos(new Set(r.ids_photos ?? [])).catch(() => undefined); // sans réseau : au prochain tour
      await envoyerFichiersMessages().catch(() => undefined);
      return r.refus.map((x) => x.raison);
    } finally { enCours = null; }
  })();
  return enCours;
}

/** Fichiers joints à mes messages acceptés par le serveur ; ceux d'un message refusé sont oubliés. */
async function envoyerFichiersMessages() {
  for (const id of lire().envoisFichiers ?? []) {
    if (lire().attente.some((o) => o.type === 'message' && (o.fichier as FichierMessage | undefined)?.id === id)) continue;
    const m = (lire().messages ?? []).find((x) => x.fichier?.id === id);
    if (m && !m.fichier!.envoye) await envoyerFichierMessage(id);
    else if (!m) await oublierFichierMessage(id);
    ecrire({ ...lire(), envoisFichiers: (lire().envoisFichiers ?? []).filter((x) => x !== id) });
  }
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
