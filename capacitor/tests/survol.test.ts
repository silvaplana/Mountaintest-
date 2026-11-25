import { describe, expect, it } from 'vitest';
import { cameraA, capAutour, chemin, ecartAngle, heuresOmbres, heureTexte, partPlongee, trajectoire, ZOOM_CIEL } from '../src/survol/camera';
import { cameraCiel } from '../src/survol/ciel-gl';
import { CIEL } from '../src/survol/nuages';
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
  it('dure 6 à 8 s environ, au moins 30 % du film, au plus 55 %', () => {
    expect(partPlongee(60)).toBeCloseTo(0.3);
    expect(partPlongee(20) * 20).toBeCloseTo(7);
    expect(partPlongee(5)).toBe(0.55);
  });
  it('la carte reste vue de haut tant que les nuages la cachent', () => {
    const part = partPlongee(20), t = trajectoire(line, 'moyen', ensemble, 600, part);
    const cam = cameraA(t, part * CIEL.dechirure * 0.75);
    expect(cam.zoom).toBeLessThan(ZOOM_CIEL + 0.4); // le lissage final arrondit à peine
    expect(cam.pitch).toBeLessThan(1);
  });
  it('dans les nuages : au-dessus, bascule vers le bas, puis sous la couche', () => {
    expect(cameraCiel(0).pitch).toBeGreaterThan(-0.2);
    expect(cameraCiel(CIEL.dedans).pitch).toBeLessThan(-1.5);
    expect(cameraCiel(0).y).toBeGreaterThan(1.15);
    expect(cameraCiel(CIEL.dechirure).y).toBeLessThan(0.35);
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

describe('survol 3D : ombres et musique du film', () => {
  it('calcule les ombres au-delà de la trace (au moins 2 km autour)', async () => {
    const { zoneElargie } = await import('../src/survol/ombres');
    const z = zoneElargie([6.0, 45.0, 6.01, 45.01]);
    expect(45.0 - z[1]).toBeGreaterThan(0.017);
    expect(6.0 - z[0]).toBeGreaterThan(0.025);
    expect(z[2]).toBeGreaterThan(6.035);
  });

  it('fond les bords de l\'image des ombres (pas de carré visible de loin)', async () => {
    const { fondreBords } = await import('../src/survol/ombres');
    const w = 40, h = 20, px = new Uint8ClampedArray(w * h * 4).fill(200);
    fondreBords(px, w, h);
    const a = (x: number, y: number) => px[(y * w + x) * 4 + 3];
    expect(a(0, 10)).toBeLessThan(40);
    expect(a(20, 0)).toBeLessThan(40);
    expect(a(20, 10)).toBe(200);
    expect(px[(10 * w) * 4]).toBe(200); // la couleur ne change pas, seulement la transparence
  });

  it('baisse la musique sur la fin', async () => {
    const { baisserFin } = await import('../src/survol/encodeur');
    const d = baisserFin(new Float32Array(10).fill(1), 4);
    expect(Array.from(d.slice(0, 6))).toEqual([1, 1, 1, 1, 1, 1]);
    expect(d[6]).toBeCloseTo(1);
    expect(d[9]).toBeCloseTo(0.25);
  });
});

describe('survol 3D : trace qui se dessine', () => {
  it('donne le début de la trace jusqu\'à la distance parcourue, coupé au bon endroit', async () => {
    const { debutTrace, chemin } = await import('../src/survol/camera');
    const total = chemin(line).total;
    expect(debutTrace(line, 0)).toEqual([]);
    const moitie = debutTrace(line, total / 2);
    expect(moitie.length).toBeGreaterThan(2);
    expect(moitie.length).toBeLessThan(line.length);
    expect(chemin(moitie).total).toBeCloseTo(total / 2, 0);
    expect(debutTrace(line, total + 100)).toHaveLength(line.length);
  });
});

describe('survol 3D : styles de prise de vue', () => {
  // Trace droite vers le nord (~4,4 km), qui monte jusqu'à son bout ; un grand sommet à 3 km à l'est du milieu.
  const droite = Array.from({ length: 41 }, (_, i) => ({ lon: 6.0, lat: 45.0 + i * 0.001 }));
  const pic = { lon: 6.0 + 3000 / (111_320 * Math.cos((45.02 * Math.PI) / 180)), lat: 45.02, alt: 2600 };
  const relief = {
    alt: (p: { lon: number; lat: number }) => {
      const dx = (p.lon - pic.lon) * 111_320 * Math.cos((45 * Math.PI) / 180), dy = (p.lat - pic.lat) * 110_540;
      return 1000 + (p.lat - 45.0) * 20_000 + 1400 * Math.exp(-(dx * dx + dy * dy) / (2 * 1200 * 1200));
    },
    sommets: [pic],
  };
  const vue = { center: { lon: 6.0, lat: 45.02 }, zoom: 12 };

  it('de côté : la caméra regarde à ~75° de la marche', () => {
    const c = cameraA(trajectoire(droite, 'moyen', vue, 600, false, { style: 'cote' }), 0.5);
    expect(Math.abs(ecartAngle(75, c.bearing))).toBeLessThan(10);
  });

  it('alpiniste : monte au sommet, s\'y arrête (altitude affichée), puis redescend par le même chemin', async () => {
    const { trajectoire: tr } = await import('../src/survol/camera');
    const t = tr(droite, 'moyen', vue, 600, false, { style: 'alpi', relief, descente: 'gopro' });
    const pause = t.filter((c) => c.sommet != null);
    expect(pause.length).toBeGreaterThan(50);
    expect(Math.abs(pause[0].point.lat - 45.04)).toBeLessThan(0.0005);
    for (let i = 1; i < t.length; i++) expect(t[i].d).toBeGreaterThanOrEqual(t[i - 1].d - 1e-6);
    const fin = t[t.length - 1];
    expect(Math.abs(fin.point.lat - 45.0)).toBeLessThan(0.0005); // retour au départ
    expect(cameraA(t, 0.9).pitch).toBeGreaterThan(70); // descente GoPro, au ras de la pente
  });

  it('sans relief, alpiniste et ciné font un simple suivi', () => {
    const t = trajectoire(droite, 'moyen', vue, 600, false, { style: 'alpi', relief: null });
    expect(t.some((c) => c.sommet != null)).toBe(false);
  });

  it('ciné : tourne la tête vers le beau sommet sur le côté, et prend son temps là', async () => {
    const { beaute, chemin: ch } = await import('../src/survol/camera');
    const b = beaute(ch(droite), relief);
    expect(b.vues.length).toBeGreaterThan(0);
    const t = trajectoire(droite, 'moyen', vue, 600, false, { style: 'cine', relief });
    const v = b.vues[0], ici = t.filter((c) => c.d > 0 && c.d < 4000).reduce((m, c) => (Math.abs(c.d - v.d) < Math.abs(m.d - v.d) ? c : m));
    expect(ecartAngle(0, ici.bearing)).toBeGreaterThan(30); // regarde vers l'est, vers le sommet
    // Plus d'images passées au point de vue qu'au bout de la trace (ralenti là).
    const n = (d: number) => t.filter((c) => Math.abs(c.d - d) < 300 && c.d > 0).length;
    expect(n(v.d)).toBeGreaterThan(n(3900));
  });
});

describe('survol 3D : relief', () => {
  it('trouve le sommet d\'une grille d\'altitudes', async () => {
    const { sommets, reliefDeGrille } = await import('../src/survol/relief');
    const spec = { z: 12, x0: 2116, y0: 1468, nx: 1, ny: 1 };
    const w = 256, h = 256, dem = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) dem[j * w + i] = 1000 + 900 * Math.exp(-((i - 100) ** 2 + (j - 150) ** 2) / (2 * 20 * 20));
    const g = { spec, w, h, dem, missing: 0 };
    const s = sommets(g);
    expect(s.length).toBe(1);
    expect(s[0].alt).toBeGreaterThan(1850);
    const r = reliefDeGrille(g);
    expect(r.alt(s[0])).toBeGreaterThan(1850);
  });
});
