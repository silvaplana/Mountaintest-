// 🧭 Naviguer sur la trace violette : où suis-je sur la trace, à quelle distance d'elle,
// combien reste-t-il jusqu'à l'arrivée. Calcul local, sans réseau. Même calcul côté Kotlin (Navigation.kt).
import { distanceM } from '../gps/adaptive';
import type { LonLat } from './osmTrails';
import type { ProfileData } from './profile';

/** Au-delà de cette distance de la trace, on prévient « hors trace ». */
export const OFF_TRACK_M = 50;

export interface NavState {
  /** Distance entre ma position et le point le plus proche de la trace. */
  offM: number;
  /** Distance parcourue le long de la trace jusqu'à ce point. */
  alongM: number;
  /** Distance restante jusqu'à l'arrivée. */
  remainingM: number;
  /** Montée et descente restantes (null : altitudes inconnues). */
  gainLeftM: number | null;
  lossLeftM: number | null;
  /** Point de la trace le plus proche. */
  nearest: LonLat;
}

/** Projette la position sur chaque tronçon (plan local, précis à l'échelle d'une rando). */
export function locateOnLine(line: LonLat[], pos: LonLat): { offM: number; alongM: number; totalM: number; nearest: LonLat } {
  const k = Math.cos((pos.lat * Math.PI) / 180);
  const M = 111_320; // mètres par degré de latitude
  const xy = (p: LonLat) => [(p.lon - pos.lon) * k * M, (p.lat - pos.lat) * M];
  let best = { off: Infinity, along: 0, nearest: line[0] };
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const seg = distanceM(a, b);
    const [ax, ay] = xy(a), [bx, by] = xy(b);
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    const off = Math.hypot(ax + t * dx, ay + t * dy);
    if (off < best.off) best = { off, along: acc + t * seg, nearest: { lon: a.lon + t * (b.lon - a.lon), lat: a.lat + t * (b.lat - a.lat) } };
    acc += seg;
  }
  return { offM: best.off, alongM: best.along, totalM: acc, nearest: best.nearest };
}

/** Montée et descente du profil après la distance donnée. */
export function climbLeft(p: ProfileData, fromM: number) {
  let gain = 0, loss = 0;
  for (let i = 1; i < p.d.length; i++) {
    if (p.d[i] <= fromM) continue;
    const dz = p.z[i] - p.z[i - 1];
    if (dz > 0) gain += dz; else loss -= dz;
  }
  return { gain, loss };
}

export function navState(line: LonLat[], pos: LonLat, profile: ProfileData | null): NavState {
  const r = locateOnLine(line, pos);
  const c = profile && profile.d.length > 1 ? climbLeft(profile, r.alongM) : null;
  return {
    offM: r.offM, alongM: r.alongM, remainingM: Math.max(0, r.totalM - r.alongM),
    gainLeftM: c ? c.gain : null, lossLeftM: c ? c.loss : null, nearest: r.nearest,
  };
}
