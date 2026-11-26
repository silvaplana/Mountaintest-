// Traces dessinées au doigt, enregistrées sur le téléphone (hors ligne, sans compte).
// Même format côté Kotlin (SavedTraces.kt) : une liste JSON dans les préférences.
import { Preferences } from '@capacitor/preferences';
import type { Pin } from './edit';
import type { LonLat } from './osmTrails';
import { lineLengthM } from './route';

export interface SavedTrace {
  /** Horodatage de l'enregistrement, sert d'identifiant. */
  id: number;
  name: string;
  onPaths: boolean;
  /** Coordonnées [lon, lat] arrondies au mètre près. */
  line: [number, number][];
  /** 📍 Points piqués avec leur petit mot. */
  pins?: Pin[];
  /** 👥 Groupe et sortie associés. */
  lien?: { groupe: string; sortie: string | null } | null;
}

const KEY = 'tracesEnregistrees';

export async function listTraces(): Promise<SavedTrace[]> {
  try {
    const v = (await Preferences.get({ key: KEY })).value;
    const arr = v ? JSON.parse(v) : [];
    return Array.isArray(arr) ? arr.filter((t) => Array.isArray(t?.line) && t.line.length >= 2) : [];
  } catch { return []; }
}

/** Prévenu à chaque changement de Mes traces (le calque « Hors ligne » se redessine). */
export const TRACES_CHANGED = 'traces-changed';

async function write(all: SavedTrace[]) {
  await Preferences.set({ key: KEY, value: JSON.stringify(all) });
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(TRACES_CHANGED));
}

const round = (line: LonLat[]) => line.map((p) => [+p.lon.toFixed(5), +p.lat.toFixed(5)] as [number, number]);

export async function saveTrace(name: string, line: LonLat[], onPaths: boolean, pins: Pin[] = [], lien: SavedTrace['lien'] = null): Promise<SavedTrace> {
  const t: SavedTrace = { id: Date.now(), name, onPaths, line: round(line), pins, lien };
  await write([t, ...(await listTraces())]);
  return t;
}

/** ✏ / 📍 Trace enregistrée modifiée : on garde la nouvelle forme et ses points (même identifiant). */
export async function updateTrace(id: number, line: LonLat[], pins: Pin[], lien: SavedTrace['lien'] = null): Promise<SavedTrace | null> {
  const all = await listTraces();
  const t = all.find((x) => x.id === id);
  if (!t) return null;
  t.line = round(line); t.pins = pins; t.lien = lien;
  await write(all);
  return t;
}

/** ✏ Nouveau nom d'une trace enregistrée (Seb, 25/11). */
export async function renameTrace(id: number, name: string): Promise<SavedTrace | null> {
  const all = await listTraces();
  const t = all.find((x) => x.id === id);
  if (!t) return null;
  t.name = name;
  await write(all);
  return t;
}

/** Points lus d'un JSON (préférences) : on ne garde que ceux qui ont une position. */
export function readPins(v: unknown): Pin[] {
  if (!Array.isArray(v)) return [];
  return v.filter((p) => Number.isFinite(p?.lon) && Number.isFinite(p?.lat))
    .map((p) => ({ lon: Number(p.lon), lat: Number(p.lat), txt: String(p.txt ?? ''), vu: p.vu !== false }));
}

/** Lien 👥 lu d'un JSON : un groupe, et peut-être une sortie. */
export function readLien(v: unknown): SavedTrace['lien'] {
  const o = v as { groupe?: unknown; sortie?: unknown } | null;
  return o && typeof o.groupe === 'string' ? { groupe: o.groupe, sortie: typeof o.sortie === 'string' ? o.sortie : null } : null;
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
