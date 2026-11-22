// Mes traces en fichiers GPX visibles dans le téléphone (Téléchargements/Mountain Buddies) et 📤 Partager.
// Plugin natif android/.../TraceSharePlugin.java (même code que le Kotlin : shared/TraceShare.java).
import { Capacitor, registerPlugin } from '@capacitor/core';
import { traceLine, type SavedTrace } from './savedTraces';

const TraceShare = registerPlugin<{
  save(o: { name: string; line: number[]; replace: boolean }): Promise<{ path: string }>;
  remove(o: { name: string }): Promise<void>;
  share(o: { name: string; line: number[] }): Promise<void>;
}>('TraceShare');

/** Dossier tel qu'on le voit dans l'appli Fichiers. */
export const TRACE_FOLDER = 'Téléchargements/Mountain Buddies';

const available = () => Capacitor.getPlatform() === 'android';
const flat = (st: SavedTrace) => traceLine(st).flatMap((p) => [p.lon, p.lat]);

/** Écrit le fichier GPX de la trace (replace = false : seulement s'il n'existe pas encore). */
export async function writeTraceFile(st: SavedTrace, replace = true): Promise<string | null> {
  if (!available()) return null;
  try { return (await TraceShare.save({ name: st.name, line: flat(st), replace })).path; } catch { return null; }
}

export async function removeTraceFile(st: SavedTrace): Promise<void> {
  if (available()) await TraceShare.remove({ name: st.name }).catch(() => {});
}

/** 📤 Feuille de partage du téléphone (mail, WhatsApp…) avec le fichier GPX. */
export async function shareTrace(st: SavedTrace): Promise<void> {
  if (!available()) throw new Error('partage : seulement dans l’appli Android');
  await TraceShare.share({ name: st.name, line: flat(st) });
}
