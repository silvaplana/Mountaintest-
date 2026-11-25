// ⑂ Carrefours le long d'une de mes traces : on croise la trace avec les chemins et routes d'OpenStreetMap
// (API Overpass). Un carrefour est un point OSM où se rejoignent au moins 3 bouts de chemin, à moins de
// JUNCTION_NEAR_M de la trace. Le résultat est gardé sur le téléphone : l'écran peut se rallumer avant
// chaque carrefour même sans réseau. Même calcul côté Kotlin (Junctions.kt).
import { Preferences } from '@capacitor/preferences';
import { distanceM } from '../gps/adaptive';
import { locateOnLine } from './navigation';
import { OVERPASS_URLS, type LonLat } from './osmTrails';
import { wayRuns, type WayRun, type WayType } from './wayTypes';

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
export function junctionQueries(line: LonLat[], aroundM = AROUND_M, gr = true): string[] {
  const pts = simplify(line);
  const out: string[] = [];
  for (let i = 0; pts.length; i += CHUNK - 1) {
    const part = pts.slice(i, i + CHUNK);
    const coords = part.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(',');
    // Forme des chemins coupée au cadre du morceau (+ ~100 m) : une route qui croise la trace n'arrive plus en entier.
    const lats = part.map((p) => p.lat), lons = part.map((p) => p.lon);
    const box = [Math.min(...lats) - 0.001, Math.min(...lons) - 0.0013, Math.max(...lats) + 0.001, Math.max(...lons) + 0.0013].map((v) => v.toFixed(5)).join(',');
    // + les relations GR / GR de Pays de ces chemins (🚵 type de chemin : portions sur GR).
    out.push(`[out:json][timeout:${gr ? 90 : 25}];way["highway"](around:${aroundM},${coords})->.w;.w out body geom(${box}) qt;`
      + (gr ? 'rel(bw.w)["route"~"^(hiking|foot)$"]["network"~"^(iwn|nwn|rwn)$"];out body qt;' : ''));
    if (i + CHUNK >= pts.length) break;
  }
  return out;
}

interface OsmWay { type: string; id: number; nodes?: number[]; geometry?: (LonLat | null)[]; tags?: Record<string, string | undefined>; members?: { type: string; ref: number }[] }

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

/** Un signal qui s'arrête avec `signal` ou au bout de `ms` ; `fin()` range la minuterie. */
export function avecDelai(signal: AbortSignal | undefined, ms: number): { signal: AbortSignal; fin: () => void } {
  const c = new AbortController();
  const stop = () => c.abort();
  const t = setTimeout(stop, ms);
  signal?.addEventListener('abort', stop);
  if (signal?.aborted) c.abort();
  return { signal: c.signal, fin: () => { clearTimeout(t); signal?.removeEventListener('abort', stop); } };
}

