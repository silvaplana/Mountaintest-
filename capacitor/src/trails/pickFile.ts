// 📥 Ouvrir un fichier de trace. Sur Android, un petit module natif ouvre le sélecteur dans le dernier
// dossier utilisé, ou dans Téléchargements la première fois (TraceFilePlugin.java). Ailleurs (iPhone,
// navigateur), le sélecteur du système, qui se souvient lui-même du dernier endroit.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { TRACE_FILE_ACCEPT } from './traceFile';

import type { PluginListenerHandle } from '@capacitor/core';

type Opened = { name?: string; text?: string; error?: string };
const TraceFile = registerPlugin<{
  pick(): Promise<{ cancelled?: boolean; files?: Opened[] }>;
  addListener(e: 'opened', cb: (r: Opened) => void): Promise<PluginListenerHandle>;
}>('TraceFile');

/** Fichier de trace ouvert depuis une autre appli (« Ouvrir avec » ou « Partager » depuis Gmail, Fichiers…). */
export function onTraceFileOpened(cb: (r: Opened) => void): () => void {
  if (Capacitor.getPlatform() !== 'android') return () => {};
  const h = TraceFile.addListener('opened', cb);
  return () => { void h.then((x) => x.remove()); };
}

/** 📥 Un ou plusieurs fichiers de trace choisis (vide si annulé). */
export async function pickTraceFiles(): Promise<Opened[]> {
  const platform = Capacitor.getPlatform();
  if (platform === 'android') {
    const r = await TraceFile.pick();
    return r.cancelled ? [] : r.files ?? [];
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    // iPhone : un .gpx n'a pas de type connu et serait grisé ; on accepte tout, la lecture trie.
    if (platform !== 'ios') input.accept = TRACE_FILE_ACCEPT;
    input.onchange = async () => {
      resolve(await Promise.all([...(input.files ?? [])].map(async (f) => ({ name: f.name, text: await f.text() }))));
    };
    input.click();
  });
}
