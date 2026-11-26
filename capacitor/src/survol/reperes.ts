// 🎯 Repères : la caméra du survol qui regarde où l'on va (étude du 26/11, Seb : « fixer un point au loin sur la trace »).
// Comme un caméraman : il cadre « toi + le prochain repère » (virage franc, fin de pente raide, sommet, arrivée), tient ce
// cadre, puis passe au repère suivant. Caméra derrière et au-dessus, dans l'axe du repère (les lacets passent sous elle),
// objectif serré (téléobjectif). Un plan posé, de face, sur le passage le plus raide ; un tour à l'arrivée.
import { chemin, ecartAngle, PITCH_MAX, type Cam, type Hauteur, type Relief } from './camera';

/** Recul le plus court (m), hauteur de l'œil (part du recul) et champ de vision vertical (°) selon la Hauteur. */
export const REPERES: Record<Hauteur, { recul: number; haut: number; fov: number }> = {
  bas: { recul: 350, haut: 0.35, fov: 30 },
  moyen: { recul: 500, haut: 0.45, fov: 28 },
  haut: { recul: 900, haut: 0.6, fov: 26 },
};
/** Durées (s) du tour à l'arrivée et du temps ajouté au plan posé du passage raide (on y ralentit pour lever les yeux). */
export const T_TOUR = 12, T_POSE = 6;
/** Champ de vision du plan posé : plus large, la paroi entière entre dans l'image quand on lève les yeux. */
export const FOV_POSE = 36;

type Chemin = ReturnType<typeof chemin>;
interface P3 { x: number; y: number; z: number }

const rad = Math.PI / 180;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const doux = (t: number) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) ** 2);

/** Flou gaussien d'une suite de valeurs (s en images). */
function flou(v: number[], s: number): number[] {
  if (s < 0.5) return v.slice();
  const r = Math.ceil(3 * s);
  return v.map((_, i) => {
    let a = 0, w = 0;
    for (let k = -r; k <= r; k++) { const j = Math.max(0, Math.min(v.length - 1, i + k)), g = Math.exp(-(k * k) / (2 * s * s)); a += v[j] * g; w += g; }
    return a / w;
  });
}

/**
 * Repères de la trace (distances en m) : virages francs (plus de 50° entre les 250 m d'avant et d'après), fins de montée
 * raide (la pente devant tombe sous la moitié : épaule, replat, col), point le plus haut, arrivée. Deux repères à moins de
 * 300 m n'en font qu'un : on garde le plus loin.
 */
export function reperes(c: Chemin, alt: (x: number, y: number) => number): number[] {
  const pas = 20, N = Math.max(2, Math.floor(c.total / pas)), z: number[] = [], cap: number[] = [];
  for (let i = 0; i <= N; i++) { const p = c.lisse(i * pas, 120); z.push(alt(p.x, p.y)); }
  for (let i = 0; i <= N; i++) { const a = c.lisse(i * pas - 150, 150), b = c.lisse(i * pas + 150, 150); cap.push(Math.atan2(b.x - a.x, b.y - a.y) / rad); }
  const out: number[] = [], L = Math.round(250 / pas);
  for (let i = L; i < N - L; i++) {
    const avant = (z[i] - z[i - L]) / (L * pas), apres = (z[i + L] - z[i]) / (L * pas);
    if ((avant > 0.25 && apres < avant * 0.5) || Math.abs(ecartAngle(cap[i - L], cap[i + L])) > 50) out.push(i * pas);
  }
  let hi = 0;
  for (let i = 0; i <= N; i++) if (z[i] > z[hi]) hi = i;
  out.push(hi * pas, c.total);
  out.sort((a, b) => a - b);
  const net: number[] = [];
  for (const d of out) { if (net.length && d - net[net.length - 1] < 300) net.pop(); net.push(d); }
  return net;
}

