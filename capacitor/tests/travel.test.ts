import { describe, expect, it } from 'vitest';
import { dedupe, formatDuration, motorways, parseRoute } from '../src/travel/travel';

const ign = (km: number, min: number, steps: { a: Record<string, string>; d: number }[]) => ({
  distance: km * 1000, duration: min * 60, geometry: { coordinates: [[5.6, 43.17], [5.37, 43.3]] as [number, number][] },
  portions: [{ steps: steps.map((s) => ({ attributes: s.a, distance: s.d })) }],
});

describe('voyage', () => {
  it('compte les km par autoroute', () => {
    const r = ign(40, 35, [
      { a: { cpx_classement_administratif: 'Autoroute', cpx_numero: 'A50', nature: 'Type autoroutier' }, d: 12000 },
      { a: { cpx_classement_administratif: 'Autoroute', cpx_numero: 'A50', nature: 'Type autoroutier' }, d: 3000 },
      { a: { cpx_classement_administratif: 'Départementale', cpx_numero: 'D559', nature: 'Route à 1 chaussée' }, d: 9000 },
    ]);
    expect(motorways(r)).toEqual([{ numero: 'A50', km: 15 }]);
  });
  it('fusionne les variantes identiques et donne une couleur à chacune', () => {
    const a = parseRoute(ign(40, 35, []), 'Le plus rapide');
    const b = parseRoute(ign(40.2, 35.3, []), 'Le plus court');
    const c = parseRoute(ign(36, 52, []), 'Sans autoroute');
    const d = dedupe([a, b, c]);
    expect(d.map((r) => r.name)).toEqual(['Le plus rapide', 'Sans autoroute']);
    expect(d[0].color).not.toBe(d[1].color);
  });
  it('écrit les durées', () => {
    expect(formatDuration(35)).toBe('35 min');
    expect(formatDuration(125)).toBe('2 h 05');
  });
});
