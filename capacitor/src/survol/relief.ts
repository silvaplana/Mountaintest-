// Relief du survol (🎬 ciné, 🧗 alpiniste) : altitudes lues dans le MNT IGN (mêmes tuiles que les ombres, gardées
// hors ligne) autour de la trace, et les sommets marquants de la zone, pour savoir où regarder.
import type { Bbox } from '../config';
import { cellMeters, gridFor, loadGrid, TILE, tileToLat, tileToLon, type DemGrid } from '../shade/dem';
import type { LonLat, Relief } from './camera';

/** Zone du relief : la trace et 6 km autour (les sommets qu'on voit de la trace). */
export function zoneRelief(z: Bbox): Bbox {
  const lat = ((z[1] + z[3]) / 2) * Math.PI / 180, my = 6000 / 111_320, mx = 6000 / (111_320 * Math.cos(lat));
  return [z[0] - mx, z[1] - my, z[2] + mx, z[3] + my];
}

/** Altitude (interpolée) et sommets d'une grille d'altitudes. */
export function reliefDeGrille(g: DemGrid): Relief {
  const { z, x0, y0 } = g.spec;
  const px = (p: LonLat) => {
    const n = 2 ** z, lat = (p.lat * Math.PI) / 180;
    const X = ((p.lon + 180) / 360) * n, Y = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n;
    return { i: (X - x0) * TILE - 0.5, j: (Y - y0) * TILE - 0.5 };
  };
  const at = (i: number, j: number) => g.dem[Math.max(0, Math.min(g.h - 1, j)) * g.w + Math.max(0, Math.min(g.w - 1, i))];
  const alt = (p: LonLat) => {
    const { i, j } = px(p);
    if (i < 0 || j < 0 || i > g.w - 1 || j > g.h - 1) return null;
    const i0 = Math.floor(i), j0 = Math.floor(j), u = i - i0, v = j - j0;
    return (at(i0, j0) * (1 - u) + at(i0 + 1, j0) * u) * (1 - v) + (at(i0, j0 + 1) * (1 - u) + at(i0 + 1, j0 + 1) * u) * v;
  };
  return { alt, sommets: sommets(g) };
}

/** Sommets marquants : plus hauts que tout à 1 km autour, et dominant leurs alentours (1,5 km) d'au moins 60 m. */
export function sommets(g: DemGrid, max = 40): (LonLat & { alt: number })[] {
  const m = cellMeters(g.spec), r = Math.max(2, Math.round(1000 / m)), r2 = Math.max(3, Math.round(1500 / m)), pas = Math.max(1, Math.round(r / 3));
  const at = (i: number, j: number) => g.dem[Math.max(0, Math.min(g.h - 1, j)) * g.w + Math.max(0, Math.min(g.w - 1, i))];
  const out: (LonLat & { alt: number; dom: number })[] = [];
  for (let j = r; j < g.h - r; j += pas) {
    for (let i = r; i < g.w - r; i += pas) {
      const h = at(i, j);
      if (!(h > 0)) continue;
      let haut = true;
      for (let dj = -r; dj <= r && haut; dj += pas) for (let di = -r; di <= r; di += pas) if ((di || dj) && at(i + di, j + dj) > h) { haut = false; break; }
      if (!haut) continue;
      let moy = 0;
      for (let k = 0; k < 8; k++) moy += at(i + Math.round(r2 * Math.cos((k * Math.PI) / 4)), j + Math.round(r2 * Math.sin((k * Math.PI) / 4)));
      const dom = h - moy / 8;
      if (dom < 60) continue;
      out.push({ lon: tileToLon(g.spec.x0 + (i + 0.5) / TILE, g.spec.z), lat: tileToLat(g.spec.y0 + (j + 0.5) / TILE, g.spec.z), alt: h, dom });
    }
  }
  return out.sort((a, b) => b.dom - a.dom).slice(0, max).map(({ lon, lat, alt }) => ({ lon, lat, alt }));
}

/** Charge le relief autour de la trace (null s'il manque : film en simple suivi). */
export async function chargerRelief(zone: Bbox, signal: AbortSignal): Promise<Relief | null> {
  const g = await loadGrid(gridFor(zoneRelief(zone), 12), signal);
  if (signal.aborted || g.missing === g.spec.nx * g.spec.ny) return null;
  return reliefDeGrille(g);
}
