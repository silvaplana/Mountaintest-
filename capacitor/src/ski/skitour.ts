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
}

export async function fetchOutings(b: Bbox, days: number, password: string): Promise<Outing[]> {
  const r = await relayPost<{ sorties?: Outing[] }>('skitour', { ouest: b[0], sud: b[1], est: b[2], nord: b[3], jours: days }, password);
  return (r.sorties ?? []).filter((o) => Number.isFinite(o.lat) && Number.isFinite(o.lon)).sort((x, y) => y.date - x.date);
}

export const outingDate = (o: Outing) => new Date(o.date * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

/** Skiabilité lisible : l'API donne souvent un chiffre (1 = « Mauvaise » sur le site). */
/** Skiabilité skitour (1 = mauvaise … 5 = excellente) en étoiles : « skiabilité ★★☆☆☆ ». */
export const skiabText = (v?: string) => {
  if (!v) return '';
  if (!/^\d+$/.test(v)) return v;
  const n = Math.min(5, Number(v));
  return `skiabilité ${'★'.repeat(n)}${'☆'.repeat(5 - n)}`;
};

/** Étiquette à côté du point bleu : nom de la course, étoiles, skiabilité. */
export function outingLabel(o: Outing): string {
  const t = o.titre.length > 26 ? `${o.titre.slice(0, 25)}…` : o.titre;
  const sk = skiabText(o.skiabilite);
  const meta = [o.etoiles ? '★'.repeat(o.etoiles) : '', sk].filter(Boolean).join(' · ');
  return meta ? `${t}\n${meta}` : t;
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

// Sorties en texte (icône ⛷💬) : liste façon skitour.fr (date, titre, auteurs) puis fiche détaillée.
// La dernière liste et les 50 dernières fiches ouvertes restent sur le téléphone (lisibles hors ligne).
export interface OutingRow {
  id: number; titre: string; date: number; massif: string; sommet: string; altitude: number | null;
  lat: number | null; lon: number | null; denivele: number | null; dif_ski: string | number | null; orientation: string;
  auteurs: string; url: string; skiabilite?: string; etoiles?: number | null;
}
/** Photo d'une sortie : affichée seulement dans sa fiche, avec son auteur (conditions de l'API skitour). */
export interface SkiPhoto { url: string; legende: string; auteur: string }
export const sheetPhotos = (f: OutingSheet | null): SkiPhoto[] => (f && Array.isArray(f.photos) ? f.photos : []);

export interface OutingSheet extends OutingRow {
  sommets: string[]; depart: string; topos: string[]; conditions: string; neige: string[]; recit: string; skiabilite?: string;
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
