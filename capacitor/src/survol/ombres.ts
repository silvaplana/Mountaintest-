// Ombres du survol : les images du film des ombres (même calcul, shade/), sur toute la trace, de h0 à h1
// toutes les 30 min, posées sur le relief 3D. Elles défilent en accéléré pendant le film.
import type { ImageSource, Map as MlMap } from 'maplibre-gl';
import type { Bbox } from '../config';
import { gridBbox, gridFor, loadGrid } from '../shade/dem';
import { computeFrame, framePixels } from '../shade/film';
import { NIGHT } from '../shade/shadow';

const SRC = 'survol-ombres';

function versUrl(px: Uint8ClampedArray, w: number, h: number): Promise<string> {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  return new Promise((ok, ko) => c.toBlob((b) => (b ? ok(URL.createObjectURL(b)) : ko(new Error('image'))), 'image/png'));
}

export interface OmbresSurvol { montrer: (i: number) => void; opacite: (o: number) => void; retirer: () => void }

/** Zone des ombres : la trace et ses alentours (ce que la caméra voit devant elle), au moins 2 km de plus. */
export function zoneElargie(z: Bbox): Bbox {
  const lat = ((z[1] + z[3]) / 2) * Math.PI / 180;
  const my = Math.max(2000 / 111_320, (z[3] - z[1]) * 0.3), mx = Math.max(2000 / (111_320 * Math.cos(lat)), (z[2] - z[0]) * 0.3);
  return [z[0] - mx, z[1] - my, z[2] + mx, z[3] + my];
}

/** Bords fondus : l'ombre s'efface sur le dernier dixième de l'image (plus de carré visible de loin). */
export function fondreBords(px: Uint8ClampedArray, w: number, h: number, part = 0.1) {
  const bx = Math.max(1, w * part), by = Math.max(1, h * part);
  for (let y = 0; y < h; y++) {
    const ky = Math.min(1, (y + 0.5) / by, (h - y - 0.5) / by);
    for (let x = 0; x < w; x++) {
      const k = Math.min(ky, (x + 0.5) / bx, (w - x - 0.5) / bx);
      if (k < 1) px[(y * w + x) * 4 + 3] *= k * k * (3 - 2 * k);
    }
  }
  return px;
}

/** Calcule les images (une par heure de `heures`, aujourd'hui) et les pose sur la carte, la première visible. */
export async function preparerOmbres(map: MlMap, zone: Bbox, zoom: number, heures: number[], signal: AbortSignal,
  progres: (fait: number, total: number) => void): Promise<OmbresSurvol | null> {
  const grid = await loadGrid(gridFor(zoneElargie(zone), zoom), signal);
  if (signal.aborted || grid.missing === grid.spec.nx * grid.spec.ny) return null;
  const now = new Date();
  const urls: string[] = [];
  for (let i = 0; i < heures.length; i++) {
    progres(i, heures.length);
    await new Promise((r) => setTimeout(r, 0));
    if (signal.aborted) { urls.forEach((u) => URL.revokeObjectURL(u)); return null; }
    const h = heures[i];
    const f = computeFrame(grid, new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(h), (h % 1) * 60));
    urls.push(await versUrl(fondreBords(framePixels(f.codes ?? new Uint8Array(grid.w * grid.h).fill(NIGHT)), grid.w, grid.h), grid.w, grid.h));
  }
  const [w, s, e, n] = gridBbox(grid.spec);
  const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [[w, n], [e, n], [e, s], [w, s]];
  map.addSource(SRC, { type: 'image', url: urls[0], coordinates });
  map.addLayer({ id: SRC, type: 'raster', source: SRC, paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' } },
    map.getLayer('forests') ? 'forests' : undefined);
  let cur = 0, op = 1;
  return {
    opacite: (o) => {
      if (Math.abs(o - op) < 0.01) return;
      op = o;
      if (map.getLayer(SRC)) map.setPaintProperty(SRC, 'raster-opacity', o);
    },
    montrer: (i) => {
      if (i === cur || !urls[i]) return;
      cur = i;
      (map.getSource(SRC) as ImageSource | undefined)?.updateImage({ url: urls[i], coordinates });
    },
    retirer: () => {
      if (map.getLayer(SRC)) map.removeLayer(SRC);
      if (map.getSource(SRC)) map.removeSource(SRC);
      urls.forEach((u) => URL.revokeObjectURL(u));
    },
  };
}
