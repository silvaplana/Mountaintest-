// ✏ Modifier une trace à moi (maquette validée par Seb le 25/11, maquettes/edition-trace/) :
// recoller un morceau sur les chemins, prolonger la fin, mode souple (ronds qu'on fait glisser),
// et 📍 les épingles piquées sur la carte avec un petit mot. Calculs purs, sans carte ni réseau.
import { distanceM } from '../gps/adaptive';
import type { LonLat } from './osmTrails';

/** 📍 Point piqué sur la carte, avec son petit mot ; `vu` : le mot est affiché sur la carte. */
export interface Pin { lon: number; lat: number; txt: string; vu: boolean }

/** Coordonnées locales en mètres (assez juste à l'échelle d'une trace). */
function projector(lat0: number) {
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111_320, ky = 111_320;
  return {
    xy: (p: LonLat): [number, number] => [p.lon * kx, p.lat * ky],
    ll: (x: number, y: number): LonLat => ({ lon: x / kx, lat: y / ky }),
  };
}

/** Point de la trace le plus proche de `p` (indice) et sa distance en mètres. */
export function nearestIndex(line: LonLat[], p: LonLat): { i: number; d: number } {
  let i = 0, d = Infinity;
  line.forEach((q, k) => { const dk = distanceM(p, q); if (dk < d) { d = dk; i = k; } });
  return { i, d };
}

/** Ajoute des points pour qu'il y en ait un au moins tous les `stepM` mètres. */
export function densify(line: LonLat[], stepM: number): LonLat[] {
  if (line.length < 2) return line.slice();
  const out = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], n = Math.max(1, Math.ceil(distanceM(a, b) / stepM));
    for (let k = 1; k <= n; k++) out.push({ lon: a.lon + ((b.lon - a.lon) * k) / n, lat: a.lat + ((b.lat - a.lat) * k) / n });
  }
  return out;
}

/** Morceau recollé : la nouvelle ligne et, pour chaque point, s'il est sur un chemin. */
export interface Snap { line: LonLat[]; onWay: boolean[]; share: number }

/**
 * Recoller un morceau sur les chemins : un point tous les 5 m, posé sur le chemin le plus proche s'il
 * est à moins de `nearM` ; plus loin de tout chemin, le tracé reste tel quel (« par morceaux »).
 */
export function snapToWays(seg: LonLat[], ways: LonLat[][], nearM = 40): Snap {
  if (seg.length < 2) return { line: seg.slice(), onWay: seg.map(() => false), share: 0 };
  const { xy, ll } = projector(seg[0].lat);
  const CELL = 60;
  const grid = new Map<string, [number, number, number, number][]>();
  for (const w of ways) for (let i = 1; i < w.length; i++) {
    const [ax, ay] = xy(w[i - 1]), [bx, by] = xy(w[i]);
    const x0 = Math.floor((Math.min(ax, bx) - nearM) / CELL), x1 = Math.floor((Math.max(ax, bx) + nearM) / CELL);
    const y0 = Math.floor((Math.min(ay, by) - nearM) / CELL), y1 = Math.floor((Math.max(ay, by) + nearM) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const k = `${cx},${cy}`, l = grid.get(k);
      if (l) l.push([ax, ay, bx, by]); else grid.set(k, [[ax, ay, bx, by]]);
    }
  }
  const line: LonLat[] = [], onWay: boolean[] = [];
  let on = 0;
  const pts = densify(seg, 5);
  for (const p of pts) {
    const [px, py] = xy(p);
    let best: [number, number] | null = null, bd = nearM;
    for (const [ax, ay, bx, by] of grid.get(`${Math.floor(px / CELL)},${Math.floor(py / CELL)}`) ?? []) {
      const sx = bx - ax, sy = by - ay, l2 = sx * sx + sy * sy;
      const u = l2 ? Math.max(0, Math.min(1, ((px - ax) * sx + (py - ay) * sy) / l2)) : 0;
      const qx = ax + u * sx, qy = ay + u * sy, d = Math.hypot(qx - px, qy - py);
      if (d <= bd) { bd = d; best = [qx, qy]; }
    }
    const q = best ? ll(best[0], best[1]) : p;
    if (best) on++;
    // Deux points presque confondus (le chemin fait un coude) : un seul.
    if (line.length && distanceM(line[line.length - 1], q) < 1) { onWay[onWay.length - 1] ||= !!best; continue; }
    line.push(q); onWay.push(!!best);
  }
  // Les deux bouts restent attachés à la trace, pour qu'elle ne se coupe pas.
  line[0] = seg[0]; line[line.length - 1] = seg[seg.length - 1];
  return { line, onWay, share: Math.round((100 * on) / pts.length) };
}

/**
 * Enlève les « houppettes » d'un tracé recollé : un aller-retour en pointe (le calcul d'itinéraire a accroché un point
 * sur un chemin voisin, ou un cul-de-sac, puis revient au même endroit). Un aller-retour que le dessin `ref` fait
 * lui-même (vers un sommet, un point de vue) est gardé : le dessin va jusqu'au bout de la pointe.
 */
export function cutSpurs(line: LonLat[], ref: LonLat[], maxM = 3000): LonLat[] {
  return keptAfterSpurs(line, ref, maxM).map((k) => line[k]);
}

