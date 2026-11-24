/**
 * Fichiers joints aux messages (spec/buddies.md §7.13, étape 3, comme AppBase) : photo, vidéo, document.
 * Gardés sur le téléphone (IndexedDB) et envoyés au retour du réseau (PUT /buddies/fichiers/<id>), comme l'album.
 * Une photo est réduite avant l'envoi (1600 px). Limites d'AppBase : 25 Mo par fichier ou photo, 100 Mo par vidéo.
 */
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { apiFichier } from '../compte/auth';
import { reduire } from './album';
import type { FichierMessage } from './store';

export const MAX_FICHIER = 25 * 1024 * 1024, MAX_VIDEO = 100 * 1024 * 1024;
const DB = 'buddies-fichiers', STORE = 'f';

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
const garder = (id: string, b: Blob) => tx('readwrite', (s) => s.put(b, id));
const lireLocal = async (id: string) => { try { return await tx<Blob | undefined>('readonly', (s) => s.get(id)); } catch { return undefined; } };
export async function oublier(id: string) { try { await tx('readwrite', (s) => s.delete(id)); } catch { /* ignoré */ } }

export const taille = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`);
export const estImage = (f: { mime: string }) => f.mime.startsWith('image/');
export const estVideo = (f: { mime: string }) => f.mime.startsWith('video/');

/** Prépare un fichier choisi : photo réduite, limites vérifiées. Rend de quoi l'annoncer, déjà gardé sur le téléphone. */
export async function preparer(f: File): Promise<FichierMessage> {
  let b: Blob = f, nom = f.name || 'fichier', mime = f.type || 'application/octet-stream';
  if (mime.startsWith('image/') && mime !== 'image/gif') {
    try { b = await reduire(await createImageBitmap(f), 1600, 0.82); mime = 'image/jpeg'; nom = nom.replace(/\.\w+$/, '') + '.jpg'; } catch { /* gardée telle quelle */ }
  }
  if (b.size > (mime.startsWith('video/') ? MAX_VIDEO : MAX_FICHIER)) {
    throw new Error(`« ${f.name} » est trop gros : ${mime.startsWith('video/') ? '100' : '25'} Mo au maximum.`);
  }
  const id = crypto.randomUUID();
  await garder(id, b);
  return { id, nom: nom.slice(0, 200), mime, taille: b.size, envoye: false };
}

/** Envoie le fichier gardé (après que la synchro l'a annoncé). Vrai s'il est parti ou perdu. */
export async function envoyer(id: string): Promise<boolean> {
  const b = await lireLocal(id);
  if (!b) return true;
  await apiFichier('PUT', `/buddies/fichiers/${id}`, b);
  return true;
}

const urls = new Map<string, string>();
/** Adresse (blob:) à afficher ; lue sur le serveur la première fois (gardée si ce n'est pas une vidéo). null sans réseau. */
export async function adresse(f: FichierMessage): Promise<string | null> {
  if (urls.has(f.id)) return urls.get(f.id)!;
  let b = await lireLocal(f.id);
  if (!b && f.envoye) {
    try { b = await apiFichier('GET', `/buddies/fichiers/${f.id}`); if (!estVideo(f)) await garder(f.id, b).catch(() => undefined); } catch { return null; }
  }
  if (!b) return null;
  const u = URL.createObjectURL(b.type ? b : new Blob([b], { type: f.mime }));
  urls.set(f.id, u);
  return u;
}

/** Ouvre un document avec l'appli du téléphone (PDF, tableur…) ; dans un navigateur, le télécharge. */
export async function ouvrir(f: FichierMessage): Promise<void> {
  const u = await adresse(f);
  if (!u) throw new Error('Pas encore arrivé, ou pas de réseau');
  if (!Capacitor.isNativePlatform()) {
    const a = document.createElement('a'); a.href = u; a.download = f.nom; a.click();
    return;
  }
  const b = await (await fetch(u)).blob();
  const data = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.readAsDataURL(b); });
  const chemin = `fichiers/${f.nom.replace(/[\\/:*?"<>|]/g, '_')}`;
  await Filesystem.writeFile({ path: chemin, data, directory: Directory.Cache, recursive: true });
  const { Natif } = await import('./Buddies'); // pas au chargement : Buddies charge le store, qui charge ce fichier
  await Natif.ouvrirFichier({ chemin, mime: f.mime });
}
