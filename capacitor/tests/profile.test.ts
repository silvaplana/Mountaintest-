import { describe, expect, it } from 'vitest';
import { buildProfile, formatSlope, nearestD, pointAt, slopeAt } from '../src/trails/profile';

// Ligne vers l'est, un point tous les ~8 m, qui monte de 10 % puis redescend de 20 %.
const seg = Array.from({ length: 201 }, (_, i) => ({ lon: 5.6 + i * 0.0001, lat: 43.16, ele: 0 as number | null }));
const step = 8.12; // ~ m par 0,0001° de longitude à 43° N
seg.forEach((p, i) => { p.ele = i <= 100 ? i * step * 0.1 : 100 * step * 0.1 - (i - 100) * step * 0.2; });

describe('pente', () => {
  const prof = buildProfile([seg]);
  it('mesure la pente moyenne sur 50 m', () => {
    expect(slopeAt(prof, 300).pct).toBeCloseTo(10, 0);
    expect(slopeAt(prof, 300).deg).toBeCloseTo(5.7, 0);
    expect(slopeAt(prof, 1200).pct).toBeCloseTo(-20, 0);
  });
  it('lisse un pic isolé du modèle de terrain', () => {
    const noisy = seg.map((p, i) => ({ ...p, ele: i === 40 ? (p.ele as number) + 4 : p.ele }));
    expect(Math.abs(slopeAt(buildProfile([noisy]), 40 * step).pct - 10)).toBeLessThan(3);
  });
  it('retrouve le point du tracé le plus proche', () => {
    const d = nearestD(prof, 5.6 + 50 * 0.0001, 43.1601);
    expect(d).toBeCloseTo(pointAt(prof, d).d);
    expect(Math.abs(d - 50 * step)).toBeLessThan(5);
    expect(formatSlope({ deg: 5.7, pct: 10 })).toBe('↗ 6° (10 %)');
  });
});
