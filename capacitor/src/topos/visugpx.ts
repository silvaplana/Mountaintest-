// 🚵 / 🥾 Circuits VisuGPX (visugpx.com), à côté de Camptocamp dans la liste des itinéraires.
// L'API demande une clé personnelle : elle reste sur le VPS, l'appli passe par le relais (/visugpx-liste, /visugpx-trace).
// Comme Camptocamp : toutes dates, du plus proche au plus loin. Même code côté Kotlin (VisuGpx.kt).
import { relayPost } from '../travel/travel';
import type { LonLat } from '../trails/osmTrails';
import type { Bike, C2cRoute, C2cSheet } from './c2c';

export const VGPX_ATTRIBUTION = 'Circuits © leurs auteurs sur VisuGPX';
export const vgpxLink = (vid: string) => `https://www.visugpx.com/${vid}`;

interface Row { id: string; titre: string; description: string; distance_m: number | null; denivele_m: number | null; duree: string; lat: number; lon: number; activite?: string }

/** Codes d'activité VisuGPX : vtt, vr (cyclotourisme = vélo de route), vg (gravel). */
export function bikeOf(code: string | undefined): Bike | undefined {
  const c = (code ?? '').toLowerCase();
  return c === 'vtt' ? 'vtt' : c === 'vr' ? 'route' : c === 'vg' ? 'gravel' : undefined;
}

/** Numéro négatif tiré de l'identifiant VisuGPX : ne croise jamais un numéro Camptocamp (positif). */
export function vgpxNum(vid: string) {
  let h = 0;
  for (const c of vid) h = (h * 31 + c.charCodeAt(0)) % 2147483647;
  return -(h + 1);
}

export function vgpxRoute(x: Row): C2cRoute {
  return {
    id: vgpxNum(x.id), src: 'visugpx', vid: x.id, title: x.titre, summary: '', lon: x.lon, lat: x.lat,
    rating: x.duree ? x.duree : '', heightUpM: x.denivele_m != null ? Math.round(x.denivele_m) : null, elevMaxM: null,
    lengthM: x.distance_m, durations: [], vdesc: x.description, bike: bikeOf(x.activite),
  };
}

/** Circuits à moins de 25 km du centre de l'écran (VTT en 🚵, randonnée pédestre en 🥾). */
export async function fetchVgpx(center: LonLat, vtt: boolean, password: string): Promise<C2cRoute[]> {
  const r = await relayPost<{ circuits?: Row[] }>('visugpx-liste', { lat: center.lat, lon: center.lon, activite: vtt ? 'vtt' : 'rando' }, password);
  return (r.circuits ?? []).map(vgpxRoute);
}

const key = (vid: string) => `vgpx:${vid}`;
export function savedVgpxSheet(r: C2cRoute): C2cSheet | null {
  try { return JSON.parse(localStorage.getItem(key(r.vid ?? '')) ?? 'null') as C2cSheet | null; } catch { return null; }
}

/** Fiche : la description de la liste et le tracé (relais), gardée sur le téléphone. */
export async function fetchVgpxSheet(r: C2cRoute, password: string): Promise<C2cSheet> {
  const saved = savedVgpxSheet(r);
  if (saved) return saved;
  const t = await relayPost<{ trace?: [number, number][] }>('visugpx-trace', { id: r.vid }, password);
  const s: C2cSheet = { ...r, description: r.vdesc ?? '', line: (t.trace ?? []).map(([lon, lat]) => ({ lon, lat })) };
  try { localStorage.setItem(key(r.vid ?? ''), JSON.stringify(s)); } catch { /* plein */ }
  return s;
}
