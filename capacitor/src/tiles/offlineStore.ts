import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { FileTransfer } from '@capacitor/file-transfer';
import type { LayerDef } from '../config';
import type { TileCoord } from './tileMath';

/**
 * Stockage des tuiles hors ligne.
 * - Natif (Android/iOS) : un fichier par tuile dans le dossier privé de l'appli
 *   (tiles/<couche>/<z>/<x>/<y>.<ext>), téléchargé par le code natif et relu par
 *   l'URL locale du WebView, sans passer par du base64. Ce dossier est conservé par
 *   les mises à jour de l'appli (il n'est effacé qu'à la désinstallation).
 * - Navigateur (dev) : Cache Storage.
 */
export interface TileStore {
  has(t: TileCoord): boolean;
  read(t: TileCoord): Promise<ArrayBuffer | null>;
  /** Télécharge et enregistre ; renvoie la taille en octets. */
  download(t: TileCoord, url: string): Promise<number>;
  /** Enregistre une tuile déjà reçue (cache des tuiles vues en ligne). */
  put(t: TileCoord, data: ArrayBuffer): Promise<void>;
  count(): number;
  /** Place occupée sur le téléphone par les tuiles de cette couche, en octets. */
  bytes(): number;
  clear(): Promise<void>;
  flushIndex(): Promise<void>;
}

const key = (t: TileCoord) => `${t.z}/${t.x}/${t.y}`;

class NativeTileStore implements TileStore {
  /** tuile -> taille en octets (0 si inconnue). */
  private index = new Map<string, number>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private madeDirs = new Set<string>();
  private dirty = false;
  private baseUri = '';

  constructor(private layer: LayerDef) {}

  private root() { return `tiles/${this.layer.id}`; }
  private path(t: TileCoord) { return `${this.root()}/${key(t)}.${this.layer.ext}`; }

  async init() {
    this.baseUri = (await Filesystem.getUri({ directory: Directory.Data, path: this.root() })).uri;
    try {
      const r = await Filesystem.readFile({ directory: Directory.Data, path: `${this.root()}/index.json`, encoding: Encoding.UTF8 });
      // Ancien format : liste de clés ; nouveau : liste de [clé, octets].
      for (const e of JSON.parse(r.data as string) as (string | [string, number])[]) {
        if (typeof e === 'string') this.index.set(e, 0); else this.index.set(e[0], e[1]);
      }
      if ([...this.index.values()].some((b) => b === 0)) await this.measureUnknown();
    } catch {
      // Pas encore d'index : première utilisation.
    }
    return this;
  }

  /** Tailles absentes de l'index (ancien format) : relues une fois sur le disque. */
  private async measureUnknown() {
    for (const [k, b] of this.index) {
      if (b) continue;
      const st = await Filesystem.stat({ directory: Directory.Data, path: `${this.root()}/${k}.${this.layer.ext}` }).catch(() => null);
      if (st) this.index.set(k, st.size); else this.index.delete(k);
    }
    this.dirty = true;
    await this.flushIndex();
  }

  has(t: TileCoord) { return this.index.has(key(t)); }
  count() { return this.index.size; }
  bytes() { let n = 0; for (const b of this.index.values()) n += b; return n; }

  async read(t: TileCoord) {
    if (!this.has(t)) return null;
    const src = Capacitor.convertFileSrc(`${this.baseUri}/${key(t)}.${this.layer.ext}`);
    const res = await fetch(src);
    return res.ok ? res.arrayBuffer() : null;
  }

  private async ensureDir(t: TileCoord) {
    const dir = `${this.root()}/${t.z}/${t.x}`;
    if (this.madeDirs.has(dir)) return;
    await Filesystem.mkdir({ directory: Directory.Data, path: dir, recursive: true }).catch(() => {});
    this.madeDirs.add(dir);
  }

  async download(t: TileCoord, url: string) {
    await this.ensureDir(t);
    const { uri } = await Filesystem.getUri({ directory: Directory.Data, path: this.path(t) });
    await FileTransfer.downloadFile({ url, path: uri });
    const st = await Filesystem.stat({ directory: Directory.Data, path: this.path(t) });
    // Le flux WMTS renvoie parfois une petite image ou un XML d'erreur avec un code 200.
    if (st.size < 200) throw new Error(`tuile suspecte (${st.size} o) ${key(t)}`);
    this.index.set(key(t), st.size);
    this.dirty = true;
    return st.size;
  }

