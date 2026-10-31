import { MODES, type GpsFix, type GpsMode, type GpsSettings } from './types';

export interface AdaptiveInput {
  mode: GpsMode;
  /** Dernière position retenue par le filtre. */
  lastKept: GpsFix | null;
  /** Dernière position reçue, même rejetée. */
  latest: GpsFix | null;
  appVisible: boolean;
  /** Niveau de batterie 0..1, ou null si inconnu. */
  battery: number | null;
  now: number;
  /** Point où l'on s'est arrêté, renvoyé par la décision précédente (null si en mouvement). */
  stopPoint: GpsFix | null;
}

export interface AdaptiveDecision { settings: GpsSettings; reasons: string[]; stopPoint: GpsFix | null }

const STATIONARY_AFTER_MS = 2 * 60_000;
const LOW_BATTERY = 0.2;

/**
 * Règles d'économie d'énergie, appliquées par-dessus le mode choisi :
 * 1. batterie faible -> mode éco ;
 * 2. aucune position retenue depuis 2 min (le filtre de distance ne laisse rien passer : pause,
 *    pique-nique) -> GPS en précision équilibrée, toutes les minutes, jusqu'à ce qu'on
 *    s'éloigne de plus de max(50 m, précision annoncée) du point d'arrêt ;
 * 3. appli en arrière-plan ou écran éteint -> positions regroupées (moins de réveils du processeur) :
 *    max(60 s, 4 × intervalle du mode), ou 120 s à l'arrêt.
 * Mêmes règles que le prototype Kotlin (section « Règles GPS communes » du scénario).
 */
export function decideSettings(input: AdaptiveInput): AdaptiveDecision {
  const reasons: string[] = [];
  let mode = input.mode;
  if (input.battery !== null && input.battery < LOW_BATTERY && mode !== 'eco') {
    mode = 'eco';
    reasons.push('batterie faible');
  }
  const s: GpsSettings = { ...MODES[mode] };

  let stopPoint = input.stopPoint;
  const latest = input.latest;
  if (stopPoint && latest && distanceM(stopPoint, latest) > Math.max(50, latest.accuracy)) stopPoint = null;
  else if (!stopPoint && isStationary(input.lastKept, input.now)) stopPoint = input.lastKept;

  if (stopPoint) {
    s.priority = 'balanced';
    s.intervalMs = Math.max(s.intervalMs, 60_000);
    s.minIntervalMs = Math.max(s.minIntervalMs, 30_000);
    reasons.push('immobile');
  }

  if (!input.appVisible) {
    s.maxDelayMs = stopPoint ? 120_000 : Math.max(60_000, MODES[mode].intervalMs * 4);
    reasons.push('arrière-plan : positions regroupées');
  }
  return { settings: s, reasons, stopPoint };
}

export function isStationary(lastKept: GpsFix | null, now: number): boolean {
  return !!lastKept && now - lastKept.time >= STATIONARY_AFTER_MS;
}

export function sameSettings(a: GpsSettings | null, b: GpsSettings): boolean {
  return !!a && (Object.keys(b) as (keyof GpsSettings)[]).every((k) => a[k] === b[k]);
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
