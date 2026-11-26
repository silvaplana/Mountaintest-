import { distM, keyWords, normalize } from './places/placeNames';
// Recherche de lieux : service d'autocomplétion de la Géoplateforme IGN (gratuit, sans clé).
// Communes, départements, régions, sommets, lieux-dits, adresses… (même service côté Kotlin, Search.kt).

export interface Place { label: string; detail: string; lon: number; lat: number; zoom: number; /** Trouvé dans les noms gardés sur le téléphone. */ local?: boolean }

const URL_COMPLETION = 'https://data.geopf.fr/geocodage/completion/';
/** Photon : recherche dans OpenStreetMap (gratuite, sans clé, © contributeurs OpenStreetMap). */
const URL_PHOTON = 'https://photon.komoot.io/api/';

interface CompletionResult {
  x: number; y: number; fulltext: string; kind?: string; poiType?: string[] | string; country?: string;
}

/** Zoom adapté au type de lieu : un département se voit en entier, un sommet de près. */
export function zoomFor(kind: string, poiTypes: string[]): number {
  const t = [kind, ...poiTypes].map((s) => s.toLowerCase());
  if (t.includes('région')) return 7;
  if (t.includes('département')) return 9;
  if (t.includes('commune')) return 13;
  if (t.some((s) => s === 'street' || s === 'housenumber')) return 16;
  return 15;
}

export function parseCompletion(json: { results?: CompletionResult[] }): Place[] {
  return (json.results ?? [])
    .filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y))
    .map((r) => {
      const poi = Array.isArray(r.poiType) ? r.poiType : r.poiType ? [r.poiType] : [];
      const kind = r.kind ?? '';
      // poiType va du plus précis au plus général, sauf pour l'administratif (« administratif, département »).
      const detail = (poi[0] === 'administratif' ? poi[1] : poi[0]) ?? (r.country === 'StreetAddress' ? 'adresse' : kind);
      return { label: r.fulltext, detail: detail === 'street' ? 'rue' : detail, lon: r.x, lat: r.y, zoom: zoomFor(kind, poi) };
    });
}

/**
 * near : centre de la carte, pour que les lieux proches sortent en premier (paramètre lonlat du service).
 * Si le service refuse ce paramètre, on redemande sans, pour ne jamais casser la recherche.
 */
export async function searchPlaces(text: string, signal?: AbortSignal, near?: { lon: number; lat: number }): Promise<Place[]> {
  const q = new URLSearchParams({ text, maximumResponses: '8' });
  if (near) q.set('lonlat', `${near.lon.toFixed(5)},${near.lat.toFixed(5)}`);
  let res = await fetch(`${URL_COMPLETION}?${q}`, { signal });
  if (near && res.status === 400) { q.delete('lonlat'); res = await fetch(`${URL_COMPLETION}?${q}`, { signal }); }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseCompletion(await res.json());
}

// ——— Loupe 🔍 : plus de résultats, sommets et lieux naturels d'abord (Seb, 25/11) ———

/** Natures OpenStreetMap gardées dans la loupe : lieux naturels et lieux isolés, pas les commerces. */
const PHOTON_KEEP: Record<string, string[] | true> = {
  natural: true, mountain_pass: true, waterway: ['waterfall'], water: true,
  tourism: ['alpine_hut', 'wilderness_hut', 'viewpoint', 'hotel', 'guest_house', 'hostel', 'chalet', 'motel', 'camp_site', 'apartment'],
  place: ['locality', 'hamlet', 'isolated_dwelling', 'village'],
  // Une auberge est souvent notée « restaurant » dans OpenStreetMap (Auberge La Jabiore, Seb 26/11) : gardée si son nom le dit.
  amenity: ['restaurant'],
};
/** Restaurants gardés seulement si leur nom dit qu'on peut y dormir. */
const NOM_HEBERGEMENT = /auberge|refuge|g[iî]te|chalet|h[oô]tel/i;
const PHOTON_NATURE: Record<string, string> = {
  peak: 'sommet', volcano: 'sommet', saddle: 'col', ridge: 'crête', arete: 'arête', cliff: 'falaise', rock: 'rocher',
  valley: 'vallon', gorge: 'gorge', spring: 'source', cave_entrance: 'grotte', glacier: 'glacier', cape: 'cap',
  bay: 'calanque, baie', beach: 'plage', alpine_hut: 'refuge', wilderness_hut: 'cabane', viewpoint: 'point de vue',
  waterfall: 'cascade', lake: 'lac', locality: 'lieu-dit', hamlet: 'hameau', isolated_dwelling: 'lieu-dit', village: 'village',
  hotel: 'hôtel', guest_house: 'gîte, chambre d’hôtes', hostel: 'auberge', chalet: 'gîte', motel: 'hôtel', camp_site: 'camping',
  apartment: 'gîte', restaurant: 'auberge, restaurant',
};
interface PhotonFeature { geometry?: { coordinates?: number[] }; properties?: Record<string, string | undefined> }

