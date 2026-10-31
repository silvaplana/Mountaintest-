import { distanceM } from './adaptive';
import type { GpsFix } from './types';

import { MODES, type GpsMode } from './types';

export interface FilterOptions { maxAccuracyM: number; maxSpeedMs: number; minDistanceM: number; minIntervalMs: number }

/** Précision max 30 m : même seuil que le prototype Kotlin. */
export const DEFAULT_FILTER: FilterOptions = { maxAccuracyM: 30, maxSpeedMs: 30, minDistanceM: 10, minIntervalMs: 0 };

/**
 * Le filtre du mode est aussi appliqué en JS : le natif le fait déjà pour le vrai GPS,
 * mais le rejeu GPX et le GPS du navigateur n'ont pas de filtre natif.
 */
export function filterForMode(mode: GpsMode): FilterOptions {
  return { ...DEFAULT_FILTER, minDistanceM: MODES[mode].minDistanceM, minIntervalMs: MODES[mode].minIntervalMs };
}

export type FilterVerdict = 'ok' | 'imprecise' | 'jump' | 'too-close' | 'too-soon';

/** Écarte les positions imprécises, les sauts impossibles et les points trop rapprochés. */
export function judgeFix(fix: GpsFix, last: GpsFix | null, opt: FilterOptions): FilterVerdict {
  if (fix.accuracy > opt.maxAccuracyM) return 'imprecise';
  if (!last) return 'ok';
  const d = distanceM(last, fix);
  const dt = (fix.time - last.time) / 1000;
  if (dt > 0 && d / dt > opt.maxSpeedMs) return 'jump';
  if (d < opt.minDistanceM) return 'too-close';
  if (fix.time - last.time < opt.minIntervalMs) return 'too-soon';
  return 'ok';
}
