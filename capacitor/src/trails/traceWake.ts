import { Capacitor, registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import type { LonLat } from './osmTrails';

/**
 * ⑂ Écran rallumé avant les carrefours (plugin natif TraceWakePlugin.java, service TraceWake.java partagé
 * avec l'appli Kotlin) : pendant le suivi, GPS actif écran éteint, écran rallumé ~20 s avant chaque carrefour
 * et quand on quitte la trace (bouton ⑂ ; sinon GPS écran éteint et vibration hors trace seulement).
 * GPS toutes les 2 s, 5 s écran éteint loin des carrefours. Android seulement : un iPhone ne laisse pas une appli rallumer l'écran.
 */
interface TraceWakePlugin {
  start(o: { line: number[]; junctions: number[]; wake: boolean; vibrate: boolean }): Promise<void>;
  stop(): Promise<void>;
}
const Native = registerPlugin<TraceWakePlugin>('TraceWake');

export const traceWakeAvailable = () => Capacitor.getPlatform() === 'android';
const flat = (pts: LonLat[]) => pts.flatMap((p) => [p.lon, p.lat]);

/** wake : bouton ⑂ activé (sinon : GPS écran éteint et vibration hors trace seulement). */
export async function startTraceWake(line: LonLat[], junctions: LonLat[], wake: boolean, vibrate: boolean) {
  if (traceWakeAvailable()) await Native.start({ line: flat(line), junctions: flat(junctions), wake, vibrate });
}
export async function stopTraceWake() {
  if (traceWakeAvailable()) await Native.stop();
}

const KEY = 'ecranCarrefours';
/** Réglage du bouton ⑂ (activé par défaut). */
export async function traceWakeEnabled() {
  try { return (await Preferences.get({ key: KEY })).value !== 'non'; } catch { return true; }
}
export async function setTraceWakeEnabled(on: boolean) {
  await Preferences.set({ key: KEY, value: on ? 'oui' : 'non' });
}

const VIB_KEY = 'vibreHorsTrace';
/** Réglage du bouton vibration hors trace (activé par défaut). */
export async function offTrackVibrateEnabled() {
  try { return (await Preferences.get({ key: VIB_KEY })).value !== 'non'; } catch { return true; }
}
export async function setOffTrackVibrateEnabled(on: boolean) {
  await Preferences.set({ key: VIB_KEY, value: on ? 'oui' : 'non' });
}
