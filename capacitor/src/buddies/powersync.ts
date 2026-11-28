/**
 * Essai PowerSync (branche d'essai) : voitures garées et positions partagées avec un groupe.
 *
 * PowerSync garde sur le téléphone une base SQLite, copie exacte de ce que le serveur veut bien me montrer
 * (deploy/essai-powersync/sync-config.yaml). Ce fichier ne contient donc ni curseur, ni file, ni reprise : seulement
 * - le schéma des tables locales ;
 * - les actions : dans une seule transaction, la ligne changée (visible tout de suite) et l'opération à envoyer
 *   (table `ops`, la même opération que la synchro maison : le serveur garde toutes ses règles) ;
 * - le connecteur : où prendre un jeton, où envoyer les opérations.
 * Quand le serveur a répondu, PowerSync attend que ses lignes à lui soient revenues, puis remplace les miennes :
 * une opération refusée ou dépassée se défait donc toute seule.
 */
import { PowerSyncDatabase } from '@powersync/capacitor';
import type { AbstractPowerSyncDatabase, PowerSyncBackendConnector } from '@powersync/web';
import { SCHEMA } from './powersyncSchema';
import type { Position, Voiture } from './store';

export type Serveur = {
  /** Jeton PowerSync et adresse du service (GET /powersync/jeton). */
  jeton: () => Promise<{ token: string; endpoint: string; moi: string }>;
  /** Envoie des opérations (POST /powersync/ecrire) ; lève une erreur si le serveur n'a pas répondu « reçu ». */
  ecrire: (ops: { id: string; type: string; [k: string]: unknown }[]) => Promise<void>;
};

/** Une erreur que renvoyer ne guérira pas (opérations mal formées) : la file ne doit pas rester bloquée dessus. */
export class Definitif extends Error {}

export function connecteur(s: Serveur): PowerSyncBackendConnector {
  return {
    fetchCredentials: async () => { const j = await s.jeton(); return { endpoint: j.endpoint, token: j.token }; },
    async uploadData(db: AbstractPowerSyncDatabase) {
      // Une transaction locale à la fois, dans l'ordre. Une erreur (réseau, serveur arrêté) : PowerSync réessaie
      // plus tard, la même transaction en premier.
      for (let tx = await db.getNextCrudTransaction(); tx; tx = await db.getNextCrudTransaction()) {
        const l = tx.crud.filter((c) => c.table === 'ops').map((c) => ({ ...JSON.parse(String(c.opData?.corps ?? '{}')), id: c.id, type: String(c.opData?.type) }));
        try { if (l.length) await s.ecrire(l); } catch (e) { if (!(e instanceof Definitif)) throw e; }
        await tx.complete();
      }
    },
  };
}

let base: PowerSyncDatabase | null = null, moi = '';
export const laBase = () => base;
export const quiSuisJe = () => moi;

/** Ouvre la base du téléphone et lance la synchro. `fichier` : une base par compte. */
export async function demarrer(s: Serveur, fichier = 'buddies.db', options: Record<string, unknown> = {}): Promise<PowerSyncDatabase> {
  base = new PowerSyncDatabase({ schema: SCHEMA, database: { dbFilename: fichier }, ...options });
  await base.init();
  moi = localStorage.getItem('powersync-moi:' + fichier) ?? '';
  const c = connecteur({ ...s, jeton: async () => { const j = await s.jeton(); moi = j.moi; localStorage.setItem('powersync-moi:' + fichier, moi); return j; } });
  void base.connect(c, { retryDelayMs: 2000, crudUploadThrottleMs: 200 });
  return base;
}

const uuid = () => crypto.randomUUID();
const arrondi = (x: number) => Math.round(x * 1e6) / 1e6;
async function agir(type: string, corps: Record<string, unknown>, local: (tx: { execute: (sql: string, p?: unknown[]) => Promise<unknown> }) => Promise<unknown>) {
  await base!.writeTransaction(async (tx) => {
    await local(tx);
    await tx.execute('INSERT INTO ops (id, type, corps) VALUES (?, ?, ?)', [uuid(), type, JSON.stringify(corps)]);
  });
}

/** 🚗 Garer ma voiture ici, jusqu'à `jusqu`. */
export function garer(p: { lat: number; lon: number }, t: number, jusqu: number) {
  const lat = arrondi(p.lat), lon = arrondi(p.lon);
  return agir('voiture', { garee: true, lat, lon, garee_le: t, jusqu }, (tx) =>
    tx.execute('INSERT OR REPLACE INTO voitures (id, lat, lon, garee_le, jusqu) VALUES (?, ?, ?, ?, ?)', [moi, lat, lon, t, jusqu]));
}
export function enlever(t: number) {
  return agir('voiture', { garee: false, quand: t }, (tx) => tx.execute('UPDATE voitures SET jusqu = ? WHERE id = ? AND garee_le <= ? AND jusqu > ?', [t, moi, t, t]));
}
/** 📍 Enfoncer ou relever l'épingle dans un groupe. */
export function epingle(groupe: string, enfoncee: boolean, t: number, jusqu = 0) {
  const id = groupe + '/' + moi;
  return agir('epingle', { groupe, enfoncee, quand: t, ...(enfoncee ? { jusqu } : {}) }, (tx) => (enfoncee
    ? tx.execute('INSERT OR REPLACE INTO positions_groupes (id, groupe_id, utilisateur_id, depuis, jusqu) VALUES (?, ?, ?, ?, ?)', [id, groupe, moi, t, jusqu])
    : tx.execute('UPDATE positions_groupes SET jusqu = ? WHERE id = ? AND depuis <= ? AND jusqu > ?', [t, id, t, t])));
}
/** Une position du GPS pendant que l'épingle est enfoncée. */
export function position(groupe: string, f: { lat: number; lon: number; alt?: number | null; t: number }) {
  const lat = arrondi(f.lat), lon = arrondi(f.lon), alt = f.alt == null ? null : Math.round(f.alt);
  return agir('position', { groupe, lat, lon, alt, prise_le: f.t }, (tx) =>
    tx.execute('UPDATE positions_groupes SET lat = ?, lon = ?, alt = ?, prise_le = ? WHERE id = ? AND depuis <= ? AND jusqu >= ? AND coalesce(prise_le, 0) < ?',
      [lat, lon, alt, f.t, groupe + '/' + moi, f.t, f.t, f.t]));
}

const SQL_VOITURES = `SELECT v.id AS qui, v.lat, v.lon, v.garee_le, v.jusqu, u.voiture_modele AS modele, u.voiture_forme AS forme, u.voiture_couleur AS couleur
  FROM voitures v LEFT JOIN utilisateurs u ON u.id = v.id`;
const SQL_POSITIONS = 'SELECT groupe_id AS groupe, utilisateur_id AS qui, depuis, jusqu, lon, lat, alt, prise_le FROM positions_groupes';
export const lireVoitures = () => base!.getAll<Voiture>(SQL_VOITURES);
export const lirePositions = () => base!.getAll<Position>(SQL_POSITIONS);
/** Rappelle à chaque changement local ou venu du serveur. Rend de quoi arrêter. */
export function suivre(f: (v: Voiture[], p: Position[]) => void): () => void {
  const fin = new AbortController();
  void (async () => {
    for await (const _ of base!.watch('SELECT (SELECT count(*) FROM voitures) + (SELECT count(*) FROM positions_groupes) + (SELECT count(*) FROM utilisateurs)', [], { signal: fin.signal, throttleMs: 30 })) {
      f(await lireVoitures(), await lirePositions());
    }
  })().catch(() => undefined);
  return () => fin.abort();
}
