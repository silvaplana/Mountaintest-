import { distanceM } from '../gps/adaptive';
import type { TrackPoint } from './gpx';

export interface TrackStats { distanceM: number; gainM: number; lossM: number; durationMs: number; movingMs: number }

/** Seuil de dénivelé : en dessous, les variations d'altitude GPS sont surtout du bruit. */
export const ELEVATION_THRESHOLD_M = 10;
const MOVING_SPEED = 0.5; // m/s

export function computeStats(points: TrackPoint[], threshold = ELEVATION_THRESHOLD_M): TrackStats {
  const s: TrackStats = { distanceM: 0, gainM: 0, lossM: 0, durationMs: 0, movingMs: 0 };
  let ref: number | null = null; // altitude de référence (hystérésis)
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i > 0) {
      const prev = points[i - 1];
      const d = distanceM(prev, p);
      s.distanceM += d;
      if (p.time !== null && prev.time !== null) {
        const dt = p.time - prev.time;
        if (dt > 0 && d / (dt / 1000) >= MOVING_SPEED) s.movingMs += dt;
      }
    }
    if (p.ele === null) continue;
    if (ref === null) ref = p.ele;
    else if (p.ele - ref >= threshold) { s.gainM += p.ele - ref; ref = p.ele; }
    else if (ref - p.ele >= threshold) { s.lossM += ref - p.ele; ref = p.ele; }
  }
  const times = points.map((p) => p.time).filter((t): t is number => t !== null);
  if (times.length > 1) s.durationMs = times[times.length - 1] - times[0];
  return s;
}

export const formatKm = (m: number) => `${(m / 1000).toFixed(2)} km`;
export function formatDuration(ms: number) {
  const min = Math.round(ms / 60000);
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}
