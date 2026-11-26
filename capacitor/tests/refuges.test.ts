import { describe, expect, it } from 'vitest';
import { categorie, demandeRefuges } from '../src/search';
import { autour } from '../src/refuges';

describe('demandeRefuges', () => {
  it('reads the nature and the place', () => {
    expect(demandeRefuges('refuge')).toEqual({ nature: 'refuge', lieu: '' });
    expect(demandeRefuges('Refuges vers Chamonix')).toEqual({ nature: 'refuge', lieu: 'Chamonix' });
    expect(demandeRefuges('gîte autour de Ceillac')).toEqual({ nature: 'gite', lieu: 'Ceillac' });
    expect(demandeRefuges("gîtes d'étape à Briançon")).toEqual({ nature: 'gite', lieu: 'Briançon' });
    expect(demandeRefuges('cabane : Belledonne')).toEqual({ nature: 'cabane', lieu: 'Belledonne' });
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
