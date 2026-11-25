import { describe, expect, it } from 'vitest';
import { decodeShown, encodeShown } from '../src/trails/shownTraces';
import type { Trail } from '../src/trails/osmTrails';

const mine: Trail = { id: -2, name: 'Vélo', kind: 'Fichier', rank: 0, color: '#e6007e', segments: [[{ lon: 5.6, lat: 43.2 }, { lon: 5.61, lat: 43.2 }]], distanceM: 811, onPaths: false, savedId: 12 };
const osm: Trail = { ...mine, id: 123, name: 'GR 98' };

describe('traces gardées à la fermeture', () => {
  it('garde mes traces et le suivi, pas les randos OSM', () => {
    const st = decodeShown(encodeShown([mine, osm], -2, true));
    expect(st.trails.map((t) => t.id)).toEqual([-2]);
    expect(st.trails[0]).toMatchObject({ name: 'Vélo', color: '#e6007e', savedId: 12 });
    expect(st.trails[0].distanceM).toBeCloseTo(811, -1);
    expect(st.navId).toBe(-2);
    expect(st.navPaused).toBe(true);
  });
  it('garde les points piqués 📍 et leur mot', () => {
    const pins = [{ lon: 5.605, lat: 43.2, txt: 'Source', vu: true }, { lon: 5.606, lat: 43.2, txt: '', vu: false }];
    const st = decodeShown(encodeShown([{ ...mine, pins }], null, false));
    expect(st.trails[0].pins).toEqual(pins);
    expect(decodeShown(encodeShown([mine], null, false)).trails[0].pins).toEqual([]);
  });
  it('oublie un suivi dont la trace a disparu, et résiste aux données abîmées', () => {
    expect(decodeShown(encodeShown([mine], -5, false)).navId).toBeNull();
    expect(decodeShown('{pas du json').trails).toEqual([]);
    expect(decodeShown(null).navId).toBeNull();
  });
});
