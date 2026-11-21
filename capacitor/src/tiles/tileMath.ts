import type { Bbox } from '../config';

export interface TileCoord { z: number; x: number; y: number }

const rad = (d: number) => (d * Math.PI) / 180;

export function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

export function latToTileY(lat: number, z: number): number {
  const r = rad(lat);
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

/** Toutes les tuiles Web Mercator couvrant la bbox, du zoom min au zoom max inclus. */
export function tilesForBbox(bbox: Bbox, minZoom: number, maxZoom: number): TileCoord[] {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const tiles: TileCoord[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const x0 = lonToTileX(minLon, z), x1 = lonToTileX(maxLon, z);
    const y0 = latToTileY(maxLat, z), y1 = latToTileY(minLat, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push({ z, x, y });
  }
  return tiles;
}

/** Largeur du couloir téléchargé de part et d'autre d'une trace (📶 Hors ligne du menu de la trace). */
export const CORRIDOR_M = 1000;

/**
 * Tuiles couvrant un couloir autour d'une ligne : on avance le long de la trace par petits pas
 * et on prend les tuiles du carré de ± bufferM autour de chaque point. Même calcul côté Kotlin.
 */
export function tilesForCorridor(line: { lon: number; lat: number }[], bufferM: number, minZoom: number, maxZoom: number): TileCoord[] {
  const pts: { lon: number; lat: number }[] = [];
  const step = Math.max(50, bufferM / 2);
  for (let i = 0; i < line.length; i++) {
    const a = line[i];
    pts.push(a);
    const b = line[i + 1];
    if (!b) break;
    const k = Math.cos(rad(a.lat));
    const d = Math.hypot((b.lon - a.lon) * k, b.lat - a.lat) * 111_320;
    for (let s = step; s < d; s += step) pts.push({ lon: a.lon + ((b.lon - a.lon) * s) / d, lat: a.lat + ((b.lat - a.lat) * s) / d });
  }
  const seen = new Set<string>();
  const out: TileCoord[] = [];
  for (const p of pts) {
    const dLat = bufferM / 111_320, dLon = dLat / Math.cos(rad(p.lat));
    for (const t of tilesForBbox([p.lon - dLon, p.lat - dLat, p.lon + dLon, p.lat + dLat], minZoom, maxZoom)) {
      const key = `${t.z}/${t.x}/${t.y}`;
      if (!seen.has(key)) { seen.add(key); out.push(t); }
    }
  }
  return out;
}

/** Rectangle englobant d'une ligne, élargi de marginM. */
export function lineBbox(line: { lon: number; lat: number }[], marginM = 0): Bbox {
  const lons = line.map((p) => p.lon), lats = line.map((p) => p.lat);
  const dLat = marginM / 111_320, dLon = dLat / Math.cos(rad((Math.min(...lats) + Math.max(...lats)) / 2));
  return [Math.min(...lons) - dLon, Math.min(...lats) - dLat, Math.max(...lons) + dLon, Math.max(...lats) + dLat];
}
