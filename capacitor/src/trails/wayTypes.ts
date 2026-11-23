// 🚵 Type de chemin le long d'une trace (route goudronnée, piste, sentier…), d'après les chemins
// d'OpenStreetMap autour de la trace : la même réponse Overpass que pour les carrefours ⑂ (junctions.ts).
// Le résultat est gardé sur le téléphone (clé « chemins:… ») : il s'affiche hors ligne, sur le SCAN 25
// où le type de chemin ne se lit pas. Même calcul côté Kotlin (WayTypes.kt).
import { distanceM } from '../gps/adaptive';
import type { LonLat } from './osmTrails';

export type WayType = 'route' | 'empierree' | 'velo' | 'chemin' | 'sentier' | 'technique' | 'inconnu';

/**
 * Les types possibles, dans l'ordre de la légende (du plus roulant au plus difficile). Mêmes catégories
 * que la légende du SCAN 25 (route, route empierrée, chemin en trait noir, sentier en tireté noir),
 * plus « sentier difficile » (difficulté VTT ou montagne notée dans OSM) pour le VTT.
 */
export const WAY_TYPES: { key: WayType; label: string; color: string }[] = [
  { key: 'route', label: 'Route goudronnée', color: '#4a4f55' },
  { key: 'velo', label: 'Piste cyclable', color: '#1e88e5' },
  { key: 'empierree', label: 'Route empierrée', color: '#e0a800' },
  { key: 'chemin', label: 'Chemin', color: '#8d5a2b' },
  { key: 'sentier', label: 'Sentier', color: '#2e9d4a' },
  { key: 'technique', label: 'Sentier difficile', color: '#8e24aa' },
  { key: 'inconnu', label: 'Hors chemin connu', color: '#b8bcc0' },
];
/** Portions sur un GR ou un GR de Pays : tireté rouge par-dessus, comme sur le SCAN 25. */
export const GR_COLOR = '#e53935';
export const WAY_COLOR = Object.fromEntries(WAY_TYPES.map((t) => [t.key, t.color])) as Record<WayType, string>;

const ROADS = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road)(_link)?$/;
const PAVED = /^(asphalt|paved|concrete(:.*)?|paving_stones|sett|chipseal|metal)$/;
const HARD = /^(demanding_mountain_hiking|alpine_hiking|demanding_alpine_hiking|difficult_alpine_hiking)$/;

/** Type d'un chemin OSM d'après ses étiquettes (highway, surface, tracktype, mtb:scale, sac_scale). */
export function wayType(tags: Record<string, string | undefined>): WayType {
  const hw = tags.highway ?? '';
  const surface = tags.surface ?? '';
  if (hw === 'cycleway' || (hw === 'path' && tags.bicycle === 'designated' && PAVED.test(surface))) return 'velo';
  if (ROADS.test(hw)) return surface && !PAVED.test(surface) ? 'empierree' : 'route';
  if (hw === 'track') {
    if (PAVED.test(surface)) return 'route';
    if (/^grade[12]$/.test(tags.tracktype ?? '') || /^(gravel|fine_gravel|compacted)$/.test(surface)) return 'empierree';
    return 'chemin';
  }
  if (hw === 'bridleway') return 'chemin';
  if (/^(path|footway|bridleway|pedestrian|steps)$/.test(hw)) {
    const mtb = parseInt(tags['mtb:scale'] ?? '', 10);
    if (hw === 'steps' || mtb >= 2 || HARD.test(tags.sac_scale ?? '') || /^(rock|scree|bare_rock)$/.test(surface)
      || /^(bad|horrible|no)$/.test(tags.trail_visibility ?? '')) return 'technique';
    if (PAVED.test(surface)) return 'route';
    return 'sentier';
  }
  return 'inconnu';
}

/** Un morceau de la trace d'un seul type : de `from` à `to` mètres depuis le départ. */
export interface WayRun { from: number; to: number; type: WayType; gr?: boolean }

/** Un point de trace plus loin que ça de tout chemin OSM est « hors chemin connu ». */
const NEAR_M = 15;
/** Un point tous les SAMPLE_M le long de la trace. */
const SAMPLE_M = 10;
/** Un morceau plus court que ça est absorbé par celui d'avant (croisement de route, bout de pont). */
const MIN_RUN_M = 30;

interface OsmWay {
  type: string; id: number; geometry?: (LonLat | null)[]; tags?: Record<string, string | undefined>;
  /** Relations GR (même réponse Overpass) : leurs chemins. */
  members?: { type: string; ref: number }[];
}

/**
 * Types de chemin le long de la trace : un point tous les 10 m, rattaché au chemin OSM le plus proche
 * (à moins de 15 m) qui va dans le même sens que la trace ; puis les morceaux trop courts sont lissés.
 */
