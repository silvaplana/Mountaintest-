// Relief pour le calcul des ombres : MNT IGN RGE ALTI (Géoplateforme, licence ouverte, sans clé),
// demandé en WMS par tuiles Web Mercator de 256 × 256 altitudes (float32, format BIL).
// Les tuiles sont gardées sur le téléphone (même stockage que les tuiles de carte, couche « mnt »)
// et téléchargées d'avance avec la zone hors ligne. Même découpage côté Kotlin (Shade.kt).
import type { Bbox, LayerDef } from '../config';
import { getTileStore } from '../tiles/offlineStore';
import { latToTileY, lonToTileX, type TileCoord } from '../tiles/tileMath';

export const MNT_LAYER: LayerDef = {
  id: 'mnt',
  label: 'Relief (RGE ALTI)',
  wmtsLayer: 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES',
  format: 'image/x-bil;bits=32',
  ext: 'bil',
  needsKey: false,
  maxNativeZoom: 14,
  attribution: '© IGN – RGE ALTI®',
};

export const TILE = 256;
export const TILE_BYTES = TILE * TILE * 4;
/** Zooms du relief : z14 ≈ 7 m par maille à nos latitudes, z10 ≈ 110 m. */
export const MNT_MIN_ZOOM = 10;
export const MNT_MAX_ZOOM = 14;
/** Tuiles de marge autour de la vue : les reliefs voisins portent aussi leur ombre. */
export const MNT_MARGIN = 1;
/** Au-delà, on prend un zoom de relief plus grossier. */
export const MAX_GRID_TILES = 48;

const E = 20037508.342789244;

export function tileBounds3857(t: TileCoord): [number, number, number, number] {
  const size = (2 * E) / 2 ** t.z;
  return [-E + t.x * size, E - (t.y + 1) * size, -E + (t.x + 1) * size, E - t.y * size];
}

export function mntTileUrl(t: TileCoord): string {
  const b = tileBounds3857(t).map((v) => v.toFixed(2)).join(',');
  return 'https://data.geopf.fr/wms-r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap'
    + `&LAYERS=${MNT_LAYER.wmtsLayer}&STYLES=&FORMAT=${encodeURIComponent(MNT_LAYER.format)}`
    + `&CRS=EPSG:3857&BBOX=${b}&WIDTH=${TILE}&HEIGHT=${TILE}`;
}

export const tileToLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
export const tileToLat = (y: number, z: number) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
};

/** Zoom du relief pour un zoom de carte : un cran en dessous (le relief est lissé à l'affichage). */
export function mntZoomFor(mapZoom: number): number {
  return Math.max(MNT_MIN_ZOOM, Math.min(MNT_MAX_ZOOM, Math.floor(mapZoom) - 1));
}

export interface GridSpec { z: number; x0: number; y0: number; nx: number; ny: number }

/** Tuiles de relief couvrant la vue avec la marge ; zoom réduit si la vue est trop grande. */
export function gridFor(view: Bbox, mapZoom: number): GridSpec {
  for (let z = mntZoomFor(mapZoom); ; z--) {
    const x0 = lonToTileX(view[0], z) - MNT_MARGIN, x1 = lonToTileX(view[2], z) + MNT_MARGIN;
    const y0 = latToTileY(view[3], z) - MNT_MARGIN, y1 = latToTileY(view[1], z) + MNT_MARGIN;
    const spec = { z, x0, y0, nx: x1 - x0 + 1, ny: y1 - y0 + 1 };
    if (spec.nx * spec.ny <= MAX_GRID_TILES || z <= MNT_MIN_ZOOM) return spec;
  }
}

/** Emprise de la grille : [ouest, sud, est, nord]. */
export function gridBbox(g: GridSpec): Bbox {
  return [tileToLon(g.x0, g.z), tileToLat(g.y0 + g.ny, g.z), tileToLon(g.x0 + g.nx, g.z), tileToLat(g.y0, g.z)];
}

/** Taille d'une maille au sol (m) au centre de la grille. */
export function cellMeters(g: GridSpec): number {
  const b = gridBbox(g);
  const lat = (b[1] + b[3]) / 2;
  return ((2 * E) / 2 ** g.z / TILE) * Math.cos((lat * Math.PI) / 180);
}

/** Lit une tuile BIL float32 ; −99999 (pas de donnée, mer) devient 0. */
export function decodeBil(buf: ArrayBuffer): Float32Array | null {
  if (buf.byteLength !== TILE_BYTES) return null;
  const v = new Float32Array(buf.slice(0));
  for (let i = 0; i < v.length; i++) if (!(v[i] > -1000) || v[i] > 9000) v[i] = 0;
  return v;
}

/** Une tuile de relief : disque d'abord, réseau ensuite (et gardée pour la prochaine fois). */
export async function loadMntTile(t: TileCoord, signal?: AbortSignal): Promise<Float32Array | null> {
  const store = await getTileStore(MNT_LAYER);
  const local = await store.read(t).catch(() => null);
  const fromDisk = local ? decodeBil(local) : null;
  if (fromDisk) return fromDisk;
  try {
    const res = await fetch(mntTileUrl(t), { signal });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const v = decodeBil(buf);
    if (v) await store.put(t, buf).catch(() => {});
    return v;
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  }
}

export interface DemGrid { spec: GridSpec; w: number; h: number; dem: Float32Array; missing: number }

/** Assemble les tuiles de relief de la grille en une seule matrice d'altitudes. */
export async function loadGrid(spec: GridSpec, signal?: AbortSignal, onTile?: (done: number, total: number) => void): Promise<DemGrid> {
  const w = spec.nx * TILE, h = spec.ny * TILE;
  const dem = new Float32Array(w * h);
  const total = spec.nx * spec.ny;
  let done = 0, missing = 0;
  const jobs: TileCoord[] = [];
  for (let j = 0; j < spec.ny; j++) for (let i = 0; i < spec.nx; i++) jobs.push({ z: spec.z, x: spec.x0 + i, y: spec.y0 + j });
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const t = jobs[next++];
      const v = await loadMntTile(t, signal);
      if (!v) missing++;
      else {
        const ox = (t.x - spec.x0) * TILE, oy = (t.y - spec.y0) * TILE;
        for (let r = 0; r < TILE; r++) dem.set(v.subarray(r * TILE, (r + 1) * TILE), (oy + r) * w + ox);
      }
      onTile?.(++done, total);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  await (await getTileStore(MNT_LAYER)).flushIndex();
  return { spec, w, h, dem, missing };
}

/** Tuiles de relief à télécharger avec une zone hors ligne (zooms 10 à 14, avec la marge). */
export function mntTilesForZone(b: Bbox): TileCoord[] {
  const out: TileCoord[] = [];
  for (let z = MNT_MIN_ZOOM; z <= MNT_MAX_ZOOM; z++) {
    const x0 = lonToTileX(b[0], z) - MNT_MARGIN, x1 = lonToTileX(b[2], z) + MNT_MARGIN;
    const y0 = latToTileY(b[3], z) - MNT_MARGIN, y1 = latToTileY(b[1], z) + MNT_MARGIN;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ z, x, y });
  }
  return out;
}
