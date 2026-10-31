import { capabilitiesUrl, type LayerDef } from '../config';

export interface LayerCapability { found: boolean; minZoom?: number; maxZoom?: number; formats?: string[] }

/** Lit le GetCapabilities pour vérifier la clé, le nom de couche et le zoom max réellement servi en PM. */
export async function checkLayer(layer: LayerDef, apiKey: string): Promise<LayerCapability> {
  const res = await fetch(capabilitiesUrl(layer, apiKey));
  if (!res.ok) throw new Error(`GetCapabilities HTTP ${res.status}`);
  return parseCapabilities(await res.text(), layer.wmtsLayer);
}

export function parseCapabilities(xml: string, layerName: string): LayerCapability {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const layers = [...doc.getElementsByTagNameNS('*', 'Layer')];
  const layer = layers.find((l) => l.getElementsByTagNameNS('*', 'Identifier')[0]?.textContent === layerName);
  if (!layer) return { found: false };
  const formats = [...layer.getElementsByTagNameNS('*', 'Format')].map((f) => f.textContent ?? '');
  const link = [...layer.getElementsByTagNameNS('*', 'TileMatrixSetLink')].find(
    (l) => l.getElementsByTagNameNS('*', 'TileMatrixSet')[0]?.textContent === 'PM',
  );
  const zooms = link
    ? [...link.getElementsByTagNameNS('*', 'TileMatrix')].map((m) => Number(m.textContent)).filter((n) => !Number.isNaN(n))
    : [];
  return {
    found: true,
    formats,
    minZoom: zooms.length ? Math.min(...zooms) : undefined,
    maxZoom: zooms.length ? Math.max(...zooms) : undefined,
  };
}
