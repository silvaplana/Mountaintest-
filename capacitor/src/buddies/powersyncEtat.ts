/**
 * Bêta PowerSync : l'état des Buddies vient de SQLite au lieu de `POST /buddies/sync`.
 *
 * Ce qui change par rapport à la synchro maison (store.ts) :
 * - lire : PowerSync tient à jour, dans SQLite, les lignes du serveur que j'ai le droit de voir. `projeter` les
 *   remet dans la forme que les écrans connaissent déjà (`Etat`) ; plus de curseur, de liste d'identifiants, de
 *   marge, de « manque » ;
 * - écrire : les mêmes opérations qu'avant, posées dans la table `ops` de SQLite. PowerSync les garde, les envoie
 *   dans l'ordre à `POST /powersync/ecrire`, réessaie seul ;
 * - ce qui s'affiche tout de suite : comme avant, `Etat.attente` (les écrans rejouent ces opérations par-dessus ce
 *   que dit le serveur). Une opération sort de `attente` quand elle est partie ET que PowerSync a reçu le point
 *   de contrôle qui la contient : jamais de trou entre « envoyé » et « revenu ».
 */
import { Capacitor } from '@capacitor/core';
import { PowerSyncDatabase } from '@powersync/capacitor';
import { PowerSyncDatabase as BaseWeb, type AbstractPowerSyncDatabase } from '@powersync/web';
import { api, connecte, HorsLigne } from '../compte/auth';
import { noter as journal } from './journal';
import { SCHEMA } from './powersyncSchema';
import type { AppelBuddy, Buddy, BuddyCountEtat, Depense, Etat, Groupe, Hebergement, Lecture, MessageBuddy, PhotoBuddy, Planning, Position,
  Signalement, Sortie, TraceBuddy, Voiture } from './store';

type Ligne = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const TABLES = Object.keys(SCHEMA.props).filter((t) => t !== 'ops');
const JOUR = 86_400_000;

/** Les dates de Postgres arrivent en « …Z » ; les écrans comparent des dates écrites comme le faisait le serveur. */
const iso = (t: string | null | undefined): string => (t ? t.replace(' ', 'T').replace(/Z$/, '+00:00') : '');
const ms = (t: string | null | undefined) => (t ? Date.parse(t.replace(' ', 'T')) : 0);
const json = <T>(t: string | null | undefined, defaut: T): T => { try { return t ? JSON.parse(t) as T : defaut; } catch { return defaut; } };
const par = <T extends Ligne>(l: T[], cle: string) => {
  const m = new Map<string, T[]>();
  for (const x of l) { const k = String(x[cle]); const a = m.get(k); if (a) a.push(x); else m.set(k, [x]); }
  return m;
};
const tri = <T extends Ligne>(l: T[], ...cles: string[]) => [...l].sort((a, b) => {
  for (const c of cles) { const d = String(a[c] ?? '').localeCompare(String(b[c] ?? '')); if (d) return d; }
  return 0;
});

export type Reste = {
  maintenant: number; moi: string; ecrivent: { cle: string; qui: string }[]; paiements: Etat['paiements']; vus: Record<string, string | null>;
  signalements: Signalement[]; scan25: boolean; scan25_ids: string[]; demandes: Etat['demandes'];
};

