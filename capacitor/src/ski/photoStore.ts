// Photos des fiches skitour gardées pour le hors ligne (IndexedDB), en taille réduite (1024 px, JPEG).
// L'appli web ne peut pas lire les octets d'une photo de skitour.fr (CORS) : elle passe par le relais (/skitour-photo).
import { relay } from '../travel/travel';

const DB = 'skitour-photos', STORE = 'p', MAX_PX = 1024;

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then((d) => new Promise<T>((res, rej) => {
    const r = f(d.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}

/** Adresse locale (blob:) d'une photo gardée, ou null. */
export async function storedPhoto(url: string): Promise<string | null> {
  try { const b = await tx<Blob | undefined>('readonly', (s) => s.get(url)); return b ? URL.createObjectURL(b) : null; } catch { return null; }
}

async function shrink(b: Blob): Promise<Blob> {
  const img = await createImageBitmap(b);
  const k = Math.min(1, MAX_PX / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((x) => res(x ?? b), 'image/jpeg', 0.75));
}

/** Garde les photos d'une fiche (celles déjà gardées sont sautées). Les erreurs sont ignorées : c'est un bonus hors ligne. */
export async function keepPhotos(urls: string[], password: string): Promise<void> {
  const p = password.split('\n').filter(Boolean)[0] ?? '';
  for (const url of urls) {
    try {
      if (await tx<number>('readonly', (s) => s.count(url))) continue;
      const res = await fetch(relay('skitour-photo'), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Mot-De-Passe': p }, body: JSON.stringify({ url }) });
      if (!res.ok) continue;
      const small = await shrink(await res.blob());
      await tx('readwrite', (s) => s.put(small, url));
    } catch { /* pas de réseau, stockage plein… */ }
  }
}

/** Retire les photos des fiches qui ne sont plus gardées. */
export async function prunePhotos(keep: Set<string>): Promise<void> {
  try {
    const keys = await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
    for (const k of keys) if (!keep.has(String(k))) await tx('readwrite', (s) => s.delete(k));
  } catch { /* ignoré */ }
}
