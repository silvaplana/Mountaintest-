import * as maplibregl from 'maplibre-gl';
import { LAYERS, wmtsTileUrl } from '../config';
import { metrics } from '../metrics';
import { getTileStore } from './offlineStore';

export interface ProtocolOptions {
  getApiKey: () => string;
  /** Garder les tuiles vues en ligne pour les retrouver hors ligne. */
  cacheViewedTiles: () => boolean;
}

/**
 * Protocole « ign://<couche>/<z>/<x>/<y> » : disque d'abord, réseau ensuite.
 * Hors ligne, une tuile absente renvoie une erreur et MapLibre garde le niveau inférieur affiché.
 */
export function registerIgnProtocol(opts: ProtocolOptions) {
  maplibregl.addProtocol('ign', async (params, abort) => {
    const t0 = performance.now();
    const [layerId, z, x, y] = params.url.slice('ign://'.length).split('/');
    const layer = LAYERS[layerId];
    const tile = { z: +z, x: +x, y: +y };
    const store = await getTileStore(layer);
    try {
      const local = await store.read(tile);
      if (local) {
        metrics.tilesFromDisk++;
        return { data: local };
      }
      const res = await fetch(wmtsTileUrl(layer, tile.z, tile.x, tile.y, opts.getApiKey()), { signal: abort.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.arrayBuffer();
      metrics.tilesFromNetwork++;
      if (opts.cacheViewedTiles()) store.put(tile, data).catch(() => {});
      return { data };
    } catch (e) {
      metrics.tileErrors++;
      throw e;
    } finally {
      metrics.tileLoadTotalMs += performance.now() - t0;
    }
  });
}
