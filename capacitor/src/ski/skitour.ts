// Sorties de ski de rando publiées sur skitour.fr, dans une zone encadrée. Passe par le relais du VPS
// (deploy/ia/relais.py), qui garde la clé de l'API skitour. Même appel côté Kotlin (Skitour.kt).
import { relayPost } from '../travel/travel';
import { keepPhotos, prunePhotos } from './photoStore';
import type { Bbox } from '../config';

export interface Outing {
  id: number; titre: string; date: number; massif: string; sommet: string; altitude: number | null;
  lat: number; lon: number; denivele: number | null; dif_ski: string | number | null; orientation: string;
  conditions: string; auteur: string; url: string;
  /** Skiabilité notée par l'auteur (texte, ou chiffre selon l'API) et étoiles si l'API les donne. */
  skiabilite?: string; etoiles?: number | null;
  /** Point de départ (parking), si skitour le place. */
  parking?: Parking | null;
  /** Trace GPX de la sortie et itinéraire GPX de son topo, simplifiés ([lon, lat]), s'ils existent. */
  trace?: [number, number][]; itineraire?: [number, number][];
}
export interface Parking { nom: string; altitude: number | null; lat: number; lon: number }
/**
 * Un seul parking par endroit quand plusieurs sorties partent du même : la sortie choisie le représente si elle en fait
 * partie (sinon la première) ; nom et altitude pris sur celle qui les a.
 */
export function uniqueParkings(outings: Outing[], sel: number | null): { i: number; p: Parking; sel: boolean }[] {
  const by = new Map<string, { i: number; p: Parking; sel: boolean }>();
  outings.forEach((o, i) => {
    if (!o.parking) return;
    const k = `${o.parking.lat.toFixed(4)},${o.parking.lon.toFixed(4)}`;
    const cur = by.get(k);
    if (!cur) { by.set(k, { i, p: o.parking, sel: i === sel }); return; }
    const p = { ...cur.p, nom: cur.p.nom || o.parking.nom, altitude: cur.p.altitude ?? o.parking.altitude };
    by.set(k, i === sel ? { i, p, sel: true } : { ...cur, p });
  });
  return [...by.values()];
}
/** « Val Thorens (2300 m) » : nom et altitude du parking (le P bleu est ajouté devant par la carte). */
export const parkingText = (p: Parking) => [p.nom, p.altitude ? `(${p.altitude} m)` : ''].filter(Boolean).join(' ');

export async function fetchOutings(b: Bbox, days: number, password: string): Promise<Outing[]> {
  const r = await relayPost<{ sorties?: Outing[] }>('skitour', { ouest: b[0], sud: b[1], est: b[2], nord: b[3], jours: days }, password);
  return (r.sorties ?? []).filter((o) => Number.isFinite(o.lat) && Number.isFinite(o.lon)).sort((x, y) => y.date - x.date);
}

