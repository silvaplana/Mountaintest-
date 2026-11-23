import { describe, expect, it } from 'vitest';
import { byDistance, formatDurations, fromMercator, parseLine, parseRoute, parseSheet, plainText, routesUrl, toMercator } from '../src/topos/c2c';

describe('Camptocamp', () => {
  it('Web Mercator aller-retour', () => {
    const [x, y] = toMercator(5.6, 43.2);
    const p = fromMercator(x, y);
    expect(p.lon).toBeCloseTo(5.6, 6);
    expect(p.lat).toBeCloseTo(43.2, 6);
  });
  it('liste : cadre en mètres, activité, toutes dates', () => {
    const u = routesUrl([5.5, 43.1, 5.7, 43.3], 'hiking');
    expect(u).toContain('act=hiking');
    expect(u).toMatch(/bbox=612\d{3},53\d{5},634\d{3},53\d{5}/);
    expect(u).not.toContain('date');
  });
  const [x, y] = toMercator(5.6, 43.2);
  const doc = {
    document_id: 42,
    locales: [{ lang: 'fr', title_prefix: 'Calanques', title: 'Tour du Cap Canaille', summary: 'Belle **boucle** [[routes/1|ici]]' }],
    geometry: { geom: JSON.stringify({ type: 'Point', coordinates: [x, y] }),
      geom_detail: JSON.stringify({ type: 'LineString', coordinates: [[x, y], [x + 1000, y]] }) },
    hiking_rating: 'T2', height_diff_up: 450, elevation_max: 394, route_length: 9000, durations: ['1'],
  };
  it('itinéraire', () => {
    const r = parseRoute(doc)!;
    expect(r.title).toBe('Calanques : Tour du Cap Canaille');
    expect(r.rating).toBe('T2');
    expect(r.summary).toBe('Belle boucle ici');
    expect(r.lon).toBeCloseTo(5.6, 5);
    expect(parseRoute({ ...doc, hiking_rating: null, mtb_up_rating: 'M2', mtb_down_rating: 'V3' })!.rating).toBe('M2 / V3');
  });
  it('fiche avec tracé', () => {
    const s = parseSheet(doc)!;
    expect(s.line).toHaveLength(2);
    expect(parseLine(JSON.stringify({ type: 'MultiLineString', coordinates: [[[x, y], [x, y + 10]], [[x, y + 20], [x, y + 30]]] }))).toHaveLength(4);
  });
  it('du plus proche au plus loin', () => {
    const a = parseRoute(doc)!, b = { ...a, id: 2, lat: 43.5 };
    expect(byDistance([b, a], { lon: 5.6, lat: 43.21 }).map((x) => x.r.id)).toEqual([42, 2]);
  });
  it('textes', () => {
    expect(plainText('## Accès\r\n[b]Parking[/b]')).toBe('Accès\nParking');
    expect(formatDurations(['1', '2'])).toBe('1 à 2 jours');
  });
});
