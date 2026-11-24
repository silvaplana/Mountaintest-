// 🥾 / 🚵 Itinéraires Camptocamp (camptocamp.org, contenu sous licence CC BY-SA) : API ouverte, sans clé.
// Contrairement aux sorties ski (où la date compte, à cause de la neige), en rando et en VTT on veut
// TOUS les itinéraires de l'écran, sans limite de date, du plus proche au plus loin.
// Même code côté Kotlin (Camptocamp.kt).
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { distanceM } from '../gps/adaptive';
import type { LonLat } from '../trails/osmTrails';

export const C2C_API = 'https://api.camptocamp.org';
export const C2C_ATTRIBUTION = '© contributeurs Camptocamp (CC BY-SA)';
export type C2cActivity = 'hiking' | 'mountain_biking';

export interface C2cRoute {
  id: number; title: string; summary: string;
  lon: number; lat: number;
  /** Cotation : T1…T5 en rando, montée / descente en VTT (M2 / V3…). */
  rating: string;
  heightUpM: number | null; elevMaxM: number | null; lengthM: number | null;
  /** Durée annoncée, en jours (« 1 » = une journée). */
  durations: string[];
  /** Circuit VisuGPX (visugpx.ts) : son identifiant et sa description ; sinon itinéraire Camptocamp. */
  src?: 'visugpx'; vid?: string; vdesc?: string;
}

export interface C2cSheet extends C2cRoute { description: string; line: LonLat[] }

