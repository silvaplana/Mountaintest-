import { describe, expect, it } from 'vitest';
import { drawnTrail, lineLengthM, parseRoute, walkingHours, waypoints } from '../src/trails/route';

describe('tracé au doigt', () => {
  const line = Array.from({ length: 101 }, (_, i) => ({ lon: 5.6 + i * 0.0001, lat: 43.16 }));
  it('garde départ et arrivée, au plus 12 points de passage', () => {
    const w = waypoints(line);
    expect(w.length).toBeLessThanOrEqual(12);
    expect(w[0]).toBe(line[0]);
    expect(w[w.length - 1]).toBe(line[100]);
  });
  it('lit la géométrie de l’itinéraire IGN', () => {
    expect(parseRoute({ geometry: { coordinates: [[5.6, 43.1], [5.61, 43.11]] } })).toEqual([{ lon: 5.6, lat: 43.1 }, { lon: 5.61, lat: 43.11 }]);
    expect(() => parseRoute({})).toThrow();
  });
  it('fait un Trail mesuré et estime le temps de marche', () => {
    const t = drawnTrail(line, false);
    expect(t.id).toBeLessThan(0);
    expect(t.distanceM).toBeCloseTo(lineLengthM(line));
    expect(walkingHours(4000, 300, 0)).toBeCloseTo(2);
  });
});