/** Les tables de SQLite → ce que les écrans lisent. Mêmes règles que les `vue_*` du serveur (deploy/comptes/buddies.py). */
export function projeter(t: Record<string, Ligne[]>, moi: string, vus: Record<string, string | null> = {}, maintenant = Date.now()): Partial<Etat> {
  const U = new Map(t.utilisateurs.map((x) => [x.id as string, x]));
  const personne = (id: string): Buddy => {
    const x = U.get(id);
    return { id, pseudo: x?.pseudo ?? '', photo: x?.photo || null, initiales: x?.initiale_prenom && x?.initiale_nom ? x.initiale_prenom + x.initiale_nom : '' };
  };
  const membres = par(t.membres, 'groupe_id'), participants = par(t.participants, 'sortie_id');
  const G = new Map(t.groupes.map((g) => [g.id as string, g]));
  const valide = (i: Ligne) => !i.acceptee_par && ms(i.expire_le) > maintenant;

  const groupes = tri(t.groupes.filter((g) => !g.supprime_le && (membres.get(g.id) ?? []).some((m) => m.utilisateur_id === moi)), 'cree_le');
  const gids = new Set(groupes.map((g) => g.id as string));
  const serveur: Groupe[] = groupes.map((g) => ({
    id: g.id, nom: g.nom, nature: g.nature, photo: g.photo || null, modifie_le: iso(g.modifie_le),
    membres: tri(membres.get(g.id) ?? [], 'rejoint_le').map((m) => ({ ...personne(m.utilisateur_id), role: m.role })),
    invitations: tri(t.invitations.filter((i) => i.groupe_id === g.id && !i.sortie_id && valide(i)), 'cree_le')
      .map((i) => ({ id: i.id, code: i.code, canal: i.canal, nom: i.nom, contact: i.contact, mail: i.mail, par: i.invite_par, approbation: !!i.approbation })),
    demandes: tri(t.demandes_entree.filter((d) => d.groupe_id === g.id), 'cree_le').map((d) => personne(d.utilisateur_id)),
  }));

  const recits = par(t.recits, 'sortie_id'), fiches = par(t.fiches_jour, 'sortie_id'), carnets = new Map(t.carnets.map((c) => [c.sortie_id as string, c]));
  const lesSorties = t.sorties.filter((s) => !s.supprime_le && !G.get(s.groupe_id)?.supprime_le
    && (gids.has(s.groupe_id) || (participants.get(s.id) ?? []).some((p) => p.utilisateur_id === moi)));
  const sids = new Set(lesSorties.map((s) => s.id as string));
  const sorties: Sortie[] = lesSorties.map((s) => {
    const c = carnets.get(s.id);
    return {
      id: s.id, groupe: s.groupe_id, nom: s.nom, photo: s.photo || null, debut: s.debut, fin: s.fin, lieu: s.lieu, modifie_le: iso(s.modifie_le), par: s.cree_par,
      participants: (participants.get(s.id) ?? []).map((p) => personne(p.utilisateur_id)),
      invitations: tri(t.invitations.filter((i) => i.sortie_id === s.id && valide(i)), 'cree_le')
        .map((i) => ({ id: i.id, code: i.code, canal: i.canal, nom: i.nom, contact: i.contact, mail: i.mail, par: i.invite_par })),
      carnet: {
        difficulte: c?.difficulte ?? '', meteo: c?.meteo ?? '', conditions: c?.conditions ?? '',
        recits: tri(recits.get(s.id) ?? [], 'modifie_le').map((r) => ({ par: personne(r.utilisateur_id), texte: r.texte, modifie_le: iso(r.modifie_le) })),
        fiches: tri(fiches.get(s.id) ?? [], 'jour').map((f) => ({ jour: f.jour, nom: f.nom, depart: f.depart, duree: f.duree, distance: f.distance, denivele: f.denivele })),
      },
    };
  });
  const ici = (x: Ligne) => (x.groupe_id && gids.has(x.groupe_id)) || (x.sortie_id && sids.has(x.sortie_id));

  const traces: TraceBuddy[] = tri(t.traces.filter(ici), 'cree_le').map((x) => ({
    id: x.id, sortie: x.sortie_id ?? null, groupe: x.groupe_id ?? null, nom: x.nom, ligne: json<[number, number][]>(x.ligne, []), mot: x.mot,
    par: personne(x.par), cree_le: iso(x.cree_le) }));
  const dispos = par(t.dispos, 'planning_id');
  const plannings: Planning[] = tri(t.plannings.filter((p) => gids.has(p.groupe_id)), 'cree_le').map((p) => ({
    id: p.id, groupe: p.groupe_id, nom: p.nom, par: personne(p.cree_par), dates: json<[string, string][]>(p.dates, []), limite: p.limite, modifie_le: iso(p.modifie_le),
    dispos: (dispos.get(p.id) ?? []).map((d) => ({ qui: d.utilisateur_id, debut: d.debut, etat: d.etat, mot: d.mot })) }));
  const photos: PhotoBuddy[] = tri(t.photos.filter((p) => sids.has(p.sortie_id)), 'prise_le').map((p) => ({
    id: p.id, sortie: p.sortie_id, par: personne(p.par), prise_le: p.prise_le, lon: p.lon, lat: p.lat, etoile: !!p.etoile, envoyee: !!p.envoyee,
    video: !!p.video, modifie_le: iso(p.modifie_le) }));
  const lesCounts = t.buddy_counts.filter(ici);
  const counts: BuddyCountEtat[] = lesCounts.map((c) => ({
    id: c.id, groupe: c.groupe_id ?? null, sortie: c.sortie_id ?? null, nom: c.nom, ferme: !!c.ferme, supprime: !!c.supprime_le, par: c.par,
    cree_le: iso(c.cree_le), modifie_le: iso(c.modifie_le) }));
  const countsDeGroupe = new Set(lesCounts.filter((c) => c.groupe_id).map((c) => c.id as string));
  const depenses: Depense[] = tri(t.depenses.filter((d) => !d.supprime_le && ((d.sortie_id && sids.has(d.sortie_id)) || (d.count_id && countsDeGroupe.has(d.count_id)))), 'jour', 'cree_le')
    // Dépense d'un Buddy count de groupe : `sortie` porte son identifiant (voir Depense, store.ts).
    .map((d) => ({ id: d.id, sortie: d.count_id ?? d.sortie_id, count: d.count_id ?? null, titre: d.titre, montant: d.montant, paye_par: d.paye_par,
      pour: json<string[]>(d.pour, []), jour: d.jour, par: d.par, modifie_le: iso(d.modifie_le), remb: d.remb ?? null, moyen: d.moyen ?? null }));
  const coeurs = par(t.coeurs, 'hebergement_id');
  const hebergements: Hebergement[] = tri(t.hebergements.filter((h) => sids.has(h.sortie_id)), 'cree_le').map((h) => ({
    id: h.id, sortie: h.sortie_id, nom: h.nom, nature: h.nature, prix_nuit: h.prix_nuit, adresse: h.adresse, url: h.url, resume: h.resume, lon: h.lon, lat: h.lat,
    retenu: !!h.retenu, par: h.par, coeurs: (coeurs.get(h.id) ?? []).map((c) => c.utilisateur_id as string).sort(), cree_le: iso(h.cree_le), modifie_le: iso(h.modifie_le) }));

  const reactions = par(t.reactions_buddies, 'message_id'), votes = par(t.votes_buddies, 'message_id');
  const messages: MessageBuddy[] = tri(t.messages_buddies.filter((m) => ici(m) && ms(m.cree_le) > maintenant - 90 * JOUR), 'cree_le').map((m) => {
    const sondage = m.sondage ? json<{ question: string; multiple: boolean; options: string[] } | null>(m.sondage, null) : null;
    return {
      id: m.id, groupe: m.groupe_id ?? null, sortie: m.sortie_id ?? null, par: m.par, nature: m.nature, texte: m.texte, lon: m.lon, lat: m.lat,
      photo: m.photo_id ?? null, bud: !!m.bud, cree_le: iso(m.cree_le), repond_a: m.repond_a ?? null, edite: !!m.edite_le, supprime: !!m.supprime,
      reactions: tri(reactions.get(m.id) ?? [], 'cree_le').map((r) => ({ qui: r.utilisateur_id, emoji: r.emoji })), transfere: !!m.transfere,
      planning: m.planning_id ?? null,
      fichier: m.fichier_id ? { id: m.fichier_id, nom: m.fichier_nom, mime: m.fichier_mime, taille: m.fichier_taille, envoye: !!m.fichier_envoye } : null,
      sondage: sondage ? { ...sondage, votes: tri(votes.get(m.id) ?? [], 'cree_le').map((v) => ({ qui: v.utilisateur_id, option: v.option })) } : null,
    };
  });

  const autres = new Set<string>();
  for (const g of gids) for (const m of membres.get(g) ?? []) autres.add(m.utilisateur_id);
  for (const s of sids) for (const p of participants.get(s) ?? []) autres.add(p.utilisateur_id);
  autres.delete(moi);
  const lus = par(t.lectures_buddies.filter((l) => gids.has(l.cle) || sids.has(l.cle)), 'utilisateur_id');
  const lectures: Lecture[] = [...autres].map((qui) => ({ qui, vu_le: vus[qui] ?? null,
    lus: Object.fromEntries((lus.get(qui) ?? []).map((l) => [l.cle, iso(l.lu_le)])) }));

  // Positions et voitures : oubliées après 48 h, et seulement de qui est encore de la sortie ou du groupe.
  const recent = (x: Ligne) => ms(x.modifie_le) > maintenant - 2 * JOUR;
  const position = (x: Ligne) => ({ qui: x.utilisateur_id, depuis: x.depuis, jusqu: x.jusqu, lon: x.lon, lat: x.lat, alt: x.alt, prise_le: x.prise_le });
  const positions: Position[] = [
    ...t.positions.filter((p) => sids.has(p.sortie_id) && recent(p) && (participants.get(p.sortie_id) ?? []).some((x) => x.utilisateur_id === p.utilisateur_id))
      .map((p) => ({ sortie: p.sortie_id, ...position(p) })),
    ...t.positions_groupes.filter((p) => gids.has(p.groupe_id) && recent(p) && (membres.get(p.groupe_id) ?? []).some((x) => x.utilisateur_id === p.utilisateur_id))
      .map((p) => ({ groupe: p.groupe_id, ...position(p) })),
  ];
  const voitures: Voiture[] = t.voitures.filter(recent).map((v) => {
    const p = U.get(v.id);
    return { qui: v.id, lat: v.lat, lon: v.lon, garee_le: v.garee_le, jusqu: v.jusqu, modele: p?.voiture_modele ?? null, forme: p?.voiture_forme ?? null, couleur: p?.voiture_couleur ?? null };
  });
  const appels: AppelBuddy[] = t.appels.filter((a) => !a.fin && ms(a.debut) > maintenant - 4 * 3_600_000 && ici(a)).map((a) => ({
    id: a.id, groupe: a.groupe_id ?? null, sortie: a.sortie_id ?? null, par: a.par, en_ligne: json<string[]>(a.en_ligne, []), debut: iso(a.debut), fini: false }));
  const bloques = tri(t.blocages.filter((b) => b.utilisateur_id === moi), 'cree_le').map((b) => personne(b.bloque_id));

  return { moi, serveur, sorties, traces, plannings, photos, counts, depenses, hebergements, messages, lectures, positions, voitures, appels, bloques };
}

