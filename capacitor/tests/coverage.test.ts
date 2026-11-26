import { describe, expect, it } from 'vitest';
import { coverageGeoJson, offlineVeil } from '../src/tiles/coverage';

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

describe('calque Hors ligne : voile et bord', () => {
  const sq = (cells: [number, number][]) => cells.flatMap(([x, y]) => z16Of(8448 + x, 5888 + y, 16));
  const lines = (fc: GeoJSON.FeatureCollection) => fc.features.map((f) => (f.geometry as GeoJSON.LineString).coordinates);

  it('deux carrés côte à côte : un seul bord, rectangle de 4 sommets, troué dans le voile', () => {
    const { veil, edge } = offlineVeil(sq([[0, 0], [1, 0]]));
    expect(lines(edge)).toHaveLength(1);
    expect(lines(edge)[0]).toHaveLength(5);
    const poly = (veil.features[0].geometry as GeoJSON.Polygon).coordinates;
    expect(poly).toHaveLength(2);
    expect(veil.features).toHaveLength(1);
  });

  it('un carré manquant au milieu de 8 carrés gardés reste voilé', () => {
    const ring: [number, number][] = [];
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) if (x !== 1 || y !== 1) ring.push([x, y]);
    const { veil, edge } = offlineVeil(sq(ring));
    expect(lines(edge)).toHaveLength(2);
    expect(veil.features).toHaveLength(2);
    expect((veil.features[0].geometry as GeoJSON.Polygon).coordinates).toHaveLength(2);
  });

  it('deux carrés qui ne se touchent que par un coin : deux bords séparés', () => {
    const { edge } = offlineVeil(sq([[0, 0], [1, 1]]));
    expect(lines(edge)).toHaveLength(2);
    for (const l of lines(edge)) expect(l).toHaveLength(5);
  });

  it('rien de gardé : tout est voilé, aucun bord', () => {
    const { veil, edge } = offlineVeil([]);
    expect(edge.features).toHaveLength(0);
    expect((veil.features[0].geometry as GeoJSON.Polygon).coordinates).toHaveLength(1);
  });
});
