// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { gainLoss, interpolate, parseElevations, sampleIndices, trailToGpx } from '../src/trails/elevation';
import { assemble, overpassQuery, parseOverpass, zoneTooBig } from '../src/trails/osmTrails';
import { parseGpx } from '../src/track/gpx';

const p = (lon: number, lat: number) => ({ lon, lat });

describe('randos OSM', () => {
  it('construit la requête Overpass (zone en S,O,N,E, géométrie sur la zone agrandie)', () => {
    const q = overpassQuery([5.55, 43.15, 5.65, 43.21]);
    expect(q).toContain('relation["type"="route"]["route"~"^(hiking|foot)$"](43.15000,5.55000,43.21000,5.65000)');
    expect(q).toContain('out tags geom(43.12000,5.50000,43.24000,5.70000)');
    expect(zoneTooBig([5, 43, 5.3, 43.3])).toBe(false);
    expect(zoneTooBig([5, 43, 5.6, 43.3])).toBe(true);
  });

  it('met les chemins bout à bout, retourne ceux à l’envers et coupe aux trous', () => {
    const a = [p(0, 0), p(0.001, 0)];
    const b = [p(0.002, 0), p(0.001, 0)]; // à l'envers
    const c = [p(0.002, 0), p(0.003, 0)];
    expect(assemble([a, b, c])).toEqual([[p(0, 0), p(0.001, 0), p(0.002, 0), p(0.003, 0)]]);
    // Premier chemin à l'envers : on le retourne pour raccorder le second.
    expect(assemble([[p(0.001, 0), p(0, 0)], [p(0.001, 0), p(0.002, 0)]])).toEqual([[p(0, 0), p(0.001, 0), p(0.002, 0)]]);
    // Point hors zone (null) : deux morceaux.
    expect(assemble([[p(0, 0), p(0.001, 0), null, p(0.005, 0), p(0.006, 0)]])).toHaveLength(2);
  });

  it('lit une réponse Overpass : nom, balisage, distance, tri GR avant PR', () => {
    const json = {
      elements: [
        { type: 'relation', id: 2, tags: { name: 'Boucle des Calanques', network: 'lwn' },
          members: [{ type: 'way', geometry: [p(5.6, 43.17), p(5.61, 43.17)] }, { type: 'node' }] },
        { type: 'relation', id: 1, tags: { name: 'Sentier du littoral', ref: 'GR 51', network: 'nwn' },
          members: [{ type: 'way', geometry: [p(5.6, 43.18), p(5.6, 43.19)] }] },
        { type: 'relation', id: 3, tags: { ref: 'PR 4' }, members: [] },
      ],
    };
    const t = parseOverpass(json);
    expect(t.map((x) => x.name)).toEqual(['GR 51 – Sentier du littoral', 'Boucle des Calanques']);
    expect(t[0].kind).toBe('GR');
    expect(t[1].distanceM).toBeGreaterThan(800);
    expect(t[1].distanceM).toBeLessThan(820);
  });

  it('échantillonne, interpole les altitudes et calcule D+ / D−', () => {
    const seg = Array.from({ length: 101 }, (_, i) => p(5.6 + i * 0.0001, 43.17)); // ~8 m entre points
    const idx = sampleIndices([seg], 800)[0];
    expect(idx[0]).toBe(0);
    expect(idx.at(-1)).toBe(100);
    expect(idx.length).toBeLessThan(60);
    const z = interpolate(seg, [0, 100], [100, 200]);
    expect(z[50]).toBeCloseTo(150, 0);
    expect(gainLoss([100, 102, 110, 104, 98, 120])).toEqual({ gain: 32, loss: 12 });
    expect(parseElevations({ elevations: [12.5, -99999, { z: 40 }] })).toEqual([12.5, null, 40]);
  });

  it('exporte un GPX relisible avec la licence OSM', () => {
    const [t] = parseOverpass({ elements: [{ type: 'relation', id: 9, tags: { name: 'A & B' }, members: [{ type: 'way', geometry: [p(5.6, 43.17), p(5.61, 43.17)] }] }] });
    const gpx = trailToGpx(t, [[{ ...p(5.6, 43.17), ele: 10 }, { ...p(5.61, 43.17), ele: null }]]);
    expect(gpx).toContain('openstreetmap.org/relation/9');
    expect(gpx).toContain('odbl');
    const back = parseGpx(gpx);
    expect(back.name).toBe('A & B');
    expect(back.points).toHaveLength(2);
    expect(back.points[0].ele).toBe(10);
  });
});

describe('randos trouvées par Claude', async () => {
  const { parseWebHikes, hikeDetail, webHikesGeoJson, costLine } = await import('../src/trails/webHikes');
  it('affiche le coût et les cumuls', () => {
    expect(costLine({ cout: 0.0834, mois: 0.4, total: 1.234 }, false)).toBe('Coût : 0,083 $ (ce mois-ci 0,40 $, total 1,23 $).');
    expect(costLine({ cout: 0, mois: 0.4, total: 1.234 }, true)).toContain('gratuit');
  });
  it('garde les randos avec coordonnées et lien web, et les met en points', () => {
    const h = parseWebHikes({ randos: [
      { nom: 'Bec de l’Aigle', lat: 43.165, lon: 5.61, url: 'https://www.visorando.com/x', site: 'Visorando', distance_km: 8.5, denivele_m: 320, resume: 'Boucle.' },
      { nom: 'Sans lien', lat: 43.1, lon: 5.6, url: 'javascript:alert(1)', site: 'X', distance_km: null, denivele_m: null, resume: '' },
    ] });
    expect(h).toHaveLength(1);
    expect(hikeDetail(h[0])).toBe('Visorando · 8,5 km · D+ 320 m');
    expect(webHikesGeoJson(h).features[0].geometry).toEqual({ type: 'Point', coordinates: [5.61, 43.165] });
  });
});
