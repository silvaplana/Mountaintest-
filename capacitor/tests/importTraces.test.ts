import { describe, expect, it } from 'vitest';
import { addImported, type SavedTrace } from '../src/trails/savedTraces';

const ligne = [{ lon: 6.3, lat: 45.0 }, { lon: 6.31, lat: 45.01 }];

describe('📥 traces reprises de fichiers', () => {
  it('ajoute chaque fichier à Mes traces, avec un identifiant différent', () => {
    const r = addImported([], [{ name: 'Col', line: ligne }, { name: 'Lac', line: ligne }], 1000);
    expect(r.fresh).toBe(2);
    expect(r.all.map((t) => t.name).sort()).toEqual(['Col', 'Lac']);
    expect(new Set(r.all.map((t) => t.id)).size).toBe(2);
    expect(r.all.every((t) => t.fichier)).toBe(true);
  });

  it('ne double pas une trace déjà là (même nom, même forme)', () => {
    const deja: SavedTrace = { id: 5000, name: 'Col', onPaths: false, line: [[6.3, 45], [6.31, 45.01]] };
    const r = addImported([deja], [{ name: 'Col', line: ligne }, { name: 'Col', line: [ligne[1], ligne[0]] }], 1000);
    expect(r.fresh).toBe(1);
    expect(r.added[0]).toBe(deja);
    expect(r.added[1].id).toBeGreaterThan(5000);
  });
});