  async put(t: TileCoord, data: ArrayBuffer) {
    await this.ensureDir(t);
    await Filesystem.writeFile({ directory: Directory.Data, path: this.path(t), data: toBase64(data) });
    this.index.set(key(t), data.byteLength);
    this.dirty = true;
    // Tuiles vues en ligne : index enregistré 5 s après la dernière, pour les retrouver au prochain lancement.
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flushIndex(), 5000);
  }

  async flushIndex() {
    if (!this.dirty) return;
    this.dirty = false;
    await Filesystem.writeFile({
      directory: Directory.Data,
      path: `${this.root()}/index.json`,
      data: JSON.stringify([...this.index.entries()]),
      encoding: Encoding.UTF8,
      recursive: true,
    });
  }

  async clear() {
    await Filesystem.rmdir({ directory: Directory.Data, path: this.root(), recursive: true }).catch(() => {});
    this.index.clear();
    this.madeDirs.clear();
  }
}

class WebTileStore implements TileStore {
  private index = new Map<string, number>();
  constructor(private layer: LayerDef) {}

  private cacheName() { return `tiles-${this.layer.id}`; }
  private req(t: TileCoord) { return new Request(`/__tiles/${this.layer.id}/${key(t)}`); }

  async init() {
    const cache = await caches.open(this.cacheName());
    for (const r of await cache.keys()) {
      const res = await cache.match(r);
      this.index.set(new URL(r.url).pathname.split('/').slice(3).join('/'), res ? (await res.blob()).size : 0);
    }
    return this;
  }

  has(t: TileCoord) { return this.index.has(key(t)); }
  count() { return this.index.size; }
  bytes() { let n = 0; for (const b of this.index.values()) n += b; return n; }

  async read(t: TileCoord) {
    const res = await (await caches.open(this.cacheName())).match(this.req(t));
    return res ? res.arrayBuffer() : null;
  }

  async download(t: TileCoord, url: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${key(t)}`);
    const buf = await res.arrayBuffer();
    await this.put(t, buf);
    return buf.byteLength;
  }

  async put(t: TileCoord, data: ArrayBuffer) {
    await (await caches.open(this.cacheName())).put(this.req(t), new Response(data));
    this.index.set(key(t), data.byteLength);
  }

  async flushIndex() {}

  async clear() {
    await caches.delete(this.cacheName());
    this.index.clear();
  }
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const stores = new Map<string, Promise<TileStore>>();

export function getTileStore(layer: LayerDef): Promise<TileStore> {
  let s = stores.get(layer.id);
  if (!s) {
    s = Capacitor.isNativePlatform() ? new NativeTileStore(layer).init() : new WebTileStore(layer).init();
    stores.set(layer.id, s);
  }
  return s;
}

export interface DownloadProgress { done: number; failed: number; total: number; bytes: number; elapsedMs: number }

/** Télécharge une liste de tuiles avec quelques requêtes en parallèle (le flux IGN n'aime pas les rafales). */
export async function downloadTiles(
  store: TileStore,
  tiles: TileCoord[],
  urlFor: (t: TileCoord) => string,
  onProgress: (p: DownloadProgress) => void,
  signal?: AbortSignal,
  concurrency = 4,
): Promise<DownloadProgress> {
  const start = performance.now();
  const todo = tiles.filter((t) => !store.has(t));
  const p: DownloadProgress = { done: tiles.length - todo.length, failed: 0, total: tiles.length, bytes: 0, elapsedMs: 0 };
  let next = 0;
  const worker = async () => {
    while (next < todo.length && !signal?.aborted) {
      const t = todo[next++];
      try {
        p.bytes += await store.download(t, urlFor(t));
        p.done++;
      } catch (e) {
        p.failed++;
        console.warn('[tiles]', e);
      }
      p.elapsedMs = performance.now() - start;
      onProgress({ ...p });
      if ((p.done + p.failed) % 50 === 0) await store.flushIndex();
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  await store.flushIndex();
  p.elapsedMs = performance.now() - start;
  return p;
}