/** Passage le plus raide (400 m) s'il monte ou descend à plus de 30 %, loin des bouts : [début, fin] en m, ou null. */
export function passageRaide(c: Chemin, alt: (x: number, y: number) => number): [number, number] | null {
  const l = 400;
  if (c.total < 4 * l) return null;
  let best: [number, number] | null = null, raide = 0.3;
  for (let d = c.total * 0.12; d + l < c.total * 0.85; d += 20) {
    const a = c.lisse(d, 80), b = c.lisse(d + l, 80), g = Math.abs(alt(b.x, b.y) - alt(a.x, a.y)) / l;
    if (g > raide) { raide = g; best = [d, d + l]; }
  }
  return best;
}

/** Rien ne coupe la vue entre a et b (marge en m au-dessus du relief, réduite près de b). */
function voit(alt: (x: number, y: number) => number, a: P3, b: P3, marge = 15): boolean {
  for (let i = 1; i < 40; i++) {
    const f = i / 40;
    if (alt(lerp(a.x, b.x, f), lerp(a.y, b.y, f)) + marge * Math.min(1, (1 - f) * 4) > lerp(a.z, b.z, f)) return false;
  }
  return true;
}

/**
 * Le corps du film 🎯 (sans l'intro) : `n` + 1 images de u = 0 à 1. `suivi` : part du corps où l'on avance sur la trace
 * (le reste est le tour à l'arrivée), `secondes` : durée du corps. `hauteurPx` : hauteur de la carte à l'écran, pour traduire en zoom MapLibre.
 */
