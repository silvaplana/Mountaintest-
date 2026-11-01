// Profil en coupe et pente le long d'un parcours (même calcul côté Kotlin, Profile.kt).
// Les altitudes viennent du modèle de terrain IGN (RGE ALTI), interrogé au plus tous les 10 m.
// Pente = dénivelé entre 25 m avant et 25 m après le point, divisé par ces 50 m :
// cette fenêtre glissante lisse les petits sauts du modèle et les zigzags du tracé.
import { distanceM } from '../gps/adaptive';
import type { LonLat } from './osmTrails';

export const SLOPE_WINDOW_M = 50;

export interface ProfileData { d: number[]; z: number[]; lon: number[]; lat: number[]; total: number }

export function buildProfile(segments: (LonLat & { ele: number | null })[][]): ProfileData {
  const out: ProfileData = { d: [], z: [], lon: [], lat: [], total: 0 };
  let d = 0;
  segments.forEach((seg) => seg.forEach((p, i) => {
    if (i > 0) d += distanceM(seg[i - 1], p);
    if (p.ele === null) return;
    if (out.d.length && d - out.d[out.d.length - 1] < 0.5) return; // doublons
    out.d.push(d); out.z.push(p.ele); out.lon.push(p.lon); out.lat.push(p.lat);
  }));
  out.total = d;
  return out;
}

/** Indice k tel que d[k] ≤ x < d[k+1]. */
function seek(p: ProfileData, x: number) {
  let lo = 0, hi = p.d.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p.d[m] <= x) lo = m; else hi = m; }
  return lo;
}

/** Altitude et position à la distance x (interpolation linéaire). */
export function pointAt(p: ProfileData, x: number) {
  const n = p.d.length;
  x = Math.max(p.d[0], Math.min(p.d[n - 1], x));
  const k = seek(p, x), k2 = Math.min(k + 1, n - 1);
  const span = p.d[k2] - p.d[k], t = span > 0 ? (x - p.d[k]) / span : 0;
  const lerp = (a: number[]) => a[k] + (a[k2] - a[k]) * t;
  return { d: x, z: lerp(p.z), lon: lerp(p.lon), lat: lerp(p.lat) };
}

/** Pente au point x, en degrés et en %, sur la fenêtre glissante (positive = ça monte dans le sens du tracé). */
export function slopeAt(p: ProfileData, x: number, window = SLOPE_WINDOW_M) {
  const n = p.d.length;
  const a = Math.max(p.d[0], x - window / 2), b = Math.min(p.d[n - 1], x + window / 2);
  if (b - a < 1) return { deg: 0, pct: 0 };
  const dz = pointAt(p, b).z - pointAt(p, a).z;
  return { deg: Math.atan2(dz, b - a) * 180 / Math.PI, pct: dz / (b - a) * 100 };
}

/** Distance le long du parcours du point le plus proche de (lon, lat). */
export function nearestD(p: ProfileData, lon: number, lat: number) {
  let best = 0, bestM = Infinity;
  for (let i = 0; i < p.d.length; i++) {
    const m = distanceM({ lon, lat }, { lon: p.lon[i], lat: p.lat[i] });
    if (m < bestM) { bestM = m; best = p.d[i]; }
  }
  return best;
}

export function formatSlope(s: { deg: number; pct: number }) {
  const sign = s.deg > 0.5 ? '↗ ' : s.deg < -0.5 ? '↘ ' : '';
  return `${sign}${Math.round(Math.abs(s.deg))}° (${Math.round(Math.abs(s.pct))} %)`;
}
