import { afterEach, describe, expect, it, vi } from 'vitest';
import { bdtopoUrl, mergeNames, normalize, overpassNamesQuery, parseBdtopo, parseOverpassNames, searchNames, type PlaceName } from '../src/places/placeNames';
import { mergePlaces, parsePhoton, searchPlaces, searchPlacesWide } from '../src/search';
const mergeResults = (a: Parameters<typeof mergePlaces>[0][0], b: Parameters<typeof mergePlaces>[0][0]) => mergePlaces([a, b]);

const ciotat = { lon: 5.6, lat: 43.17 };

describe('noms de lieux hors ligne', () => {
  it('lit les noms de la BD TOPO (points et surfaces), sans les objets sans nom', () => {
    const names = parseBdtopo({ features: [
      { type: 'Feature', properties: { toponyme: "Bec de l'Aigle", nature: 'Pic' }, geometry: { type: 'Point', coordinates: [5.605625, 43.161201, 155] } },
      { type: 'Feature', properties: { toponyme: null, nature: 'Rochers' }, geometry: { type: 'Point', coordinates: [5.6, 43.1] } },
      { type: 'Feature', properties: { toponyme: 'Les Crêtes', nature: 'Lieu-dit habité' },
        geometry: { type: 'Polygon', coordinates: [[[5.6, 43.2], [5.62, 43.2], [5.62, 43.22], [5.6, 43.22]]] } },
    ] });
    expect(names).toEqual([["Bec de l'Aigle", 'Pic', 5.60562, 43.1612], ['Les Crêtes', 'Lieu-dit habité', 5.61, 43.21]]);
  });

  it('demande la BD TOPO en latitude puis longitude', () => {
    const u = new URL(bdtopoUrl('BDTOPO_V3:detail_orographique', [5.5, 43.1, 5.7, 43.3]));
    expect(u.searchParams.get('TYPENAMES')).toBe('BDTOPO_V3:detail_orographique');
    expect(u.searchParams.get('BBOX')).toBe('43.10000,5.50000,43.30000,5.70000,urn:ogc:def:crs:EPSG::4326');
  });

  it('lit les noms OpenStreetMap avec leur nature en français', () => {
    expect(overpassNamesQuery([5.5, 43.1, 5.7, 43.3])).toContain('(43.1,5.5,43.3,5.7)');
    const names = parseOverpassNames({ elements: [
      { lat: 43.2, lon: 5.65, tags: { natural: 'peak', name: 'Grande Tête' } },
      { lat: 45.9, lon: 6.8, tags: { natural: 'saddle', mountain_pass: 'yes', name: 'Col de Balme' } },
      { center: { lat: 43.21, lon: 5.51 }, tags: { natural: 'bay', name: 'Calanque de Sugiton' } },
      { lat: 43, lon: 5, tags: { natural: 'peak' } },
    ] });
    expect(names).toEqual([['Grande Tête', 'sommet', 5.65, 43.2], ['Col de Balme', 'col', 6.8, 45.9], ['Calanque de Sugiton', 'calanque, baie', 5.51, 43.21]]);
  });

  it('garde un seul exemplaire d’un même lieu venu de l’IGN et d’OSM', () => {
    const ign: PlaceName[] = [['Bec de l’Aigle', 'Pic', 5.6056, 43.1612]];
    const osm: PlaceName[] = [["Bec de l'Aigle", 'sommet', 5.6060, 43.1615], ["Bec de l'Aigle", 'sommet', 6.5, 44.5]];
    expect(mergeNames(ign, osm)).toEqual([ign[0], osm[1]]);
  });

  it('trouve un nom par le début de ses mots, sans accents, le plus proche en premier', () => {
    const names: PlaceName[] = [
      ['Pas du Coup de Sabre', 'Col', 5.55, 43.2],
      ['Coupe de Sabre', 'Lieu-dit non habité', 2.3, 48.8],
      ['Pic du Coup de Sabre', 'Pic', 5.56, 43.21],
      ['Crête de Bertagne', 'Crête', 5.7, 43.3],
    ];
    expect(normalize("Pic de l'Écureuil")).toBe('pic de l ecureuil');
    expect(searchNames(names, 'coup sab', ciotat).map((p) => p.label)).toEqual(['Pas du Coup de Sabre', 'Pic du Coup de Sabre', 'Coupe de Sabre']);
    expect(searchNames(names, 'pic du coup', ciotat)[0]).toMatchObject({ label: 'Pic du Coup de Sabre', detail: 'pic', zoom: 15, local: true });
    expect(searchNames(names, 'crete', ciotat).map((p) => p.label)).toEqual(['Crête de Bertagne']);
    expect(searchNames(names, 'zzz', ciotat)).toEqual([]);
  });

  it('ne répète pas en ligne un lieu déjà trouvé sur le téléphone', () => {
    const local = [{ label: "Bec de l'Aigle", detail: 'pic', lon: 5.6056, lat: 43.1612, zoom: 15, local: true }];
    const online = [
      { label: "Bec de l'Aigle, 13600 La Ciotat", detail: 'pic', lon: 5.605625, lat: 43.161201, zoom: 15 },
      { label: "Avenue du Bec de l'Aigle, 13600 La Ciotat", detail: 'rue', lon: 5.6, lat: 43.18, zoom: 16 },
    ];
    expect(mergeResults(local, online).map((p) => p.label)).toEqual(["Bec de l'Aigle", "Avenue du Bec de l'Aigle, 13600 La Ciotat"]);
  });
});

