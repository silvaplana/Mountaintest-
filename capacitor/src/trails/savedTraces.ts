// Traces dessinées au doigt, enregistrées sur le téléphone (hors ligne, sans compte).
// Même format côté Kotlin (SavedTraces.kt) : une liste JSON dans les préférences.
import { Preferences } from '@capacitor/preferences';
import type { LonLat } from './osmTrails';
import { lineLengthM } from './route';

export interface SavedTrace {
  /** Horodatage de l'enregistrement, sert d'identifiant. */
  id: number;
  name: string;
  onPaths: boolean;
  /** Coordonnées [lon, lat] arrondies au mètre près. */
  line: [number, number][];
}

const KEY = 'tracesEnregistrees';

export async function listTraces(): Promise<SavedTrace[]> {
  try {
    const v = (await Preferences.get({ key: KEY })).value;
    const arr = v ? JSON.parse(v) : [];
    return Array.isArray(arr) ? arr.filter((t) => Array.isArray(t?.line) && t.line.length >= 2) : [];
  } catch { return []; }
}

async function write(all: SavedTrace[]) {
  await Preferences.set({ key: KEY, value: JSON.stringify(all) });
}

export async function saveTrace(name: string, line: LonLat[], onPaths: boolean): Promise<SavedTrace> {
  const t: SavedTrace = { id: Date.now(), name, onPaths, line: line.map((p) => [+p.lon.toFixed(5), +p.lat.toFixed(5)]) };
  await write([t, ...(await listTraces())]);
  return t;
}

export async function deleteTrace(id: number) {
  await write((await listTraces()).filter((t) => t.id !== id));
}

export const traceLine = (t: SavedTrace): LonLat[] => t.line.map(([lon, lat]) => ({ lon, lat }));
export const traceLengthM = (t: SavedTrace) => lineLengthM(traceLine(t));

/** Nom proposé : « Tracé du 5/11 à 14h32 ». */
export function defaultTraceName(d = new Date()) {
  return `Tracé du ${d.getDate()}/${d.getMonth() + 1} à ${d.getHours()}h${String(d.getMinutes()).padStart(2, '0')}`;
}
