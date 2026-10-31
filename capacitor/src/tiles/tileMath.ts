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
