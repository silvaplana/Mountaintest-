// Zones drones hors ligne : la carte DGAC « Restrictions UAS catégorie Ouverte et aéromodélisme » existe aussi en
// contours (WFS de la Géoplateforme, gratuit, sans clé). On les télécharge avec la zone hors ligne et on les dessine
// sur la carte quand il n'y a pas de réseau (le calque image de l'IGN prend le relais dès que le réseau revient).
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { Bbox } from '../config';

export const WFS_URL = 'https://data.geopf.fr/wfs/ows';
export const DRONES_TYPENAME = 'TRANSPORTS.DRONES.RESTRICTIONS:carte_restriction_drones_lf';
const FILE = 'drones/zones.json';
const RED = '#e3170a';
const ORANGE = '#ff9900';

export function dronesWfsUrl(b: Bbox): string {
  const [w, s, e, n] = b;
  const f = (v: number) => v.toFixed(5);
  const params = new URLSearchParams({
    SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature',
    TYPENAMES: DRONES_TYPENAME, OUTPUTFORMAT: 'application/json', SRSNAME: 'EPSG:4326',
    // En WFS 2.0 avec ce nom de système, l'ordre est latitude puis longitude.
    BBOX: `${f(s)},${f(w)},${f(n)},${f(e)},urn:ogc:def:crs:EPSG::4326`,
    COUNT: '5000',
  });
  return `${WFS_URL}?${params}`;
}

/**
 * Le champ « limite » dit la règle : « Vol interdit * » (rouge), ou une hauteur maximale (orange, « 50 m »).
 * On garde le texte tel quel pour le montrer quand on touche la zone.
 */
export function zoneStyle(limite: string | undefined): { color: string; short: string } {
  const t = (limite ?? '').trim();
  if (/interdit/i.test(t)) return { color: RED, short: 'Vol interdit' };
  const h = t.match(/(\d+)\s*m\b/i);
  if (h) return { color: ORANGE, short: `Hauteur maximale ${h[1]} m` };
  return { color: ORANGE, short: t || 'Vol limité' };
}

/** Garde la géométrie et la règle de chaque zone, avec sa couleur. */
export function parseDroneZones(json: { features?: GeoJSON.Feature[] }): GeoJSON.Feature[] {
  return (json.features ?? []).filter((f) => f.geometry).map((f, i) => {
    const p = (f.properties ?? {}) as { limite?: string; remarque?: string };
    const s = zoneStyle(p.limite);
    return { type: 'Feature', id: f.id ?? `z${i}`, geometry: f.geometry,
      properties: { color: s.color, text: [s.short, p.remarque?.trim()].filter(Boolean).join(' · ') } };
  });
}

interface Saved { zones: Bbox[]; features: GeoJSON.Feature[] }
const inside = (a: Bbox, b: Bbox) => a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];

let cache: Saved | null = null;
async function load(): Promise<Saved> {
  if (cache) return cache;
  try {
    const r = await Filesystem.readFile({ directory: Directory.Data, path: FILE, encoding: Encoding.UTF8 });
    cache = JSON.parse(r.data as string) as Saved;
  } catch {
    cache = { zones: [], features: [] };
  }
  return cache;
}

export async function localDroneZones(): Promise<GeoJSON.FeatureCollection> {
  return { type: 'FeatureCollection', features: (await load()).features };
}

/** Télécharge les zones drones du rectangle et les garde sur le téléphone ; rien à faire s'il est déjà couvert. */
export async function saveDroneZones(b: Bbox, signal?: AbortSignal): Promise<number> {
  const saved = await load();
  if (saved.zones.some((z) => inside(b, z))) return 0;
  const res = await fetch(dronesWfsUrl(b), { signal });
  if (!res.ok) throw new Error(`zones drones : HTTP ${res.status}`);
  const got = parseDroneZones(await res.json());
  const ids = new Set(got.map((f) => f.id));
  const features = [...saved.features.filter((f) => !ids.has(f.id)), ...got];
  cache = { zones: [...saved.zones.filter((z) => !inside(z, b)), b], features };
  await Filesystem.writeFile({ directory: Directory.Data, path: FILE, data: JSON.stringify(cache), encoding: Encoding.UTF8, recursive: true });
  return got.length;
}

/** « Effacer les cartes » efface aussi les zones drones. */
export async function clearDroneZones() {
  cache = { zones: [], features: [] };
  await Filesystem.deleteFile({ directory: Directory.Data, path: FILE }).catch(() => {});
}
