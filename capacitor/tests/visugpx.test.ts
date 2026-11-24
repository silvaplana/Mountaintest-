import { describe, expect, it } from 'vitest';
import { vgpxNum, vgpxRoute } from '../src/topos/visugpx';

describe('VisuGPX', () => {
  it('numéro négatif stable, jamais celui d’un itinéraire Camptocamp', () => {
    expect(vgpxNum('K32b7Eq0Uu')).toBe(vgpxNum('K32b7Eq0Uu'));
    expect(vgpxNum('K32b7Eq0Uu')).toBeLessThan(0);
    expect(vgpxNum('a')).not.toBe(vgpxNum('b'));
  });
  it('ligne du relais en itinéraire de la liste', () => {
    const r = vgpxRoute({ id: 'abc', titre: 'Tour', description: 'Joli', distance_m: 12500, denivele_m: 450.4, duree: '', lat: 43.2, lon: 5.6 });
    expect(r).toMatchObject({ src: 'visugpx', vid: 'abc', title: 'Tour', lengthM: 12500, heightUpM: 450, vdesc: 'Joli' });
  });
});
