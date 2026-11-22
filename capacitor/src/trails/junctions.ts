// ⑂ Carrefours le long d'une de mes traces : on croise la trace avec les chemins et routes d'OpenStreetMap
// (API Overpass). Un carrefour est un point OSM où se rejoignent au moins 3 bouts de chemin, à moins de
// JUNCTION_NEAR_M de la trace. Le résultat est gardé sur le téléphone : l'écran peut se rallumer avant
// chaque carrefour même sans réseau. Même calcul côté Kotlin (Junctions.kt).
import { Preferences } from '@capacitor/preferences';
import { distanceM } from '../gps/adaptive';
import { locateOnLine } from './navigation';
import { OVERPASS_URLS, type LonLat } from './osmTrails';

/** Un nœud OSM plus loin que ça de la trace n'est pas un carrefour de la trace. */
export const JUNCTION_NEAR_M = 20;
/** Deux carrefours plus proches que ça n'en font qu'un (rond-point, croisement en baïonnette). */
export const JUNCTION_MERGE_M = 30;
/** Rayon de recherche des chemins autour de la trace. */
const AROUND_M = 25;
/** Points de trace par requête Overpass. */
const CHUNK = 300;

/** Chemins sans intérêt pour s'orienter : allées privées, trottoirs, chantiers… */
export function usefulWay(tags: Record<string, string | undefined>): boolean {
  const hw = tags.highway;
  if (!hw) return false;
  if (/^(proposed|construction|abandoned|razed|disused|platform|bus_stop|elevator|corridor|raceway|rest_area|services)$/.test(hw)) return false;
  if (tags.area === 'yes') return false;
  if (hw === 'service' && /^(driveway|parking_aisle|drive-through)$/.test(tags.service ?? '')) return false;
  if (/^(sidewalk|crossing)$/.test(tags.footway ?? '')) return false;
  if (/^(private|no)$/.test(tags.access ?? '')) return false;
  return true;
}