export const outingDate = (o: Outing) => new Date(o.date * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

/** Skiabilité comme sur skitour.fr (« 🙂 Bonne », lue par le relais sur la page de la sortie) ;
 *  si le relais n'a que le chiffre de l'API, « skiabilité 1 ». */
export const skiabText = (v?: string) => (!v ? '' : /^\d+$/.test(v) ? `skiabilité ${v}` : v);

/** « il y a 8 j » depuis la date de la sortie (secondes Unix). */
export const daysAgo = (date: number, now = Date.now()) => {
  const n = Math.max(0, Math.floor((now - date * 1000) / 86400000));
  return n === 0 ? "aujourd'hui" : `il y a ${n} j`;
};

/** Étiquette à côté du point bleu (format demandé par Seb) :
 *  « Monte Bellino (2942 m), NE / ski 2.3, D+200 m, ★★ / skiabilité 🤢 Mauvaise, il y a 8 j ». */
export function outingLabel(o: Outing, now = Date.now()): string {
  const nom = o.sommet || o.titre;
  const l1 = [(nom.length > 28 ? `${nom.slice(0, 27)}…` : nom) + (o.altitude ? ` (${o.altitude} m)` : ''), o.orientation].filter(Boolean).join(', ');
  const l2 = [o.dif_ski ? `ski ${o.dif_ski}` : '', o.denivele ? `D+${o.denivele} m` : '', o.etoiles ? '★'.repeat(o.etoiles) : ''].filter(Boolean).join(', ');
  const l3 = [o.skiabilite ? `skiabilité ${o.skiabilite}` : '', o.date ? daysAgo(o.date, now) : ''].filter(Boolean).join(', ');
  return [l1, l2, l3].filter(Boolean).join('\n');
}

export const outingLine = (o: Outing) => [o.sommet + (o.altitude ? ` ${o.altitude} m` : ''), o.denivele ? `D+ ${o.denivele} m` : '',
  o.dif_ski ? `ski ${o.dif_ski}` : '', o.orientation].filter(Boolean).join(' · ');

// Hors ligne : chaque recherche réussie est gardée sur le téléphone (texte seulement : titre, date, sommet, point,
// D+, conditions, lien ; ni récit ni photos). Sans réseau, on rassemble les sorties gardées qui tombent dans la
// zone et la période demandées. Même logique côté Kotlin (SkitourCache).
export interface CachedSearch { zone: Bbox; days: number; t: number; sorties: Outing[] }
export const CACHE_MAX = 10;
const CACHE_KEY = 'skitourCache';

export function addToCache(list: CachedSearch[], zone: Bbox, days: number, sorties: Outing[], now: number): CachedSearch[] {
  const same = (c: CachedSearch) => c.days === days && c.zone.every((v, i) => Math.abs(v - zone[i]) < 1e-6);
  return [{ zone, days, t: now, sorties }, ...list.filter((c) => !same(c))].slice(0, CACHE_MAX);
}

/** Sorties gardées dans la zone et la période ; t = date de la plus ancienne recherche utilisée. null si aucune ne couvre la zone. */
export function fromCache(list: CachedSearch[], zone: Bbox, days: number, now: number): { sorties: Outing[]; t: number } | null {
  const [w, s, e, n] = zone;
  const used = list.filter((c) => c.zone[0] < e && c.zone[2] > w && c.zone[1] < n && c.zone[3] > s);
  if (!used.length) return null;
  const since = now / 1000 - days * 86400;
  const byId = new Map<number, Outing>();
  for (const c of used) for (const o of c.sorties)
    if (o.lon >= w && o.lon <= e && o.lat >= s && o.lat <= n && o.date >= since && !byId.has(o.id)) byId.set(o.id, o);
  return { sorties: [...byId.values()].sort((x, y) => y.date - x.date), t: Math.min(...used.map((c) => c.t)) };
}

function readCache(): CachedSearch[] {
  try { const v = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Cherche en ligne et garde le résultat ; sans réseau (ou relais en panne), répond avec les sorties gardées (offline = date de ces données). */
export async function loadOutings(b: Bbox, days: number, password: string): Promise<{ outings: Outing[]; offline?: number }> {
  try {
    const outings = await fetchOutings(b, days, password);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(addToCache(readCache(), b, days, outings, Date.now()))); } catch { /* stockage plein */ }
    return { outings };
  } catch (e) {
    const c = fromCache(readCache(), b, days, Date.now());
    if (!c) throw e;
    return { outings: c.sorties, offline: c.t };
  }
}

// Sorties sur la carte (⛷🗺) : toute la liste de la période en une requête (gardée sur le téléphone pour le hors
// ligne), filtrée ici sur l'écran affiché ; étoiles, skiabilité en mot et parking demandés seulement pour les sorties
// à l'écran (30 au plus à la fois), gardés eux aussi. Même logique côté Kotlin (SkiPanel.kt).
const ALL_KEY = 'skitourTout';
const DET_KEY = 'skitourDetails4';
// Clés « i123 » (et non « 123 ») : un objet range les clés numériques par valeur, on perdrait l'ordre d'arrivée.
const dk = (id: number | string) => `i${id}`;
export const DETAILS_MAX = 800;
export interface Details { etoiles?: number | null; skiabilite?: string; parking?: Parking | null; trace?: [number, number][]; itineraire?: [number, number][];
  /** Heure de réception : une sortie reçue sans parking est redemandée une heure après (l'API a pu être en erreur). */
  t?: number }

/** Choix de période de la carte ⛷🗺 (jours ; 3650 = « Tout »), du plus court au plus long. */
export const PERIODS: [number, string][] = [[1, '< 1 j'], [2, '< 2 j'], [3, '< 3 j'], [4, '< 4 j'], [5, '< 5 j'], [7, '< 1 sem.'],
  [15, '< 15 j'], [30, '< 30 j'], [90, '< 3 mois'], [365, '< 1 an'], [3650, 'Tout']];
export const periodLabel = (d: number) => PERIODS.find((p) => p[0] === d)?.[1] ?? `< ${d} j`;
/** Période gardée valide (sinon 30 jours). */
export const periodOk = (d: number) => (PERIODS.some((p) => p[0] === d) ? d : 30);

/** Difficulté ski maximale (échelle Toponeige 1.1 à 5.6 de skitour) ; 0 = toutes. */
export const SKI_LEVELS: [number, string][] = [[1.3, '≤ 1.3'], [2.1, '≤ 2.1'], [2.2, '≤ 2.2'], [2.3, '≤ 2.3'], [3.1, '≤ 3.1'],
  [3.2, '≤ 3.2'], [3.3, '≤ 3.3'], [4.1, '≤ 4.1'], [4.2, '≤ 4.2'], [4.3, '≤ 4.3'], [5.2, '≤ 5.2'], [5.4, '≤ 5.4'], [0, 'Tout']];
export const skiLabel = (max: number) => (max ? `≤ ${max}` : 'Ski : tout');
/** La sortie passe le filtre de difficulté (une sortie sans cotation est gardée). */
export function skiOk(o: { dif_ski?: string | number | null }, max: number): boolean {
  if (!max) return true;
  const v = Number(String(o.dif_ski ?? '').replace(',', '.'));
  return !Number.isFinite(v) || v <= 0 || v <= max + 1e-9;
}

export async function loadAll(days: number, password: string): Promise<{ outings: Outing[]; offline?: number }> {
  try {
    const r = await relayPost<{ sorties?: Outing[] }>('skitour-tout', { jours: days }, password);
    const outings = (r.sorties ?? []).filter((o) => Number.isFinite(o.lat) && Number.isFinite(o.lon)).sort((x, y) => y.date - x.date);
    try { localStorage.setItem(ALL_KEY, JSON.stringify({ days, t: Date.now(), sorties: outings })); } catch { /* stockage plein */ }
    return { outings };
  } catch (e) {
    let saved: { days: number; t: number; sorties: Outing[] } | null = null;
    try { saved = JSON.parse(localStorage.getItem(ALL_KEY) ?? 'null'); } catch { /* rien */ }
    if (!saved || !Array.isArray(saved.sorties)) throw e;
    const since = Date.now() / 1000 - days * 86400;
    return { outings: saved.sorties.filter((o) => o.date >= since), offline: saved.t };
  }
}

/** Sorties dans l'écran [ouest, sud, est, nord], les plus récentes d'abord (max au plus). */
export const inView = (all: Outing[], b: Bbox, max = 150) =>
  all.filter((o) => o.lon >= b[0] && o.lon <= b[2] && o.lat >= b[1] && o.lat <= b[3]).slice(0, max);

export function readDetails(): Record<string, Details> {
  try { const v = JSON.parse(localStorage.getItem(DET_KEY) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
export const withDetails = (o: Outing, det: Record<string, Details>): Outing => {
  const d = det[dk(o.id)];
  return d ? { ...o, ...d, parking: d.parking ?? o.parking } : o;
};
export const hasDetails = (o: Outing, det: Record<string, Details>, now = Date.now()) => {
  const d = det[dk(o.id)];
  return !!d && (!!d.parking || now - (d.t ?? 0) < 3600_000);
};

/** Garde les détails reçus (clés = id des sorties ; les plus récents en dernier, DETAILS_MAX au plus). */
export function mergeDetails(old: Record<string, Details>, add: Record<string, Details>): Record<string, Details> {
  const all = { ...old };
  for (const [k, v] of Object.entries(add)) { delete all[dk(k)]; all[dk(k)] = v; }
  const keys = Object.keys(all);
  return keys.length > DETAILS_MAX ? Object.fromEntries(keys.slice(-DETAILS_MAX).map((k) => [k, all[k]])) : all;
}

export async function fetchDetails(ids: number[], password: string): Promise<Record<string, Details>> {
  const r = await relayPost<{ details?: Record<string, Details> }>('skitour-details', { ids: ids.slice(0, 30) }, password);
  const t = Date.now();
  const got = Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, { ...v, t }]));
  const det = mergeDetails(readDetails(), got);
  try { localStorage.setItem(DET_KEY, JSON.stringify(det)); } catch { /* stockage plein */ }
  return det;
}

// Sorties en texte (icône ⛷💬) : liste façon skitour.fr (date, titre, auteurs) puis fiche détaillée.
// La dernière liste et les 50 dernières fiches ouvertes restent sur le téléphone (lisibles hors ligne).
export interface OutingRow {
  id: number; titre: string; date: number; massif: string; sommet: string; altitude: number | null;
  lat: number | null; lon: number | null; denivele: number | null; dif_ski: string | number | null; orientation: string;
  auteurs: string; url: string; skiabilite?: string; etoiles?: number | null; parking?: Parking | null;
  /** Adresse de la trace GPX sur skitour.fr, quand la sortie en a une. */
  gpx?: string;
}
/** Photo d'une sortie : affichée seulement dans sa fiche, avec son auteur (conditions de l'API skitour). */
export interface SkiPhoto { url: string; legende: string; auteur: string }
export const sheetPhotos = (f: OutingSheet | null): SkiPhoto[] => (f && Array.isArray(f.photos) ? f.photos : []);

/** Liens de la fiche vers les pages skitour.fr du départ, des topos et des sommets (et leur point pour la carte). */
export interface SheetLink { nom: string; url: string; altitude?: number | null; lat?: number | null; lon?: number | null }
export interface SheetLinks { depart: SheetLink | null; topos: SheetLink[]; sommets: SheetLink[]; /** Topos retrouvés par le sommet (la sortie n'en cite pas). */ topos_trouves?: boolean }
/** « Val Thorens (2300 m) » */
export const linkText = (l: SheetLink) => l.nom + (l.altitude ? ` (${l.altitude} m)` : '');
/** Une sortie de la carte (⛷🗺) vue comme une ligne de la liste, pour ouvrir sa fiche. */
export const rowOf = (o: Outing): OutingRow => ({
  id: o.id, titre: o.titre, date: o.date, massif: o.massif, sommet: o.sommet, altitude: o.altitude, lat: o.lat, lon: o.lon,
  denivele: o.denivele, dif_ski: o.dif_ski, orientation: o.orientation, auteurs: o.auteur, url: o.url,
  skiabilite: o.skiabilite, etoiles: o.etoiles, parking: o.parking,
});

export interface OutingSheet extends OutingRow {
  sommets: string[]; depart: string; topos: string[]; conditions: string; neige: string[]; recit: string; skiabilite?: string;
  liens?: SheetLinks; exposition?: string;
  /** Anciennes fiches gardées : un nombre (avant les photos). */
  photos: SkiPhoto[] | number;
}
const LIST_KEY = 'skitourListe';
const SHEETS_KEY = 'skitourFiches';

export interface SavedList { jours: number; t: number; sorties: OutingRow[] }
export function readList(): SavedList | null {
  try { const v = JSON.parse(localStorage.getItem(LIST_KEY) ?? 'null'); return v && Array.isArray(v.sorties) ? v : null; } catch { return null; }
}
export async function fetchList(jours: number, massifs: number[], password: string): Promise<SavedList> {
  const r = await relayPost<{ sorties?: OutingRow[] }>('skitour-liste', { jours, massifs }, password);
  const l = { jours, t: Date.now(), sorties: r.sorties ?? [] };
  try { localStorage.setItem(LIST_KEY, JSON.stringify(l)); } catch { /* stockage plein */ }
  return l;
}

function readSheets(): OutingSheet[] {
  try { const v = JSON.parse(localStorage.getItem(SHEETS_KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export const savedSheet = (id: number) => readSheets().find((f) => f.id === id) ?? null;
export async function fetchSheet(id: number, password: string): Promise<OutingSheet> {
  const f = await relayPost<OutingSheet>('skitour-sortie', { id }, password);
  const kept = [f, ...readSheets().filter((x) => x.id !== id)].slice(0, 50);
  try { localStorage.setItem(SHEETS_KEY, JSON.stringify(kept)); } catch { /* stockage plein */ }
  // Photos gardées pour le hors ligne : celles des 50 fiches gardées, pas plus.
  void keepPhotos(sheetPhotos(f).map((p) => p.url), password).then(() => prunePhotos(new Set(kept.flatMap((x) => sheetPhotos(x).map((p) => p.url)))));
  return f;
}

/** Point d'un topo (départ ou sommet). */
export interface TopoPoint { nom: string; altitude?: number | null; lat?: number | null; lon?: number | null }
/** Fiche d'un topo (itinéraire de skitour.fr), lue dans l'appli. */
export interface TopoSheet {
  id: number; nom: string; url: string; massif: string; orientation: string; denivele?: number | null; dif_ski: string;
  difficulte: string; expo: string; depart: TopoPoint | null; sommets: TopoPoint[];
  presentation: string; itineraire: string; variantes: string; remarques: string; materiel: string; biblio?: string;
  auteur: string; gpx: string;
}
const TOPOS_KEY = 'skitourTopos';
/** Numéro d'un topo d'après son lien skitour.fr (…/topos/123). */
export const topoId = (url: string): number | null => { const m = /\/topos\/(\d+)/.exec(url); return m ? Number(m[1]) : null; };
function readTopos(): TopoSheet[] {
  try { const v = JSON.parse(localStorage.getItem(TOPOS_KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export const savedTopo = (id: number) => readTopos().find((t) => t.id === id) ?? null;
/** Topo lu par le relais ; les 50 derniers ouverts sont gardés (le plus ancien est effacé). */
export async function fetchTopo(id: number, password: string): Promise<TopoSheet> {
  const t = await relayPost<TopoSheet>('skitour-topo', { id }, password);
  const { trace: _t, ...keep } = t as TopoSheet & { trace?: unknown };
  const kept = [keep, ...readTopos().filter((x) => x.id !== id)].slice(0, 50);
  try { localStorage.setItem(TOPOS_KEY, JSON.stringify(kept)); } catch { /* stockage plein */ }
  return t;
}

/** Filtre de la liste : chaque mot (sans accents) doit se trouver dans le titre, le massif, le sommet ou les auteurs. */
export function filterRows(rows: OutingRow[], q: string): OutingRow[] {
  const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const words = norm(q).split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((o) => { const t = norm(`${o.titre} ${o.massif} ${o.sommet} ${o.auteurs}`); return words.every((w) => t.includes(w)); });
}

export const shortDate = (d: number) => new Date(d * 1000).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

// Massifs de skitour (id, nom, groupe) : demandés au relais, gardés sur le téléphone.
export interface Massif { id: number; nom: string; groupe: string }
const MASSIFS_KEY = 'skitourMassifsListe';
export function readMassifs(): Massif[] {
  try { const v = JSON.parse(localStorage.getItem(MASSIFS_KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export async function fetchMassifs(password: string): Promise<Massif[]> {
  const r = await relayPost<{ massifs?: Massif[] }>('skitour-massifs', {}, password);
  const m = r.massifs ?? [];
  if (m.length) try { localStorage.setItem(MASSIFS_KEY, JSON.stringify(m)); } catch { /* stockage plein */ }
  return m;
}
/** Groupes dans l'ordre de l'API (Haute Savoie, Savoie, Isère…), massifs dans l'ordre alphabétique. */
export function groupMassifs(ms: Massif[]): [string, string[]][] {
  const g = new Map<string, string[]>();
  for (const m of ms) g.set(m.groupe || 'Autres', [...(g.get(m.groupe || 'Autres') ?? []), m.nom]);
  return [...g.entries()].map(([k, v]) => [k, v.sort((a, b) => a.localeCompare(b, 'fr'))]);
}

// ---------- Topos (onglets « Topos » et « Carte topos ») ----------
/** Un topo de la liste (départ placé sur la carte). */
export interface TopoRow {
  id: number; nom: string; url: string; massif: string; orientation: string; denivele: number | null; dif_ski: string;
  difficulte: string; expo: string; gpx: boolean; depart: { nom: string; altitude: number | null; lat: number | null; lon: number | null } | null;
}
const TOPO_LIST_KEY = 'skitourToposListe';
const TOPO_MAP_KEY = 'skitourToposCarte';
/** Dernière liste de topos (massifs choisis), gardée pour le hors ligne. */
export function readTopoList(): { massifs: number[]; t: number; topos: TopoRow[] } | null {
  try { const v = JSON.parse(localStorage.getItem(TOPO_LIST_KEY) ?? 'null'); return v && Array.isArray(v.topos) ? v : null; } catch { return null; }
}
export async function fetchTopoList(massifs: number[], password: string): Promise<TopoRow[]> {
  const r = await relayPost<{ topos?: TopoRow[] }>('skitour-topos', { massifs }, password);
  const topos = r.topos ?? [];
  try { localStorage.setItem(TOPO_LIST_KEY, JSON.stringify({ massifs, t: Date.now(), topos })); } catch { /* stockage plein */ }
  return topos;
}
/** Case de 0,1° du centre de l'écran : une demande par case, gardée 7 jours sur le téléphone (et sur le serveur). */
export const topoCell = (lat: number, lon: number) => `${(Math.round(lat * 10) / 10).toFixed(1)},${(Math.round(lon * 10) / 10).toFixed(1)}`;
function readTopoCells(): Record<string, { t: number; topos: TopoRow[] }> {
  try { const v = JSON.parse(localStorage.getItem(TOPO_MAP_KEY) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
export function savedToposNear(lat: number, lon: number): TopoRow[] | null {
  const c = readTopoCells()[topoCell(lat, lon)];
  return c && Date.now() - c.t < 7 * 86400_000 ? c.topos : null;
}
export async function fetchToposNear(lat: number, lon: number, password: string): Promise<TopoRow[]> {
  const k = topoCell(lat, lon);
  const [la, lo] = k.split(',').map(Number);
  const r = await relayPost<{ topos?: TopoRow[] }>('skitour-topos', { lat: la, lon: lo }, password);
  const all = readTopoCells();
  delete all[k];
  all[k] = { t: Date.now(), topos: r.topos ?? [] };
  const keys = Object.keys(all).slice(-40); // 40 cases au plus
  try { localStorage.setItem(TOPO_MAP_KEY, JSON.stringify(Object.fromEntries(keys.map((x) => [x, all[x]])))); } catch { /* stockage plein */ }
  return all[k].topos;
}
/** Toutes les cases gardées, pour garder les points déjà vus quand on bouge la carte. */
export function allSavedTopos(): TopoRow[] {
  const seen = new Set<number>(), out: TopoRow[] = [];
  for (const c of Object.values(readTopoCells())) for (const t of c.topos) if (!seen.has(t.id)) { seen.add(t.id); out.push(t); }
  return out;
}
/** Filtre de la liste des topos : chaque mot (sans accents) dans le nom, le massif ou le départ. */
export function filterTopos(rows: TopoRow[], q: string): TopoRow[] {
  const n = (t: string) => t.normalize('NFD').replace(/\p{Mn}+/gu, '').toLowerCase();
  const words = n(q).split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((t) => { const h = n(`${t.nom} ${t.massif} ${t.depart?.nom ?? ''}`); return words.every((w) => h.includes(w)); });
}
/** « ski 2.3 · D+ 780 m · E » */
export const topoLine = (t: TopoRow) => [t.dif_ski && `ski ${t.dif_ski}`, t.denivele && `D+ ${t.denivele} m`, t.orientation, t.difficulte].filter(Boolean).join(' · ');
