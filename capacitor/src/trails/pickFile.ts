// 📥 Ouvrir un fichier de trace. Sur Android, un petit module natif ouvre le sélecteur dans le dernier
// dossier utilisé, ou dans Téléchargements la première fois (TraceFilePlugin.java). Ailleurs (iPhone,
// navigateur), le sélecteur du système, qui se souvient lui-même du dernier endroit.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { TRACE_FILE_ACCEPT } from './traceFile';

import type { PluginListenerHandle } from '@capacitor/core';

type Opened = { name?: string; text?: string; error?: string };
const TraceFile = registerPlugin<{
  pick(): Promise<{ cancelled?: boolean; name?: string; text?: string }>;
  addListener(e: 'opened', cb: (r: Opened) => void): Promise<PluginListenerHandle>;
}>('TraceFile');

/** Fichier de trace ouvert depuis une autre appli (« Ouvrir avec » ou « Partager » depuis Gmail, Fichiers…). */
export function onTraceFileOpened(cb: (r: Opened) => void): () => void {
  if (Capacitor.getPlatform() !== 'android') return () => {};
  const h = TraceFile.addListener('opened', cb);
  return () => { void h.then((x) => x.remove()); };
}

export async function pickTraceFile(): Promise<{ name: string; text: string } | null> {
  const platform = Capacitor.getPlatform();
  if (platform === 'android') {
    const r = await TraceFile.pick();
    return r.cancelled || r.text == null ? null : { name: r.name ?? '', text: r.text };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    // iPhone : un .gpx n'a pas de type connu et serait grisé ; on accepte tout, la lecture trie.
    if (platform !== 'ios') input.accept = TRACE_FILE_ACCEPT;
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, text: await f.text() } : null);
    };
    input.click();
  });
}