// ------------------------------------------------------------------ branchement sur store.ts

type Acces = {
  lire: () => Etat; ecrire: (e: Etat) => void;
  /** Les fichiers (photos, pièces jointes) annoncés et acceptés partent à part, comme avant. */
  fichiers: (photos: Set<string>) => void;
  premiere: (debut: boolean, nombres?: { groupes: number; sorties: number; albums: number; conversations: number }) => void;
};
let acces: Acces | null = null;
let base: AbstractPowerSyncDatabase | null = null;
let pret: Promise<void> | null = null;
let vus: Record<string, string | null> = {};
let raisons: string[] = [];
/** Opérations parties : identifiant → heure de la réponse du serveur. */
const parties = new Map<string, number>();
/** Opérations déjà posées dans SQLite. */
const posees = new Set<string>();
const APPAREIL = crypto.randomUUID();
const FICHIER = 'buddies.db';

export const laBase = () => base;
/** Pour les essais : où en est la file d'envoi. */
export const _file = () => ({ posees: [...posees], parties: [...parties.keys()], pret: !!pret, base: !!base, poussees: enFile, rebranchements });

async function ouvrir(): Promise<AbstractPowerSyncDatabase> {
  if (Capacitor.isNativePlatform()) {
    try {
      const b = new PowerSyncDatabase({ schema: SCHEMA, database: { dbFilename: FICHIER } });
      await b.init();
      return b;
    } catch (e) {
      // Le SDK Capacitor est en bêta : si le SQLite natif refuse de s'ouvrir, on prend celui du navigateur (WebView).
      journal('powersync', `SQLite natif refusé, repli WebAssembly : ${String(e).slice(0, 200)}`);
    }
  }
  const b = new BaseWeb({ schema: SCHEMA, database: { dbFilename: FICHIER } });
  await b.init();
  return b;
}

