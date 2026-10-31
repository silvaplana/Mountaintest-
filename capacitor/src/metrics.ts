import { Capacitor, registerPlugin } from '@capacitor/core';

// Compteurs affichés dans le panneau « Mesures » et écrits dans logcat sous le tag ASSO_BENCH,
// au même format JSON que le prototype Kotlin.

export const metrics = {
  appStart: performance.now(),
  firstMapRenderMs: 0,
  tilesFromDisk: 0,
  tilesFromNetwork: 0,
  tileErrors: 0,
  tileLoadTotalMs: 0,
  gpsFixes: 0,
  gpsBatches: 0,
  gpsRejected: 0,
};

export type Metrics = typeof metrics;

const BenchLog = registerPlugin<{ log(o: { message: string }): Promise<void> }>('BenchLog');

export function bench(kind: string, data: Record<string, unknown> = {}) {
  const message = JSON.stringify({ bench: kind, ...data });
  if (Capacitor.isNativePlatform()) void BenchLog.log({ message }).catch(() => console.info(`ASSO_BENCH ${message}`));
  else console.info(`ASSO_BENCH ${message}`);
}