describe('recherche en ligne près de la carte', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('envoie le centre de la carte, et redemande sans si le service le refuse', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      urls.push(u);
      return urls.length === 1 ? new Response('', { status: 400 }) : new Response(JSON.stringify({ results: [] }));
    }));
    await searchPlaces('sabre', undefined, ciotat);
    expect(new URL(urls[0]).searchParams.get('lonlat')).toBe('5.60000,43.17000');
    expect(new URL(urls[1]).searchParams.has('lonlat')).toBe(false);
  });
});

describe('loupe : Le Dôme des Écrins (Seb, 25/11)', () => {
  afterEach(() => vi.unstubAllGlobals());
  const dome: PlaceName[] = [['Dôme de Neige des Écrins', 'Sommet', 6.3567, 44.9217], ['Les Écrins', 'Lieu-dit', 5.0, 45.0]];

  it('hors ligne : les petits mots tapés (le, des) ne gênent pas', () => {
    expect(searchNames(dome, 'Le Dome Des Ecrins', ciotat)[0].label).toBe('Dôme de Neige des Écrins');
  });

  it('garde de Photon les lieux naturels, pas les rues', () => {
    expect(parsePhoton({ features: [
      { geometry: { coordinates: [6.3567, 44.9217] }, properties: { name: 'Dôme de Neige des Écrins', osm_key: 'natural', osm_value: 'peak', state: 'Provence-Alpes-Côte d’Azur' } },
      { geometry: { coordinates: [6.3, 45] }, properties: { name: 'Col de la Temple', osm_key: 'mountain_pass', osm_value: 'yes' } },
      { geometry: { coordinates: [5, 45] }, properties: { name: 'Rue des Écrins', osm_key: 'highway', osm_value: 'residential' } },
    ] })).toEqual([
      { label: 'Dôme de Neige des Écrins, Provence-Alpes-Côte d’Azur', detail: 'sommet', lon: 6.3567, lat: 44.9217, zoom: 15 },
      { label: 'Col de la Temple', detail: 'col', lon: 6.3, lat: 45, zoom: 15 },
    ]);
  });

  it('sommets IGN puis OSM avant les adresses, sans doublons, jusqu’à 30', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      urls.push(u);
      const q = new URL(u).searchParams;
      if (u.includes('photon')) return new Response(JSON.stringify({ features: [
        { geometry: { coordinates: [6.3568, 44.9218] }, properties: { name: 'Dôme de Neige des Écrins', osm_key: 'natural', osm_value: 'peak' } },
        { geometry: { coordinates: [6.36, 44.92] }, properties: { name: 'Barre des Écrins', osm_key: 'natural', osm_value: 'peak' } },
      ] }));
      if (q.get('type') === 'PositionOfInterest') return new Response(JSON.stringify({ results: [
        { x: 6.3567, y: 44.9217, fulltext: 'Dôme de Neige des Écrins, 05340 Pelvoux', kind: 'sommet', poiType: ['sommet'] }] }));
      return new Response(JSON.stringify({ results: Array.from({ length: 40 }, (_, i) =>
        ({ x: 5 + i / 10, y: 45, fulltext: `Les Écrins ${i}, 26540 Mours`, kind: 'street', country: 'StreetAddress' })) }));
    }));
    const r = await searchPlacesWide('Le Dome Des Ecrins', undefined, ciotat);
    expect(r.slice(0, 3).map((p) => p.label)).toEqual(['Dôme de Neige des Écrins, 05340 Pelvoux', 'Barre des Écrins', 'Les Écrins 0, 26540 Mours']);
    expect(r).toHaveLength(30);
    const poi = urls.find((u) => u.includes('PositionOfInterest'))!;
    expect(new URL(poi).searchParams.get('text')).toBe('dome ecrins');
  });

  it('une source en panne n’empêche pas les autres', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u.includes('photon')
      ? new Response(JSON.stringify({ features: [{ geometry: { coordinates: [6.36, 44.92] }, properties: { name: 'Barre des Écrins', osm_key: 'natural', osm_value: 'peak' } }] }))
      : new Response('', { status: 500 }))));
    expect((await searchPlacesWide('barre ecrins')).map((p) => p.label)).toEqual(['Barre des Écrins']);
  });
});