/** Indices des points gardés par `cutSpurs`, pour garder en face d'autres valeurs (sur chemin ou non). */
export function keptAfterSpurs(line: LonLat[], ref: LonLat[], maxM = 3000): number[] {
  const idx = line.map((_, k) => k);
  const pt = (k: number) => line[idx[k]];
  const dessin = densify(ref, 5);
  let i = 0;
  while (i < idx.length - 2) {
    let len = 0, best = -1;
    for (let j = i + 1; j < idx.length; j++) {
      len += distanceM(pt(j - 1), pt(j));
      if (len > maxM) break;
      // Revenu à moins de 8 m du point de départ après au moins 15 m de pointe : un aller-retour.
      const c = distanceM(pt(i), pt(j));
      if (j > i + 1 && c < 8 && len > 2 * c + 30) best = j;
    }
    if (best > 0) {
      let pointe = pt(i), dp = 0;
      for (let k = i + 1; k < best; k++) { const d = distanceM(pt(i), pt(k)); if (d > dp) { dp = d; pointe = pt(k); } }
      // Voulu si le dessin passe au bout de la pointe ET y va depuis la base (il fait lui-même le chemin).
      const base = nearestIndex(dessin, pt(i)).i, bout = nearestIndex(dessin, pointe);
      let le = 0;
      for (let k = Math.min(base, bout.i) + 1; k <= Math.max(base, bout.i); k++) le += distanceM(dessin[k - 1], dessin[k]);
      if (!(bout.d <= 15 && le >= 0.7 * dp)) { idx.splice(i + 1, best - i - 1); continue; }
    }
    i++;
  }
  return idx;
}

/** Coupe une ligne en morceaux d'au plus `maxM` mètres (indices [a, b], les bouts partagés). */
export function piecesOf(line: LonLat[], maxM: number): [number, number][] {
  const out: [number, number][] = [];
  let a = 0, m = 0;
  for (let i = 1; i < line.length; i++) {
    m += distanceM(line[i - 1], line[i]);
    if (m >= maxM && i < line.length - 1) { out.push([a, i]); a = i; m = 0; }
  }
  if (line.length > 1) out.push([a, line.length - 1]);
  return out;
}

/** Morceaux continus sur chemin (indices dans `snap.line`), d'au moins `minM` mètres. */
export function wayRunsOf(snap: Snap, minM = 80): [number, number][] {
  const out: [number, number][] = [];
  let a = -1;
  for (let i = 0; i <= snap.line.length; i++) {
    if (i < snap.line.length && snap.onWay[i]) { if (a < 0) a = i; continue; }
    if (a >= 0 && i - 1 > a) {
      let m = 0;
      for (let k = a + 1; k < i; k++) m += distanceM(snap.line[k - 1], snap.line[k]);
      if (m >= minM) out.push([a, i - 1]);
    }
    a = -1;
  }
  return out;
}

/** La trace avec le morceau a..b (indices compris) remplacé par `part`. */
export function replaceSlice(line: LonLat[], a: number, b: number, part: LonLat[]): LonLat[] {
  const [i, j] = a <= b ? [a, b] : [b, a];
  return [...line.slice(0, i), ...part, ...line.slice(j + 1)];
}

/** Mode souple : indices de `n` ronds régulièrement espacés le long de la trace (départ et arrivée compris). */
export function splineNodes(line: LonLat[], n: number): number[] {
  if (line.length <= n) return line.map((_, i) => i);
  let total = 0;
  for (let i = 1; i < line.length; i++) total += distanceM(line[i - 1], line[i]);
  const idx = [0];
  let acc = 0;
  for (let i = 1; i < line.length - 1; i++) {
    acc += distanceM(line[i - 1], line[i]);
    if (acc >= (total * idx.length) / (n - 1) && idx.length < n - 1) idx.push(i);
  }
  idx.push(line.length - 1);
  return idx;
}

/**
 * Mode souple : un rond tous les `stepM` mètres le long de la trace (départ et arrivée compris),
 * au plus `max` ronds. L'écart vient de l'écran : les ronds restent à la même distance au doigt quel que soit le zoom.
 */
export function splineNodesEvery(line: LonLat[], stepM: number, max = 200): number[] {
  if (line.length < 2) return line.map((_, i) => i);
  let total = 0;
  for (let i = 1; i < line.length; i++) total += distanceM(line[i - 1], line[i]);
  const n = Math.max(2, Math.min(max, Math.round(total / Math.max(1, stepM)) + 1));
  return splineNodes(line, n);
}

const STEPS = 10;
function catmull(p0: LonLat, p1: LonLat, p2: LonLat, p3: LonLat): LonLat[] {
  const out: LonLat[] = [];
  const f = (a: number, b: number, c: number, d: number, t: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  for (let k = 1; k < STEPS; k++) {
    const t = k / STEPS;
    out.push({ lon: f(p0.lon, p1.lon, p2.lon, p3.lon, t), lat: f(p0.lat, p1.lat, p2.lat, p3.lat, t) });
  }
  out.push(p2); // le rond suivant, exactement
  return out;
}

/**
 * Mode souple : le rond `k` va en `p`. Seule la trace entre ses deux voisins change, en courbe douce
 * passant par les ronds ; le reste ne bouge pas. Renvoie la trace et les nouveaux indices des ronds.
 */
export function moveNode(line: LonLat[], nodes: number[], k: number, p: LonLat): { line: LonLat[]; nodes: number[] } {
  const N = nodes.map((i) => line[i]);
  N[k] = p;
  const g = Math.max(0, k - 1), d = Math.min(nodes.length - 1, k + 1);
  if (g === d) return { line: line.map((q, i) => (i === nodes[k] ? p : q)), nodes };
  let seg: LonLat[] = [N[g]];
  for (let j = g; j < d; j++) seg = seg.concat(catmull(N[Math.max(0, j - 1)], N[j], N[j + 1], N[Math.min(N.length - 1, j + 2)]));
  const out = [...line.slice(0, nodes[g]), ...seg, ...line.slice(nodes[d] + 1)];
  const delta = seg.length - (nodes[d] - nodes[g] + 1);
  return { line: out, nodes: nodes.map((i, j) => (j <= g ? i : j < d ? nodes[g] + (j - g) * STEPS : i + delta)) };
}
