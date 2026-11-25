// ❄ Neige posée sur les photos aériennes du film (Seb, 25/11 : les photos de l'IGN sont prises en été). Elle est
// calculée d'après le relief : blanc au-dessus de la limite choisie (plus bas en versant nord, plus haut au sud),
// limite fondue, pentes très raides laissées en rocher. Le blanc est ombré par le relief (soleil au sud-est), sinon
// la montagne enneigée serait un aplat.
import type { Map as MlMap } from 'maplibre-gl';
import type { Bbox } from '../config';
import { cellMeters, gridBbox, gridFor, loadGrid } from '../shade/dem';
import { fondreBords } from './ombres';
import { zoneRelief } from './relief';

const ID = 'survol-neige';
export const LIMITES_NEIGE = [1000, 1500, 2000, 2500];

const doux = (v: number) => { const x = Math.max(0, Math.min(1, v)); return x * x * (3 - 2 * x); };
// Soleil au sud-est, à 35° au-dessus de l'horizon (vers l'est, vers le nord, vers le haut).
const SOLEIL = [0.58, -0.58, 0.57];

/**
 * Relief adouci (moyenne glissante sur ±r mailles, passée trois fois ; les trous restent des trous). Le relief IGN
 * arrive en marches d'escalier (données plus grossières que la maille demandée) : sans ça la pente saute d'une maille
 * à l'autre et la neige se couvre de stries (Seb, 26/11).
 */
export function lisser(dem: Float32Array, w: number, h: number, r = 2): Float32Array {
  let a = dem;
  const passe = (src: Float32Array, n: number, pas: number, debut: (k: number) => number, lignes: number) => {
    const out = new Float32Array(src.length);
    for (let k = 0; k < lignes; k++) {
      const o = debut(k);
      for (let i = 0; i < n; i++) {
        let somme = 0, nb = 0;
        for (let d = -r; d <= r; d++) {
          const v = src[o + Math.max(0, Math.min(n - 1, i + d)) * pas];
          if (v > 0) { somme += v; nb++; }
        }
        out[o + i * pas] = src[o + i * pas] > 0 && nb ? somme / nb : src[o + i * pas];
      }
    }
    return out;
  };
  for (let t = 0; t < 3; t++) {
    a = passe(a, w, 1, (j) => j * w, h);
    a = passe(a, h, w, (i) => i, w);
  }
  return a;
}

/** Image de la neige (RGBA) pour une grille d'altitudes de maille `m` mètres ; ligne 0 au nord. */
export function pixelsNeige(dem: Float32Array, w: number, h: number, m: number, limite: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  dem = lisser(dem, w, h);
  const at = (i: number, j: number) => dem[Math.max(0, Math.min(h - 1, j)) * w + Math.max(0, Math.min(w - 1, i))];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const z = at(i, j);
      if (!(z > 0)) continue;
      // Pente : vers l'est (gx) et vers le nord (gy) ; la normale au terrain est (−gx, −gy, 1).
      const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * m), gy = (at(i, j - 1) - at(i, j + 1)) / (2 * m);
      const p = Math.hypot(gx, gy), l = Math.hypot(p, 1);
      // Versant nord (le terrain descend vers le nord, gy < 0) : la neige tient 150 m plus bas ; versant sud, plus haut.
      const lim = limite + 150 * (p ? gy / p : 0) * Math.min(1, p / 0.3);
      // Limite fondue sur 250 m ; au-delà de 40° la neige ne tient plus, à 55° c'est du rocher.
      const a = doux((z - lim + 125) / 250) * (1 - doux((Math.atan(p) * 180 / Math.PI - 40) / 15));
      if (a <= 0) continue;
      const lum = Math.max(0, (-gx * SOLEIL[0] - gy * SOLEIL[1] + SOLEIL[2]) / l), k = 0.55 + 0.45 * Math.min(1, lum / 0.75), o = (j * w + i) * 4;
      // À l'ombre, la neige tire sur le bleu.
      px[o] = 255 * k * (0.9 + 0.1 * k); px[o + 1] = 255 * k * (0.95 + 0.05 * k); px[o + 2] = 255 * Math.min(1, k + 0.06); px[o + 3] = 242 * a;
    }
  }
  return px;
}

/** Pose la neige par-dessus les photos ; rend de quoi la retirer (null si le relief manque). */
export async function poserNeige(map: MlMap, zone: Bbox, limite: number, signal: AbortSignal): Promise<(() => void) | null> {
  const g = await loadGrid(gridFor(zoneRelief(zone), 15, 144), signal);
  if (signal.aborted || g.missing === g.spec.nx * g.spec.ny) return null;
  const c = document.createElement('canvas');
  c.width = g.w; c.height = g.h;
  const px = fondreBords(pixelsNeige(g.dem, g.w, g.h, cellMeters(g.spec), limite), g.w, g.h, 0.05);
  c.getContext('2d')!.putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, g.w, g.h), 0, 0);
  const url = await new Promise<string>((ok, ko) => c.toBlob((b) => (b ? ok(URL.createObjectURL(b)) : ko(new Error('image'))), 'image/png'));
  const [w, s, e, n] = gridBbox(g.spec);
  map.addSource(ID, { type: 'image', url, coordinates: [[w, n], [e, n], [e, s], [w, s]] });
  map.addLayer({ id: ID, type: 'raster', source: ID, paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, map.getLayer('slopes') ? 'slopes' : undefined);
  return () => {
    if (map.getLayer(ID)) map.removeLayer(ID);
    if (map.getSource(ID)) map.removeSource(ID);
    URL.revokeObjectURL(url);
  };
}
