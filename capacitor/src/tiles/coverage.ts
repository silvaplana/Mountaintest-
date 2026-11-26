// « Hors ligne » : les carrés déjà gardés sur le téléphone, colorés en vert sur la carte (Seb, 26/11).
// Un carré = une tuile du zoom 14 (environ 1,7 km dans les Alpes) ; il compte comme gardé quand au moins
// 12 de ses 16 tuiles du zoom 16 (le plus détaillé téléchargé) sont là, que ce soit SCAN 25 ou Plan IGN.
export const COVER_ZOOM = 14;
export const DETAIL_ZOOM = 16;
const MIN_TILES = 12;

const tileLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const tileLat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

/** keys : « z/x/y » des tuiles gardées, toutes couches confondues. */
export function coverageGeoJson(keys: Iterable<string>): GeoJSON.FeatureCollection {
  const shift = DETAIL_ZOOM - COVER_ZOOM;
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (const k of keys) {
    const [z, x, y] = k.split('/').map(Number);
    if (z !== DETAIL_ZOOM || seen.has(k)) continue;
    seen.add(k);
    const p = `${x >> shift}/${y >> shift}`;
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const features: GeoJSON.Feature[] = [];
  for (const [p, n] of counts) {
    if (n < MIN_TILES) continue;
    const [x, y] = p.split('/').map(Number);
    const w = tileLon(x, COVER_ZOOM), e = tileLon(x + 1, COVER_ZOOM), nl = tileLat(y, COVER_ZOOM), s = tileLat(y + 1, COVER_ZOOM);
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[w, nl], [e, nl], [e, s], [w, s], [w, nl]]] } });
  }
  return { type: 'FeatureCollection', features };
}
