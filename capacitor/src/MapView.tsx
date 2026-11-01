import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useRef, useState } from 'react';
import { AUTO_PLAN_UNTIL, AUTO_SCAN_FROM, DISPLAY_MAX_ZOOM, LA_CIOTAT_CENTER, LAYERS, type BaseMode } from './config';
import { bench, metrics } from './metrics';
import { toLineString, type TrackPoint } from './track/gpx';
import { bboxPolygon, trailsGeoJson, type Trail } from './trails/osmTrails';
import type { Bbox } from './config';

export interface MapViewProps {
  baseLayer: BaseMode;
  showSlopes: boolean;
  recorded: TrackPoint[];
  imported: TrackPoint[];
  position: { lat: number; lon: number } | null;
  follow: boolean;
  /** Faux quand l'appli est en arrière-plan : on ne redessine rien pour économiser la batterie. */
  visible: boolean;
  onMapReady?: (map: MlMap) => void;
  /** Position donnée par le bouton « me localiser ». */
  onGeolocate?: (p: { coords: GeolocationCoordinates; timestamp: number }) => void;
  /** Randos OSM trouvées dans la zone encadrée, celle choisie, et le cadre. */
  trails: Trail[];
  selectedTrail: Trail | null;
  frame: Bbox | null;
  onTrailClick?: (id: number) => void;
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
  const onGeolocate = useRef(props.onGeolocate);
  onGeolocate.current = props.onGeolocate;
  const onTrailClick = useRef(props.onTrailClick);
  onTrailClick.current = props.onTrailClick;

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
          recorded: { type: 'geojson', data: EMPTY }, imported: { type: 'geojson', data: EMPTY }, me: { type: 'geojson', data: EMPTY },
          trails: { type: 'geojson', data: EMPTY }, trailSel: { type: 'geojson', data: EMPTY }, frame: { type: 'geojson', data: EMPTY } },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#f2efe6' } },
          // Plan IGN sous le SCAN 25 : en mode Auto, le SCAN 25 apparaît en fondu par-dessus en zoomant.
          { id: 'planign', type: 'raster', source: 'planign' },
          { id: 'scan25', type: 'raster', source: 'scan25' },
          { id: 'slopes', type: 'raster', source: 'slopes', paint: { 'raster-opacity': 0.6 }, layout: { visibility: 'none' } },
          { id: 'frame', type: 'line', source: 'frame', paint: { 'line-color': '#1d2421', 'line-width': 2, 'line-dasharray': [3, 2] } },
          { id: 'trails', type: 'line', source: 'trails', layout: { 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.75 } },
          // Couche invisible plus large : le doigt n'a pas besoin de tomber pile sur le trait.
          { id: 'trails-hit', type: 'line', source: 'trails', paint: { 'line-color': '#000', 'line-width': 18, 'line-opacity': 0 } },
          { id: 'trail-sel-casing', type: 'line', source: 'trailSel', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': 8 } },
          { id: 'trail-sel', type: 'line', source: 'trailSel', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#7b3fe4', 'line-width': 5 } },
          { id: 'imported', type: 'line', source: 'imported', paint: { 'line-color': '#7b3fe4', 'line-width': 4, 'line-opacity': 0.8 } },
          { id: 'recorded', type: 'line', source: 'recorded', paint: { 'line-color': '#e4572e', 'line-width': 4 } },
          { id: 'me', type: 'circle', source: 'me', paint: { 'circle-radius': 7, 'circle-color': '#1d6fe0', 'circle-stroke-width': 3, 'circle-stroke-color': '#fff' } },
        ],
      },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), 'top-right');
    // Bouton « me localiser » : 1er appui centre sur ma position et la suit, 2e appui arrête.
    // Le GPS du téléphone ne tourne que tant que le bouton est actif (et jamais appli en arrière-plan).
    const geo = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true, timeout: 20_000, maximumAge: 10_000 },
      trackUserLocation: true,
      showAccuracyCircle: true,
      fitBoundsOptions: { maxZoom: 15 },
    });
    geo.on('geolocate', (p) => onGeolocate.current?.(p));
    m.addControl(geo, 'top-right');
    m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    m.once('idle', () => {
      metrics.firstMapRenderMs = Math.round(performance.now() - metrics.appStart);
      bench('startup', { startup: 'map_idle', ms: metrics.firstMapRenderMs });
    });
    m.on('click', 'trails-hit', (e) => {
      const id = e.features?.[0]?.properties?.id;
      if (id != null) onTrailClick.current?.(Number(id));
    });
    m.on('mouseenter', 'trails-hit', () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', 'trails-hit', () => { m.getCanvas().style.cursor = ''; });
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
    const auto = props.baseLayer === 'auto';
    m.setLayoutProperty('scan25', 'visibility', props.baseLayer !== 'planign' ? 'visible' : 'none');
    m.setLayoutProperty('planign', 'visibility', props.baseLayer !== 'scan25' ? 'visible' : 'none');
    // Auto : le Plan IGN n'est plus demandé au-delà du zoom 14, le SCAN 25 pas en dessous du zoom 13.
    m.setLayerZoomRange('planign', 0, auto ? AUTO_PLAN_UNTIL : 24);
    m.setLayerZoomRange('scan25', auto ? AUTO_SCAN_FROM : 0, 24);
    m.setPaintProperty('scan25', 'raster-opacity',
      auto ? ['interpolate', ['linear'], ['zoom'], AUTO_SCAN_FROM, 0, AUTO_PLAN_UNTIL, 1] : 1);
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
    if (!ready) return;
    const m = map.current!;
    (m.getSource('trails') as GeoJSONSource).setData(trailsGeoJson(props.trails));
    (m.getSource('frame') as GeoJSONSource).setData(props.frame ? bboxPolygon(props.frame) : EMPTY);
  }, [props.trails, props.frame, ready]);

  useEffect(() => {
    if (!ready) return;
    const m = map.current!;
    const t = props.selectedTrail;
    (m.getSource('trailSel') as GeoJSONSource).setData(t ? trailsGeoJson([t]) : EMPTY);
    if (t) {
      const b = new maplibregl.LngLatBounds();
      t.segments.forEach((s) => s.forEach((p) => b.extend([p.lon, p.lat])));
      // Haut : barres « fond de carte » et « Y aller » ; bas : le panneau ouvert.
      const sheet = document.querySelector('.sheet')?.getBoundingClientRect().height ?? 0;
      const h = m.getContainer().clientHeight;
      const bottom = Math.min(sheet + 20, h - 200);
      m.fitBounds(b, { padding: { top: 140, left: 30, right: 70, bottom: Math.max(20, bottom) }, duration: 800 });
    }
  }, [props.selectedTrail, ready]);

  useEffect(() => {
    const p = props.position;
    if (!p || !props.visible || !ready) return;
    const m = map.current!;
    (m.getSource('me') as GeoJSONSource).setData({ type: 'Point', coordinates: [p.lon, p.lat] });
    if (props.follow) m.jumpTo({ center: [p.lon, p.lat] });
  }, [props.position, props.follow, props.visible, ready]);

  return <div ref={el} className="map" />;
}
