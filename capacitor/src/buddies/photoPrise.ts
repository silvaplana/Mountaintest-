// 📷 Photos prises avec l'appareil photo du téléphone, ouvert depuis l'appli (PhotoPlugin.java) : on note le moment
// de l'appui sur 📷 ; au retour dans l'appli, les photos arrivées depuis sont proposées à un album (PhotosRecues.tsx).
import { registerPlugin } from '@capacitor/core';

export const Photo = registerPlugin<{
  open(): Promise<void>;
  recentes(o: { depuis: number }): Promise<{ chemins: string[]; refuse?: boolean }>;
}>('Photo');

let depuis: number | null = null;
/** L'appareil photo vient d'être ouvert. */
export function noterPrise() { depuis = Date.now() - 2000; }
/** Les photos prises depuis l'ouverture de l'appareil photo (une seule fois par ouverture). */
export async function photosPrises(): Promise<string[]> {
  if (depuis == null) return [];
  const t = depuis;
  depuis = null;
  try { return (await Photo.recentes({ depuis: t })).chemins ?? []; } catch { return []; }
}
