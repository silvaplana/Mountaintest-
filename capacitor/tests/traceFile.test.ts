// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseTraceFile, baseName } from '../src/trails/traceFile';
import { locateOnLine, navState } from '../src/trails/navigation';
import { nextMine, TRACE_COLORS, drawnTrail } from '../src/trails/route';
import { tilesForCorridor, tilesForBbox } from '../src/tiles/tileMath';
import { buildProfile } from '../src/trails/profile';

describe('chargement de fichier de trace', () => {
  it('lit un GPX à plusieurs segments', () => {
    const t = parseTraceFile(`<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>Meta</name></metadata>
      <trk><name>Calanques</name><trkseg><trkpt lat="43.2" lon="5.6"/><trkpt lat="43.21" lon="5.61"/></trkseg>
      <trkseg><trkpt lat="43.22" lon="5.62"/></trkseg></trk></gpx>`, 'x.gpx');
    expect(t.name).toBe('Calanques');
    expect(t.line).toHaveLength(3);
    expect(t.line[2]).toEqual({ lon: 5.62, lat: 43.22 });
  });
  it('lit une route GPX sans nom : nom du fichier', () => {
    const t = parseTraceFile('<gpx><rte><rtept lat="45" lon="6"/><rtept lat="45.1" lon="6.1"/></rte></gpx>', '/Download/Tour du Mont.gpx');
    expect(t.name).toBe('Tour du Mont');
    expect(t.line).toHaveLength(2);
  });
  it('lit un KML (LineString et gx:Track)', () => {
    const a = parseTraceFile(`<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Doc</name><Placemark><name>Crête</name>
      <LineString><coordinates>6.1,45.1,1200 6.2,45.2,1300
      6.3,45.3</coordinates></LineString></Placemark></Document></kml>`);
    expect(a.name).toBe('Crête');
    expect(a.line.map((p) => p.lon)).toEqual([6.1, 6.2, 6.3]);
    const b = parseTraceFile(`<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Placemark>
      <gx:Track><gx:coord>6.1 45.1 100</gx:coord><gx:coord>6.2 45.2 110</gx:coord></gx:Track></Placemark></kml>`, 'piste.kml');
    expect(b.name).toBe('piste');
    expect(b.line).toHaveLength(2);
  });
  it('lit un GeoJSON (FeatureCollection, MultiLineString)', () => {
    const t = parseTraceFile(JSON.stringify({ type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { name: 'Point' }, geometry: { type: 'Point', coordinates: [1, 1] } },
      { type: 'Feature', properties: { name: 'Boucle' }, geometry: { type: 'MultiLineString', coordinates: [[[6, 45], [6.1, 45.1]], [[6.2, 45.2], [6.3, 45.3]]] } },
    ] }));
    expect(t.name).toBe('Boucle');
    expect(t.line).toHaveLength(4);
  });
  it('refuse un fichier sans trace', () => {
    expect(() => parseTraceFile('<gpx><wpt lat="1" lon="1"/></gpx>')).toThrow(/aucune trace/);
    expect(() => parseTraceFile('<html></html>')).toThrow(/format/);
    expect(baseName('a/b/c.d.gpx')).toBe('c.d');
  });
});

describe('navigation sur une trace', () => {
  const line = [{ lon: 6, lat: 45 }, { lon: 6.01, lat: 45 }, { lon: 6.02, lat: 45 }];
  it('situe la position sur la trace', () => {
    const r = locateOnLine(line, { lon: 6.005, lat: 45.0009 });
    expect(r.offM).toBeGreaterThan(90); expect(r.offM).toBeLessThan(110);
    expect(r.alongM).toBeGreaterThan(380); expect(r.alongM).toBeLessThan(410);
    expect(r.totalM).toBeGreaterThan(1560); expect(r.totalM).toBeLessThan(1590);
  });
  it('reste à faire, montée restante', () => {
    const prof = buildProfile([[{ ...line[0], ele: 1000 }, { ...line[1], ele: 1100 }, { ...line[2], ele: 1050 }]]);
    const n = navState(line, { lon: 6.0101, lat: 45 }, prof);
    expect(n.offM).toBeLessThan(1);
    expect(n.remainingM).toBeGreaterThan(770); expect(n.remainingM).toBeLessThan(790);
    expect(n.gainLeftM).toBe(0); expect(n.lossLeftM).toBe(50);
    expect(navState(line, line[0], null).gainLeftM).toBeNull();
  });
});

describe('plusieurs traces et hors ligne', () => {
  it('donne un identifiant et une couleur libres', () => {
    const a = drawnTrail([{ lon: 0, lat: 0 }, { lon: 1, lat: 1 }], false);
    expect(nextMine([])).toEqual({ id: -1, color: TRACE_COLORS[0] });
    expect(nextMine([a])).toEqual({ id: -2, color: TRACE_COLORS[1] });
    expect(nextMine([{ ...a, id: -3, color: TRACE_COLORS[1] }, { ...a, id: 5, color: TRACE_COLORS[0] }])).toEqual({ id: -4, color: TRACE_COLORS[0] });
  });
  it('couloir : bien moins de tuiles que le rectangle', () => {
    const diag = [{ lon: 6, lat: 45 }, { lon: 6.2, lat: 45.2 }];
    const c = tilesForCorridor(diag, 1000, 16, 16);
    const r = tilesForBbox([6, 45, 6.2, 45.2], 16, 16);
    expect(c.length).toBeGreaterThan(100);
    expect(c.length).toBeLessThan(r.length / 3);
    expect(new Set(c.map((t) => `${t.x}/${t.y}`)).size).toBe(c.length);
  });
});
