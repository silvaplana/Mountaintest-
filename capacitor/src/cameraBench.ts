import type { Map as MlMap } from 'maplibre-gl';
import { bench } from './metrics';

/** Parcours caméra du scénario commun (identique côté Kotlin) : 5 transitions de 3 s, jouées 2 fois. */
const START = { center: [5.605, 43.18] as [number, number], zoom: 12 };
const KEYFRAMES = [
  { center: [5.597, 43.163] as [number, number], zoom: 15 },
  { center: [5.588, 43.17] as [number, number], zoom: 16 },
  { center: [5.588, 43.17] as [number, number], zoom: 18 },
  { center: [5.6075, 43.1745] as [number, number], zoom: 17 },
  { center: [5.605, 43.18] as [number, number], zoom: 12 },
];
const TRANSITION_MS = 3000;
const LAPS = 2;

export interface CameraBenchResult {
  frames: number; durationMs: number; fps: number; p50: number; p95: number; p99: number; late: number;
}

export async function runCameraBench(map: MlMap): Promise<CameraBenchResult> {
  map.jumpTo(START);
  await new Promise<void>((r) => map.once('idle', () => r()));

  const stamps: number[] = [];
  const onRender = () => stamps.push(performance.now());
  map.on('render', onRender);
  const t0 = performance.now();
  for (let lap = 0; lap < LAPS; lap++) {
    for (const k of KEYFRAMES) {
      map.easeTo({ ...k, duration: TRANSITION_MS });
      await new Promise<void>((r) => map.once('moveend', () => r()));
    }
  }
  const durationMs = performance.now() - t0;
  map.off('render', onRender);

  const gaps = stamps.slice(1).map((t, i) => t - stamps[i]).sort((a, b) => a - b);
  const pct = (p: number) => (gaps.length ? +gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))].toFixed(1) : 0);
  const res: CameraBenchResult = {
    frames: stamps.length,
    durationMs: Math.round(durationMs),
    fps: +((stamps.length * 1000) / durationMs).toFixed(1),
    p50: pct(0.5), p95: pct(0.95), p99: pct(0.99),
    late: gaps.filter((g) => g > 33.3).length,
  };
  bench('camera', { ...res });
  return res;
}