export function wayRuns(json: { elements?: OsmWay[] }, line: LonLat[]): WayRun[] {
  if (line.length < 2) return [];
  const lat0 = line[0].lat, kx = Math.cos((lat0 * Math.PI) / 180) * 111_320, ky = 111_320;
  const xy = (p: LonLat) => [p.lon * kx, p.lat * ky];
  // Index des segments de chemin par cases de 50 m.
  const CELL = 50;
  const grid = new Map<string, { ax: number; ay: number; bx: number; by: number; t: WayType; gr: boolean }[]>();
  const seen = new Set<number>();
  const grWays = new Set<number>();
  for (const r of json.elements ?? []) if (r.type === 'relation') r.members?.forEach((m) => { if (m.type === 'way') grWays.add(m.ref); });
  for (const w of json.elements ?? []) {
    if (w.type !== 'way' || !w.geometry || seen.has(w.id) || !w.tags?.highway) continue;
    seen.add(w.id);
    const t = wayType(w.tags), gr = grWays.has(w.id);
    for (let i = 1; i < w.geometry.length; i++) {
      const a = w.geometry[i - 1], b = w.geometry[i];
      if (!a || !b) continue;
      const [ax, ay] = xy(a), [bx, by] = xy(b);
      const seg = { ax, ay, bx, by, t, gr };
      const x0 = Math.floor((Math.min(ax, bx) - NEAR_M) / CELL), x1 = Math.floor((Math.max(ax, bx) + NEAR_M) / CELL);
      const y0 = Math.floor((Math.min(ay, by) - NEAR_M) / CELL), y1 = Math.floor((Math.max(ay, by) + NEAR_M) / CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
        const key = `${cx},${cy}`;
        const l = grid.get(key);
        if (l) l.push(seg); else grid.set(key, [seg]);
      }
    }
  }
  // Points réguliers le long de la trace, avec la direction de la trace à cet endroit.
  const types: { type: WayType; gr: boolean }[] = [];
  let acc = 0, next = 0;
  for (let i = 1; i < line.length; i++) {
    const segM = distanceM(line[i - 1], line[i]);
    const [ax, ay] = xy(line[i - 1]), [bx, by] = xy(line[i]);
    const dx = bx - ax, dy = by - ay, dl = Math.hypot(dx, dy) || 1;
    while (next <= acc + segM) {
      const f = segM ? (next - acc) / segM : 0;
      const px = ax + f * dx, py = ay + f * dy;
      let best: WayType = 'inconnu', bestGr = false, bestScore = Infinity;
      for (const s of grid.get(`${Math.floor(px / CELL)},${Math.floor(py / CELL)}`) ?? []) {
        const sx = s.bx - s.ax, sy = s.by - s.ay, l2 = sx * sx + sy * sy;
        const u = l2 ? Math.max(0, Math.min(1, ((px - s.ax) * sx + (py - s.ay) * sy) / l2)) : 0;
        const off = Math.hypot(s.ax + u * sx - px, s.ay + u * sy - py);
        if (off > NEAR_M) continue;
        // Une route qu'on ne fait que traverser est perpendiculaire à la trace : pénalisée.
        const cos = l2 ? Math.abs(sx * dx + sy * dy) / (Math.sqrt(l2) * dl) : 1;
        const score = off + 20 * (1 - cos);
        if (score < bestScore) { bestScore = score; best = s.t; bestGr = s.gr; }
      }
      types.push({ type: best, gr: bestGr });
      next += SAMPLE_M;
    }
    acc += segM;
  }
  // Morceaux d'un seul type, puis lissage des morceaux trop courts.
  let runs: WayRun[] = [];
  const same = (a: { type: WayType; gr?: boolean }, b: { type: WayType; gr?: boolean }) => a.type === b.type && !!a.gr === !!b.gr;
  types.forEach((t, i) => {
    const from = Math.max(0, i * SAMPLE_M - SAMPLE_M / 2), to = Math.min(acc, i * SAMPLE_M + SAMPLE_M / 2);
    const last = runs[runs.length - 1];
    if (last && same(last, t)) last.to = to; else runs.push({ from, to, ...t });
  });
  for (let pass = 0; pass < 2; pass++) {
    const out: WayRun[] = [];
    runs.forEach((r, i) => {
      const prev = out[out.length - 1];
      const short = r.to - r.from < MIN_RUN_M;
      const k = short ? (prev ?? runs[i + 1] ?? r) : r;
      if (prev && same(prev, k)) prev.to = r.to; else out.push({ from: r.from, to: r.to, type: k.type, gr: !!k.gr });
    });
    runs = out;
  }
  if (runs.length) runs[runs.length - 1].to = acc;
  return runs;
}

/** Longueur de chaque type sur la trace (m), et sur GR. */
export function wayTotals(runs: WayRun[]): { byType: Record<WayType, number>; gr: number; total: number } {
  const byType = Object.fromEntries(WAY_TYPES.map((t) => [t.key, 0])) as Record<WayType, number>;
  let gr = 0, total = 0;
  for (const r of runs) { const m = r.to - r.from; byType[r.type] += m; total += m; if (r.gr) gr += m; }
  return { byType, gr, total };
}

/** Part en % (arrondie ; « < 1 % » pour un petit bout). */
export function sharePct(m: number, total: number) {
  if (!total || m <= 0) return '';
  const p = (m / total) * 100;
  return p < 1 ? '< 1 %' : `${Math.round(p)} %`;
}

/** Bouts de la trace (coordonnées) de chaque morceau, pour colorer la trace sur la carte. */
export function wayRunLines(line: LonLat[], runs: WayRun[]): { type: WayType; gr: boolean; coords: [number, number][] }[] {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + distanceM(line[i - 1], line[i]));
  const at = (d: number): [number, number] => {
    let i = 1;
    while (i < line.length - 1 && cum[i] < d) i++;
    const span = cum[i] - cum[i - 1], f = span ? Math.max(0, Math.min(1, (d - cum[i - 1]) / span)) : 0;
    const a = line[i - 1], b = line[i];
    return [a.lon + f * (b.lon - a.lon), a.lat + f * (b.lat - a.lat)];
  };
  return runs.map((r) => {
    const coords: [number, number][] = [at(r.from)];
    for (let i = 0; i < line.length; i++) if (cum[i] > r.from && cum[i] < r.to) coords.push([line[i].lon, line[i].lat]);
    coords.push(at(r.to));
    return { type: r.type, gr: !!r.gr, coords };
  });
}
