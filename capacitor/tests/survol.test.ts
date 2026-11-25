import { describe, expect, it } from 'vitest';
import { cameraA, capAutour, chemin, distanceCamera, ecartAngle, heuresOmbres, heureTexte, partPlongee, PITCH_MAX, PLONGEE_NUAGES_S, trajectoire, ZOOM_CIEL } from '../src/survol/camera';
import { dureeFilm } from '../src/survol/camera';
import { horlogePhotos, momentPhoto, photosDeLaTrace } from '../src/survol/photos-film';
import { pixelsNeige } from '../src/survol/neige';
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
  it('dure 12 s, en plus du survol', () => {
    // La plongée dure 12 s et s'ajoute au survol : la trace garde toute la durée choisie.
    for (const d of [5, 15, 30]) expect(partPlongee(d) * (d + PLONGEE_NUAGES_S)).toBeCloseTo(12);
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

describe('survol 3D : ombres fines (✨ soigné)', () => {
  it('lisse les bords : une maille seule devient un dégradé autour', async () => {
    const { adoucir } = await import('../src/survol/ombres');
    const w = 5, h = 5, px = new Uint8ClampedArray(w * h * 4);
    px.set([20, 30, 85, 117], (2 * w + 2) * 4);
    adoucir(px, w, h);
    expect(px[(2 * w + 2) * 4 + 3]).toBe(13);
    expect(px[(1 * w + 1) * 4 + 3]).toBe(13);
    expect(px[(1 * w + 1) * 4 + 2]).toBe(85);
    expect(px[3]).toBe(0);
  });
  it('prend le relief à 7 m quand la zone le permet', async () => {
    const { zoneElargie } = await import('../src/survol/ombres');
    const { gridFor } = await import('../src/shade/dem');
    const zone: [number, number, number, number] = [6.8, 45.85, 6.9, 45.92];
    expect(gridFor(zoneElargie(zone), 15, 144).z).toBe(14);
    expect(gridFor(zoneElargie(zone), 14).z).toBeLessThan(14);
  });
});

describe('survol 3D : plongée simple', () => {
  it('descend tout de suite, sans attendre de nuages', () => {
    const t = trajectoire(line, 'moyen', ensemble, 600, true, { nuages: false });
    const nuages = trajectoire(line, 'moyen', ensemble, 600, true);
    expect(cameraA(t, 0.12).zoom).toBeGreaterThan(cameraA(nuages, 0.12).zoom + 1);
    expect(cameraA(t, 0.35).pitch).toBeGreaterThan(55);
  });
});

describe('survol 3D : jamais dans la montagne, mouvements lissés', () => {
  // La trace descend une pente à 45° vers le nord-est : derrière la caméra, le versant monte plus vite qu'elle.
  const mur = { alt: (p: { lon: number; lat: number }) => 2000 - ((p.lon - 6.0) * 78_700 * 0.6 + (p.lat - 45.0) * 110_540 * 0.8), sommets: [] };
  it('redresse la caméra plutôt que de la mettre sous le relief', async () => {
    const { camLibre } = await import('../src/survol/camera');
    const libre = trajectoire(line, 'bas', ensemble, 600, false, { relief: mur, hauteurPx: 800 });
    const sans = trajectoire(line, 'bas', ensemble, 600);
    let dedans = 0, avant = 0;
    for (let i = 100; i < 500; i++) {
      const a = libre[i], b = sans[i];
      if (!camLibre(a, a.zoom, a.pitch, a.bearing, mur, 800)) dedans++;
      if (!camLibre(b, b.zoom, b.pitch, b.bearing, mur, 800)) avant++;
    }
    expect(avant).toBeGreaterThan(50);
    expect(dedans).toBe(0);
  });
  it('sur une trace chaotique (lacets serrés, bruit GPS), la caméra regarde loin et tourne doucement', () => {
    let g = 3; const al = () => ((g = (g * 16807) % 2147483647) / 2147483647) - 0.5;
    // 3 km : lacets de 30 m vers le nord, bruit GPS ±15 m, puis virage franc vers l'est.
    const chaos = Array.from({ length: 300 }, (_, i) => {
      const d = i * 10, lac = 30 * Math.sin(d / 25);
      const x = d < 1500 ? lac : d - 1500, y = d < 1500 ? d : 1500 + lac;
      return { lon: 6 + (x + al() * 30) / 78_700, lat: 45 + (y + al() * 30) / 110_540 };
    });
    const track = trajectoire(chaos, 'moyen', { center: { lon: 6.01, lat: 45.01 }, zoom: 12 });
    let max = 0, total = 0;
    for (let i = 100; i < 500; i++) { const a = Math.abs(ecartAngle(track[i - 1].bearing, track[i].bearing)); max = Math.max(max, a); total += a; }
    expect(max).toBeLessThan(0.6);
    expect(total).toBeLessThan(100); // le virage de 90° et presque rien d'autre
  });
});

describe('survol 3D : 🧗 la caméra se penche dans la pente', () => {
  it('regard levé en montée, plongé en descente, dans les bornes', async () => {
    const { dansLaPente, PITCH_GOPRO } = await import('../src/survol/camera');
    expect(dansLaPente(60, 20)).toBe(70);
    expect(dansLaPente(76, -30)).toBeCloseTo(53.5);
    expect(dansLaPente(76, 30)).toBe(PITCH_GOPRO);
    expect(dansLaPente(40, -40)).toBe(30);
  });
});

describe('survol 3D : 🧗 caméra au sol, sommet en drone, regard final', () => {
  // Cône à 29° (sommet 2600 m), bosses de 6 m et ondulations de 25 m ; la trace y monte en grands lacets.
  const KX = 78_710, KY = 110_540;
  const h = (lon: number, lat: number) => { const x = (lon - 6) * KX, y = (lat - 45.03) * KY, d = Math.hypot(x, y);
    return Math.max(1200, 2600 - 0.55 * d) + 6 * Math.sin(x / 60) * Math.cos(y / 45) + 25 * Math.sin(x / 400 + 1) * Math.sin(y / 300); };
  const lacets = Array.from({ length: 221 }, (_, i) => { const d = i * 10; return { lon: 6 + (120 * Math.sin(d / 110) * (1 - d / 2300)) / KX, lat: 45.03 - (2200 - d) / KY }; });
  const cone = { alt: (p: { lon: number; lat: number }) => h(p.lon, p.lat), sommets: [], maille: 7 };
  const vue = { center: { lon: 6, lat: 45.02 }, zoom: 12.5 };
  /** Position réelle de la caméra dans MapLibre (vérifiée dans MapLibre sans écran le 25/11) et hauteur au-dessus du sol. */
  const oeil = (c: { lon: number; lat: number; zoom: number; pitch: number; bearing: number; elevation?: number }) => {
    const D = distanceCamera(c.zoom, c.lat, 800), p = (c.pitch * Math.PI) / 180, a = (c.bearing * Math.PI) / 180, L = D * Math.sin(p);
    const lon = c.lon - (L * Math.sin(a)) / (111_320 * Math.cos((c.lat * Math.PI) / 180)), lat = c.lat - (L * Math.cos(a)) / 110_540, alt = c.elevation! + D * Math.cos(p);
    return { lon, lat, alt, sol: alt - h(lon, lat) };
  };
  const film = (hauteur: 'bas' | 'moyen' | 'haut', o: object = {}) => trajectoire(lacets, hauteur, vue, 600, false, { style: 'alpi', relief: cone, hauteurPx: 800, ...o });
  // « Les deux » : montée jusqu'à l'image 284, sommet jusqu'à 447, descente jusqu'à 534, puis regard final.
  const MONTEE = [120, 250] as const;

  it('jamais dans la montagne, quelle que soit la hauteur, le sens ou l\'intro', () => {
    for (const ht of ['bas', 'moyen', 'haut'] as const) for (const sens of ['deux', 'montee', 'descente'] as const) for (const desc of ['gopro', 'large'] as const) {
      const t = film(ht, { sens, descente: desc });
      expect(Math.min(...t.map((c) => oeil(c).sol)), `${ht} ${sens} ${desc}`).toBeGreaterThan(2);
    }
    const plongee = trajectoire(lacets, 'bas', vue, 600, 0.3, { style: 'alpi', relief: cone, hauteurPx: 800 });
    expect(Math.min(...plongee.map((c) => oeil(c).sol))).toBeGreaterThan(2);
  });
  it('vitesse choisie : la durée suit la trace, la descente a son temps, deux fois moins vite = deux fois plus long', () => {
    // Trace de 2,4 km qui finit au sommet : on redescend par le même chemin.
    const a = dureeFilm(lacets, 200, { style: 'alpi', sens: 'deux', relief: cone }), [m1, m2, m3] = a.temps!;
    const tm = m1 * a.corps, td = (m3 - m2) * a.corps;
    expect(tm).toBeGreaterThan(41); expect(tm).toBeLessThan(45);           // 2,4 km à 200 km/h ≈ 43 s
    expect(td).toBeGreaterThan(27); expect(td).toBeLessThan(31);           // descente une fois et demie plus vite
    expect((m2 - m1) * a.corps).toBeCloseTo(12, 0);                        // le sommet garde ses 12 s
    expect((1 - m3) * a.corps).toBeCloseTo(5, 0);
    const lent = dureeFilm(lacets, 100, { style: 'alpi', sens: 'deux', relief: cone });
    expect(lent.temps![0] * lent.corps).toBeCloseTo(2 * tm, 0);
    expect(dureeFilm(lacets, 200, { style: 'alpi', sens: 'montee', relief: cone }).temps).toEqual([expect.any(Number), 1.01, 2]);
    // Sans relief ou autre style : la trace à la vitesse choisie, entre 12 s et 4 min.
    expect(dureeFilm(lacets, 200).corps).toBe(48);
    expect(dureeFilm(lacets.slice(0, 10), 400).corps).toBe(12);
    const longue = Array.from({ length: 400 }, (_, i) => ({ lon: 6 + i * 0.002, lat: 45 }));
    expect(dureeFilm(longue, 100).corps).toBe(240);
    // Le film suit ces temps : au milieu de la descente, on est bien à mi-pente.
    const t = film('bas', { temps: a.temps }), i = Math.round(600 * (m2 + m3) / 2);
    expect(t[i].d).toBeGreaterThan(2400 + 700); expect(t[i].d).toBeLessThan(2400 + 1700);
    expect(t[600].d).toBeCloseTo(4810, -2);
    // Et la caméra reste hors de la montagne à ce rythme, avec les images d'un film de 87 s.
    for (const ht of ['bas', 'moyen'] as const) {
      const f = trajectoire(lacets, ht, vue, 1740, false, { style: 'alpi', relief: cone, hauteurPx: 800, temps: a.temps, debut: 4 / 87 });
      expect(Math.min(...f.map((c) => oeil(c).sol)), ht).toBeGreaterThan(2);
    }
  });
  it('« Bas » colle au sol en montée ; Moyen et Haut s\'éloignent', () => {
    const moy = (ht: 'bas' | 'moyen' | 'haut') => { const t = film(ht).slice(...MONTEE); return t.reduce((s, c) => s + oeil(c).sol, 0) / t.length; };
    const bas = film('bas').slice(...MONTEE).map((c) => oeil(c).sol);
    expect(Math.max(...bas)).toBeLessThan(30);
    expect(moy('bas')).toBeLessThan(18);
    expect(moy('moyen')).toBeGreaterThan(moy('bas') + 20);
    expect(moy('haut')).toBeGreaterThan(moy('moyen') + 60);
  });
  it('en montée raide la caméra lève les yeux (au-dessus de l\'horizon), en descente elle regarde vers le bas', () => {
    const t = film('bas');
    for (const c of t.slice(...MONTEE)) { expect(c.pitch).toBeGreaterThan(92); expect(c.pitch).toBeLessThanOrEqual(PITCH_MAX + 1e-6); }
    for (const c of t.slice(470, 525)) expect(c.pitch).toBeLessThan(80);
  });
  it('sans à-coup : la caméra ne saute ni en position ni en cap d\'une image à l\'autre', () => {
    const t = film('bas');
    for (let i = 1; i < t.length; i++) {
      const a = oeil(t[i - 1]), b = oeil(t[i]);
      const pas = Math.hypot((b.lon - a.lon) * KX, (b.lat - a.lat) * KY, b.alt - a.alt);
      if (i > 100) expect(pas, `image ${i}`).toBeLessThan(60);
      expect(Math.abs(t[i].bearing - t[i - 1].bearing), `cap ${i}`).toBeLessThan(i > 530 ? 6 : 4); // à l'arrivée, on se retourne
      expect(Math.abs(t[i].pitch - t[i - 1].pitch), `pitch ${i}`).toBeLessThan(4);
    }
  });
  it('au sommet : s\'élève comme un drone, tourne, replonge dans l\'axe de la descente et attend avant de partir', () => {
    const t = film('bas');
    const pause = t.filter((c) => c.sommet != null);
    expect(Math.max(...pause.map((c) => oeil(c).sol))).toBeGreaterThan(300);
    expect(Math.abs(pause[pause.length - 1].bearing - pause[0].bearing)).toBeGreaterThan(170);
    // Les dernières images de la pause : immobile, au sol, face à la descente (la trace redescend vers le sud).
    const a = oeil(pause[pause.length - 12]), b = oeil(pause[pause.length - 1]);
    expect(Math.hypot((b.lon - a.lon) * KX, (b.lat - a.lat) * KY, b.alt - a.alt)).toBeLessThan(1);
    expect(b.sol).toBeLessThan(40);
    expect(Math.abs(ecartAngle(180, pause[pause.length - 1].bearing))).toBeLessThan(25);
  });
  it('la descente prend de la hauteur au fil de la pente', () => {
    const t = film('bas');
    expect(oeil(t[520]).sol).toBeGreaterThan(oeil(t[460]).sol + 5);
  });
  it('à l\'arrivée : se retourne vers le sommet et s\'en approche s\'il est visible', () => {
    const t = film('bas'), fin = t[600], e = oeil(fin), avant = oeil(t[534]);
    const versSommet = (Math.atan2((6 - e.lon) * KX, (45.03 - e.lat) * KY) * 180) / Math.PI;
    expect(Math.abs(ecartAngle(versSommet, fin.bearing))).toBeLessThan(3);
    const dist = (p: { lon: number; lat: number }) => Math.hypot((6 - p.lon) * KX, (45.03 - p.lat) * KY);
    expect(dist(e)).toBeLessThan(dist(avant) - 300);
    // Sommet caché par une crête : on se retourne, sans s'approcher.
    const crete = { ...cone, alt: (p: { lon: number; lat: number }) => { const y = (p.lat - 45.03) * KY; return h(p.lon, p.lat) + (Math.abs(y + 1400) < 150 ? 900 : 0); } };
    const c2 = trajectoire(lacets, 'bas', vue, 600, false, { style: 'alpi', relief: crete, hauteurPx: 800 });
    const o = (c: typeof c2[0]) => { const x = oeil(c); return x; };
    expect(dist(o(c2[600]))).toBeGreaterThan(dist(o(c2[534])) - 150);
  });
});

describe('survol 3D : 🧗 aller, retour (Seb, 25/11 : un film a un début et une fin)', () => {
  const pic = { alt: (p: { lon: number; lat: number }) => { const y = (p.lat - 45.0) * 110_540; return 3000 - Math.abs(y - 2000) * 0.3; }, sommets: [] };
  const droite = Array.from({ length: 41 }, (_, i) => ({ lon: 6, lat: 45 + (i * 100) / 110_540 }));
  const y = (c: { lat: number }) => (c.lat - 45) * 110_540;
  it('aller : toute la trace, du début à la fin, avec le tour au point haut en chemin', () => {
    const t = trajectoire(droite, 'moyen', ensemble, 600, false, { style: 'alpi', relief: pic, sens: 'montee' });
    expect(Math.abs(y(t.filter((c) => c.sommet != null)[0].point) - 2000)).toBeLessThan(200);
    expect(y(t[600].point)).toBeGreaterThan(3600);
  });
  it('retour : toute la trace, de la fin au début', () => {
    const t = trajectoire(droite, 'moyen', ensemble, 600, false, { style: 'alpi', relief: pic, sens: 'descente' });
    expect(y(t[90].point)).toBeGreaterThan(3000);
    expect(y(t[600].point)).toBeLessThan(400);
  });
  it('aller-retour : va au bout de la trace, y tourne, et revient au départ, même si la trace ne fait que descendre', () => {
    const pente = { alt: (p: { lon: number; lat: number }) => 3000 - (p.lat - 45.0) * 110_540 * 0.3, sommets: [] };
    for (const relief of [pic, pente]) {
      const t = trajectoire(droite, 'moyen', ensemble, 600, false, { style: 'alpi', relief, sens: 'deux' });
      expect(y(t.filter((c) => c.sommet != null)[0].point)).toBeGreaterThan(3800);
      expect(y(t[600].point)).toBeLessThan(400);
    }
  });
});

describe('survol 3D : ❄ neige posée sur les photos', () => {
  // Grille de 40 × 40 mailles de 10 m : pente régulière de `pente` (m/m) qui descend vers `vers`, altitude `z0` au centre.
  const plan = (z0: number, pente: number, vers: 'nord' | 'sud') => Float32Array.from({ length: 1600 }, (_, k) => {
    const j = Math.floor(k / 40); return z0 + pente * 10 * (j - 20) * (vers === 'sud' ? -1 : 1);
  });
  const alpha = (dem: Float32Array, limite = 2000) => pixelsNeige(dem, 40, 40, 10, limite)[(20 * 40 + 20) * 4 + 3];

  it('blanc au-dessus de la limite, rien en dessous, fondu entre les deux', () => {
    expect(alpha(plan(2600, 0.1, 'sud'))).toBeGreaterThan(230);
    expect(alpha(plan(1500, 0.1, 'sud'))).toBe(0);
    const a = alpha(plan(2000, 0, 'sud'));
    expect(a).toBeGreaterThan(60); expect(a).toBeLessThan(190);
  });
  it('les pentes très raides restent en rocher', () => {
    expect(alpha(plan(2600, Math.tan((60 * Math.PI) / 180), 'sud'))).toBe(0);
    expect(alpha(plan(2600, Math.tan((30 * Math.PI) / 180), 'sud'))).toBeGreaterThan(230);
  });
  it('la neige descend plus bas en versant nord', () => {
    expect(alpha(plan(2000, 0.4, 'nord'))).toBeGreaterThan(alpha(plan(2000, 0.4, 'sud')) + 100);
  });
  it('le versant au soleil est plus clair que le versant à l\'ombre', () => {
    const rouge = (d: Float32Array) => pixelsNeige(d, 40, 40, 10, 1000)[(20 * 40 + 20) * 4];
    expect(rouge(plan(2600, 0.5, 'sud'))).toBeGreaterThan(rouge(plan(2600, 0.5, 'nord')) + 40);
  });
  it('pas de stries sur un relief en marches d\'escalier (relief IGN plus grossier que la maille)', () => {
    // Pente régulière de 27° vers le sud, donnée par paliers de 3,5 mailles.
    const marches = Float32Array.from({ length: 3600 }, (_, k) => 2600 + 0.5 * 10 * 3.5 * Math.floor(Math.floor(k / 60) / 3.5));
    const px = pixelsNeige(marches, 60, 60, 10, 1000);
    const rouges = Array.from({ length: 30 }, (_, n) => px[((15 + n) * 60 + 30) * 4]);
    expect(Math.max(...rouges) - Math.min(...rouges)).toBeLessThan(12);
  });
});

describe('survol 3D : 📷 photos de la sortie dans le film', () => {
  const line = Array.from({ length: 101 }, (_, i) => ({ lon: 6 + i * 0.0005, lat: 45 }));   // ≈ 3,9 km vers l'est
  const ph = (i: number, o: object = {}) => ({ id: `p${i}`, lon: 6 + i * 0.0005, lat: 45.0005, prise_le: `2026-05-0${1 + (i % 9)}T10:${String(i).padStart(2, '0')}`, ...o });
  it('garde les photos prises près de la trace, pas les films ni les photos sans position ou loin', () => {
    const l = photosDeLaTrace([ph(10), ph(20, { video: true }), ph(30, { lon: null, lat: null }), ph(40, { lat: 45.01 }), ph(50)], line);
    expect(l.map((p) => p.id)).toEqual(['p10', 'p50']);
  });
  it('au-delà de 8, les ⭐ d\'abord et les autres réparties', () => {
    const l = photosDeLaTrace(Array.from({ length: 30 }, (_, i) => ph(i + 1, { prise_le: `2026-05-01T10:${String(i).padStart(2, '0')}`, etoile: i === 13 })), line);
    expect(l).toHaveLength(8);
    expect(l.some((p) => p.id === 'p14')).toBe(true);
    expect(l[0].id).toBe('p1'); expect(l[7].id).toBe('p30');
  });
  it('le film s\'allonge de 3 s par photo, ralentit sans reculer et montre chaque photo à son endroit', () => {
    const h = horlogePhotos(40, [0.5, 0.25]);
    expect(h.total).toBe(46);
    let avant = -1, vues: (number | null)[] = [];
    for (let k = 0; k <= 460; k++) {
      const x = h.a(k / 460);
      expect(x.t).toBeGreaterThanOrEqual(avant); avant = x.t;
      if (x.photo !== vues.at(-1)) vues.push(x.photo);
      if (x.photo != null) { expect(x.q).toBeGreaterThanOrEqual(0); expect(x.q).toBeLessThanOrEqual(1); expect(Math.abs(x.t - [0.5, 0.25][x.photo])).toBeLessThan(0.016); }
    }
    expect(vues).toEqual([null, 1, null, 0, null]);
    expect(h.a(0).t).toBeCloseTo(0, 3); expect(h.a(1).t).toBeCloseTo(1, 3);
    // Deux photos au même endroit passent l'une après l'autre.
    const d = horlogePhotos(40, [0.5, 0.5]);
    expect(new Set(Array.from({ length: 461 }, (_, k) => d.a(k / 460).photo)).size).toBe(3);
    // Sans photo, rien ne change.
    expect(horlogePhotos(40, []).a(0.3).t).toBeCloseTo(0.3, 5);
  });
  it('trouve le moment où le film passe près de la photo, après l\'intro', () => {
    const track = Array.from({ length: 101 }, (_, i) => ({ point: line[Math.max(0, i - 20)] })) as never;
    expect(momentPhoto(track, { lon: 6 + 40 * 0.0005, lat: 45.0005 }, 0.2)).toBeCloseTo(0.6, 2);
    expect(momentPhoto(track, { lon: 6, lat: 45.0005 }, 0.2)).toBeCloseTo(0.21, 2);
    expect(momentPhoto(track, { lon: 7, lat: 45 }, 0.2)).toBeNull();
  });
});

describe('jour des ombres du film', () => {
  it('prend le jour du Buddy Time, ou celui de sa première photo sur la trace', async () => {
    const { jourDesOmbres } = await import('../src/survol/photos-film');
    const bt = { debut: '2026-04-25', fin: '2026-04-26' };
    expect(jourDesOmbres(null, [])).toBeNull();
    expect(jourDesOmbres(bt, [])).toBe('2026-04-25');
    expect(jourDesOmbres(bt, [{ prise_le: '2026-04-26T10:12:00' }])).toBe('2026-04-26');
    expect(jourDesOmbres(bt, [{ prise_le: '2026-11-25T21:00:00' }])).toBe('2026-04-25');
  });
});

describe('alpiniste : aller-retour vers un refuge', () => {
  // 4,4 km vers le nord : monte de 1000 à 2400 m aux 70 %, puis redescend de 130 m jusqu'au refuge (le bout).
  const line = Array.from({ length: 41 }, (_, i) => ({ lon: 6.0, lat: 45.0 + i * 0.001 }));
  const relief = { alt: (p: { lat: number }) => { const k = (p.lat - 45.0) / 0.04; return k < 0.7 ? 1000 + 2000 * k : 2400 - (k - 0.7) * 433; }, sommets: [] };
  it('« les deux » monte jusqu\'au refuge puis redescend toute la trace', async () => {
    const { sommetTrace, chemin: ch, trajectoire: tr } = await import('../src/survol/camera');
    const c = ch(line), s = sommetTrace(c, relief);
    expect(s.d).toBeCloseTo(c.total, 0);
    expect(s.retour).toBe(true);
    const t = tr(line, 'moyen', { center: { lon: 6.0, lat: 45.02 }, zoom: 12 }, 600, false, { style: 'alpi', relief, sens: 'deux' });
    expect(Math.abs(t.filter((x) => x.sommet != null)[0].point.lat - 45.04)).toBeLessThan(0.0005);
    expect(Math.abs(t[t.length - 1].point.lat - 45.0)).toBeLessThan(0.0005);
  });
  it('aller d\'une traversée : le tour se fait au point haut, en chemin', async () => {
    const { sommetTrace, chemin: ch } = await import('../src/survol/camera');
    const traverse = { alt: (p: { lat: number }) => 2400 - Math.abs((p.lat - 45.0) / 0.04 - 0.5) * 2800, sommets: [] };
    const c = ch(line), s = sommetTrace(c, traverse, 'montee');
    expect(s.d / c.total).toBeCloseTo(0.5, 1);
    expect(s.retour).toBe(false);
  });
});
