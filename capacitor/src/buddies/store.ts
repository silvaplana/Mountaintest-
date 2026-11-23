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
export type Op = { id: string; type: string; t: number; [k: string]: unknown };

export type Etat = {
  /** Dernière version reçue du serveur. */
  serveur: Groupe[];
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
const vide = (): Etat => ({ serveur: [], attente: [] });
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
        if (g && !g.invitations.some((i) => i.id === op.invitation)) {
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
  return e.serveur.filter((g) => Date.parse(g.modifie_le) > vu && g.nature === 'bande').length;
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

type Reponse = { curseur: string; moi: string; ids: string[]; groupes: Groupe[]; refus: { id: string; raison: string }[] };
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
      const parId = new Map(e.serveur.map((g) => [g.id, g]));
      for (const g of r.groupes) parId.set(g.id, g);
      const envoyees = new Set(ops.map((o) => o.id));
      // Un groupe connu du serveur mais jamais reçu : on redemandera tout à la prochaine synchro.
      const manque = r.ids.some((id) => !parId.has(id));
      ecrire({
        ...e, moi: r.moi, curseur: manque ? undefined : r.curseur, synchro: Date.now(),
        serveur: r.ids.map((id) => parId.get(id)).filter((g): g is Groupe => !!g),
        attente: e.attente.filter((o) => !envoyees.has(o.id)),
      });
      return r.refus.map((x) => x.raison);
    } finally { enCours = null; }
  })();
  return enCours;
}

/** Pour les tests. */
export function _reinitialiser() { memoire = null; abonnes.clear(); enCours = null; }
