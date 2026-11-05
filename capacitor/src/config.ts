// Paramètres du scénario commun (voir docs/SCENARIO.md) : ne pas les changer
// sans changer aussi le prototype Kotlin, sinon les mesures ne sont plus comparables.

export type Bbox = [minLon: number, minLat: number, maxLon: number, maxLat: number];

export const LA_CIOTAT_BBOX: Bbox = [5.55, 43.15, 5.66, 43.21];
export const LA_CIOTAT_CENTER: [number, number] = [5.6, 43.172];
export const OFFLINE_MIN_ZOOM = 10;
export const OFFLINE_MAX_ZOOM = 16;
export const DISPLAY_MAX_ZOOM = 18;

/**
 * Carte « Auto » (même réglage que le prototype Kotlin, Scenario.kt) : Plan IGN de loin,
 * SCAN 25 de près, fondu entre les zooms 12 et 13 (SCAN 25 plein dès le zoom 13, barre d’échelle « 500 m »).
 * Hors ligne en Auto : Plan IGN z10-12 + SCAN 25 z12-16.
 */
export const AUTO_SCAN_FROM = 12;
export const AUTO_PLAN_UNTIL = 13;
export type BaseMode = 'auto' | 'scan25' | 'planign';
export const BASE_MODES: Record<BaseMode, string> = {
  auto: 'Carte auto',
  scan25: 'SCAN 25',
  planign: 'Plan IGN',
};

/** Couches et zooms à télécharger pour un fond donné, dans l'ordre. */
export function offlinePlan(mode: BaseMode, min: number, max: number): { layer: string; minZoom: number; maxZoom: number }[] {
  if (mode === 'auto') {
    return [
      { layer: 'planign', minZoom: min, maxZoom: Math.min(max, AUTO_SCAN_FROM) },
      { layer: 'scan25', minZoom: Math.max(min, AUTO_SCAN_FROM), maxZoom: Math.min(max, LAYERS.scan25.maxNativeZoom) },
    ];
  }
  return [{ layer: mode, minZoom: min, maxZoom: Math.min(max, LAYERS[mode].maxNativeZoom) }];
}

export interface LayerDef {
  id: string;
  label: string;
  wmtsLayer: string;
  format: 'image/jpeg' | 'image/png' | 'image/x-bil;bits=32';
  ext: 'jpg' | 'png' | 'bil';
  /** true : flux privé data.geopf.fr/private/wmts, clé obligatoire. */
  needsKey: boolean;
  maxNativeZoom: number;
  attribution: string;
}

export const LAYERS: Record<string, LayerDef> = {
  scan25: {
    id: 'scan25',
    label: 'SCAN 25 (1:25 000)',
    wmtsLayer: 'GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN25TOUR',
    format: 'image/jpeg',
    ext: 'jpg',
    needsKey: true,
    maxNativeZoom: 16,
    attribution: '© IGN – SCAN 25®',
  },
  planign: {
    id: 'planign',
    label: 'Plan IGN v2',
    wmtsLayer: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2',
    format: 'image/png',
    ext: 'png',
    needsKey: false,
    maxNativeZoom: 19,
    attribution: '© IGN – Plan IGN (Etalab 2.0)',
  },
  // Surcouche pentes > 30° (zones de montagne). Nom de couche à confirmer par GetCapabilities.
  slopes: {
    id: 'slopes',
    label: 'Pentes > 30°',
    wmtsLayer: 'GEOGRAPHICALGRIDSYSTEMS.SLOPES.MOUNTAIN',
    format: 'image/png',
    ext: 'png',
    needsKey: false,
    maxNativeZoom: 17,
    attribution: '© IGN',
  },
};

/** Clé transitoire publiée par l'IGN en 2024 pour les SCAN ; remplacer par une clé personnelle cartes.gouv.fr. */
export const DEFAULT_SCAN_KEY = 'ign_scan_ws';

export function wmtsTileUrl(layer: LayerDef, z: number, x: number, y: number, apiKey: string): string {
  const base = layer.needsKey ? 'https://data.geopf.fr/private/wmts' : 'https://data.geopf.fr/wmts';
  const params = new URLSearchParams({
    SERVICE: 'WMTS',
    REQUEST: 'GetTile',
    VERSION: '1.0.0',
    LAYER: layer.wmtsLayer,
    STYLE: 'normal',
    TILEMATRIXSET: 'PM',
    TILEMATRIX: String(z),
    TILEROW: String(y),
    TILECOL: String(x),
    FORMAT: layer.format,
  });
  if (layer.needsKey) params.set('apikey', apiKey);
  return `${base}?${params}`;
}

export function capabilitiesUrl(layer: LayerDef, apiKey: string): string {
  return layer.needsKey
    ? `https://data.geopf.fr/private/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetCapabilities&apikey=${encodeURIComponent(apiKey)}`
    : 'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetCapabilities';
}
