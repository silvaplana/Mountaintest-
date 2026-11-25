/**
 * Album d'un Buddy Time (spec/buddies.md §5.8) : les fichiers des photos.
 *
 * - Déposer : la photo est réduite sur le téléphone (petite 400 px pour la grille, grande 1600 px pour la voir),
 *   gardée ici (IndexedDB) et envoyée au retour du réseau (PUT /buddies/photos/<id>/<taille>).
 * - Voir : petite et grande sont lues une fois sur le serveur puis gardées : l'album s'ouvre sans réseau.
 * - L'heure et le lieu de prise de vue sont lus dans la photo (EXIF) quand le téléphone les y a laissés.
 * Même fonctionnement côté Kotlin (Album.kt).
 */
import { apiFichier } from '../compte/auth';

export type Taille = 'petite' | 'grande' | 'video';
export const PX: Record<'petite' | 'grande', number> = { petite: 400, grande: 1600 };
/** Fichiers d'une photo ; « video » seulement pour un film de survol 3D (petite et grande = sa couverture). */
const TAILLES: Taille[] = ['petite', 'grande', 'video'];
const DB = 'buddies-photos', STORE = 'p';

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
export async function garder(id: string, taille: Taille, b: Blob) { await tx('readwrite', (s) => s.put(b, `${id}-${taille}`)); }
export async function fichier(id: string, taille: Taille): Promise<Blob | undefined> {
  try { return await tx<Blob | undefined>('readonly', (s) => s.get(`${id}-${taille}`)); } catch { return undefined; }
}
export async function oublier(id: string) {
  try { for (const t of TAILLES) await tx('readwrite', (s) => s.delete(`${id}-${t}`)); } catch { /* ignoré */ }
}

const urls = new Map<string, string>();
/** Adresse (blob:) à afficher : gardée sur le téléphone, sinon lue sur le serveur puis gardée ; null sans réseau. */
export async function adresse(id: string, taille: Taille, envoyee: boolean): Promise<string | null> {
  const k = `${id}-${taille}`;
  if (urls.has(k)) return urls.get(k)!;
  let b = await fichier(id, taille);
  if (!b && envoyee) {
    try { b = await apiFichier('GET', `/buddies/photos/${id}/${taille}`); await garder(id, taille, b).catch(() => undefined); } catch { return null; }
  }
  if (!b) return null;
  const u = URL.createObjectURL(b);
  urls.set(k, u);
  return u;
}

/** Envoie le fichier d'une photo (petite, grande, puis le film s'il y en a un). Vrai si tout est parti. */
export async function envoyer(id: string): Promise<boolean> {
  for (const t of TAILLES) {
    const b = await fichier(id, t);
    if (!b) return true; // fichier perdu (stockage vidé), ou pas de film : rien de plus à envoyer
    await apiFichier('PUT', `/buddies/photos/${id}/${t}`, b);
  }
  return true;
}

// ------------------------------------------------------------------ préparer une photo choisie

export async function reduire(img: ImageBitmap, px: number, q: number): Promise<Blob> {
  const k = Math.min(1, px / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((x) => (x ? res(x) : rej(new Error('Photo illisible'))), 'image/jpeg', q));
}

/** Heure locale AAAA-MM-JJTHH:MM:SS (heure du téléphone). */
export function heureLocale(d = new Date()) {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}

export type Preparee = { prise_le: string; lon: number | null; lat: number | null; petite: Blob; grande: Blob };
/** Lit l'heure et le lieu de la photo, puis la réduit (l'orientation est appliquée par le navigateur). */
export async function preparer(f: File): Promise<Preparee> {
  const x = exif(await f.slice(0, 256 * 1024).arrayBuffer());
  const img = await createImageBitmap(f, { imageOrientation: 'from-image' });
  const [petite, grande] = [await reduire(img, PX.petite, 0.7), await reduire(img, PX.grande, 0.8)];
  img.close();
  return { prise_le: x.prise_le ?? heureLocale(f.lastModified ? new Date(f.lastModified) : new Date()), lon: x.lon, lat: x.lat, petite, grande };
}

/**
 * EXIF minimal : DateTimeOriginal (0x9003) et position GPS. Rien de plus : pas de bibliothèque à embarquer.
 * Rend des champs vides si la photo n'en a pas (captures d'écran, photos dont le téléphone a retiré le lieu).
 */
export function exif(buf: ArrayBuffer): { prise_le: string | null; lon: number | null; lat: number | null } {
  const vide = { prise_le: null, lon: null, lat: null };
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return vide;
  let o = 2;
  while (o + 4 <= v.byteLength) {
    const m = v.getUint16(o), n = v.getUint16(o + 2);
    if (m === 0xffe1 && v.getUint32(o + 4) === 0x45786966) return tiff(v, o + 10) ?? vide; // « Exif »
    if ((m & 0xff00) !== 0xff00 || m === 0xffda) break;
    o += 2 + n;
  }
  return vide;
}
function tiff(v: DataView, t: number) {
  if (t + 8 > v.byteLength) return null;
  const le = v.getUint16(t) === 0x4949;
  const u16 = (o: number) => v.getUint16(t + o, le), u32 = (o: number) => v.getUint32(t + o, le);
  const entrees = (ifd: number) => {
    const out = new Map<number, { type: number; n: number; val: number }>();
    if (t + ifd + 2 > v.byteLength) return out;
    for (let i = 0, c = u16(ifd); i < c; i++) {
      const e = ifd + 2 + i * 12;
      if (t + e + 12 > v.byteLength) break;
      out.set(u16(e), { type: u16(e + 2), n: u32(e + 4), val: e + 8 });
    }
    return out;
  };
  const off = (x: { n: number; val: number; type: number }, taille: number) => (x.n * taille > 4 ? u32(x.val) : x.val);
  const ascii = (x?: { n: number; val: number; type: number }) => {
    if (!x) return null;
    const d = off(x, 1); let s = '';
    for (let i = 0; i < x.n - 1 && t + d + i < v.byteLength; i++) s += String.fromCharCode(v.getUint8(t + d + i));
    return s;
  };
  const rationnels = (x?: { n: number; val: number; type: number }) => {
    if (!x || x.type !== 5) return null;
    const d = u32(x.val), l: number[] = [];
    for (let i = 0; i < x.n; i++) { const b = u32(d + i * 8 + 4); l.push(b ? u32(d + i * 8) / b : 0); }
    return l;
  };
  const ifd0 = entrees(u32(4));
  let prise_le: string | null = null, lon: number | null = null, lat: number | null = null;
  const exifIfd = ifd0.get(0x8769);
  if (exifIfd) {
    const d = ascii(entrees(u32(exifIfd.val)).get(0x9003)) ?? ascii(ifd0.get(0x0132));
    const m = d?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (m) prise_le = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  }
  const gps = ifd0.get(0x8825);
  if (gps) {
    const g = entrees(u32(gps.val));
    const deg = (r: number[] | null) => (r && r.length >= 3 ? r[0] + r[1] / 60 + r[2] / 3600 : null);
    const la = deg(rationnels(g.get(2))), lo = deg(rationnels(g.get(4)));
    if (la != null && lo != null && (la || lo)) {
      lat = ascii(g.get(1)) === 'S' ? -la : la;
      lon = ascii(g.get(3)) === 'W' ? -lo : lo;
    }
  }
  return { prise_le, lon, lat };
}
