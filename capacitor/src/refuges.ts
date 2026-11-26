// Loupe 🔍 « refuge », « gîte », « auberge », « hébergement près de Prapic »… : les hébergements autour d'un lieu (ou du
// centre de la carte), posés sur la carte comme ceux de la recherche d'hébergement. Deux sources gratuites, sans Claude :
// refuges.info (refuges, cabanes, gîtes d'étape, par le relais du VPS) et OpenStreetMap (Overpass : hôtels, gîtes, auberges…).
import { relayPost } from './travel/travel';
import { searchPlaces, type NatureRefuge } from './search';
import { normalize } from './places/placeNames';
import { OVERPASS_URLS } from './trails/osmTrails';
import { distanceM } from './gps/adaptive';
import type { PlacedLodging } from './Lodging';

/** Rectangle d'environ 2 × km autour du point. */
export function autour(c: { lon: number; lat: number }, km = 10) {
  const dLat = km / 111, dLon = km / (111 * Math.cos((c.lat * Math.PI) / 180));
  return { o: c.lon - dLon, s: c.lat - dLat, e: c.lon + dLon, n: c.lat + dLat };
}
type Cadre = ReturnType<typeof autour>;

/** Natures OpenStreetMap (tourism=…, ou restaurant dont le nom dit auberge) gardées pour chaque demande. */
const OSM: Record<NatureRefuge, string[]> = {
  refuge: ['alpine_hut', 'wilderness_hut'], cabane: ['wilderness_hut'], gite: ['guest_house', 'chalet', 'hostel'],
  auberge: ['hostel', 'guest_house', 'restaurant'], hotel: ['hotel', 'motel'],
  hebergement: ['alpine_hut', 'wilderness_hut', 'guest_house', 'chalet', 'hostel', 'restaurant', 'hotel', 'motel', 'apartment', 'camp_site'],
};
const NOM_OSM: Record<string, string> = {
  alpine_hut: 'refuge', wilderness_hut: 'cabane', guest_house: 'gîte, chambre d’hôtes', chalet: 'gîte', hostel: 'auberge',
  restaurant: 'auberge', hotel: 'hôtel', motel: 'hôtel', apartment: 'gîte', camp_site: 'camping',
};
/** Natures cherchées aussi sur refuges.info. */
const SUR_REFUGES_INFO: NatureRefuge[] = ['refuge', 'cabane', 'gite', 'hebergement'];

export function overpassHebergements(b: Cadre): string {
  const bb = `(${b.s.toFixed(4)},${b.o.toFixed(4)},${b.n.toFixed(4)},${b.e.toFixed(4)})`;
  return `[out:json][timeout:25];(nwr["tourism"~"^(hotel|guest_house|hostel|chalet|motel|alpine_hut|wilderness_hut|camp_site|apartment)$"]["name"]${bb};`
    + `nwr["amenity"="restaurant"]["name"~"auberge|refuge|g[iî]te",i]${bb};);out center tags 200;`;
}

interface OsmEl { type?: string; id?: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }
export function parseHebergementsOsm(json: { elements?: OsmEl[] }, nature: NatureRefuge): PlacedLodging[] {
  const out: PlacedLodging[] = [];
  for (const el of json.elements ?? []) {
    const t = el.tags ?? {}, quoi = t.tourism ?? (t.amenity === 'restaurant' ? 'restaurant' : '');
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (!t.name || lat == null || lon == null || !OSM[nature].includes(quoi)) continue;
    const adresse = [t['addr:street'] && `${t['addr:housenumber'] ?? ''} ${t['addr:street']}`.trim(), t['addr:city']].filter(Boolean).join(', ');
    out.push({ nom: t.name, type: NOM_OSM[quoi] ?? quoi, prix_nuit: null, adresse, lon, lat,
      url: t.website ?? t['contact:website'] ?? `https://www.openstreetmap.org/${el.type ?? 'node'}/${el.id}`,
      resume: [t.phone ?? t['contact:phone'], 'OpenStreetMap'].filter(Boolean).join(' · ') });
  }
  return out;
}

/** Même hébergement vu par les deux sources : même nom à moins de 300 m. */
export function fusionner(listes: PlacedLodging[][]): PlacedLodging[] {
  const out: PlacedLodging[] = [];
  for (const l of listes) for (const h of l) {
    if (!out.some((x) => normalize(x.nom) === normalize(h.nom) && distanceM(x, h) < 300)) out.push(h);
  }
  return out.slice(0, 80);
}

async function osm(b: Cadre, nature: NatureRefuge): Promise<PlacedLodging[]> {
  const body = new URLSearchParams({ data: overpassHebergements(b) });
  let last: unknown = null;
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, { method: 'POST', body, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseHebergementsOsm(await res.json(), nature);
    } catch (e) { last = e; }
  }
  throw last;
}

export async function chercherHebergements(d: { nature: NatureRefuge; lieu: string }, centre: { lon: number; lat: number }, password: string): Promise<PlacedLodging[]> {
  const ici = d.lieu.length >= 2 ? (await searchPlaces(d.lieu, AbortSignal.timeout(5000)).catch(() => []))[0] ?? centre : centre;
  const b = autour(ici);
  const asks: Promise<PlacedLodging[]>[] = [osm(b, d.nature)];
  if (SUR_REFUGES_INFO.includes(d.nature)) asks.unshift(relayPost<{ hebergements?: PlacedLodging[] }>('refuges', { ...b, nature: d.nature }, password).then((r) => r.hebergements ?? []));
  const got = await Promise.allSettled(asks);
  if (got.every((g) => g.status === 'rejected')) throw (got[0] as PromiseRejectedResult).reason;
  return fusionner(got.map((g) => (g.status === 'fulfilled' ? g.value : [])));
}
