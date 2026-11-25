import { describe, expect, it } from 'vitest';
import { cameraA, capAutour, chemin, ecartAngle, heuresOmbres, heureTexte, trajectoire } from '../src/survol/camera';
import { cadrage } from '../src/survol/enregistreur';

// Trace en zigzag serré (virages tous les ~100 m) vers le nord-est, ~5 km.
const line = Array.from({ length: 50 }, (_, i) => ({ lon: 6.0 + i * 0.0006 + (i % 2) * 0.0008, lat: 45.0 + i * 0.0008 }));
const ensemble = { center: { lon: 6.02, lat: 45.02 }, zoom: 12 };

describe('survol 3D : trajectoire de la caméra', () => {
  const track = trajectoire(line, 'moyen', ensemble);

  it('commence sur la vue d\'ensemble et finit à l\'arrivée', () => {
    expect(track[0].pitch).toBeCloseTo(45, 0);
    expect(Math.abs(track[0].lon - 6.02)).toBeLessThan(0.002);
    const fin = track[track.length - 1], arrivee = line[line.length - 1];
    expect(Math.abs(fin.lon - arrivee.lon)).toBeLessThan(0.001);
    expect(Math.abs(fin.lat - arrivee.lat)).toBeLessThan(0.001);
  });

  it('tourne lentement malgré les zigzags (pas d\'à-coups de cap)', () => {
    let max = 0;
    for (let i = 1; i < track.length; i++) max = Math.max(max, Math.abs(ecartAngle(track[i - 1].bearing, track[i].bearing)));
    // 600 images : au plus ~1° par image, donc ~10° par seconde sur un film de 10 s.
    expect(max).toBeLessThan(1);
  });

  it('suit la direction générale (nord-est), pas chaque virage', () => {
    const c = chemin(line);
    const cap = capAutour(c, c.total / 2);
    expect(cap).toBeGreaterThan(10);
    expect(cap).toBeLessThan(60);
  });

  it('avance sur la trace du départ à l\'arrivée', () => {
    for (let i = 1; i < track.length; i++) expect(track[i].d).toBeGreaterThanOrEqual(track[i - 1].d);
    expect(cameraA(track, 0.5).d).toBeGreaterThan(0);
  });

  it('caméra plus haute = moins inclinée et moins zoomée', () => {
    const bas = cameraA(trajectoire(line, 'bas', ensemble), 0.5), haut = cameraA(trajectoire(line, 'haut', ensemble), 0.5);
    expect(bas.pitch).toBeGreaterThan(haut.pitch);
    expect(bas.zoom).toBeGreaterThan(haut.zoom);
  });
});

describe('survol 3D : intro plongée', () => {
  const track = trajectoire(line, 'moyen', ensemble, 600, true);
  it('part très haut, à la verticale du départ, puis se redresse', () => {
    expect(track[0].zoom).toBeLessThan(10);
    expect(track[0].pitch).toBeLessThan(1);
    expect(Math.abs(track[0].lon - line[0].lon)).toBeLessThan(0.001);
    const apres = cameraA(track, 0.35);
    expect(apres.pitch).toBeGreaterThan(55);
    expect(apres.zoom).toBeGreaterThan(14);
  });
  it('tourne doucement en se redressant', () => {
    let max = 0;
    for (let i = 1; i < track.length; i++) max = Math.max(max, Math.abs(ecartAngle(track[i - 1].bearing, track[i].bearing)));
    expect(max).toBeLessThan(1.5);
  });
});

describe('survol 3D : ombres et format', () => {
  it('heures des ombres toutes les 30 min', () => {
    expect(heuresOmbres(8, 10)).toEqual([8, 8.5, 9, 9.5, 10]);
    expect(heureTexte(8.5)).toBe('8 h 30');
    expect(heureTexte(12)).toBe('12 h');
  });

  it('cadrage vertical 9:16 et horizontal 16:9, dimensions paires', () => {
    const v = cadrage(1080, 2000, true);
    expect(v.ow / v.oh).toBeCloseTo(9 / 16, 1);
    expect(v.ow % 2 + v.oh % 2).toBe(0);
    const h = cadrage(1080, 2000, false);
    expect(h.sw).toBe(1080);
    expect(h.ow / h.oh).toBeCloseTo(16 / 9, 1);
  });
});
