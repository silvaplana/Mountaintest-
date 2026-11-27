// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { FORMES } from '../src/buddies/voitureDessin';
import { blocs, polygones, voitures3d } from '../src/buddies/voitures3d';

describe('Voitures garées en 3D (Seb, 27/11)', () => {
  it('a une maquette pour chaque silhouette, à la couleur choisie', () => {
    for (const f of FORMES) {
      const bs = blocs(f, '#1e5fb4');
      expect(bs.filter((b) => b.c === '#1c1f24')).toHaveLength(4); // quatre roues
      expect(bs.some((b) => b.c === '#1e5fb4')).toBe(true);
      for (const b of bs) expect(b.h).toBeGreaterThan(b.b);
    }
    expect(Math.max(...blocs('camping', '#fff').map((b) => b.h))).toBeGreaterThan(Math.max(...blocs('citadine', '#fff').map((b) => b.h)));
  });
  it('sans silhouette ni couleur : la citadine rouge', () => {
    const fs = polygones({ qui: 'a', lon: 6, lat: 45 }, 1, 90);
    expect(fs.map((f) => f.properties!.c)).toContain('#d32f2f');
    expect(fs).toHaveLength(blocs('citadine', '#d32f2f').length);
  });
  it("pose la voiture autour de son point, l'avant vers le cap demandé", () => {
    const fs = polygones({ qui: 'a', lon: 6, lat: 45, forme: 'berline', couleur: 'bleu' }, 10, 90);
    const xs = fs.flatMap((f) => (f.geometry as GeoJSON.Polygon).coordinates[0].map((p) => p[0]));
    const ys = fs.flatMap((f) => (f.geometry as GeoJSON.Polygon).coordinates[0].map((p) => p[1]));
    // Cap 90 (est) : longue de 47 m d'ouest en est, large de 18 m environ.
    expect((Math.max(...xs) - Math.min(...xs)) * 111320 * Math.cos(45 * Math.PI / 180)).toBeCloseTo(47, 0);
    expect((Math.max(...ys) - Math.min(...ys)) * 110540).toBeLessThan(20);
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(6, 6);
  });
  it('sur une pente, les blocs restent à la hauteur de la voiture', () => {
    // Le terrain monte vers l'est : sans correction, la cabine et les roues avant monteraient avec lui.
    const pente = (lon: number) => (lon - 6) * 111320 * Math.cos(45 * Math.PI / 180) * 0.3;
    const plat = polygones({ qui: 'a', lon: 6, lat: 45, forme: 'berline' }, 10, 90);
    const fs = polygones({ qui: 'a', lon: 6, lat: 45, forme: 'berline' }, 10, 90, (lon) => pente(lon));
    fs.forEach((f, i) => {
      const anneau = (f.geometry as GeoJSON.Polygon).coordinates[0];
      const z = pente(anneau.reduce((a, p) => a + p[0], 0) / 5);
      // Haut du bloc en altitude absolue = celui de la voiture à plat.
      expect(f.properties!.h + z).toBeCloseTo(plat[i].properties!.h, 6);
    });
  });
});

describe('Voitures 3D sur une vraie carte (Seb, 27/11 : la voiture noire disparaissait)', () => {
  it('pose le calque même pendant que des tuiles chargent', () => {
    // Sur le téléphone, isStyleLoaded() reste faux tant qu'une tuile (fond, relief) arrive : le calque n'était jamais créé.
    const sources = new Map<string, unknown>(), calques: string[] = [];
    const ecoute = new Map<string, () => void>();
    const map = {
      isStyleLoaded: () => false,
      getSource: (id: string) => sources.get(id),
      addSource: (id: string, s: unknown) => { sources.set(id, { ...(s as object), setData: () => {} }); },
      getLayer: (id: string) => calques.includes(id),
      addLayer: (l: { id: string }) => { calques.push(l.id); },
      removeLayer: () => {}, removeSource: () => {},
      on: (e: string, f: () => void) => { ecoute.set(e, f); }, off: () => {},
      getTerrain: () => ({}), getCenter: () => ({ lat: 45, lng: 6 }), getZoom: () => 16, getBearing: () => 0,
      queryTerrainElevation: () => 100, getContainer: () => document.createElement('div'),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    voitures3d(map as any, [{ qui: 'moi', lon: 6, lat: 45, forme: 'berline', couleur: 'noir' }]);
    expect(calques).toContain('voitures3d');
  });
});
