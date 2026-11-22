import { describe, expect, it } from 'vitest';
import { junctionAlongs, junctionQueries, nextJunctionM, parseJunctions, simplify, usefulWay } from '../src/trails/junctions';

const p = (lon: number, lat: number) => ({ lon, lat });
const g = (lon: number, lat: number) => ({ lon, lat });

// Trace plein est le long de la latitude 43.2 ; 0.001° de longitude ≈ 81 m.
const line = [p(5.600, 43.2), p(5.605, 43.2)];

describe('carrefours de la trace', () => {
  it('trouve les embranchements sur la trace, ignore les allées privées et ce qui est loin', () => {
    const json = { elements: [
      // Chemin suivi par la trace : nœuds 1-2-3-4.
      { type: 'way', id: 10, tags: { highway: 'track' }, nodes: [1, 2, 3, 9, 4], geometry: [g(5.600, 43.2), g(5.601, 43.2), g(5.603, 43.2), g(5.604, 43.2), g(5.605, 43.2)] },
      // Embranchement vers le nord au nœud 2 : carrefour.
      { type: 'way', id: 11, tags: { highway: 'path' }, nodes: [2, 5], geometry: [g(5.601, 43.2), g(5.601, 43.202)] },
      // Allée privée au nœud 3 : pas un carrefour.
      { type: 'way', id: 12, tags: { highway: 'service', service: 'driveway' }, nodes: [3, 6], geometry: [g(5.603, 43.2), g(5.603, 43.201)] },
      // Croisement loin de la trace (nœud 5, 220 m au nord) : ignoré.
      { type: 'way', id: 13, tags: { highway: 'path' }, nodes: [7, 5, 8], geometry: [g(5.600, 43.202), g(5.601, 43.202), g(5.602, 43.202)] },
      // Croisement en X au nœud 9 (nœud partagé avec le chemin suivi).
      { type: 'way', id: 14, tags: { highway: 'residential' }, nodes: [20, 9, 21], geometry: [g(5.604, 43.199), g(5.604, 43.2), g(5.604, 43.201)] },
    ] };
    const j = parseJunctions(json, line);
    expect(j).toEqual([g(5.601, 43.2), g(5.604, 43.2)]);
  });

  it('regroupe deux carrefours à moins de 30 m', () => {
    const json = { elements: [
      { type: 'way', id: 1, tags: { highway: 'path' }, nodes: [1, 2, 3, 4], geometry: [g(5.600, 43.2), g(5.601, 43.2), g(5.6012, 43.2), g(5.605, 43.2)] },
      { type: 'way', id: 2, tags: { highway: 'path' }, nodes: [2, 5], geometry: [g(5.601, 43.2), g(5.601, 43.201)] },
      { type: 'way', id: 3, tags: { highway: 'path' }, nodes: [3, 6], geometry: [g(5.6012, 43.2), g(5.6012, 43.199)] },
    ] };
    expect(parseJunctions(json, line)).toHaveLength(1);
  });

  it('chemins utiles', () => {
    expect(usefulWay({ highway: 'path' })).toBe(true);
    expect(usefulWay({ highway: 'footway', footway: 'sidewalk' })).toBe(false);
    expect(usefulWay({ highway: 'construction' })).toBe(false);
    expect(usefulWay({ highway: 'track', access: 'private' })).toBe(false);
    expect(usefulWay({ building: 'yes' })).toBe(false);
  });

  it('simplifie la trace et découpe les requêtes Overpass', () => {
    const straight = Array.from({ length: 100 }, (_, i) => p(5.6 + i * 0.0001, 43.2));
    expect(simplify(straight)).toHaveLength(2);
    const zig = Array.from({ length: 1000 }, (_, i) => p(5.6 + i * 0.001, 43.2 + (i % 2) * 0.001));
    const qs = junctionQueries(zig);
    expect(qs.length).toBe(4);
    expect(qs[0]).toContain('way["highway"](around:25,43.20000,5.60000,43.20100,5.60100');
    expect(junctionQueries(line)).toHaveLength(1);
  });

  it('distance du prochain carrefour devant moi', () => {
    const alongs = junctionAlongs(line, [g(5.601, 43.2), g(5.604, 43.2)]);
    expect(alongs[0]).toBeCloseTo(81, 0);
    expect(nextJunctionM(alongs, 0)).toBeCloseTo(81, 0);
    expect(nextJunctionM(alongs, 85)).toBe(0); // juste passé : encore affiché à 0 m
    expect(nextJunctionM(alongs, 100)).toBeCloseTo(324 - 100, -1);
    expect(nextJunctionM(alongs, 400)).toBeNull();
  });
});
