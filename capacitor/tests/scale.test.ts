import { describe, expect, it } from 'vitest';
import { metersPerPx, niceScale, scaleLabel } from '../src/map/scale';

describe('barre d\'échelle', () => {
  it('donne des longueurs rondes 1, 2, 5 × 10^n', () => {
    expect(niceScale(10).meters).toBe(1000); // 110 px = 1,1 km → 1 km
    expect(niceScale(20).meters).toBe(2000); // 2,2 km → 2 km
    expect(niceScale(50).meters).toBe(5000); // 5,5 km → 5 km
    expect(niceScale(100).meters).toBe(10000); // 11 km → 10 km
    expect(niceScale(4).meters).toBe(200);
  });
  it('largeur en pixels cohérente', () => {
    const s = niceScale(20);
    expect(s.px).toBeCloseTo(100);
    expect(s.px).toBeLessThanOrEqual(110);
  });
  it('libellés en français', () => {
    expect(scaleLabel(500)).toBe('500 m');
    expect(scaleLabel(2000)).toBe('2 km');
    expect(scaleLabel(10000)).toBe('10 km');
  });
  it('mètres par pixel à l\'équateur, zoom 0', () => {
    expect(metersPerPx(0, 0)).toBeCloseTo(78271.5, 0);
  });
});
