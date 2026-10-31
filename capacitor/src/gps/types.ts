export interface GpsFix {
  lat: number;
  lon: number;
  alt: number | null;
  /** Précision horizontale en mètres. */
  accuracy: number;
  /** Vitesse en m/s, si le capteur la donne. */
  speed: number | null;
  /** Horodatage en ms (epoch). */
  time: number;
}

export type Priority = 'high' | 'balanced' | 'low';

/** Réglages envoyés au plugin natif (équivalent direct de LocationRequest côté Android). */
export interface GpsSettings {
  priority: Priority;
  intervalMs: number;
  minIntervalMs: number;
  minDistanceM: number;
  /** Regroupement des positions : le GPS les garde en mémoire et réveille l'appli moins souvent. */
  maxDelayMs: number;
}

export type GpsMode = 'rando' | 'velo' | 'eco';

/** Mêmes valeurs que dans le scénario commun avec le prototype Kotlin. */
export const MODES: Record<GpsMode, GpsSettings> = {
  rando: { priority: 'high', intervalMs: 5000, minIntervalMs: 2000, minDistanceM: 10, maxDelayMs: 0 },
  velo: { priority: 'high', intervalMs: 2000, minIntervalMs: 1000, minDistanceM: 20, maxDelayMs: 0 },
  eco: { priority: 'balanced', intervalMs: 30000, minIntervalMs: 15000, minDistanceM: 50, maxDelayMs: 0 },
};
