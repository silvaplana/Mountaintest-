import { describe, expect, it } from 'vitest';
import { sunPosition, compass } from '../src/shade/sun';
import { CAST_SHADOW, computeShade, LIT, NIGHT, SELF_SHADE } from '../src/shade/shadow';
import { decodeBil, gridFor, mntTileUrl, tileBounds3857, TILE, TILE_BYTES } from '../src/shade/dem';
import { filmTimes, framePixels, hhmm } from '../src/shade/film';

describe('position du soleil (NOAA)', () => {
  it('midi solaire au solstice à La Ciotat : plein sud, ~70°', () => {
    // Midi solaire ≈ 12:00 − 4 min × 5,6° − équation du temps (−1,7 min) ≈ 11:39 UTC.
    const s = sunPosition(new Date(Date.UTC(2026, 5, 21, 11, 39)), 43.17, 5.6);
    expect(s.altitude).toBeGreaterThan(70);
    expect(s.altitude).toBeLessThan(70.6);
    expect(Math.abs(s.azimuth - 180)).toBeLessThan(2);
  });
  it('matin d\'hiver : soleil bas au sud-est', () => {
    // 2 novembre, 9 h heure de Paris (UTC+1).
    const s = sunPosition(new Date(Date.UTC(2026, 10, 2, 8, 0)), 43.17, 5.6);
    expect(s.altitude).toBeGreaterThan(10);
    expect(s.altitude).toBeLessThan(20);
    expect(s.azimuth).toBeGreaterThan(120);
    expect(s.azimuth).toBeLessThan(145);
    expect(compass(s.azimuth)).toBe('SE');
  });
  it('nuit : hauteur négative', () => {
    expect(sunPosition(new Date(Date.UTC(2026, 10, 2, 2, 0)), 43.17, 5.6).altitude).toBeLessThan(-20);
  });
});

/** Plaine à 0 m avec un mur de 100 m de haut sur la colonne 10. */
function wall(w = 60, h = 20): Float32Array {
  const d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) d[y * w + 10] = 100;
  return d;
}

describe('ombres du relief', () => {
  it('soleil à l\'est, 45° : ombre portée de 100 m à l\'ouest du mur', () => {
    const w = 60, h = 20;
    const c = computeShade(wall(w, h), w, h, 10, 90, 45);
    const row = Array.from(c.subarray(10 * w, 11 * w));
    // À l'ouest du mur (x < 10) : 100 m d'ombre = 10 mailles de 10 m.
    expect(row[9]).not.toBe(LIT);
    expect(row[3]).toBe(CAST_SHADOW);
    expect(row[0]).toBe(LIT);
    // À l'est (côté soleil) : au soleil.
    expect(row[20]).toBe(LIT);
  });
  it('soleil à l\'ouest : l\'ombre passe à l\'est', () => {
    const w = 60, h = 20;
    const c = computeShade(wall(w, h), w, h, 10, 270, 45);
    expect(c[10 * w + 15]).toBe(CAST_SHADOW);
    expect(c[10 * w + 25]).toBe(LIT);
    expect(c[10 * w + 5]).toBe(LIT);
  });
  it('soleil bas : ombre plus longue', () => {
    const w = 60, h = 20;
    const c = computeShade(wall(w, h), w, h, 10, 270, 15); // 100 / tan 15° ≈ 373 m
    expect(c[10 * w + 40]).toBe(CAST_SHADOW);
    expect(c[10 * w + 50]).toBe(LIT);
  });
  it('soleil au sud (axe vertical de la grille)', () => {
    const w = 20, h = 60;
    const d = new Float32Array(w * h);
    for (let x = 0; x < w; x++) d[30 * w + x] = 100; // mur est-ouest
    const c = computeShade(d, w, h, 10, 180, 45);
    expect(c[25 * w + 10]).toBe(CAST_SHADOW); // au nord du mur
    expect(c[45 * w + 10]).toBe(LIT);
  });
  it('versant opposé au soleil : ombre propre', () => {
    const w = 40, h = 10;
    const d = new Float32Array(w * h);
    // Pente montant vers l'est de 45° (z = 10 m par maille de 10 m).
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = x * 10;
    // Le versant regarde l'ouest : au soleil l'après-midi, à l'ombre le matin (soleil plus bas que la pente).
    expect(computeShade(d, w, h, 10, 270, 30)[5 * w + 20]).toBe(LIT);
    expect(computeShade(d, w, h, 10, 90, 30)[5 * w + 20]).not.toBe(LIT);
    // Pente douce (10 %) dos au soleil plus haut qu'elle : ombre propre seulement si le soleil passe dessous.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = x;
    expect(computeShade(d, w, h, 10, 90, 3)[5 * w + 20]).not.toBe(LIT);
    expect(computeShade(d, w, h, 10, 90, 10)[5 * w + 20]).toBe(LIT);
    // Ombre propre isolée : un pic, dont le flanc ouest est à l'ombre du soleil levant.
    const p = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p[y * w + x] = Math.max(0, 100 - Math.abs(x - 20) * 30);
    expect([SELF_SHADE, CAST_SHADOW]).toContain(computeShade(p, w, h, 10, 90, 60)[5 * w + 19]);
    expect(computeShade(p, w, h, 10, 90, 60)[5 * w + 21]).toBe(LIT);
  });
  it('nuit : tout en ombre', () => {
    expect(computeShade(new Float32Array(4), 2, 2, 10, 90, -3).every((c) => c === NIGHT)).toBe(true);
  });
});

describe('relief IGN', () => {
  it('URL WMS d\'une tuile en Web Mercator', () => {
    const u = mntTileUrl({ z: 14, x: 8447, y: 6000 });
    expect(u).toContain('LAYERS=ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES');
    expect(u).toContain('FORMAT=image%2Fx-bil%3Bbits%3D32');
    expect(u).toContain('CRS=EPSG:3857');
    const b = tileBounds3857({ z: 1, x: 0, y: 0 });
    expect(b[0]).toBeCloseTo(-20037508.34, 1);
    expect(b[1]).toBeCloseTo(0, 5);
  });
  it('BIL float32 : taille vérifiée et pas-de-donnée à 0', () => {
    const v = new Float32Array(TILE * TILE).fill(250);
    v[0] = -99999;
    const out = decodeBil(v.buffer)!;
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(250);
    expect(decodeBil(new ArrayBuffer(300))).toBeNull();
    expect(TILE_BYTES).toBe(262144);
  });
  it('grille : marge autour de la vue et zoom réduit si trop grand', () => {
    const g = gridFor([5.55, 43.15, 5.66, 43.21], 15);
    expect(g.z).toBeLessThanOrEqual(14);
    expect(g.nx * g.ny).toBeLessThanOrEqual(48);
    expect(gridFor([5.3, 43.0, 5.9, 43.4], 15).z).toBeLessThan(14);
  });
});

describe('film', () => {
  it('9 images de 8 h à midi toutes les 30 min', () => {
    const t = filmTimes('2026-11-02');
    expect(t.map(hhmm)).toEqual(['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00']);
    expect(t[0].getDate()).toBe(2);
  });
  it('pixels transparents au soleil', () => {
    const px = framePixels(new Uint8Array([LIT, CAST_SHADOW]));
    expect(px[3]).toBe(0);
    expect(px[7]).toBeGreaterThan(0);
  });
});
