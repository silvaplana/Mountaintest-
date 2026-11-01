import { describe, expect, it } from 'vitest';
import { essenceLabel, forestsGeoJson, forestZoneTooBig, groupByEssence, parseForests, polygonsAreaHa, wfsUrl } from '../src/forests/bdForet';

// Extrait de réponse réelle du WFS Géoplateforme (BD Forêt V2, près de La Ciotat), géométrie simplifiée.
const sq = (x: number, y: number, d: number) => [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]];
const sample = {
  type: 'FeatureCollection',
  features: [
    { id: 'formation_vegetale.1', geometry: { type: 'MultiPolygon', coordinates: [sq(5.6, 43.18, 0.01)] },
      properties: { id: 'F1', code_tfv: 'FF1-49-49', tfv: "Forêt fermée de pin d'Alep pur", tfv_g11: 'Forêt fermée conifères', essence: "Pin d'Alep" } },
    { id: 'formation_vegetale.2', geometry: { type: 'Polygon', coordinates: sq(5.62, 43.18, 0.005) },
      properties: { id: 'F2', tfv: "Forêt fermée de pin d'Alep pur", tfv_g11: 'Forêt fermée conifères', essence: "Pin d'Alep" } },
    { id: 'formation_vegetale.3', geometry: { type: 'MultiPolygon', coordinates: [sq(5.63, 43.19, 0.002)] },
      properties: { id: 'F3', tfv: 'Lande', tfv_g11: 'Lande', essence: 'NC' } },
    // Ordre lat/lon : doit être remis en lon/lat.
    { id: 'formation_vegetale.4', geometry: { type: 'MultiPolygon', coordinates: [[[[43.2, 5.6], [43.2, 5.61], [43.21, 5.61], [43.2, 5.6]]]] },
      properties: { id: 'F4', tfv: 'Forêt fermée de hêtre pur', essence: 'Hêtre' } },
    { id: 'formation_vegetale.5', geometry: null, properties: { essence: 'Hêtre' } },
  ],
};

describe('forêts par essence (BD Forêt IGN)', () => {
  it('construit la requête WFS en lat/lon', () => {
    const u = new URL(wfsUrl([5.55, 43.15, 5.66, 43.21]));
    expect(u.searchParams.get('TYPENAMES')).toBe('LANDCOVER.FORESTINVENTORY.V2:formation_vegetale');
    expect(u.searchParams.get('BBOX')).toBe('43.15000,5.55000,43.21000,5.66000,urn:ogc:def:crs:EPSG::4326');
  });

  it('limite la taille de la zone', () => {
    expect(forestZoneTooBig([5.5, 43.1, 5.65, 43.25])).toBe(false);
    expect(forestZoneTooBig([5.5, 43.1, 5.8, 43.25])).toBe(true);
  });

  it('remplace NC/NR par le type de formation', () => {
    expect(essenceLabel('NC', 'Lande', 'Lande')).toEqual({ label: 'Lande', tree: false });
    expect(essenceLabel('Hêtre', 'x', 'y')).toEqual({ label: 'Hêtre', tree: true });
    expect(essenceLabel('NR', '', '').label).toBe('Non renseigné');
  });

  it('lit les massifs, calcule les surfaces et regroupe par essence', () => {
    const f = parseForests(sample);
    expect(f.map((x) => x.essence)).toEqual(["Pin d'Alep", "Pin d'Alep", 'Lande', 'Hêtre']);
    // 0,01° x 0,01° à 43° N ≈ 814 m x 1105 m ≈ 90 ha
    expect(f[0].areaHa).toBeGreaterThan(85);
    expect(f[0].areaHa).toBeLessThan(95);
    expect(f[3].polygons[0][0][0]).toEqual([5.6, 43.2]);
    const g = groupByEssence(f);
    expect(g[0].essence).toBe("Pin d'Alep");
    expect(g[0].count).toBe(2);
    expect(g[0].color).toBe(f[0].color);
  });

  it('les trous sont retirés de la surface', () => {
    const outer = sq(0, 0, 0.01)[0] as [number, number][];
    const hole = sq(0.0025, 0.0025, 0.005)[0] as [number, number][];
    expect(polygonsAreaHa([[outer, hole]])).toBeCloseTo(polygonsAreaHa([[outer]]) * 0.75, 1);
  });

  it('ne dessine que les essences choisies', () => {
    const f = parseForests(sample);
    expect(forestsGeoJson(f, new Set()).features).toHaveLength(4);
    expect(forestsGeoJson(f, new Set(['Hêtre'])).features).toHaveLength(1);
  });
});