export function parsePhoton(json: { features?: PhotonFeature[] }): Place[] {
  const out: Place[] = [];
  for (const f of json.features ?? []) {
    const p = f.properties ?? {};
    const c = f.geometry?.coordinates;
    const keep = PHOTON_KEEP[p.osm_key ?? ''];
    if (!p.name || !c || !keep || (keep !== true && !keep.includes(p.osm_value ?? ''))) continue;
    if (p.osm_key === 'amenity' && !NOM_HEBERGEMENT.test(p.name)) continue;
    const where = p.city ?? p.county ?? p.state;
    const nature = p.osm_key === 'mountain_pass' ? 'col' : PHOTON_NATURE[p.osm_value ?? ''] ?? p.osm_value ?? 'lieu';
    out.push({ label: where ? `${p.name}, ${where}` : p.name, detail: nature, lon: c[0], lat: c[1], zoom: 15 });
  }
  return out;
}

const firstPart = (label: string) => normalize(label.split(',')[0]);
/** Même lieu : même nom (l'un commence par l'autre) à moins de 500 m. */
export function samePlace(a: Place, b: Place): boolean {
  const x = firstPart(a.label), y = firstPart(b.label);
  return (x.startsWith(y) || y.startsWith(x)) && distM(a.lon, a.lat, b.lon, b.lat) < 500;
}
/** Listes mises bout à bout, dans l'ordre, sans redire un lieu déjà là. */
export function mergePlaces(lists: Place[][], max = 30): Place[] {
  const out: Place[] = [];
  for (const l of lists) for (const p of l) if (!out.some((q) => samePlace(q, p))) out.push(p);
  return out.slice(0, max);
}

async function completion(params: Record<string, string>, signal?: AbortSignal): Promise<Place[]> {
  const q = new URLSearchParams(params);
  let res = await fetch(`${URL_COMPLETION}?${q}`, { signal });
  if (res.status === 400) {
    // Paramètre refusé (lonlat, nombre de réponses…) : on redemande au plus simple pour ne jamais casser la loupe.
    q.delete('lonlat'); q.set('maximumResponses', '10');
    res = await fetch(`${URL_COMPLETION}?${q}`, { signal });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseCompletion(await res.json());
}

/**
 * Recherche de la loupe, trois demandes en même temps :
 * 1. IGN, lieux seulement (sommets, cols, lieux-dits…), avec les mots qui comptent (« dome ecrins ») ;
 * 2. OpenStreetMap (Photon), lieux naturels seulement, pour ce que l'IGN ne trouve pas ;
 * 3. IGN, tout (communes, adresses), le texte tel quel.
 * Résultats dans cet ordre, sans doublons, 30 au plus. Une source en panne n'empêche pas les autres.
 */
export async function searchPlacesWide(text: string, signal?: AbortSignal, near?: { lon: number; lat: number }): Promise<Place[]> {
  const words = keyWords(text).join(' ');
  const lonlat: Record<string, string> = near ? { lonlat: `${near.lon.toFixed(5)},${near.lat.toFixed(5)}` } : {};
  const photon = new URLSearchParams({ q: words, lang: 'fr', limit: '15', ...(near ? { lat: near.lat.toFixed(4), lon: near.lon.toFixed(4) } : {}) });
  const asks: Promise<Place[]>[] = [
    completion({ text: words, type: 'PositionOfInterest', maximumResponses: '15', ...lonlat }, signal),
    fetch(`${URL_PHOTON}?${photon}`, { signal }).then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return parsePhoton(await r.json()); }),
    completion({ text, maximumResponses: '15', ...lonlat }, signal),
  ];
  const got = await Promise.allSettled(asks);
  if (got.every((g) => g.status === 'rejected')) throw (got[0] as PromiseRejectedResult).reason;
  return mergePlaces(got.map((g) => (g.status === 'fulfilled' ? g.value : [])));
}

// ——— Loupe 🔍 « refuge », « gîte », « cabane » (+ un lieu) : refuges.info sur la carte (Seb, 26/11) ———

export type NatureRefuge = 'refuge' | 'cabane' | 'gite';

/** « refuges vers Chamonix » → { nature: 'refuge', lieu: 'Chamonix' } ; « refuge » seul → lieu vide (autour de la carte). */
export function demandeRefuges(text: string): { nature: NatureRefuge; lieu: string } | null {
  const m = /^\s*(refuges?|cabanes?|g[iî]tes?(?: d['’]étapes?)?)\b(.*)$/i.exec(text);
  if (!m) return null;
  const mot = normalize(m[1]);
  const nature: NatureRefuge = mot.startsWith('cabane') ? 'cabane' : mot.startsWith('gite') ? 'gite' : 'refuge';
  const lieu = m[2].replace(/^[\s:,]*(?:(?:autour|pr[eè]s)\s+(?:de|du|des|d['’])|vers|à|a|au|aux|dans\s+(?:le|la|les)|de\s+la|du|des|de|d['’])?\s*/i, '').trim();
  return { nature, lieu };
}

// ——— Loupe rangée par catégories (Seb, 26/11 : « c'est fourre-tout ») ———

export type Categorie = 'courses' | 'sommets' | 'refuges' | 'lieux';

/** Catégorie d'un lieu trouvé, d'après sa nature (IGN, OpenStreetMap ou noms gardés sur le téléphone). */
export function categorie(p: Place): Exclude<Categorie, 'courses'> {
  const d = normalize(p.detail);
  if (/refuge|cabane|gite|abri|bivouac|chalet|auberge|hotel|chambre d hotes|camping/.test(d)) return 'refuges';
  if (/sommet|col\b|cret|arete|pic\b|aiguille|glacier|falaise|rocher|dome|pointe|montagne|orograph|massif|vallon|gorge|grotte|cascade|lac\b|source|point de vue/.test(d)) return 'sommets';
  return 'lieux';
}
