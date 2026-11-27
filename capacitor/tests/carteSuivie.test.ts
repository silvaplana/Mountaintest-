import { describe, expect, it } from 'vitest';
import { tracesAEnvoyer, tracesAMontrer, tracesInvitees } from '../src/buddies/carteSuivie';
import type { Trail } from '../src/trails/osmTrails';

const trace = (id: number, n: number): Trail => ({
  id, name: `T${id}`, kind: '', rank: 0, color: '#e8590c', distanceM: 0,
  segments: [Array.from({ length: n }, (_, i) => ({ lon: 5.6 + i * 1e-4, lat: 43.2 }))],
});

describe('Suis ma carte : traces envoyées', () => {
  it('allège les longues traces sous la limite et garde le dernier point', () => {
    const [t] = tracesAEnvoyer([trace(-1, 5000)]);
    expect(t.ligne.length).toBeLessThanOrEqual(501);
    expect(t.ligne[t.ligne.length - 1]).toEqual([+(5.6 + 4999e-4).toFixed(5), 43.2]);
    expect(JSON.stringify({ traces: [t] }).length).toBeLessThan(15000);
  });
  it('laisse les petites traces entières', () => {
    expect(tracesAEnvoyer([trace(-1, 10)])[0].ligne).toHaveLength(10);
  });
  it('partage la limite entre plusieurs traces', () => {
    const ts = tracesAEnvoyer([trace(-1, 3000), trace(-2, 3000), trace(-3, 3000), trace(-4, 3000)]);
    expect(ts.reduce((n, t) => n + t.ligne.length, 0)).toBeLessThanOrEqual(504);
    expect(JSON.stringify({ traces: ts }).length).toBeLessThan(15000);
  });
  it('les traces reçues ne sont jamais à moi (identifiant positif) et portent le nom du buddy', () => {
    const [g] = tracesInvitees(tracesAEnvoyer([trace(-1, 10)]), 'Julie');
    expect(g.id).toBeGreaterThan(0);
    expect(g.name).toBe('T-1 (de Julie)');
    expect(g.distanceM).toBeGreaterThan(50);
  });
});

describe('Suis ma carte : ce qui est à l\'écran', () => {
  it('envoie toutes mes traces, plus les randos qui passent dans l\'écran', () => {
    const loin: Trail = { ...trace(7, 10), segments: [[{ lon: 10, lat: 50 }, { lon: 10.1, lat: 50 }]] };
    const ecran: [number, number, number, number] = [5.5, 43.1, 5.7, 43.3];
    const r = tracesAMontrer([trace(5, 10), loin, trace(-1, 10), { ...loin, id: -2 }], ecran, (id) => id < 0);
    expect(r.map((t) => t.id)).toEqual([-1, -2, 5]);
  });
  it('pas plus de 15 traces', () => {
    expect(tracesAMontrer(Array.from({ length: 30 }, (_, i) => trace(i + 1, 5)), [5.5, 43.1, 5.7, 43.3], () => false)).toHaveLength(15);
  });
});
