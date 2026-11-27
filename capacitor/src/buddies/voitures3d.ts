/**
 * 🚗 Les voitures garées en 3D (Seb, 27/11 : « quand on est en 3D, on peut faire des voitures en 3D ? »).
 * Carte inclinée : chaque voiture devient une petite maquette posée sur le relief, avec la silhouette et la couleur
 * du profil (rouge et citadine si rien n'est choisi). Pas de modèle à télécharger : quelques blocs extrudés par
 * MapLibre (roues, caisse, vitres, toit), calculés ici, hors ligne. Toujours vue de profil, l'avant à droite comme
 * en 2D, et toujours à la même taille à l'écran (une vraie voiture ferait quelques pixels).
 * Le badge des initiales, l'heure et l'appui pour le détail restent les marqueurs HTML de Positions.tsx.
 */
import type { Map as MlMap, GeoJSONSource } from 'maplibre-gl';
import { COULEURS, FORMES, type Couleur, type Forme } from './voitureDessin';

/** Longueur, largeur, haut de la caisse, cabine (de l'arrière 0 à l'avant 1, hauteur du toit), roues, en mètres. */
type Gabarit = { l: number; w: number; caisse: number; cab: [number, number, number]; roue: number; vitre?: 'pleine' };
const GABARITS: Record<Forme, Gabarit> = {
  citadine: { l: 3.9, w: 1.75, caisse: 1.0, cab: [0.2, 0.75, 1.5], roue: 0.62 },
  berline: { l: 4.7, w: 1.8, caisse: 0.95, cab: [0.28, 0.7, 1.45], roue: 0.64 },
  break: { l: 4.7, w: 1.8, caisse: 0.95, cab: [0.04, 0.72, 1.5], roue: 0.64 },
  suv: { l: 4.5, w: 1.85, caisse: 1.15, cab: [0.05, 0.72, 1.7], roue: 0.75 },
  van: { l: 4.9, w: 1.95, caisse: 1.1, cab: [0.02, 0.86, 2.0], roue: 0.66 },
  camping: { l: 6.5, w: 2.2, caisse: 1.1, cab: [0, 0.8, 2.9], roue: 0.7, vitre: 'pleine' },
  pickup: { l: 5.3, w: 1.9, caisse: 1.0, cab: [0.45, 0.76, 1.8], roue: 0.75 },
  cabriolet: { l: 4.3, w: 1.8, caisse: 0.9, cab: [0.55, 0.6, 1.25], roue: 0.62 },
};
const VITRE = '#bfe0f2', PNEU = '#1c1f24';

/** Taille à l'écran : une berline fait environ 90 px de long, quel que soit le zoom. */
const PX = 90, L_REF = 4.7;

export type Voiture3d = { qui: string; lon: number; lat: number; forme?: string | null; couleur?: string | null };
type Bloc = { x0: number; x1: number; y0: number; y1: number; b: number; h: number; c: string };

/** Les blocs d'une voiture, en mètres (x vers l'avant, y vers la gauche, centre au milieu). */
export function blocs(forme: Forme, couleur: string): Bloc[] {
  const g = GABARITS[forme], x = (f: number) => (f - 0.5) * g.l, w = g.w / 2, r = g.roue / 2;
  const roues = [0.18, 0.82].flatMap((f) => [-1, 1].map((cote) => ({
    x0: x(f) - r, x1: x(f) + r, y0: cote * w - cote * 0.3, y1: cote * w, b: 0, h: g.roue, c: PNEU,
  })));
  const [a, av, toit] = g.cab;
  const l: Bloc[] = [...roues, { x0: -g.l / 2, x1: g.l / 2, y0: -w, y1: w, b: r * 0.9, h: g.caisse, c: couleur }];
  if (forme === 'cabriolet') {
    l.push({ x0: x(a), x1: x(av), y0: -w + 0.12, y1: w - 0.12, b: g.caisse, h: toit, c: VITRE }); // pare-brise
  } else if (g.vitre === 'pleine') {
    // Camping-car : la cellule de la couleur choisie, le pare-brise de la cabine devant.
    l.push({ x0: x(a), x1: x(av), y0: -w + 0.05, y1: w - 0.05, b: g.caisse, h: toit, c: couleur });
    l.push({ x0: x(av), x1: x(0.93), y0: -w + 0.15, y1: w - 0.15, b: g.caisse, h: 1.9, c: VITRE });
  } else {
    l.push({ x0: x(a), x1: x(av), y0: -w + 0.15, y1: w - 0.15, b: g.caisse, h: toit - 0.14, c: VITRE });
    l.push({ x0: x(a) + 0.05, x1: x(av) - 0.05, y0: -w + 0.12, y1: w - 0.12, b: toit - 0.14, h: toit, c: couleur });
  }
  return l;
}

