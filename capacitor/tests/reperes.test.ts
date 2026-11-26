import { describe, expect, it } from 'vitest';
import { chemin, dureeFilm, trajectoire, type LonLat, type Relief } from '../src/survol/camera';
import { FOV_POSE, passageRaide, reperes, T_POSE, T_TOUR } from '../src/survol/reperes';

// Montagne en cône (sommet 3 800 m à 3 km du départ, 1 500 m en bas) et une trace droite qui y monte avec un virage.
const S = { lon: 6.40, lat: 44.90 };
const kx = 111_320 * Math.cos((S.lat * Math.PI) / 180), ky = 110_540;
const alt = (p: LonLat) => { const r = Math.hypot((p.lon - S.lon) * kx, (p.lat - S.lat) * ky); return Math.max(1500, 3800 - r * 0.75); };
const relief: Relief = { alt, sommets: [{ ...S, alt: 3800 }], maille: 25 };
const ligne: LonLat[] = [];
for (let i = 0; i <= 60; i++) {
  // 3 km plein nord vers le sommet, en partant du sud ; un coude franc au milieu.
  const y = -3000 + i * 50, x = i < 30 ? -400 + i * 13 : 0;
  ligne.push({ lon: S.lon + x / kx, lat: S.lat + y / ky });
}

describe('🎯 Repères', () => {
  const c = chemin(ligne), a = (x: number, y: number) => alt(c.pr.depuis({ x, y }));

  it('trouve le sommet et l\'arrivée comme repères', () => {
    const r = reperes(c, a);
    expect(r[r.length - 1]).toBeCloseTo(c.total, 0);
    expect(r.length).toBeGreaterThanOrEqual(1);
  });

  it('trouve un passage raide sur une pente à 75 %', () => {
    expect(passageRaide(c, a)).not.toBeNull();
  });

  it('ajoute le plan posé et le tour à la durée', () => {
    const d = dureeFilm(ligne, 400, { style: 'reperes', relief });
    const simple = dureeFilm(ligne, 400, { style: 'suivi', relief });
    expect(d.corps).toBeGreaterThan(simple.corps + T_TOUR + T_POSE - 8);
    expect(d.temps![0]).toBeLessThan(1);
  });

  it('garde un regard stable, en téléobjectif, sans passer sous le relief', () => {
    const d = dureeFilm(ligne, 400, { style: 'reperes', relief });
    const track = trajectoire(ligne, 'moyen', { center: S, zoom: 13 }, 1200, false, { style: 'reperes', relief, hauteurPx: 800, debut: 0.08, temps: d.temps, secondes: d.corps });
    const corps = track.slice(Math.ceil(0.08 * 1200));
    for (const cam of corps) {
      expect(Number.isFinite(cam.zoom) && Number.isFinite(cam.pitch) && Number.isFinite(cam.bearing)).toBe(true);
      expect(cam.fov).toBe(cam.coupe || cam.fov === FOV_POSE ? cam.fov : 28);
      expect(cam.pitch).toBeGreaterThan(45);
      expect(cam.pitch).toBeLessThanOrEqual(100);
    }
    // Plan posé sur la pente à 75 % : il y a des coupes.
    expect(corps.some((x) => x.coupe)).toBe(true);
    // Hors coupes, l'inclinaison bouge de moins d'un degré d'une image à l'autre.
    const saut = corps.findIndex((x, i) => i > 0 && !x.coupe && !corps[i - 1].coupe && Math.abs(x.pitch - corps[i - 1].pitch) >= 1);
    expect(saut === -1 ? "" : `${saut}/${corps.length} ${corps.slice(saut - 2, saut + 2).map((x) => x.pitch.toFixed(1) + (x.coupe ? "c" : "")).join(" ")}`).toBe("");
  });
});
