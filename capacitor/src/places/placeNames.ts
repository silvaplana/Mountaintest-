// Noms des lieux gardés sur le téléphone, pour que la loupe 🔍 trouve un sommet ou un col sans réseau.
// Téléchargés avec la carte d'une zone ou d'une trace mise hors ligne :
// - BD TOPO de l'IGN (les noms écrits sur les cartes IGN), par le service WFS de la Géoplateforme
//   (gratuit, sans clé, licence ouverte Etalab 2.0) ;
// - OpenStreetMap (API Overpass, © contributeurs OpenStreetMap, ODbL) pour compléter (cabanes, plages…).
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { Bbox } from '../config';
import { WFS_URL } from '../forests/bdForet';
import { OVERPASS_URLS } from '../trails/osmTrails';
import type { Place } from '../search';

/** Un nom de lieu : [nom, nature, lon, lat], en tableau pour garder le fichier petit. */
export type PlaceName = [name: string, nature: string, lon: number, lat: number];
interface Saved { zones: Bbox[]; names: PlaceName[] }

const FILE = 'places/names.json';
/** Couches BD TOPO qui portent des noms de lieux naturels ou isolés. */
export const BDTOPO_LAYERS = ['BDTOPO_V3:detail_orographique', 'BDTOPO_V3:lieu_dit_non_habite', 'BDTOPO_V3:detail_hydrographique', 'BDTOPO_V3:zone_d_habitation'];
const MAX_FEATURES = 5000;
/** Deux noms identiques à moins de 300 m : le même lieu (on garde celui de l'IGN, lu en premier). */
const SAME_PLACE_M = 300;

export function bdtopoUrl(layer: string, b: Bbox): string {
  const [w, s, e, n] = b;
  const f = (v: number) => v.toFixed(5);
  const params = new URLSearchParams({
    SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature',
    TYPENAMES: layer, OUTPUTFORMAT: 'application/json', SRSNAME: 'EPSG:4326',
    // En WFS 2.0 avec ce nom de système, l'ordre est latitude puis longitude.
    BBOX: `${f(s)},${f(w)},${f(n)},${f(e)},urn:ogc:def:crs:EPSG::4326`,
    COUNT: String(MAX_FEATURES),
  });
  return `${WFS_URL}?${params}`;
}

/** Un point qui représente la géométrie : le point lui-même, sinon la moyenne des sommets. */
function pointOf(g: GeoJSON.Geometry | null | undefined): [number, number] | null {
  if (!g) return null;
  if (g.type === 'Point') return [g.coordinates[0], g.coordinates[1]];
  if (g.type === 'GeometryCollection') return pointOf(g.geometries[0]);
  const pts: number[][] = [];
  const walk = (c: unknown) => {
    if (Array.isArray(c) && typeof c[0] === 'number') pts.push(c as number[]);
    else if (Array.isArray(c)) c.forEach(walk);
  };
  walk(g.coordinates);
  if (!pts.length) return null;
  return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
}

export function parseBdtopo(json: { features?: GeoJSON.Feature[] }): PlaceName[] {
  const out: PlaceName[] = [];
  for (const f of json.features ?? []) {
    const p = f.properties ?? {};
    const name = String(p.toponyme ?? '').trim();
    const at = pointOf(f.geometry);
    if (!name || !at) continue;
    out.push([name, String(p.nature ?? '').trim(), +at[0].toFixed(5), +at[1].toFixed(5)]);
  }
  return out;
}

export function overpassNamesQuery(b: Bbox): string {
  const bb = `(${b[1]},${b[0]},${b[3]},${b[2]})`;
  return `[out:json][timeout:60];(
nwr["natural"~"^(peak|volcano|saddle|ridge|arete|cliff|rock|stone|valley|gorge|spring|cave_entrance|glacier|cape|bay|beach|peninsula|plateau)$"]["name"]${bb};
nwr["mountain_pass"="yes"]["name"]${bb};
nwr["tourism"~"^(alpine_hut|wilderness_hut|viewpoint)$"]["name"]${bb};
nwr["waterway"="waterfall"]["name"]${bb};
nwr["water"~"^(lake|pond|reservoir)$"]["name"]${bb};
nwr["place"~"^(locality|hamlet|isolated_dwelling)$"]["name"]${bb};
);out center tags;`;
}

/** Nature en français, pour l'afficher sous le nom comme le fait la recherche en ligne. */
const OSM_NATURE: Record<string, string> = {
  peak: 'sommet', volcano: 'sommet', saddle: 'col', ridge: 'crête', arete: 'arête', cliff: 'falaise', rock: 'rocher',
  stone: 'rocher', valley: 'vallon', gorge: 'gorge', spring: 'source', cave_entrance: 'grotte', glacier: 'glacier',
  cape: 'cap', bay: 'calanque, baie', beach: 'plage', peninsula: 'presqu’île', plateau: 'plateau',
  alpine_hut: 'refuge', wilderness_hut: 'cabane', viewpoint: 'point de vue', waterfall: 'cascade',
  lake: 'lac', pond: 'étang', reservoir: 'lac', locality: 'lieu-dit', hamlet: 'hameau', isolated_dwelling: 'lieu-dit',
};

