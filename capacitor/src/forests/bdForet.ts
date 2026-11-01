// Forêts par essence : BD Forêt® V2 de l'IGN (carte forestière, licence ouverte Etalab 2.0), lue par le
// service WFS de la Géoplateforme (gratuit, sans clé). Chaque massif de plus de 0,5 ha porte son essence
// principale (« Hêtre », « Pin d'Alep », « Chênes décidus »…). Même logique côté Kotlin (Forests.kt).
import type { Bbox } from '../config';

export const BDFORET_ATTRIBUTION = '© IGN – BD Forêt® V2 (licence ouverte Etalab 2.0)';
export const WFS_URL = 'https://data.geopf.fr/wfs/ows';
export const WFS_TYPENAME = 'LANDCOVER.FORESTINVENTORY.V2:formation_vegetale';
/** Au-delà (environ 20 km de côté), la réponse dépasserait plusieurs dizaines de Mo. */
export const MAX_FOREST_DEG = 0.2;
/** Nombre maximum de massifs demandés en une fois (le serveur en renvoie au plus 5000). */
export const MAX_FORESTS = 5000;

export type Ring = [number, number][];
export interface Forest {
  id: string;
  /** Essence principale, ou type de formation quand l'essence n'est pas renseignée (landes…). */
  essence: string;
  /** Type de formation végétale (« Forêt fermée de hêtre pur »…). */
  type: string;
  color: string;
  /** Polygones (anneau extérieur puis trous), en [lon, lat]. */
  polygons: Ring[][];
  areaHa: number;
}
export interface EssenceGroup { essence: string; color: string; count: number; areaHa: number }

export function forestZoneTooBig(b: Bbox) { return b[2] - b[0] > MAX_FOREST_DEG || b[3] - b[1] > MAX_FOREST_DEG; }

export function wfsUrl(b: Bbox): string {
  const [w, s, e, n] = b;
  const f = (v: number) => v.toFixed(5);
  const params = new URLSearchParams({
    SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature',
    TYPENAMES: WFS_TYPENAME, OUTPUTFORMAT: 'application/json', SRSNAME: 'EPSG:4326',
    // En WFS 2.0 avec ce nom de système, l'ordre est latitude puis longitude.
    BBOX: `${f(s)},${f(w)},${f(n)},${f(e)},urn:ogc:def:crs:EPSG::4326`,
    COUNT: String(MAX_FORESTS),
  });
  return `${WFS_URL}?${params}`;
}

/** Couleurs des essences les plus courantes ; les autres prennent une couleur de la palette. */
const COLORS: Record<string, string> = {
  'Chênes décidus': '#b08d2c',
  'Chênes sempervirents': '#6b7d1f',
  'Hêtre': '#7cc242',
  'Châtaignier': '#c4702a',
  'Robinier': '#d9c43a',
  'Peuplier': '#b5d334',
  'Feuillus': '#94c973',
  'Pin d\'Alep': '#2e8b3e',
  'Pin maritime': '#1b5e20',
  'Pin sylvestre': '#2a9d8f',
  'Pin laricio, pin noir': '#00695c',
  'Pin à crochets, pin cembro': '#26667a',
  'Pins mélangés': '#3f8f5a',
  'Autres pins': '#4d7c3a',
  'Sapin, épicéa': '#1f4e79',
  'Mélèze': '#8e6cc2',
  'Douglas': '#3949ab',
  'Conifères': '#2f6f4f',
  'Autres conifères': '#456b5e',
  'Mixte': '#7f9c4a',
};
const PALETTE = ['#e07a5f', '#81b29a', '#f2cc8f', '#3d405b', '#c06c84', '#6c5b7b', '#355c7d', '#99b898'];
const NON_TREE = '#c9b79c';