/** Appel réseau : chemins autour de la trace (plusieurs requêtes si elle est longue). */
async function fetchWays(line: LonLat[], signal?: AbortSignal, aroundM = AROUND_M, gr = true, delaiMs = 0): Promise<OsmWay[]> {
  const elements: OsmWay[] = [];
  // Deux morceaux à la fois (Overpass accepte deux requêtes simultanées par appareil).
  const qs = junctionQueries(line, aroundM, gr);
  let next = 0;
  const worker = async () => { while (next < qs.length) await fetchOne(qs[next++]); };
  const fetchOne = async (q: string) => {
    const body = new URLSearchParams({ data: q });
    let last: unknown = null, ok = false;
    for (const url of OVERPASS_URLS) {
      const d = delaiMs ? avecDelai(signal, delaiMs) : null;
      try {
        const res = await fetch(url, { method: 'POST', body, signal: d?.signal ?? signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        elements.push(...((await res.json()).elements ?? []));
        ok = true;
        break;
      } catch (e) {
        if (signal?.aborted) throw e;
        last = e;
      } finally { d?.fin(); }
    }
    if (!ok) throw last instanceof Error ? last : new Error(String(last));
  };
  await Promise.all([worker(), worker()]);
  return elements;
}

/** ✏ Recoller : forme des chemins et routes utiles à moins de `aroundM` d'un morceau de trace (réseau). */
export async function fetchWayLines(line: LonLat[], aroundM: number, signal?: AbortSignal): Promise<LonLat[][]> {
  const seen = new Set<number>(), out: LonLat[][] = [];
  // Sans les relations GR, et un serveur qui ne répond pas en 25 s laisse la place au suivant (Seb, 25/11 : « ça rame »).
  for (const w of await fetchWays(line, signal, aroundM, false, 25_000)) {
    if (w.type !== 'way' || !w.geometry || seen.has(w.id) || !usefulWay(w.tags ?? {})) continue;
    seen.add(w.id);
    let run: LonLat[] = [];
    for (const p of [...w.geometry, null]) {
      if (p && Number.isFinite(p.lat)) run.push({ lon: p.lon, lat: p.lat });
      else { if (run.length >= 2) out.push(run); run = []; }
    }
  }
  return out;
}

/** Appel réseau : chemins autour de la trace, puis carrefours. */
export async function fetchJunctions(line: LonLat[], signal?: AbortSignal): Promise<LonLat[]> {
  return parseJunctions({ elements: await fetchWays(line, signal) }, line);
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

/**
 * Une seule requête Overpass pour les deux : carrefours ⑂ et 🚵 types de chemin de la trace,
 * gardés sur le téléphone (hors ligne).
 */
async function fetchAndKeep(line: LonLat[], signal?: AbortSignal) {
  // Une seule recherche à la fois par trace : le menu, le suivi et le calcul au chargement la partagent.
  const k = lineKey(line);
  const cur = pending.get(k);
  if (cur) return cur;
  const p = fetchAndKeepOnce(line, signal).finally(() => pending.delete(k));
  pending.set(k, p);
  return p;
}
const pending = new Map<string, Promise<{ junctions: LonLat[]; runs: WayRun[] }>>();
/** Types de chemin déjà lus ou calculés depuis l'ouverture de l'appli (clé : empreinte de la trace). */
const waysMemo = new Map<string, WayRun[]>();

async function fetchAndKeepOnce(line: LonLat[], signal?: AbortSignal) {
  const elements = await fetchWays(line, signal);
  const j = parseJunctions({ elements }, line);
  const runs = wayRuns({ elements }, line);
  await Preferences.set({ key: lineKey(line), value: JSON.stringify(j.map((p) => [+p.lon.toFixed(6), +p.lat.toFixed(6)])) });
  await Preferences.set({ key: wayKey(line), value: JSON.stringify(runs.map((r) => [Math.round(r.from), Math.round(r.to), r.type, r.gr ? 1 : 0])) });
  waysMemo.set(lineKey(line), runs);
  return { junctions: j, runs };
}

/** Carrefours de la trace : ceux du téléphone, sinon cherchés sur le réseau puis gardés. */
export async function junctionsFor(line: LonLat[], signal?: AbortSignal): Promise<LonLat[]> {
  const c = await cachedJunctions(line);
  if (c) return c;
  return (await fetchAndKeep(line, signal)).junctions;
}

const wayKey = (line: LonLat[]) => lineKey(line).replace('carrefours:', 'chemins:');

/** 🚵 Types de chemin de la trace déjà gardés sur le téléphone (null : jamais cherchés). */
export async function cachedWayRuns(line: LonLat[]): Promise<WayRun[] | null> {
  const m = waysMemo.get(lineKey(line));
  if (m) return m;
  try {
    const v = (await Preferences.get({ key: wayKey(line) })).value;
    if (!v) return null;
    const arr = JSON.parse(v);
    if (!Array.isArray(arr)) return null;
    const runs = arr.map(([from, to, type, gr]: [number, number, WayType, number?]) => ({ from, to, type, gr: gr === 1 }));
    waysMemo.set(lineKey(line), runs);
    return runs;
  } catch { return null; }
}

/** 🚵 Types de chemin de la trace : ceux du téléphone, sinon cherchés sur le réseau puis gardés. */
export async function wayRunsFor(line: LonLat[], signal?: AbortSignal): Promise<WayRun[]> {
  const c = await cachedWayRuns(line);
  if (c) return c;
  return (await fetchAndKeep(line, signal)).runs;
}

/**
 * Calcul en avance (demande de Seb : il est long) : dès qu'une trace s'affiche pour la première fois,
 * types de chemin et carrefours sont cherchés en tâche de fond et gardés sur le téléphone.
 * Sans réseau, on réessaiera au prochain affichage.
 */
export function prefetchWays(line: LonLat[]) {
  if (line.length < 2) return;
  void cachedWayRuns(line).then((c) => (c ? null : fetchAndKeep(line))).catch(() => null);
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
