import { describe, expect, it } from 'vitest';
import { coverageGeoJson } from '../src/tiles/coverage';

const z16Of = (x14: number, y14: number, n: number) => {
  const out: string[] = [];
  for (let i = 0; i < 16 && out.length < n; i++) out.push(`16/${x14 * 4 + (i % 4)}/${y14 * 4 + Math.floor(i / 4)}`);
  return out;
};

describe('carrés gardés hors ligne', () => {
  it('un carré compte quand au moins 12 de ses 16 tuiles détaillées sont là', () => {
    const c = coverageGeoJson([...z16Of(8448, 5888, 16), ...z16Of(8449, 5888, 11), '12/2112/1472']);
    expect(c.features).toHaveLength(1);
    const ring = (c.features[0].geometry as GeoJSON.Polygon).coordinates[0];
    expect(ring[0][0]).toBeCloseTo(5.625, 3);
    expect(ring[1][0]).toBeCloseTo(5.6470, 3);
  });

  it('les mêmes tuiles en SCAN 25 et en Plan IGN ne comptent qu’une fois', () => {
    const k = z16Of(8448, 5888, 8);
    expect(coverageGeoJson([...k, ...k]).features).toHaveLength(0);
  });
});
