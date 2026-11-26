// Place prise sur le téléphone, en trois parts : cartes, photos et vidéos, données (Seb, 26/11).
// Réutilise la mesure de 📊 (plugin StorageUsage) ; les photos et vidéos sont dans IndexedDB, qu'on additionne ici.
import { Capacitor } from '@capacitor/core';
import { StorageUsage } from '../Usage';

export interface PhoneSpace { cartes: number; photos: number; donnees: number; total: number; libre: number | null }

/** Bases IndexedDB qui gardent des photos ou des vidéos : album et fichiers des Buddies, photos skitour, films du survol. */
const MEDIA_DBS = ['buddies-photos', 'buddies-fichiers', 'skitour-photos', 'survol-films'];

const blobBytes = (v: unknown): number => {
  if (v instanceof Blob) return v.size;
  if (v && typeof v === 'object') return Object.values(v).reduce<number>((n, x) => n + (x instanceof Blob ? x.size : 0), 0);
  return 0;
};

/** Octets de toutes les images et vidéos d'une base ; 0 si elle n'existe pas (on ne la crée surtout pas). */
function dbBytes(name: string): Promise<number> {
  return new Promise((resolve) => {
    const r = indexedDB.open(name);
    r.onupgradeneeded = () => r.transaction?.abort();
    r.onerror = () => resolve(0);
    r.onsuccess = () => {
      const d = r.result;
      const stores = [...d.objectStoreNames];
      if (!stores.length) { d.close(); resolve(0); return; }
      let n = 0;
      const t = d.transaction(stores, 'readonly');
      for (const st of stores) {
        const c = t.objectStore(st).openCursor();
        c.onsuccess = () => { const cur = c.result; if (cur) { n += blobBytes(cur.value); cur.continue(); } };
      }
      t.oncomplete = () => { d.close(); resolve(n); };
      t.onerror = t.onabort = () => { d.close(); resolve(n); };
    };
  });
}

export const mediaBytes = () => Promise.all(MEDIA_DBS.map(dbBytes)).then((a) => a.reduce((x, y) => x + y, 0));

/** cartes : octets des tuiles gardées (SCAN 25, Plan IGN, relief), déjà comptés par l'onglet Hors ligne. */
export async function measurePhoneSpace(cartes: number): Promise<PhoneSpace> {
  const photos = await mediaBytes().catch(() => 0);
  let total = 0, libre: number | null = null;
  if (Capacitor.isNativePlatform()) {
    const m = await StorageUsage.measure();
    total = m.donnees;
    libre = typeof m.libre === 'number' ? m.libre : null;
  } else if (navigator.storage?.estimate) {
    total = (await navigator.storage.estimate()).usage ?? 0;
  }
  return splitSpace(total, cartes, photos, libre);
}

/** Données = tout le reste ; jamais négatif si les mesures ne tombent pas pile. */
export function splitSpace(total: number, cartes: number, photos: number, libre: number | null): PhoneSpace {
  const sum = Math.max(total, cartes + photos);
  return { cartes, photos, donnees: sum - cartes - photos, total: sum, libre };
}
