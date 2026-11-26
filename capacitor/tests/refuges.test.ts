import { describe, expect, it } from 'vitest';
import { categorie, demandeRefuges } from '../src/search';
import { autour, fusionner, parseHebergementsOsm } from '../src/refuges';

describe('demandeRefuges', () => {
  it('reads the nature and the place', () => {
    expect(demandeRefuges('refuge')).toEqual({ nature: 'refuge', lieu: '' });
    expect(demandeRefuges('Refuges vers Chamonix')).toEqual({ nature: 'refuge', lieu: 'Chamonix' });
    expect(demandeRefuges('gîte autour de Ceillac')).toEqual({ nature: 'gite', lieu: 'Ceillac' });
    expect(demandeRefuges("gîtes d'étape à Briançon")).toEqual({ nature: 'gite', lieu: 'Briançon' });
    expect(demandeRefuges('cabane : Belledonne')).toEqual({ nature: 'cabane', lieu: 'Belledonne' });
  });
  it('auberges, hébergements, hôtels near a place', () => {
    expect(demandeRefuges('auberges près de Prapic')).toEqual({ nature: 'auberge', lieu: 'Prapic' });
    expect(demandeRefuges('hébergement près de Prapic')).toEqual({ nature: 'hebergement', lieu: 'Prapic' });
    expect(demandeRefuges('Hôtels autour de Briançon')).toEqual({ nature: 'hotel', lieu: 'Briançon' });
    expect(demandeRefuges('où dormir vers Orcières')).toEqual({ nature: 'hebergement', lieu: 'Orcières' });
  });
  it('ignores other searches', () => {
    expect(demandeRefuges('Chamonix')).toBeNull();
    expect(demandeRefuges('refugees')).toBeNull();
  });
});

describe('autour', () => {
  it('about 20 km wide box', () => {
    const b = autour({ lon: 6.87, lat: 45.92 });
    expect(b.n - b.s).toBeCloseTo(0.18, 2);
    expect(b.e - b.o).toBeGreaterThan(0.25);
  });
});

describe('categorie', () => {
  const p = (detail: string) => ({ label: 'x', detail, lon: 0, lat: 0, zoom: 15 });
  it('sorts places into the loupe categories', () => {
    expect(categorie(p('sommet'))).toBe('sommets');
    expect(categorie(p('Col'))).toBe('sommets');
    expect(categorie(p('refuge'))).toBe('refuges');
    expect(categorie(p('cabane'))).toBe('refuges');
    expect(categorie(p('commune'))).toBe('lieux');
    expect(categorie(p('rue'))).toBe('lieux');
    expect(categorie(p('collège'))).toBe('lieux');
    expect(categorie(p('auberge, restaurant'))).toBe('refuges');
    expect(categorie(p('hôtel'))).toBe('refuges');
  });
});

describe('hébergements OpenStreetMap', () => {
  const json: Parameters<typeof parseHebergementsOsm>[0] = { elements: [
    { type: 'node', id: 1, lat: 44.67, lon: 6.37, tags: { amenity: 'restaurant', name: 'Auberge La Jabiore', 'addr:city': 'Orcières' } },
    { type: 'way', id: 2, center: { lat: 44.68, lon: 6.38 }, tags: { tourism: 'hotel', name: 'Hôtel du Lac', website: 'https://lac.fr' } },
    { type: 'node', id: 3, lat: 44.7, lon: 6.4, tags: { tourism: 'alpine_hut', name: 'Refuge X' } },
  ] };
  it('keeps the natures asked for', () => {
    expect(parseHebergementsOsm(json, 'auberge').map((h) => [h.nom, h.type, h.adresse])).toEqual([['Auberge La Jabiore', 'auberge', 'Orcières']]);
    expect(parseHebergementsOsm(json, 'hotel')[0].url).toBe('https://lac.fr');
    expect(parseHebergementsOsm(json, 'hebergement')).toHaveLength(3);
  });
  it('merges the same place seen twice', () => {
    const osm = parseHebergementsOsm(json, 'refuge');
    expect(fusionner([[{ ...osm[0], nom: 'refuge x', lon: 6.4001 }], osm])).toHaveLength(1);
  });
});
