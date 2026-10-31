// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LA_CIOTAT_BBOX, LAYERS, wmtsTileUrl } from '../src/config';
import { decideSettings, isStationary } from '../src/gps/adaptive';
import { DEFAULT_FILTER, filterForMode, judgeFix } from '../src/gps/filter';
import type { GpsFix } from '../src/gps/types';
import { parseCapabilities } from '../src/tiles/capabilities';
import { tilesForBbox } from '../src/tiles/tileMath';
import { parseGpx, toGpx } from '../src/track/gpx';
import { computeStats } from '../src/track/stats';

const fix = (o: Partial<GpsFix>): GpsFix => ({ lat: 43.17, lon: 5.6, alt: 0, accuracy: 5, speed: 0, time: 0, ...o });

describe('tuiles', () => {
  it('compte les tuiles du scénario commun (467)', () => {
    const t = tilesForBbox(LA_CIOTAT_BBOX, 10, 16);
    expect(t.length).toBe(467);
    expect(t.filter((x) => x.z === 16).length).toBe(336);
  });
  it('construit une URL WMTS privée avec la clé', () => {
    const u = wmtsTileUrl(LAYERS.scan25, 16, 33571, 23941, 'abc');
    expect(u).toContain('data.geopf.fr/private/wmts');
    expect(u).toContain('TILEMATRIX=16');
    expect(u).toContain('apikey=abc');
    expect(wmtsTileUrl(LAYERS.planign, 1, 0, 0, 'abc')).not.toContain('apikey');
  });
  it('lit le zoom max dans un GetCapabilities', () => {
    const xml = `<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1"><Contents>
      <Layer><ows:Identifier>GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN25TOUR</ows:Identifier><Format>image/jpeg</Format>
      <TileMatrixSetLink><TileMatrixSet>PM</TileMatrixSet><TileMatrixSetLimits>
      <TileMatrixLimits><TileMatrix>6</TileMatrix></TileMatrixLimits><TileMatrixLimits><TileMatrix>16</TileMatrix></TileMatrixLimits>
      </TileMatrixSetLimits></TileMatrixSetLink></Layer></Contents></Capabilities>`;
    expect(parseCapabilities(xml, 'GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN25TOUR')).toEqual({ found: true, formats: ['image/jpeg'], minZoom: 6, maxZoom: 16 });
    expect(parseCapabilities(xml, 'AUTRE').found).toBe(false);
  });
});

describe('GPS économe', () => {
  const now = 10 * 60_000;
  const base = { mode: 'rando' as const, appVisible: true, battery: 0.8, now, stopPoint: null };
  const recentKept = fix({ time: now - 20_000 });

  it('applique le mode demandé quand tout va bien', () => {
    const d = decideSettings({ ...base, lastKept: recentKept, latest: recentKept });
    expect(d.settings).toMatchObject({ priority: 'high', intervalMs: 5000, minDistanceM: 10, maxDelayMs: 0 });
    expect(d.reasons).toEqual([]);
  });
  it("passe en précision équilibrée après 2 min sans position retenue, et en sort à plus de 50 m", () => {
    const stop = fix({ time: now - 121_000 });
    expect(isStationary(stop, now)).toBe(true);
    expect(isStationary(recentKept, now)).toBe(false);
    const d = decideSettings({ ...base, lastKept: stop, latest: stop });
    expect(d.settings.priority).toBe('balanced');
    expect(d.settings.intervalMs).toBe(60_000);
    expect(d.stopPoint).toBe(stop);
    // Toujours sur place (20 m) : on reste en mode arrêt, positions regroupées par 120 s écran éteint.
    const near = fix({ time: now + 1000, lat: 43.17018 });
    const again = decideSettings({ ...base, appVisible: false, lastKept: stop, latest: near, stopPoint: stop });
    expect(again.stopPoint).toBe(stop);
    expect(again.settings.maxDelayMs).toBe(120_000);
    // À plus de 50 m du point d'arrêt : retour en haute précision.
    const far = fix({ time: now + 2000, lat: 43.1706 });
    const moved = decideSettings({ ...base, lastKept: far, latest: far, stopPoint: stop, now: now + 2000 });
    expect(moved.stopPoint).toBeNull();
    expect(moved.settings.priority).toBe('high');
  });
  it('regroupe les positions en arrière-plan et passe en éco sur batterie faible', () => {
    const d = decideSettings({ ...base, mode: 'velo', appVisible: false, battery: 0.1, lastKept: recentKept, latest: recentKept });
    expect(d.settings.minDistanceM).toBe(50);
    expect(d.settings.maxDelayMs).toBe(120_000); // max(60 s, 4 × 30 s)
    expect(d.reasons).toContain('batterie faible');
  });
  it('filtre les positions imprécises, les sauts et les points trop proches', () => {
    const a = fix({ time: 0 });
    expect(judgeFix(fix({ accuracy: 80 }), a, DEFAULT_FILTER)).toBe('imprecise');
    expect(judgeFix(fix({ lat: 43.2, time: 1000 }), a, DEFAULT_FILTER)).toBe('jump');
    expect(judgeFix(fix({ lat: 43.17003, time: 5000 }), a, DEFAULT_FILTER)).toBe('too-close');
    expect(judgeFix(fix({ lat: 43.1702, time: 20000 }), a, DEFAULT_FILTER)).toBe('ok');
    expect(judgeFix(fix({ lat: 43.1702, time: 1000 }), a, filterForMode('rando'))).toBe('too-soon');
  });
});

describe('traces', () => {
  const ref = parseGpx(readFileSync('public/la-ciotat-rando.gpx', 'utf8'));

  it('lit la trace de référence', () => {
    expect(ref.points.length).toBe(3952);
    const s = computeStats(ref.points);
    expect(s.distanceM / 1000).toBeCloseTo(4.94, 1);
    expect(s.gainM).toBeGreaterThan(150);
    expect(s.durationMs).toBe(3951_000);
  });
  it('ignore le bruit d\'altitude sous le seuil', () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({ lat: 43, lon: 5 + i * 1e-4, ele: 100 + (i % 2 ? 4 : -4), time: i * 1000 }));
    expect(computeStats(pts).gainM).toBe(0);
  });
  it('relit à l\'identique un GPX exporté', () => {
    const t = { name: 'Test <&>', points: ref.points.slice(0, 20) };
    const back = parseGpx(toGpx(t));
    expect(back.name).toBe('Test <&>');
    expect(back.points).toEqual(t.points.map((p) => ({ ...p, lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), ele: +p.ele!.toFixed(1) })));
  });
});