let acces_ps: { endpoint: string; token: string } | null = null;
const brancher = (b: AbstractPowerSyncDatabase) => b.connect({
  fetchCredentials: async () => {
    const j = await api<{ token: string; endpoint: string; moi: string; maintenant: number }>('GET', '/powersync/jeton');
    acces_ps = { endpoint: j.endpoint, token: j.token };
    return acces_ps;
  },
  uploadData: envoyer,
}, { retryDelayMs: 3000, crudUploadThrottleMs: 100 });

/**
 * Une connexion peut se figer sans se fermer (antenne perdue, box qui oublie la connexion, serveur qui disparaît) :
 * PowerSync n'a pas de minuterie et resterait « connecté » pour toujours, sans plus rien recevoir. Toutes les 45 s,
 * on demande donc au service un point de contrôle : il revient par le flux en une seconde. S'il n'est pas revenu
 * 20 s après, le flux est mort et on le rebranche. Rien n'est perdu : la reprise repart de ce que la base a déjà.
 */
const GARDE = 45_000, DELAI_GARDE = 20_000;
let garde: ReturnType<typeof setInterval> | null = null;
let rebranchements = 0;
function surveiller(b: AbstractPowerSyncDatabase) {
  if (garde) clearInterval(garde);
  garde = setInterval(() => void (async () => {
    if (base !== b) { if (garde) clearInterval(garde); return; }
    if (typeof document !== 'undefined' && document.hidden) return;
    const st = b.currentStatus;
    // Pas connecté : PowerSync réessaie déjà. Des envois en attente : aucun point de contrôle n'est appliqué avant leur retour.
    if (!st.connected || !acces_ps || posees.size || (await b.getNextCrudTransaction())) return;
    const parti = Date.now();
    const demander = (x: { endpoint: string; token: string }, id: string) => fetch(`${x.endpoint}/write-checkpoint2.json?client_id=${id}`,
      { headers: { Authorization: `Token ${x.token}` }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
    const id = await b.getClientId();
    let r = await demander(acces_ps, id);
    if (r?.status === 401) {  // jeton périmé : un flux figé ne le renouvelle plus
      const j = await api<{ token: string; endpoint: string }>('GET', '/powersync/jeton');
      r = await demander({ endpoint: j.endpoint, token: j.token }, id);
    }
    if (!r?.ok) return;  // sans réseau : rien à conclure
    await new Promise((ok) => setTimeout(ok, DELAI_GARDE));
    if (base !== b || !b.currentStatus.connected || posees.size) return;
    if ((b.currentStatus.lastSyncedAt?.getTime() ?? 0) >= parti) return;
    journal('powersync', 'flux muet : rebranché');
    rebranchements++;
    await b.disconnect();
    if (base === b) void brancher(b);
  })().catch(() => undefined), GARDE);
}

/** Ouvre SQLite et lance la synchro. Sans compte connecté : rien. Appelée au démarrage et à la connexion. */
export function demarrer(a: Acces): Promise<void> {
  acces = a;
  if (!connecte()) return Promise.resolve();
  pret ??= (async () => {
    const b = await ouvrir();
    base = b;
    for (const x of await b.getAll<{ id: string }>("SELECT json_extract(data, '$.id') AS id FROM ps_crud")) posees.add(x.id);
    const premiere = !a.lire().synchro;
    if (premiere) a.premiere(true);
    void brancher(b);
    surveiller(b);
    b.onChange({ onChange: () => { planifier(); } }, { tables: TABLES, throttleMs: 60 });
    b.registerListener({ statusChanged: () => planifier() });
    await rafraichir();
    void pousser();
    void lireReste().catch(() => undefined);
    if (premiere) {
      const fin = () => {
        const e = a.lire();
        a.premiere(false, { groupes: e.serveur.filter((g) => g.nature !== 'duo' && g.nature !== 'support').length, sorties: e.sorties.length,
          albums: new Set(e.photos.map((p) => p.sortie)).size, conversations: new Set((e.messages ?? []).map((m) => m.sortie ?? m.groupe)).size });
      };
      void Promise.race([b.waitForFirstSync(), new Promise((r) => setTimeout(r, 30_000))]).then(() => rafraichir()).then(fin, fin);
    }
  })().catch((e) => { pret = null; journal('powersync', `démarrage raté : ${String(e).slice(0, 300)}`); throw e; });
  return pret;
}

/** Déconnexion : la base du téléphone est vidée. */
export async function oublier() {
  const b = base;
  base = null; pret = null; vus = {}; parties.clear(); posees.clear();
  if (garde) clearInterval(garde);
  garde = null; acces_ps = null;
  await b?.disconnectAndClear().catch(() => undefined);
  await b?.close().catch(() => undefined);
}

/** Les envois : un lot à la fois, dans l'ordre. Une erreur de réseau ou de serveur : PowerSync réessaie le même lot. */
async function envoyer(b: AbstractPowerSyncDatabase) {
  for (let limite = 50; ;) {
    const lot = await b.getCrudBatch(limite);
    if (!lot) return;
    const ops = lot.crud.filter((c) => c.table === 'ops').map((c) => ({ ...json<Record<string, unknown>>(c.opData?.corps as string, {}), id: c.id, type: String(c.opData?.type) }));
    // Un envoi : 300 000 caractères au plus (une photo en message pèse lourd), toujours au moins une opération.
    if (ops.length > 1 && JSON.stringify(ops).length > 300_000) { limite = Math.max(1, Math.floor(limite / 2)); continue; }
    if (ops.length) {
      try {
        const r = await api<{ refus: { id: string; raison: string }[] }>('POST', '/powersync/ecrire', { ops, appareil: APPAREIL });
        raisons.push(...r.refus.map((x) => x.raison));
      } catch (e) {
        // Refusé en bloc pour sa forme ou sa taille : le renvoyer ne changera rien, et toute la file resterait derrière.
        if (!/erreur (413|422)$/.test(String((e as Error).message))) throw e;
        journal('powersync', `envoi abandonné (${ops.length} opérations) : ${(e as Error).message}`);
        raisons.push('Un envoi a été refusé par le serveur');
      }
    }
    // L'heure est prise AVANT `complete()` : tant que le lot n'est pas rendu, PowerSync n'applique rien de ce qu'il
    // reçoit, et ensuite seulement un point de contrôle qui contient nos écritures. Prise après, le point de contrôle
    // pouvait être déjà appliqué : plus rien ne venait dire que c'était fini, et l'opération restait « en attente »
    // (trouvé par la batterie de tests, cas « Rafale » après une longue série).
    const t = Date.now();
    await lot.complete();
    for (const o of ops) parties.set(o.id, t);
    limite = 50;
    planifier();
    // La garde de 15 s (voir `rafraichir`) doit tomber même si plus rien ne bouge dans la base.
    setTimeout(planifier, 15_200);
  }
}

let file: Promise<void> = Promise.resolve();
let enFile = 0;
/** Pose dans SQLite les opérations de `attente` qui n'y sont pas encore (une seule écriture à la fois). */
export function pousser(): Promise<void> {
  enFile++;
  file = file.then(async () => {
    if (!pret || !acces) return;
    await pret.catch(() => undefined);
    const b = base;
    if (!b) return;
    const l = acces.lire().attente.filter((o) => !posees.has(o.id) && !parties.has(o.id));
    if (!l.length) return;
    for (const o of l) posees.add(o.id);
    try {
      await b.writeTransaction(async (tx) => {
        for (const { id, type, t: _t, ...corps } of l) await tx.execute('INSERT INTO ops (id, type, corps) VALUES (?, ?, ?)', [id, type, JSON.stringify(corps)]);
      });
    } catch (e) { for (const o of l) posees.delete(o.id); throw e; }
  }).catch((e) => journal('powersync', `file : ${String(e).slice(0, 200)}`)).finally(() => { enFile--; });
  return file;
}

let prevu = false, enCours: Promise<void> | null = null;
function planifier() {
  if (prevu) return;
  prevu = true;
  setTimeout(() => { prevu = false; void rafraichir(); }, 20);
}
/** Relit SQLite et met l'état des écrans à jour. */
function rafraichir(): Promise<void> {
  const tour = async () => {
    const b = base, a = acces;
    if (!b || !a) return;
    const statut = b.currentStatus;
    const synchro = statut.lastSyncedAt?.getTime() ?? 0;
    const t: Record<string, Ligne[]> = {};
    await b.readTransaction(async (tx) => { for (const nom of TABLES) t[nom] = await tx.getAll<Ligne>(`SELECT * FROM ${nom}`); });
    if (b !== base) return;
    const e = a.lire();
    const moi = e.moi ?? '';
    // Sorties de `attente` : parties, et un point de contrôle est arrivé après la réponse du serveur. (15 s de garde :
    // rien ne doit rester affiché « en attente » pour toujours.)
    const maintenant = Date.now();
    const finies = new Set([...parties].filter(([, quand]) => synchro >= quand || maintenant - quand > 15_000).map(([id]) => id));
    for (const id of finies) { parties.delete(id); posees.delete(id); }
    a.ecrire({ ...e, ...(moi ? projeter(t, moi, vus, maintenant + (e.decalage ?? 0)) : {}), synchro: synchro || e.synchro,
      attente: finies.size ? e.attente.filter((o) => !finies.has(o.id)) : e.attente });
    a.fichiers(new Set(t.photos.map((p) => p.id as string)));
  };
  enCours = (enCours ?? Promise.resolve()).then(tour).catch((e) => journal('powersync', `lecture : ${String(e).slice(0, 200)}`));
  return enCours;
}

let resteEnCours: Promise<void> | null = null;
/** Ce qui ne vient pas par la réplication (« écrit… », comment rembourser, signalements) : un petit appel. */
function lireReste(): Promise<void> {
  resteEnCours ??= (async () => {
    try {
      const parti = Date.now();
      const r = await api<Reste>('GET', '/powersync/reste');
      vus = r.vus;
      const e = acces!.lire();
      acces!.ecrire({ ...e, moi: r.moi, decalage: Math.round(r.maintenant - (parti + Date.now()) / 2), ecrivent: r.ecrivent, paiements: r.paiements,
        signalements: r.signalements, scan25: r.scan25, scan25_ids: r.scan25_ids, demandes: r.demandes });
      if (e.moi !== r.moi || !e.serveur.length) await rafraichir();
    } finally { resteEnCours = null; }
  })();
  return resteEnCours;
}

/**
 * Remplace `synchroniser()` de store.ts : pose ce qui attend, attend que ce soit revenu (8 s au plus), et rend les
 * raisons des opérations refusées. Sans réseau : HorsLigne, rien n'est perdu.
 */
export async function synchroniser(): Promise<string[]> {
  if (!acces || !connecte()) return [];
  await demarrer(acces);
  await pousser();
  const hors = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (!hors) {
    await lireReste().catch((e) => { if (e instanceof HorsLigne) throw e; });
    for (let i = 0; i < 80 && acces.lire().attente.some((o) => posees.has(o.id) || parties.has(o.id)); i++) await new Promise((r) => setTimeout(r, 100));
  }
  if (hors && acces.lire().attente.length) throw new HorsLigne();
  const r = raisons;
  raisons = [];
  return r;
}

/** Pour les tests. */
export function _reinitialiser() { acces = null; base = null; pret = null; vus = {}; raisons = []; parties.clear(); posees.clear(); file = Promise.resolve(); enCours = null; }
