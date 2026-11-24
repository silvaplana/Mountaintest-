// Vue 3D : le relief IGN des ombres (tuiles BIL, déjà gardées hors ligne) donné à MapLibre.
// MapLibre veut des images où la couleur code l'altitude (format « terrarium ») : on convertit au vol.
import * as maplibregl from 'maplibre-gl';
import { loadMntTile, TILE } from './dem';

/** Altitudes (m) → pixels terrarium : altitude = R × 256 + G + B / 256 − 32768. */
export function terrariumRgba(dem: Float32Array): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(dem.length * 4);
  for (let i = 0; i < dem.length; i++) {
    const v = Math.max(0, Math.min(65535.99, dem[i] + 32768));
    const r = Math.floor(v / 256), g = Math.floor(v) % 256, b = Math.floor((v - Math.floor(v)) * 256);
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = 255;
  }
  return out;
}

async function toPng(rgba: Uint8ClampedArray<ArrayBuffer>): Promise<ArrayBuffer> {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  c.getContext('2d')!.putImageData(new ImageData(rgba, TILE, TILE), 0, 0);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'));
  if (!blob) throw new Error('PNG');
  return blob.arrayBuffer();
}

/** Protocole « relief://<z>/<x>/<y> » : tuile de relief (disque d'abord, réseau ensuite) en PNG terrarium. */
export function registerReliefProtocol() {
  maplibregl.addProtocol('relief', async (params, abort) => {
    const [z, x, y] = params.url.slice('relief://'.length).split('/').map(Number);
    const dem = await loadMntTile({ z, x, y }, abort.signal);
    // Hors ligne sans cette tuile : MapLibre garde le relief d'un zoom au-dessus s'il l'a.
    if (!dem) throw new Error('relief absent');
    return { data: await toPng(terrariumRgba(dem)) };
  });
}

export const RELIEF_SOURCE: maplibregl.RasterDEMSourceSpecification = {
  type: 'raster-dem', tiles: ['relief://{z}/{x}/{y}'], tileSize: TILE, encoding: 'terrarium', minzoom: 6, maxzoom: 14,
};
