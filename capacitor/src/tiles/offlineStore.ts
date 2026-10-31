import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { FileTransfer } from '@capacitor/file-transfer';
import type { LayerDef } from '../config';
import type { TileCoord } from './tileMath';

/**
 * Stockage des tuiles hors ligne.
 * - Natif (Android/iOS) : un fichier par tuile dans le dossier privé de l'appli
 *   (tiles/<couche>/<z>/<x>/<y>.<ext>), téléchargé par le code natif et relu par
 *   l'URL locale du WebView, sans passer par du base64.
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
  clear(): Promise<void>;
  flushIndex(): Promise<void>;
}

const key = (t: TileCoord) => `${t.z}/${t.x}/${t.y}`;

class NativeTileStore implements TileStore {
  private index = new Set<string>();
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
      for (const k of JSON.parse(r.data as string) as string[]) this.index.add(k);
    } catch {
      // Pas encore d'index : première utilisation.
    }
    return this;
  }

  has(t: TileCoord) { return this.index.has(key(t)); }
  count() { return this.index.size; }

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
    this.index.add(key(t));
    this.dirty = true;
    return st.size;
  }

  async put(t: TileCoord, data: ArrayBuffer) {
    await this.ensureDir(t);
    await Filesystem.writeFile({ directory: Directory.Data, path: this.path(t), data: toBase64(data) });
    this.index.add(key(t));
    this.dirty = true;
  }

  async flushIndex() {
    if (!this.dirty) return;
    this.dirty = false;
    await Filesystem.writeFile({
      directory: Directory.Data,
      path: `${this.root()}/index.json`,
      data: JSON.stringify([...this.index]),
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
  private index = new Set<string>();
  constructor(private layer: LayerDef) {}

  private cacheName() { return `tiles-${this.layer.id}`; }
  private req(t: TileCoord) { return new Request(`/__tiles/${this.layer.id}/${key(t)}`); }

  async init() {
    const cache = await caches.open(this.cacheName());
    for (const r of await cache.keys()) this.index.add(new URL(r.url).pathname.split('/').slice(3).join('/'));
    return this;
  }

  has(t: TileCoord) { return this.index.has(key(t)); }
  count() { return this.index.size; }

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
    this.index.add(key(t));
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
