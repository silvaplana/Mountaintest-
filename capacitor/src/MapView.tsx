import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useRef, useState } from 'react';
import { DISPLAY_MAX_ZOOM, LA_CIOTAT_CENTER, LAYERS } from './config';
import { bench, metrics } from './metrics';
import { toLineString, type TrackPoint } from './track/gpx';

export interface MapViewProps {
  baseLayer: 'scan25' | 'planign';
  showSlopes: boolean;
  recorded: TrackPoint[];
  imported: TrackPoint[];
  position: { lat: number; lon: number } | null;
  follow: boolean;
  /** Faux quand l'appli est en arrière-plan : on ne redessine rien pour économiser la batterie. */
  visible: boolean;
  onMapReady?: (map: MlMap) => void;
}

// Le worker MapLibre est empaqueté par Vite avec l'appli : il marche hors ligne.
maplibregl.setWorkerUrl(workerUrl);

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function rasterSource(layerId: string): maplibregl.RasterSourceSpecification {
  const l = LAYERS[layerId];
  return { type: 'raster', tiles: [`ign://${l.id}/{z}/{x}/{y}`], tileSize: 256, maxzoom: l.maxNativeZoom, attribution: l.attribution };
}

export function MapView(props: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current!,
      center: LA_CIOTAT_CENTER,
      zoom: 14,
      maxZoom: DISPLAY_MAX_ZOOM,
      // Un écran 3x dessine 2,25 fois plus de pixels qu'en 2x pour un gain peu visible sur des cartes raster.
      pixelRatio: Math.min(window.devicePixelRatio, 2),
      fadeDuration: 0,
      attributionControl: { compact: true },
      style: {
        version: 8,
        sources: { scan25: rasterSource('scan25'), planign: rasterSource('planign'), slopes: rasterSource('slopes'),
          recorded: { type: 'geojson', data: EMPTY }, imported: { type: 'geojson', data: EMPTY }, me: { type: 'geojson', data: EMPTY } },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#f2efe6' } },
          { id: 'scan25', type: 'raster', source: 'scan25' },
          { id: 'planign', type: 'raster', source: 'planign', layout: { visibility: 'none' } },
          { id: 'slopes', type: 'raster', source: 'slopes', paint: { 'raster-opacity': 0.6 }, layout: { visibility: 'none' } },
          { id: 'imported', type: 'line', source: 'imported', paint: { 'line-color': '#7b3fe4', 'line-width': 4, 'line-opacity': 0.8 } },
          { id: 'recorded', type: 'line', source: 'recorded', paint: { 'line-color': '#e4572e', 'line-width': 4 } },
          { id: 'me', type: 'circle', source: 'me', paint: { 'circle-radius': 7, 'circle-color': '#1d6fe0', 'circle-stroke-width': 3, 'circle-stroke-color': '#fff' } },
        ],
      },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), 'top-right');
    m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    m.once('idle', () => {
      metrics.firstMapRenderMs = Math.round(performance.now() - metrics.appStart);
      bench('startup', { startup: 'map_idle', ms: metrics.firstMapRenderMs });
    });
    m.on('load', () => {
      setReady(true);
      props.onMapReady?.(m);
    });
    map.current = m;
    return () => m.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    m.setLayoutProperty('scan25', 'visibility', props.baseLayer === 'scan25' ? 'visible' : 'none');
    m.setLayoutProperty('planign', 'visibility', props.baseLayer === 'planign' ? 'visible' : 'none');
    m.setLayoutProperty('slopes', 'visibility', props.showSlopes ? 'visible' : 'none');
  }, [props.baseLayer, props.showSlopes, ready]);

  useEffect(() => {
    if (!props.visible || !ready) return;
    (map.current!.getSource('recorded') as GeoJSONSource).setData(toLineString(props.recorded));
  }, [props.recorded, props.visible, ready]);

  useEffect(() => {
    if (!ready) return;
    const m = map.current!;
    (m.getSource('imported') as GeoJSONSource).setData(props.imported.length ? toLineString(props.imported) : EMPTY);
    if (props.imported.length) {
      const b = new maplibregl.LngLatBounds();
      props.imported.forEach((p) => b.extend([p.lon, p.lat]));
      m.fitBounds(b, { padding: 40, duration: 0 });
    }
  }, [props.imported, ready]);

  useEffect(() => {
    const p = props.position;
    if (!p || !props.visible || !ready) return;
    const m = map.current!;
    (m.getSource('me') as GeoJSONSource).setData({ type: 'Point', coordinates: [p.lon, p.lat] });
    if (props.follow) m.jumpTo({ center: [p.lon, p.lat] });
  }, [props.position, props.follow, props.visible, ready]);

  return <div ref={el} className="map" />;
}
