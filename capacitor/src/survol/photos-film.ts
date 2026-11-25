// 📷 Photos de la sortie dans le film (Seb, 25/11) : chaque photo s'ouvre là où elle a été prise. La caméra
// ralentit en arrivant sur son point, la photo reste quelques secondes, puis le film repart.
import type { Cam, LonLat } from './camera';

/** Durée (s) d'une photo à l'écran ; elle s'ajoute au film. */
export const T_PHOTO = 3;
export const MAX_PHOTOS_FILM = 8;
/** Une photo est « sur la trace » à moins de 150 m d'elle. */
const PRES = 150;

const metres = (a: LonLat, b: LonLat) => Math.hypot((a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110_540);

type Prise = { lon: number | null; lat: number | null; prise_le: string; etoile?: boolean; video?: boolean };

/** Photos prises le long de la trace, dans l'ordre des prises ; au-delà de `max`, les ⭐ d'abord puis les autres réparties. */
export function photosDeLaTrace<T extends Prise>(photos: T[], line: LonLat[], max = MAX_PHOTOS_FILM): T[] {
  const pres = photos.filter((p) => !p.video && p.lon != null && p.lat != null && line.some((q) => metres(q, { lon: p.lon!, lat: p.lat! }) < PRES))
    .sort((a, b) => a.prise_le.localeCompare(b.prise_le));
  if (pres.length <= max) return pres;
  const et = pres.filter((p) => p.etoile).slice(0, max), reste = pres.filter((p) => !p.etoile), n = max - et.length;
  const pris = new Set(Array.from({ length: n }, (_, i) => reste[Math.round((i * (reste.length - 1)) / Math.max(1, n - 1))]));
  return pres.filter((p) => et.includes(p) || pris.has(p));
}

/** Moment (0 → 1 de la trajectoire, après l'intro) où le film passe au plus près de la photo ; null si jamais près. */
export function momentPhoto(track: Cam[], p: LonLat, debut: number): number | null {
  let m = PRES * 1.5, k = -1;
  for (let i = Math.ceil(debut * (track.length - 1)) + 1; i < track.length; i++) { const d = metres(track[i].point, p); if (d < m) { m = d; k = i; } }
  return k < 0 ? null : k / (track.length - 1);
}

const doux = (v: number) => { const x = Math.max(0, Math.min(1, v)); return x * x * (3 - 2 * x); };

/**
 * Horloge du film avec ses photos : un film de `duree` secondes plus T_PHOTO par photo. a(u) rend, pour le moment u
 * (0 → 1) du film, le moment t de la trajectoire et la photo à montrer (son rang dans `moments`, q de 0 à 1).
 * Autour de chaque photo la caméra ralentit sans s'arrêter net ; deux photos au même endroit passent l'une après l'autre.
 */
export function horlogePhotos(duree: number, moments: number[], P = T_PHOTO) {
  const w = 0.6 / duree, rang = moments.map((m, i) => ({ m, i })).sort((a, b) => a.m - b.m), l: { m: number; i: number }[] = [];
  for (const x of rang) { const m = Math.max(x.m, l.length ? l[l.length - 1].m + 2 * w : w); if (m <= 1 - w) l.push({ m, i: x.i }); }
  const total = duree + P * l.length;
  const T = (t: number) => duree * t + P * l.reduce((s, x) => s + doux((t - x.m) / (2 * w) + 0.5), 0);
  const a = (u: number): { t: number; photo: number | null; q: number } => {
    const but = Math.max(0, Math.min(1, u)) * total;
    let lo = 0, hi = 1;
    for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (T(mid) < but) lo = mid; else hi = mid; }
    const t = (lo + hi) / 2, x = l.find((y) => Math.abs(t - y.m) < w);
    return x ? { t, photo: x.i, q: (but - T(x.m - w)) / (2 * w * duree + P) } : { t, photo: null, q: 0 };
  };
  return { total, photos: l.map((x) => x.i), a };
}
