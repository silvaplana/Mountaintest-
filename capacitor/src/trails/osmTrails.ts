// Randos libres d'une zone : itinéraires balisés d'OpenStreetMap (relations route=hiking / foot),
// lus par l'API Overpass. Licence ODbL : libre, en citant « © contributeurs OpenStreetMap ».
// Même logique côté Kotlin (Trails.kt) : mêmes serveurs, même requête, même assemblage.
import type { Bbox } from '../config';
import { distanceM } from '../gps/adaptive';

export const OSM_ATTRIBUTION = '© contributeurs OpenStreetMap (licence ODbL)';

/** Serveurs Overpass publics : le second sert de secours si le premier est saturé. */
export const OVERPASS_URLS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

/** Au-delà (environ 40 km de côté), la réponse serait trop lourde pour un téléphone. */
export const MAX_ZONE_DEG = 0.4;

export interface LonLat { lon: number; lat: number }
export interface Trail {
  id: number;
  name: string;
  /** GR, GR de Pays, PR… lu dans le tag network. */
  kind: string;
  rank: number;
  color: string;
  segments: LonLat[][];
  distanceM: number;
}

export function zoneTooBig(b: Bbox) { return b[2] - b[0] > MAX_ZONE_DEG || b[3] - b[1] > MAX_ZONE_DEG; }

/**
 * Relations rando de la zone, avec la géométrie de leurs chemins. La géométrie est coupée à la zone
 * agrandie d'une demi-zone de chaque côté : une boucle locale arrive entière, un GR de 500 km non.
 */
export function overpassQuery(b: Bbox): string {
  const [w, s, e, n] = b;
  const dx = (e - w) / 2, dy = (n - s) / 2;
  const f = (v: number) => v.toFixed(5);
  return `[out:json][timeout:60];relation["type"="route"]["route"~"^(hiking|foot)$"](${f(s)},${f(w)},${f(n)},${f(e)});`
    + `out tags geom(${f(s - dy)},${f(w - dx)},${f(n + dy)},${f(e + dx)});`;
}

const KINDS: Record<string, { kind: string; rank: number; color: string }> = {
  iwn: { kind: 'GR (international)', rank: 0, color: '#d62828' },
  nwn: { kind: 'GR', rank: 0, color: '#d62828' },
  rwn: { kind: 'GR de Pays / régional', rank: 1, color: '#e67e00' },
  lwn: { kind: 'PR / local', rank: 2, color: '#1d6fe0' },
};
const OTHER = { kind: 'Sentier', rank: 3, color: '#2f6f4f' };

interface OsmMember { type: string; role?: string; geometry?: (LonLat | null)[] }
interface OsmElement { type: string; id: number; tags?: Record<string, string | undefined>; members?: OsmMember[] }

const same = (a: LonLat, b: LonLat) => Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7;

/** Met bout à bout les chemins d'une relation (dans l'ordre des membres, en retournant ceux qui sont à l'envers). */
export function assemble(ways: (LonLat | null)[][]): LonLat[][] {
  const out: LonLat[][] = [];
  let cur: LonLat[] | null = null;
  let single = false; // cur ne contient qu'un chemin : on peut encore le retourner
  for (const way of ways) {
    // Un point absent (hors zone) coupe le chemin en morceaux.
    const runs: LonLat[][] = [[]];
    for (const p of way) {
      if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) runs[runs.length - 1].push({ lon: p.lon, lat: p.lat });
      else runs.push([]);
    }
    for (const run of runs) {
      if (run.length < 2) continue;
      if (!cur) { cur = run; single = true; continue; }
      const end = cur[cur.length - 1];
      if (same(end, run[0])) cur.push(...run.slice(1));
      else if (same(end, run[run.length - 1])) cur.push(...run.slice(0, -1).reverse());
      else if (single && same(cur[0], run[0])) { cur.reverse(); cur.push(...run.slice(1)); }
      else if (single && same(cur[0], run[run.length - 1])) { cur.reverse(); cur.push(...run.slice(0, -1).reverse()); }
      else { out.push(cur); cur = run; single = true; continue; }
      single = false;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function lengthM(segments: LonLat[][]): number {
  let d = 0;
  for (const s of segments) for (let i = 1; i < s.length; i++) d += distanceM(s[i - 1], s[i]);
  return d;
}

export function parseOverpass(json: { elements?: OsmElement[] }): Trail[] {
  const trails: Trail[] = [];
  for (const el of json.elements ?? []) {
    if (el.type !== 'relation') continue;
    const tags = el.tags ?? {};
    const ways = (el.members ?? []).filter((m) => m.type === 'way' && m.geometry).map((m) => m.geometry!);
    const segments = assemble(ways);
    if (!segments.length) continue;
    const k = KINDS[tags.network ?? ''] ?? OTHER;
    const ref = tags.ref?.trim();
    const base = tags.name?.trim() || tags['name:fr']?.trim() || '';
    const name = base ? (ref && !base.includes(ref) ? `${ref} – ${base}` : base) : ref || `Itinéraire OSM ${el.id}`;
    trails.push({ id: el.id, name, ...k, segments, distanceM: lengthM(segments) });
  }
  return trails.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'fr'));
}

export async function fetchTrails(b: Bbox, signal?: AbortSignal): Promise<Trail[]> {
  const body = new URLSearchParams({ data: overpassQuery(b) });
  let last: unknown = null;
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, { method: 'POST', body, signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseOverpass(await res.json());
    } catch (e) {
      if (signal?.aborted) throw e;
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export function trailsGeoJson(trails: Trail[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: trails.map((t) => ({
      type: 'Feature',
      id: t.id,
      properties: { id: t.id, color: t.color },
      geometry: { type: 'MultiLineString', coordinates: t.segments.map((s) => s.map((p) => [p.lon, p.lat])) },
    })),
  };
}

export function bboxPolygon(b: Bbox): GeoJSON.Feature<GeoJSON.Polygon> {
  const [w, s, e, n] = b;
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } };
}
