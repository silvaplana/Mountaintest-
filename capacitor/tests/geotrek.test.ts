import { describe, expect, it } from 'vitest';
import { geotrekRoute } from '../src/topos/geotrek';
import { vgpxRoute } from '../src/topos/visugpx';
import { srcKey, srcLabel, srcLink, toggleSource } from '../src/topos/sources';

const row = { id: 'ecrins:5', titre: 'Lac', description: 'Joli lac', distance_m: 8200, denivele_m: 640.4, duree: '3 h 30',
  nature: 'rando' as const, source: 'Geotrek · Écrins', lien: 'https://destination.ecrins-parcnational.fr/trek/5-lac', lat: 44.8, lon: 6.3 };

describe('Geotrek', () => {
  it('présente un itinéraire comme les autres sources, marqué de son territoire', () => {
    const r = geotrekRoute(row);
    expect(r.id).toBeLessThan(0);
    expect(r.heightUpM).toBe(640);
    expect(r.bike).toBeUndefined();
    expect(srcLabel(r)).toBe('Geotrek · Écrins');
    expect(srcLink(r).url).toBe(row.lien);
    expect(srcKey(r)).toBe('geotrek');
  });
  it('garde la nature vélo pour le filtre des modes', () => {
    expect(geotrekRoute({ ...row, nature: 'gravel' }).bike).toBe('gravel');
  });
  it('ne croise pas un circuit VisuGPX de même identifiant', () => {
    const v = vgpxRoute({ id: 'ecrins:5', titre: '', description: '', distance_m: null, denivele_m: null, duree: '', lat: 0, lon: 0 });
    expect(geotrekRoute(row).id).not.toBe(v.id);
    expect(srcLabel(v)).toBe('VisuGPX');
  });
  it('masque puis remet une source', () => {
    const h = toggleSource([], 'c2c');
    expect(h).toEqual(['c2c']);
    expect(toggleSource(h, 'c2c')).toEqual([]);
  });
});

import { searchArea } from '../src/C2cPanel';
describe('zone cherchée', () => {
  it('donne la taille de l’écran en km et les zones des autres sources', () => {
    const t = searchArea([5.5, 43.1, 5.7, 43.3], true);
    expect(t).toContain("l'écran, 16 × 22 km");
    expect(t).toContain('25 km autour du centre');
    expect(searchArea([5.5, 43.1, 5.7, 43.3], false)).not.toContain('Camptocamp');
  });
});