interface OsmEl { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }
export function parseOverpassNames(json: { elements?: OsmEl[] }): PlaceName[] {
  const out: PlaceName[] = [];
  for (const el of json.elements ?? []) {
    const t = el.tags ?? {};
    const name = (t['name:fr'] ?? t.name ?? '').trim();
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (!name || lat == null || lon == null) continue;
    const kind = t.mountain_pass === 'yes' && t.natural !== 'peak' ? 'saddle' : t.natural ?? t.tourism ?? t.waterway ?? t.water ?? t.place ?? '';
    out.push([name, OSM_NATURE[kind] ?? kind, +lon.toFixed(5), +lat.toFixed(5)]);
  }
  return out;
}

/** Mots en minuscules, sans accents ni apostrophes : « Pic de l'Aigle » → « pic de l aigle ». */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Petits mots qu'on ne tape pas toujours (« Le Dôme des Écrins » = « Dôme de Neige des Écrins »). */
const STOP = new Set(['le', 'la', 'les', 'l', 'de', 'des', 'du', 'd', 'au', 'aux', 'a', 'et', 'en', 'sur', 'sous']);
/** Mots qui comptent dans ce qu'on a tapé, sans les petits mots (sauf s'il n'y a qu'eux). */
export function keyWords(text: string): string[] {
  const all = normalize(text).split(' ').filter(Boolean);
  const kept = all.filter((w) => !STOP.has(w));
  return kept.length ? kept : all;
}

export function distM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const kx = 111_320 * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return Math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * 110_540);
}

/** Ajoute des noms sans doublons : même nom à moins de 300 m = même lieu, le premier gagne. */
export function mergeNames(into: PlaceName[], added: PlaceName[]): PlaceName[] {
  const byName = new Map<string, PlaceName[]>();
  for (const p of into) { const k = normalize(p[0]); byName.set(k, [...(byName.get(k) ?? []), p]); }
  const out = [...into];
  for (const p of added) {
    const k = normalize(p[0]);
    const same = byName.get(k) ?? [];
    if (same.some((q) => distM(p[2], p[3], q[2], q[3]) < SAME_PLACE_M)) continue;
    byName.set(k, [...same, p]);
    out.push(p);
  }
  return out;
}

/**
 * Cherche dans les noms gardés : chaque mot tapé doit commencer un mot du nom (« coup sab » trouve
 * « Pas du Coup de Sabre »). Les noms qui commencent par le texte tapé passent devant, puis les plus proches.
 */
export function searchNames(names: PlaceName[], text: string, near?: { lon: number; lat: number }, max = 30): Place[] {
  const q = normalize(text);
  const words = keyWords(text);
  if (!words.length) return [];
  const found: { p: PlaceName; starts: boolean; d: number }[] = [];
  for (const p of names) {
    const n = normalize(p[0]);
    const nw = n.split(' ');
    if (!words.every((w) => nw.some((x) => x.startsWith(w)))) continue;
    found.push({ p, starts: n.startsWith(q) || n.startsWith(words.join(' ')), d: near ? distM(near.lon, near.lat, p[2], p[3]) : 0 });
  }
  found.sort((a, b) => Number(b.starts) - Number(a.starts) || a.d - b.d);
  return found.slice(0, max).map(({ p }) => ({ label: p[0], detail: p[1].toLowerCase() || 'lieu', lon: p[2], lat: p[3], zoom: 15, local: true }));
}

const inside = (a: Bbox, b: Bbox) => a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];

let cache: Saved | null = null;
async function load(): Promise<Saved> {
  if (cache) return cache;
  try {
    const r = await Filesystem.readFile({ directory: Directory.Data, path: FILE, encoding: Encoding.UTF8 });
    cache = JSON.parse(r.data as string) as Saved;
  } catch {
    cache = { zones: [], names: [] };
  }
  return cache;
}

export async function localNames(): Promise<PlaceName[]> { return (await load()).names; }

/**
 * Télécharge les noms de lieux du rectangle (IGN puis OpenStreetMap) et les garde sur le téléphone.
 * Rien à faire si le rectangle est déjà couvert. Une source en panne n'empêche pas l'autre.
 */
export async function savePlaceNames(b: Bbox, signal?: AbortSignal): Promise<number> {
  const saved = await load();
  if (saved.zones.some((z) => inside(b, z))) return 0;
  const got: PlaceName[][] = [];
  let ok = 0;
  for (const layer of BDTOPO_LAYERS) {
    try {
      const res = await fetch(bdtopoUrl(layer, b), { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      got.push(parseBdtopo(await res.json()));
      ok++;
    } catch { if (signal?.aborted) throw new Error('arrêté'); }
  }
  const body = new URLSearchParams({ data: overpassNamesQuery(b) });
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, { method: 'POST', body, signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      got.push(parseOverpassNames(await res.json()));
      ok++;
      break;
    } catch { if (signal?.aborted) throw new Error('arrêté'); }
  }
  if (!ok) throw new Error('noms de lieux indisponibles (réseau ?)');
  const before = saved.names.length;
  let names = saved.names;
  for (const g of got) names = mergeNames(names, g);
  // Zone marquée couverte seulement si l'IGN et OSM ont tous deux répondu : sinon on réessaiera.
  const zones = ok === BDTOPO_LAYERS.length + 1 ? [...saved.zones.filter((z) => !inside(z, b)), b] : saved.zones;
  cache = { zones, names };
  await Filesystem.writeFile({ directory: Directory.Data, path: FILE, data: JSON.stringify(cache), encoding: Encoding.UTF8, recursive: true });
  return names.length - before;
}

/** « Effacer les cartes » efface aussi les noms. */
export async function clearPlaceNames() {
  cache = { zones: [], names: [] };
  await Filesystem.deleteFile({ directory: Directory.Data, path: FILE }).catch(() => {});
}
