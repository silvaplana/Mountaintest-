import { describe, expect, it } from 'vitest';
import { kmTick, profileScale, PROFILE_EXAG, PROFILE_H_MAX, PROFILE_H_MIN, formatSlope } from '../src/trails/profile';
import { sharePct, wayRunLines, wayRuns, wayTotals, wayType } from '../src/trails/wayTypes';
import { overpassQuery, parseOverpass } from '../src/trails/osmTrails';
import { bikeHours } from '../src/trails/route';

describe('profil à échelle fixe', () => {
  it('garde le même rapport hauteur / distance quelle que soit la trace', () => {
    for (const [total, dz] of [[10000, 800], [3000, 1000], [40000, 500], [2000, 60]]) {
      const sc = profileScale(total, dz, 300);
      expect(sc.vPxPerM / sc.s).toBe(PROFILE_EXAG);
    }
  });
  it('rando de 10 km et 800 m : tient dans l’écran', () => {
    const sc = profileScale(10000, 800, 300);
    expect(sc.contentW).toBeCloseTo(300);
    expect(sc.plotH).toBeLessThanOrEqual(PROFILE_H_MAX);
  });
  it('VTT long et plat : défile de côté', () => {
    const sc = profileScale(40000, 500, 300);
    expect(sc.contentW).toBeGreaterThan(300);
    expect(sc.plotH).toBeGreaterThanOrEqual(PROFILE_H_MIN);
  });
  it('montée très raide : moins large que l’écran, hauteur plafonnée', () => {
    const sc = profileScale(3000, 1000, 300);
    expect(sc.contentW).toBeLessThan(300);
    expect(sc.plotH).toBe(PROFILE_H_MAX);
  });
  it('graduations espacées d’au moins 45 px', () => {
    expect(kmTick(0.3)).toBe(0.2);
    expect(kmTick(0.03)).toBe(2);
  });
});

describe('🚵 mode VTT', () => {
  it('pente en % d’abord', () => {
    expect(formatSlope({ deg: 5.7, pct: 10 }, true)).toBe('↗ 10 % (6°)');
    expect(formatSlope({ deg: 5.7, pct: 10 })).toBe('↗ 6° (10 %)');
  });
  it('durée à vélo', () => { expect(bikeHours(30000, 600)).toBeCloseTo(3); });
  it('cherche les circuits VTT', () => {
    expect(overpassQuery([5, 43, 5.1, 43.1], true)).toContain('"^(mtb)$"');
    const t = parseOverpass({ elements: [{ type: 'relation', id: 1, tags: { name: 'Boucle' }, members: [{ type: 'way', geometry: [{ lon: 5, lat: 43 }, { lon: 5.01, lat: 43 }] }] }] }, true);
    expect(t[0].kind).toBe('Circuit VTT');
  });
});

describe('types de chemin', () => {
  it('catégories du SCAN 25 d’après OSM', () => {
    expect(wayType({ highway: 'tertiary' })).toBe('route');
    expect(wayType({ highway: 'unclassified', surface: 'gravel' })).toBe('empierree');
    expect(wayType({ highway: 'track', tracktype: 'grade2' })).toBe('empierree');
    expect(wayType({ highway: 'track' })).toBe('chemin');
    expect(wayType({ highway: 'path' })).toBe('sentier');
    expect(wayType({ highway: 'path', 'mtb:scale': '3' })).toBe('technique');
    expect(wayType({ highway: 'cycleway' })).toBe('velo');
  });

  // Trace est-ouest de 1 km : 600 m de route puis 400 m de sentier sur GR ; une route nord-sud la croise à 300 m.
  const lat = 43.2, m = 1 / (111_320 * Math.cos((lat * Math.PI) / 180));
  const P = (xm: number, dy = 0) => ({ lon: 5 + xm * m, lat: lat + dy / 111_320 });
  const line = [P(0), P(1000)];
  const json = { elements: [
    { type: 'way', id: 1, tags: { highway: 'residential' }, geometry: [P(0, 3), P(600, 3)] },
    { type: 'way', id: 2, tags: { highway: 'path' }, geometry: [P(600, -2), P(1000, -2)] },
    { type: 'way', id: 3, tags: { highway: 'primary' }, geometry: [P(300, -200), P(300, 200)] },
    { type: 'relation', id: 9, tags: { network: 'nwn' }, members: [{ type: 'way', ref: 2 }] },
  ] };
  const runs = wayRuns(json, line);
  it('découpe la trace par type, sans le croisement de route', () => {
    expect(runs.map((r) => r.type)).toEqual(['route', 'sentier']);
    expect(runs[0].to).toBeGreaterThan(580);
    expect(runs[0].to).toBeLessThan(620);
    expect(runs[1].gr).toBe(true);
  });
  it('bilan en % et km', () => {
    const t = wayTotals(runs);
    expect(sharePct(t.byType.route, t.total)).toBe('60 %');
    expect(sharePct(t.gr, t.total)).toBe('40 %');
  });
  it('bouts de trait pour la carte', () => {
    const l = wayRunLines(line, runs);
    expect(l).toHaveLength(2);
    expect(l[1].gr).toBe(true);
    expect(l[1].coords[l[1].coords.length - 1][0]).toBeCloseTo(line[1].lon, 6);
  });
  it('hors chemin connu loin de tout', () => {
    expect(wayRuns({ elements: [] }, line)).toEqual([{ from: 0, to: expect.any(Number), type: 'inconnu', gr: false }]);
  });
});