/** Simplification de Douglas-Peucker (tolérance en mètres) : la requête reste courte. */
export function simplify(line: LonLat[], tolM = 5): LonLat[] {
  if (line.length < 3) return line.slice();
  const lat0 = line[0].lat, k = Math.cos((lat0 * Math.PI) / 180) * 111_320;
  const xy = line.map((p) => [p.lon * k, p.lat * 111_320]);
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy);
    let far = -1, best = tolM;
    for (let i = a + 1; i < b; i++) {
      const d = l ? Math.abs(dy * (xy[i][0] - ax) - dx * (xy[i][1] - ay)) / l : Math.hypot(xy[i][0] - ax, xy[i][1] - ay);
      if (d > best) { best = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return line.filter((_, i) => keep[i]);
}

/** Requêtes Overpass : chemins (highway) à moins de 25 m de la trace, par morceaux de 300 points. */
export function junctionQueries(line: LonLat[]): string[] {
  const pts = simplify(line);
  const out: string[] = [];
  for (let i = 0; pts.length; i += CHUNK - 1) {
    const part = pts.slice(i, i + CHUNK);
    const coords = part.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(',');
    out.push(`[out:json][timeout:90];way["highway"](around:${AROUND_M},${coords});out body geom qt;`);
    if (i + CHUNK >= pts.length) break;
  }
  return out;
}

interface OsmWay { type: string; id: number; nodes?: number[]; geometry?: (LonLat | null)[]; tags?: Record<string, string | undefined> }

/**
 * Carrefours de la trace : nœuds partagés par au moins 3 bouts de chemin (un nœud au milieu d'un chemin
 * compte 2, à son extrémité 1), à moins de JUNCTION_NEAR_M de la trace, regroupés à JUNCTION_MERGE_M.
 * Triés dans l'ordre de la trace.
 */
export function parseJunctions(json: { elements?: OsmWay[] }, line: LonLat[]): LonLat[] {
  const deg = new Map<number, number>();
  const pos = new Map<number, LonLat>();
  const seen = new Set<number>();
  for (const w of json.elements ?? []) {
    if (w.type !== 'way' || !w.nodes || w.nodes.length < 2 || seen.has(w.id) || !usefulWay(w.tags ?? {})) continue;
    seen.add(w.id);
    const n = w.nodes.length;
    w.nodes.forEach((id, k) => {
      deg.set(id, (deg.get(id) ?? 0) + (k === 0 || k === n - 1 ? 1 : 2));
      const g = w.geometry?.[k];
      if (g && Number.isFinite(g.lat)) pos.set(id, { lon: g.lon, lat: g.lat });
    });
  }
  const cands: { p: LonLat; along: number }[] = [];
  for (const [id, d] of deg) {
    const p = pos.get(id);
    if (d < 3 || !p) continue;
    const r = locateOnLine(line, p);
    if (r.offM <= JUNCTION_NEAR_M) cands.push({ p, along: r.alongM });
  }
  cands.sort((a, b) => a.along - b.along);
  const kept: LonLat[] = [];
  for (const c of cands) if (!kept.some((k) => distanceM(k, c.p) < JUNCTION_MERGE_M)) kept.push(c.p);
  return kept;
}

/** Appel réseau : chemins autour de la trace (plusieurs requêtes si elle est longue), puis carrefours. */
export async function fetchJunctions(line: LonLat[], signal?: AbortSignal): Promise<LonLat[]> {
  const elements: OsmWay[] = [];
  for (const q of junctionQueries(line)) {
    const body = new URLSearchParams({ data: q });
    let last: unknown = null, ok = false;
    for (const url of OVERPASS_URLS) {
      try {
        const res = await fetch(url, { method: 'POST', body, signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        elements.push(...((await res.json()).elements ?? []));
        ok = true;
        break;
      } catch (e) {
        if (signal?.aborted) throw e;
        last = e;
      }
    }
    if (!ok) throw last instanceof Error ? last : new Error(String(last));
  }
  return parseJunctions({ elements }, line);
}

/** Empreinte de la trace (même calcul que le méta du hors ligne côté Kotlin). */
export function lineKey(line: LonLat[]): string {
  let h = 17n;
  const M = (1n << 64n) - 1n;
  for (const p of line) h = (h * 31n + BigInt(Math.round(p.lon * 1e5)) * 7n + BigInt(Math.round(p.lat * 1e5))) & M;
  return `carrefours:${h.toString(16)}`;
}

/** Carrefours déjà gardés sur le téléphone pour cette trace (null : jamais cherchés). */
export async function cachedJunctions(line: LonLat[]): Promise<LonLat[] | null> {
  try {
    const v = (await Preferences.get({ key: lineKey(line) })).value;
    if (!v) return null;
    const arr = JSON.parse(v);
    return Array.isArray(arr) ? arr.map(([lon, lat]: [number, number]) => ({ lon, lat })) : null;
  } catch { return null; }
}

/** Carrefours de la trace : ceux du téléphone, sinon cherchés sur le réseau puis gardés. */
export async function junctionsFor(line: LonLat[], signal?: AbortSignal): Promise<LonLat[]> {
  const c = await cachedJunctions(line);
  if (c) return c;
  const j = await fetchJunctions(line, signal);
  await Preferences.set({ key: lineKey(line), value: JSON.stringify(j.map((p) => [+p.lon.toFixed(6), +p.lat.toFixed(6)])) });
  return j;
}

/** Position de chaque carrefour le long de la trace (m depuis le départ), calculée une fois par trace. */
export function junctionAlongs(line: LonLat[], junctions: LonLat[]): number[] {
  return junctions.map((j) => locateOnLine(line, j).alongM);
}

/** Distance du prochain carrefour devant moi, le long de la trace (null : aucun). */
export function nextJunctionM(alongs: number[], alongM: number): number | null {
  let best: number | null = null;
  for (const a of alongs) { const d = a - alongM; if (d > -10 && (best == null || d < best)) best = d; }
  return best == null ? null : Math.max(0, best);
}
