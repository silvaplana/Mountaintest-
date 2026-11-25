import { afterEach, describe, expect, it, vi } from 'vitest';
import { bdtopoUrl, mergeNames, normalize, overpassNamesQuery, parseBdtopo, parseOverpassNames, searchNames, type PlaceName } from '../src/places/placeNames';
import { mergeResults } from '../src/SearchBar';
import { searchPlaces } from '../src/search';

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