export function essenceColor(essence: string, tree = true): string {
  if (COLORS[essence]) return COLORS[essence];
  if (!tree) return NON_TREE;
  let h = 0;
  for (const c of essence) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** « NC » : non concerné (landes, peupleraies…) ; « NR » : non renseigné. On montre alors le type de formation. */
export function essenceLabel(essence: string | undefined, tfvG11: string | undefined, tfv: string | undefined): { label: string; tree: boolean } {
  const e = (essence ?? '').trim();
  if (e && e !== 'NC' && e !== 'NR') return { label: e, tree: true };
  return { label: (tfvG11 ?? '').trim() || (tfv ?? '').trim() || 'Non renseigné', tree: false };
}

/** Surface d'un anneau en m² (projection locale, largement assez précise à l'échelle d'un massif). */
export function ringAreaM2(ring: Ring): number {
  if (ring.length < 3) return 0;
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180), ky = 110_540;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] * kx) * (ring[i][1] * ky) - (ring[i][0] * kx) * (ring[j][1] * ky);
  }
  return Math.abs(a) / 2;
}

export function polygonsAreaHa(polygons: Ring[][]): number {
  let m2 = 0;
  for (const p of polygons) p.forEach((r, k) => { m2 += k === 0 ? ringAreaM2(r) : -ringAreaM2(r); });
  return Math.max(0, m2) / 10_000;
}

interface WfsFeature {
  id?: string;
  geometry?: { type: string; coordinates: unknown } | null;
  properties?: Record<string, string | undefined>;
}

/** Le serveur rend du [lon, lat] ; par prudence, on retourne si on reçoit du [lat, lon] (en France, lat > 40 > lon). */
function fixAxis(polys: Ring[][]): Ring[][] {
  const p = polys[0]?.[0]?.[0];
  if (!p || p[0] < 40) return polys;
  return polys.map((poly) => poly.map((r) => r.map(([a, b]) => [b, a] as [number, number])));
}

export function parseForests(json: { features?: WfsFeature[] }): Forest[] {
  const out: Forest[] = [];
  for (const f of json.features ?? []) {
    const g = f.geometry;
    if (!g) continue;
    let polys: Ring[][];
    if (g.type === 'Polygon') polys = [g.coordinates as Ring[]];
    else if (g.type === 'MultiPolygon') polys = g.coordinates as Ring[][];
    else continue;
    polys = fixAxis(polys.filter((p) => p.length && p[0].length >= 4));
    if (!polys.length) continue;
    const pr = f.properties ?? {};
    const { label, tree } = essenceLabel(pr.essence, pr.tfv_g11, pr.tfv);
    out.push({
      id: String(pr.id ?? f.id ?? out.length),
      essence: label,
      type: (pr.tfv ?? '').trim(),
      color: essenceColor(label, tree),
      polygons: polys,
      areaHa: polygonsAreaHa(polys),
    });
  }
  return out;
}

/** Essences présentes, de la plus étendue à la moins étendue. */
export function groupByEssence(forests: Forest[]): EssenceGroup[] {
  const m = new Map<string, EssenceGroup>();
  for (const f of forests) {
    const g = m.get(f.essence) ?? { essence: f.essence, color: f.color, count: 0, areaHa: 0 };
    g.count++; g.areaHa += f.areaHa;
    m.set(f.essence, g);
  }
  return [...m.values()].sort((a, b) => b.areaHa - a.areaHa);
}

export async function fetchForests(b: Bbox, signal?: AbortSignal): Promise<Forest[]> {
  const res = await fetch(wfsUrl(b), { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseForests(await res.json());
}

/** Massifs à dessiner : tous, ou seulement les essences choisies. */
export function forestsGeoJson(forests: Forest[], only: Set<string>): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: forests.filter((f) => !only.size || only.has(f.essence)).map((f) => ({
      type: 'Feature',
      properties: { id: f.id, essence: f.essence, type: f.type, color: f.color, ha: Math.round(f.areaHa * 10) / 10 },
      geometry: { type: 'MultiPolygon', coordinates: f.polygons },
    })),
  };
}

/** « 1 234 ha » ou « 3,5 ha ». */
export function formatHa(ha: number): string {
  return ha >= 100 ? `${Math.round(ha).toLocaleString('fr-FR')} ha` : `${ha.toFixed(1).replace('.', ',')} ha`;
}
