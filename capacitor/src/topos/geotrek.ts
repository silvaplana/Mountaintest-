// Itinéraires Geotrek (portails des parcs nationaux, parcs régionaux, départements), par le relais du VPS
// (/geotrek-liste, /geotrek-trace) : il trouve l'API de chaque portail proche et ne garde que l'activité demandée.
// Ils s'ajoutent à la même liste que Camptocamp et VisuGPX, marqués « Geotrek · territoire ».
import { relayPost } from '../travel/travel';
import type { LonLat } from '../trails/osmTrails';
import type { Bike, C2cRoute, C2cSheet } from './c2c';
import { vgpxNum } from './visugpx';

export const GEOTREK_ATTRIBUTION = 'Itinéraires © leurs auteurs, publiés avec Geotrek';

interface Row { id: string; titre: string; description: string; distance_m: number | null; denivele_m: number | null; duree: string;
  nature: 'rando' | Bike; source: string; lien: string; lat: number; lon: number }

export function geotrekRoute(x: Row): C2cRoute {
  return {
    // Numéro négatif (comme VisuGPX), préfixé pour ne pas croiser un circuit VisuGPX.
    id: vgpxNum(`geotrek:${x.id}`), src: 'geotrek', vid: x.id, title: x.titre, summary: '', lon: x.lon, lat: x.lat,
    rating: x.duree, heightUpM: x.denivele_m != null ? Math.round(x.denivele_m) : null, elevMaxM: null,
    lengthM: x.distance_m, durations: [], vdesc: x.description, bike: x.nature === 'rando' ? undefined : x.nature,
    srcName: x.source, link: x.lien,
  };
}

/** Itinéraires à environ 25 km du centre de l'écran : randonnée (🥾) ou vélo (🚵 🚴 🚲, l'appli filtre). */
export async function fetchGeotrek(center: LonLat, velo: boolean, password: string): Promise<C2cRoute[]> {
  const r = await relayPost<{ circuits?: Row[] }>('geotrek-liste', { lat: center.lat, lon: center.lon, activite: velo ? 'velo' : 'rando' }, password);
  return (r.circuits ?? []).map(geotrekRoute);
}

const key = (vid: string) => `geotrek:${vid}`;
export function savedGeotrekSheet(r: C2cRoute): C2cSheet | null {
  try { return JSON.parse(localStorage.getItem(key(r.vid ?? '')) ?? 'null') as C2cSheet | null; } catch { return null; }
}

/** Fiche : la description de la liste et le tracé (relais), gardée sur le téléphone. */
export async function fetchGeotrekSheet(r: C2cRoute, password: string): Promise<C2cSheet> {
  const saved = savedGeotrekSheet(r);
  if (saved) return saved;
  const t = await relayPost<{ trace?: [number, number][] }>('geotrek-trace', { id: r.vid }, password);
  const s: C2cSheet = { ...r, description: r.vdesc ?? '', line: (t.trace ?? []).map(([lon, lat]) => ({ lon, lat })) };
  try { localStorage.setItem(key(r.vid ?? ''), JSON.stringify(s)); } catch { /* plein */ }
  return s;
}