const R = 6378137;
/** Web Mercator (EPSG:3857), le système des géométries Camptocamp. */
export function toMercator(lon: number, lat: number): [number, number] {
  return [R * (lon * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
}
export function fromMercator(x: number, y: number): LonLat {
  return { lon: (x / R) * 180 / Math.PI, lat: (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI };
}

/** Adresse de la liste : itinéraires de l'activité dont le point de départ est dans le cadre (lon/lat). */
export function routesUrl(b: [number, number, number, number], act: C2cActivity, offset = 0) {
  const [x1, y1] = toMercator(b[0], b[1]), [x2, y2] = toMercator(b[2], b[3]);
  return `${C2C_API}/routes?bbox=${Math.round(x1)},${Math.round(y1)},${Math.round(x2)},${Math.round(y2)}&act=${act}&pl=fr&limit=100&offset=${offset}`;
}

interface C2cDoc {
  document_id: number;
  locales?: { lang?: string; title?: string; title_prefix?: string; summary?: string | null; description?: string | null }[];
  geometry?: { geom?: string | null; geom_detail?: string | null };
  hiking_rating?: string | null; mtb_up_rating?: string | null; mtb_down_rating?: string | null;
  height_diff_up?: number | null; elevation_max?: number | null; route_length?: number | null;
  durations?: string[] | null;
}

function locale(d: C2cDoc) {
  const l = d.locales?.find((x) => x.lang === 'fr') ?? d.locales?.[0];
  return l ?? {};
}

/** Texte Camptocamp (markdown léger, balises [[lien|texte]]) en texte simple. */
export function plainText(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/\[\[[^|\]]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[(\/)?[a-z0-9_]+(=[^\]]*)?\]/gi, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseRoute(d: C2cDoc): C2cRoute | null {
  let p: LonLat | null = null;
  try {
    const g = JSON.parse(d.geometry?.geom ?? 'null') as { coordinates?: [number, number] } | null;
    if (g?.coordinates) p = fromMercator(g.coordinates[0], g.coordinates[1]);
  } catch { /* sans position */ }
  if (!p) return null;
  const l = locale(d);
  const title = [l.title_prefix, l.title].filter(Boolean).join(' : ') || `Itinéraire ${d.document_id}`;
  const rating = d.hiking_rating ?? [d.mtb_up_rating, d.mtb_down_rating].filter(Boolean).join(' / ');
  return {
    id: d.document_id, title, summary: plainText(l.summary), lon: p.lon, lat: p.lat, rating: rating ?? '',
    heightUpM: d.height_diff_up ?? null, elevMaxM: d.elevation_max ?? null, lengthM: d.route_length ?? null,
    durations: d.durations ?? [],
  };
}

/** Itinéraires triés du plus proche au plus loin d'un point (centre de l'écran ou position). */
export function byDistance(routes: C2cRoute[], from: LonLat) {
  return routes.map((r) => ({ r, d: distanceM(from, r) })).sort((a, b) => a.d - b.d);
}

async function getJson(url: string) {
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.get({ url, headers: { Accept: 'application/json' } });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Tous les itinéraires du cadre (au plus 300). */
export async function fetchRoutes(b: [number, number, number, number], act: C2cActivity): Promise<C2cRoute[]> {
  const out: C2cRoute[] = [];
  for (let offset = 0; offset < 300; offset += 100) {
    const j = await getJson(routesUrl(b, act, offset)) as { documents?: C2cDoc[]; total?: number };
    for (const d of j.documents ?? []) { const r = parseRoute(d); if (r) out.push(r); }
    if (!j.documents?.length || offset + 100 >= (j.total ?? 0)) break;
  }
  return out;
}

/** Tracé de l'itinéraire (LineString ou MultiLineString), bout à bout. */
export function parseLine(geomDetail: string | null | undefined): LonLat[] {
  try {
    const g = JSON.parse(geomDetail ?? 'null') as { type?: string; coordinates?: number[][] | number[][][] } | null;
    if (!g?.coordinates) return [];
    const lines = (g.type === 'MultiLineString' ? g.coordinates : [g.coordinates]) as number[][][];
    return lines.flat().map(([x, y]) => fromMercator(x, y));
  } catch { return []; }
}

export function parseSheet(d: C2cDoc): C2cSheet | null {
  const r = parseRoute(d);
  if (!r) return null;
  return { ...r, description: plainText(locale(d).description), line: parseLine(d.geometry?.geom_detail) };
}

/** Fiche d'un itinéraire, gardée sur le téléphone (lisible hors ligne ensuite). */
export async function fetchSheet(id: number): Promise<C2cSheet> {
  try {
    const s = parseSheet(await getJson(`${C2C_API}/routes/${id}?l=fr`) as C2cDoc);
    if (!s) throw new Error('fiche vide');
    try { localStorage.setItem(`c2c:${id}`, JSON.stringify(s)); } catch { /* plein */ }
    return s;
  } catch (e) {
    const saved = savedSheet(id);
    if (saved) return saved;
    throw e;
  }
}

export function savedSheet(id: number): C2cSheet | null {
  try { return JSON.parse(localStorage.getItem(`c2c:${id}`) ?? 'null') as C2cSheet | null; } catch { return null; }
}

export const c2cLink = (id: number) => `https://www.camptocamp.org/routes/${id}/fr`;

export function formatDurations(d: string[]) {
  if (!d.length) return '';
  const n = d.map(Number).filter(Number.isFinite);
  if (!n.length) return '';
  const lo = Math.min(...n), hi = Math.max(...n);
  const j = (v: number) => `${v} jour${v > 1 ? 's' : ''}`;
  return lo === hi ? j(lo) : `${lo} à ${j(hi)}`;
}

/** Itinéraires dessinés sur la carte (façon Komoot) : les plus proches seulement, pour ne pas charger tout Camptocamp. */
export const C2C_MAP_LINES = 40;

/**
 * Tracés des itinéraires les plus proches, fiche par fiche (4 à la fois), chacun prévenu dès qu'il arrive.
 * Les fiches sont gardées sur le téléphone : une seconde ouverture marche hors ligne.
 */
export async function fetchLines(routes: C2cRoute[], center: LonLat, onLine: (id: number, line: LonLat[]) => void, signal?: { stop: boolean },
  other?: (r: C2cRoute) => Promise<C2cSheet | null>) {
  const todo = byDistance(routes, center).slice(0, C2C_MAP_LINES).map((x) => x.r);
  const next = async (): Promise<void> => {
    const r = todo.shift();
    if (!r || signal?.stop) return;
    const s = r.src ? await other?.(r).catch(() => null) : savedSheet(r.id) ?? await fetchSheet(r.id).catch(() => null);
    if (s?.line.length && !signal?.stop) onLine(r.id, s.line);
    return next();
  };
  await Promise.all([next(), next(), next(), next()]);
}