/** Les blocs en GeoJSON autour du point, agrandis de `k`, l'avant vers le cap `cap` (degrés, 0 = nord).
 * `altitude` (relief de la carte) : MapLibre pose chaque bloc à l'altitude de son propre centre ; sur une pente, la
 * voiture se disloquerait (cabine décalée, roues à des hauteurs différentes). On ramène chaque bloc à l'altitude de la
 * voiture (son point) ; les roues, posées au sol, s'allongent jusqu'au terrain côté pente. */
export function polygones(v: Voiture3d, k: number, cap: number, altitude?: (lon: number, lat: number) => number | null): GeoJSON.Feature[] {
  const forme = FORMES.includes(v.forme as Forme) ? v.forme as Forme : 'citadine';
  const couleur = COULEURS[(v.couleur && v.couleur in COULEURS ? v.couleur : 'rouge') as Couleur];
  const t = cap * Math.PI / 180, ax = [Math.sin(t), Math.cos(t)], ay = [-Math.cos(t), Math.sin(t)];
  const mLon = 111320 * Math.cos(v.lat * Math.PI / 180), mLat = 110540;
  const pt = (x: number, y: number): [number, number] =>
    [v.lon + (x * ax[0] + y * ay[0]) * k / mLon, v.lat + (x * ax[1] + y * ay[1]) * k / mLat];
  const bs = blocs(forme, couleur).map((b) => {
    const anneau = [pt(b.x0, b.y0), pt(b.x1, b.y0), pt(b.x1, b.y1), pt(b.x0, b.y1), pt(b.x0, b.y0)];
    // Le centre pris par MapLibre : la moyenne des points de l'anneau.
    const z = altitude?.(anneau.reduce((a, p) => a + p[0], 0) / 5, anneau.reduce((a, p) => a + p[1], 0) / 5) ?? null;
    return { b, anneau, z };
  });
  const ici = altitude?.(v.lon, v.lat) ?? null;
  return bs.map(({ b, anneau, z }) => {
    const dz = z == null || ici == null ? 0 : ici - z;
    return {
      type: 'Feature',
      properties: { c: b.c, b: b.b ? Math.max(0, b.b * k + dz) : 0, h: Math.max(0, b.h * k + dz), qui: v.qui },
      geometry: { type: 'Polygon', coordinates: [anneau] },
    };
  });
}

/** Pose les voitures en 3D sur la carte ; elles n'apparaissent que carte inclinée (relief allumé). Rend le nettoyage. */
export function voitures3d(map: MlMap, vs: Voiture3d[]): () => void {
  const SRC = 'voitures3d';
  const donnees = (): GeoJSON.FeatureCollection => {
    const c = map.getCenter(), z = map.getZoom();
    // Mètres par pixel à ce zoom (tuiles de 512 px) : la voiture garde ~90 px de long.
    const mpp = 78271.517 * Math.cos(c.lat * Math.PI / 180) / 2 ** z;
    const k = Math.max(1, PX * mpp / L_REF);
    return { type: 'FeatureCollection', features: vs.flatMap((v) => polygones(v, k, map.getBearing() + 90, (lon, lat) => map.queryTerrainElevation([lon, lat]))) };
  };
  const en3d = () => !!map.getTerrain();
  let attente = 0;
  const maj = () => {
    if (attente) return;
    attente = requestAnimationFrame(() => {
      attente = 0;
      const s = map.getSource(SRC) as GeoJSONSource | undefined;
      if (s) s.setData(en3d() ? donnees() : { type: 'FeatureCollection', features: [] });
      // En 3D, le dessin à plat s'efface : il ne reste que le badge, l'heure et la zone à toucher (styles.css).
      map.getContainer().classList.toggle('voitures-3d', en3d());
    });
  };
  const poser = () => {
    if (map.getSource(SRC) || !map.isStyleLoaded()) return;
    map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: SRC, type: 'fill-extrusion', source: SRC,
      paint: { 'fill-extrusion-color': ['get', 'c'], 'fill-extrusion-base': ['get', 'b'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 1 },
    });
    maj();
  };
  const enlever = () => {
    if (map.getLayer(SRC)) map.removeLayer(SRC);
    if (map.getSource(SRC)) map.removeSource(SRC);
  };
  // Le style peut se recharger (changement de fond) : on se repose dessus.
  const surStyle = () => { poser(); maj(); };
  if (map.isStyleLoaded()) poser();
  map.on('styledata', surStyle);
  map.on('terrain', maj);
  map.on('zoom', maj);
  map.on('rotate', maj);
  map.on('pitch', maj);
  map.on('moveend', maj); // relief arrivé entre-temps
  return () => {
    cancelAnimationFrame(attente);
    map.off('styledata', surStyle);
    map.off('terrain', maj);
    map.off('zoom', maj);
    map.off('rotate', maj);
    map.off('pitch', maj);
    map.off('moveend', maj);
    map.getContainer().classList.remove('voitures-3d');
    try { enlever(); } catch { /* carte déjà détruite */ }
  };
}