export function filmReperes(line: { lon: number; lat: number }[], hauteur: Hauteur, relief: Relief, n: number, suivi: number, secondes: number, hauteurPx: number): Cam[] {
  // k : images par seconde / 13 (les flous ci-dessous sont réglés pour 13 images par seconde, comme dans l'étude).
  const c = chemin(line), A = REPERES[hauteur], k = n / Math.max(1, secondes) / 13;
  const alt = (x: number, y: number) => relief.alt(c.pr.depuis({ x, y })) ?? 0;
  const R = reperes(c, alt), raide = passageRaide(c, alt);
  const marcheur = (d: number): P3 => { const p = c.lisse(d, 120), q = c.at(d); return { ...p, z: alt(q.x, q.y) + 2 }; };
  const versant = (x: number, y: number) => {
    const l = 400, gx = alt(x + l, y) - alt(x - l, y), gy = alt(x, y + l) - alt(x, y - l), m = Math.hypot(gx, gy) || 1;
    return { x: -gx / m, y: -gy / m };
  };
  // On avance à vitesse constante, sauf sur le passage raide où l'on prend T_POSE secondes de plus.
  const tS = suivi * secondes, lent = raide && tS > T_POSE + 2 ? raide : null, vs = c.total / (tS - (lent ? T_POSE : 0));
  const ds = Array.from({ length: n + 1 }, (_, i) => {
    const t = Math.min(1, i / n / suivi) * tS;
    if (!lent) return Math.min(c.total, t * vs);
    const t0 = lent[0] / vs, tr = (lent[1] - lent[0]) / vs + T_POSE;
    return Math.min(c.total, t < t0 ? t * vs : t < t0 + tr ? lent[0] + ((t - t0) / tr) * (lent[1] - lent[0]) : lent[1] + (t - t0 - tr) * vs);
  });

  // 1. Repère tenu : le premier devant ; on passe au suivant à moins de 150 m, ou s'il est caché plus d'une seconde.
  let cible = 0, cache = 0;
  const cibles = ds.map((d) => {
    while (cible < R.length - 1 && R[cible] - d < 150) cible++;
    const w = marcheur(d), t = marcheur(R[cible]);
    const oeil = { x: w.x - (t.x - w.x) * 0.3, y: w.y - (t.y - w.y) * 0.3, z: w.z + 300 };
    if (!voit(alt, oeil, t)) { if (++cache > 20 * k && cible < R.length - 1) { cible++; cache = 0; } } else cache = 0;
    return cible;
  });
  // Passage d'un repère à l'autre en ~2 s : flou fort sur le point visé.
  const T = cibles.map((i) => marcheur(R[i]));
  const tx = flou(T.map((t) => t.x), 25 * k), ty = flou(T.map((t) => t.y), 25 * k), tz = flou(T.map((t) => t.z), 25 * k);
  const W = ds.map(marcheur);

  // 2. L'œil : derrière soi dans l'axe du repère, le recul le plus court qui garde le marcheur ET le repère dans l'image.
  const ecart = (e: P3, p: P3, q: P3) => {
    const u = [p.x - e.x, p.y - e.y, p.z - e.z], v = [q.x - e.x, q.y - e.y, q.z - e.z];
    return Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v) || 1)))) / rad;
  };
  const oeil: P3[] = ds.map((_, i) => {
    const w = W[i], t = { x: tx[i], y: ty[i], z: tz[i] }, ux = t.x - w.x, uy = t.y - w.y, m = Math.hypot(ux, uy) || 1;
    let e: P3 = w;
    for (let D = A.recul; D <= 4000; D += 100) {
      e = { x: w.x - (ux / m) * D, y: w.y - (uy / m) * D, z: w.z + D * A.haut };
      if (ecart(e, w, t) <= 0.55 * A.fov) break;
    }
    return e;
  });
  const lisse = (v: P3[], s: number) => { const x = flou(v.map((p) => p.x), s), y = flou(v.map((p) => p.y), s), z = flou(v.map((p) => p.z), s); return v.map((_, i) => ({ x: x[i], y: y[i], z: z[i] })); };
  const E = lisse(oeil, 40 * k);

  // 3. Plan posé sur le passage raide (coupe franche) : un drone immobile en face de la paroi, un peu bas ; il cadre le
  // marcheur dans la pente, puis lève lentement le regard jusqu'au haut (repère suivant) : la taille de la montagne (Seb, 26/11).
  const coupes = new Set<number>(), leveTete = ds.map(() => 0), pose = ds.map(() => false);
  let haut: P3 | null = null;
  if (raide) {
    // Où poser le drone : en face de la paroi (±40° autour de la pente), assez loin pour la voir entière, de bas en haut ; la première
    // place d'où l'on voit le marcheur presque tout le passage, et le haut.
    const mid = marcheur((raide[0] + raide[1]) / 2), v = versant(mid.x, mid.y), a0 = Math.atan2(v.x, v.y);
    haut = marcheur(R.find((d) => d > raide[1]) ?? c.total);
    const dans = ds.map((d) => d >= raide[0] && d <= raide[1]), idx = dans.flatMap((x, i) => (x ? [i] : []));
    let s: P3 | null = null;
    cherche: for (const D of [1800, 2500, 1300, 900].map((x) => x + A.recul - 500)) {
      for (const h of [0.1, 0.2, 0.3, 0.45]) {
        for (const da of [0, 20, -20, 40, -40]) {
          const a = a0 + da * rad, x = mid.x + D * Math.sin(a), y = mid.y + D * Math.cos(a), q = { x, y, z: Math.max(mid.z + D * h, alt(x, y) + 80) };
          if (!voit(alt, q, haut, 20)) continue;
          const vu = idx.filter((i, j) => j % 4 === 0 && voit(alt, q, W[i], 10)).length / Math.max(1, Math.ceil(idx.length / 4));
          if (vu > 0.8) { s = q; break cherche; }
        }
      }
    }
    if (s) {
      let j = 0;
      for (const i of idx) {
        E[i] = s; pose[i] = true; leveTete[i] = doux(Math.max(0, Math.min(1, (j++ / idx.length - 0.35) / 0.5)));
        if (!dans[i - 1] || !dans[i + 1]) coupes.add(i);
      }
    }
  }

  // 4. Tour à l'arrivée : on tourne autour du dernier point, en partant de là où l'on est, en s'élevant un peu.
  const f = W[W.length - 1], i1 = ds.findIndex((d, i) => i / n >= suivi), tour = ds.map(() => 0);
  if (i1 > 0) {
    const t0 = { x: tx[i1 - 1], y: ty[i1 - 1], z: tz[i1 - 1] }, e0 = E[i1 - 1], a0 = Math.atan2(e0.x - f.x, e0.y - f.y), r0 = Math.hypot(e0.x - f.x, e0.y - f.y);
    for (let i = i1; i <= n; i++) {
      const v = doux((i / n - suivi) / (1 - suivi)), w = doux(Math.min(1, v * 3)), a = a0 + v * 1.6 * Math.PI, r = lerp(r0, Math.max(1400, r0), w);
      E[i] = { x: f.x + r * Math.sin(a), y: f.y + r * Math.cos(a), z: lerp(e0.z, f.z + r * 0.35, w) };
      tx[i] = lerp(t0.x, f.x, w); ty[i] = lerp(t0.y, f.y, w); tz[i] = lerp(t0.z, f.z + 30, w); tour[i] = w;
    }
  }

  // 5. Jamais dans la montagne : l'œil est relevé là où le sol ou la vue l'exige, à l'avance et en douceur.
  const besoin = E.map((e, i) => {
    let h = Math.max(0, alt(e.x, e.y) + 60 - e.z);
    for (let j = 0; j < 30 && !(voit(alt, { ...e, z: e.z + h }, W[i], 10) && voit(alt, { ...e, z: e.z + h }, { x: tx[i], y: ty[i], z: tz[i] }, 20)); j++) h += 25;
    return h;
  });
  const r = Math.ceil(30 * k), leve = flou(besoin.map((_, i) => Math.max(...besoin.slice(Math.max(0, i - r), i + r + 1))), 15 * k);

  // 6. Le regard vise entre le marcheur et le repère (le marcheur en bas, le repère en haut), puis traduit pour MapLibre.
  const out: Cam[] = E.map((e0, i) => {
    const e = { ...e0, z: e0.z + Math.max(leve[i], besoin[i]) }, w = W[i], t = { x: tx[i], y: ty[i], z: tz[i] };
    const u = [w.x - e.x, w.y - e.y, w.z - e.z], v = [t.x - e.x, t.y - e.y, t.z - e.z], lu = Math.hypot(...u) || 1, lv = Math.hypot(...v) || 1;
    // Au tour final, le regard glisse du marcheur vers l'arrivée seule.
    const q0 = tour[i];
    let b = u.map((x, j) => (x / lu + v[j] / lv) * (1 - q0) + (v[j] / lv) * q0), dist = lerp(lu, lv, q0);
    if (pose[i] && haut) {
      // Plan posé : du marcheur au haut de la paroi.
      const h = [haut.x - e.x, haut.y - e.y, haut.z - e.z], lh = Math.hypot(...h) || 1, q = leveTete[i];
      b = u.map((x, j) => (x / lu) * (1 - q) + (h[j] / lh) * q); dist = lerp(lu, lh, q);
    }
    const lb = Math.hypot(...b) || 1;
    const L = Math.max(1, Math.hypot(b[0], b[1]) / lb * dist), dz = (b[2] / lb) * dist;
    const pitch = Math.min(PITCH_MAX, 90 + Math.atan2(dz, L) / rad);
    const cible = c.pr.depuis({ x: e.x + (b[0] / lb) * dist, y: e.y + (b[1] / lb) * dist });
    const D = Math.hypot(L, dz);
    const zoom = Math.log2((0.5 * hauteurPx / Math.tan((A.fov / 2) * rad)) * 40_075_016.7 * Math.cos(cible.lat * rad) / (512 * D));
    return { lon: cible.lon, lat: cible.lat, zoom, pitch, bearing: Math.atan2(b[0], b[1]) / rad, d: ds[i], point: c.pr.depuis(c.at(ds[i])),
      elevation: e.z + dz, garde: 40, fov: pose[i] ? FOV_POSE : A.fov, coupe: coupes.has(i) || undefined };
  });
  for (let i = 1; i < out.length; i++) out[i].bearing = out[i - 1].bearing + ecartAngle(out[i - 1].bearing, out[i].bearing);
  return out;
}
