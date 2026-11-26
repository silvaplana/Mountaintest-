import { describe, expect, it } from 'vitest';
import { dronesWfsUrl, parseDroneZones, zoneStyle } from '../src/drones/droneZones';

describe('zones drones hors ligne', () => {
  it('demande le rectangle en latitude puis longitude', () => {
    const u = new URL(dronesWfsUrl([6.0, 44.4, 6.6, 44.8]));
    expect(u.searchParams.get('TYPENAMES')).toBe('TRANSPORTS.DRONES.RESTRICTIONS:carte_restriction_drones_lf');
    expect(u.searchParams.get('BBOX')).toBe('44.40000,6.00000,44.80000,6.60000,urn:ogc:def:crs:EPSG::4326');
  });

  it('rouge pour « Vol interdit », orange avec la hauteur sinon', () => {
    expect(zoneStyle('Vol interdit *')).toEqual({ color: '#e3170a', short: 'Vol interdit' });
    expect(zoneStyle('Hauteur maximale de vol de 50 m')).toEqual({ color: '#ff9900', short: 'Hauteur maximale 50 m' });
  });

  it('garde la géométrie, la couleur et le texte à montrer', () => {
    const f = parseDroneZones({ features: [
      { type: 'Feature', id: 'carte_restriction_drones_lf.2400',
        properties: { limite: 'Vol interdit *', remarque: 'Évolution interdite en espace public en agglomération.' },
        geometry: { type: 'MultiPolygon', coordinates: [[[[6, 44], [6.1, 44], [6.1, 44.1], [6, 44]]]] } },
      { type: 'Feature', properties: {}, geometry: null as unknown as GeoJSON.Geometry },
    ] });
    expect(f).toHaveLength(1);
    expect(f[0].properties).toEqual({ color: '#e3170a', text: 'Vol interdit · Évolution interdite en espace public en agglomération.' });
  });
});
