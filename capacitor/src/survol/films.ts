// 📁 Derniers films de survol, gardés sur le téléphone pour les revoir (Seb, 25/11). Les 10 plus récents :
// au-delà, le plus ancien part. « Jeter » sur un film le retire aussi d'ici.

export interface FilmGarde { id: string; nom: string; le: number; secondes: number; vertical: boolean; couverture: Blob | null }

export const MAX_FILMS = 10;
const DB = 'survol-films';

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('fiche', { keyPath: 'id' }); r.result.createObjectStore('video'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

/** Les films gardés, du plus récent au plus ancien. */
export async function films(): Promise<FilmGarde[]> {
  try {
    const d = await db();
    const tout = await req(d.transaction('fiche').objectStore('fiche').getAll() as IDBRequest<FilmGarde[]>);
    return tout.sort((a, b) => b.le - a.le);
  } catch { return []; }
}

export async function videoDe(id: string): Promise<Blob | undefined> {
  try { return await req((await db()).transaction('video').objectStore('video').get(id) as IDBRequest<Blob | undefined>); } catch { return undefined; }
}

export async function oublierFilm(id: string) {
  try {
    const t = (await db()).transaction(['fiche', 'video'], 'readwrite');
    t.objectStore('fiche').delete(id); t.objectStore('video').delete(id);
    await new Promise((res) => { t.oncomplete = res; t.onerror = res; });
  } catch { /* ignoré */ }
}

/** Garde un nouveau film et retire les plus anciens au-delà de MAX_FILMS. Rend son identifiant. */
export async function garderFilm(video: Blob, fiche: Omit<FilmGarde, 'id' | 'le'>): Promise<string | null> {
  try {
    const id = `${Date.now()}`, t = (await db()).transaction(['fiche', 'video'], 'readwrite');
    t.objectStore('fiche').put({ ...fiche, id, le: Date.now() });
    t.objectStore('video').put(video, id);
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
    for (const f of (await films()).slice(MAX_FILMS)) await oublierFilm(f.id);
    return id;
  } catch { return null; }
}
