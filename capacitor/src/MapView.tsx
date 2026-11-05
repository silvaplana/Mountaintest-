import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useRef, useState } from 'react';
import { AUTO_PLAN_UNTIL, AUTO_SCAN_FROM, DISPLAY_MAX_ZOOM, LA_CIOTAT_CENTER, LAYERS, type BaseMode } from './config';
import { bench, metrics } from './metrics';
import { toLineString, type TrackPoint } from './track/gpx';
import { bboxPolygon, trailsGeoJson, type Trail } from './trails/osmTrails';
import { webHikesGeoJson, type WebHike } from './trails/webHikes';
import type { Bbox } from './config';
import { forestsGeoJson, type Forest } from './forests/bdForet';
import type { CarRoute } from './travel/travel';
import { outingLabel, parkingText, type Outing } from './ski/skitour';
import { placeLabels } from './ski/labels';

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
  /** Le contrôle « me localiser », piloté par les boutons permanents (QuickButtons). */
  onGeolocate?: (g: maplibregl.GeolocateControl) => void;
  /** Randos OSM trouvées dans la zone encadrée, celle choisie, et le cadre. */
  trails: Trail[];
  selectedTrail: Trail | null;
  frame: Bbox | null;
  onTrailClick?: (id: number, at: { lon: number; lat: number }) => void;
  /** Point du profil sous le doigt (pente), affiché sur le tracé. */
  cursor?: { lon: number; lat: number } | null;
  /** Étiquettes de pente le long des tracés (case Pentes cochée). */
  slopeTags?: { lon: number; lat: number; deg: number; text: string }[];
  /** Randos trouvées sur le web par Claude : un point par rando, celle choisie en surbrillance. */
  webHikes: WebHike[];
  selectedHike: number | null;
  onHikeClick?: (i: number) => void;
  /** Forêts par essence (BD Forêt IGN) et essences choisies (vide : toutes). */
  forests: Forest[];
  forestFilter: Set<string>;
  onForestClick?: (f: { essence: string; type: string; ha: number }) => void;
  /** Voyage en voiture : itinéraires trouvés (un trait de couleur chacun) et celui choisi. */
  travelRoutes?: CarRoute[];
  travelSel?: number;
  onTravelClick?: (i: number) => void;
  /** Sorties skitour.fr : un point bleu par sortie, celle choisie en violet. */
  skiOutings?: Outing[];
  skiSel?: number | null;
  onSkiClick?: (i: number) => void;
}

// Le worker MapLibre est empaqueté par Vite avec l'appli : il marche hors ligne.
maplibregl.setWorkerUrl(workerUrl);

const VIEW_KEY = 'derniereVue';
function savedView(): { center: [number, number]; zoom: number } {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as { lon: number; lat: number; zoom: number } | null;
    if (v && Number.isFinite(v.lon) && Number.isFinite(v.lat) && Number.isFinite(v.zoom)) return { center: [v.lon, v.lat], zoom: v.zoom };
  } catch { /* stockage indisponible : vue par défaut */ }
  return { center: LA_CIOTAT_CENTER, zoom: 14 };
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function rasterSource(layerId: string): maplibregl.RasterSourceSpecification {
  const l = LAYERS[layerId];
  return { type: 'raster', tiles: [`ign://${l.id}/{z}/{x}/{y}`], tileSize: 256, maxzoom: l.maxNativeZoom, attribution: l.attribution };
}

export function MapView(props: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const onTrailClick = useRef(props.onTrailClick);
  onTrailClick.current = props.onTrailClick;
  const onHikeClick = useRef(props.onHikeClick);
  onHikeClick.current = props.onHikeClick;
  const onForestClick = useRef(props.onForestClick);
  onForestClick.current = props.onForestClick;
  const onSkiClick = useRef(props.onSkiClick);
  onSkiClick.current = props.onSkiClick;
  const onTravelClick = useRef(props.onTravelClick);
  onTravelClick.current = props.onTravelClick;

  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current!,
      // Rouvre la carte là où on l'avait laissée (sinon La Ciotat).
      ...savedView(),
      maxZoom: DISPLAY_MAX_ZOOM,
      // Un écran 3x dessine 2,25 fois plus de pixels qu'en 2x pour un gain peu visible sur des cartes raster.
      pixelRatio: Math.min(window.devicePixelRatio, 2),
      fadeDuration: 0,
      attributionControl: { compact: true },
      style: {
        version: 8,
        sources: { scan25: rasterSource('scan25'), planign: rasterSource('planign'), slopes: rasterSource('slopes'),
          recorded: { type: 'geojson', data: EMPTY }, imported: { type: 'geojson', data: EMPTY }, me: { type: 'geojson', data: EMPTY },
          trails: { type: 'geojson', data: EMPTY }, trailSel: { type: 'geojson', data: EMPTY }, frame: { type: 'geojson', data: EMPTY },
          webHikes: { type: 'geojson', data: EMPTY }, travel: { type: 'geojson', data: EMPTY }, ski: { type: 'geojson', data: EMPTY }, skiPark: { type: 'geojson', data: EMPTY },
          forests: { type: 'geojson', data: EMPTY, attribution: '© IGN – BD Forêt® V2' } },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#f2efe6' } },
          // Plan IGN sous le SCAN 25 : en mode Auto, le SCAN 25 apparaît en fondu par-dessus en zoomant.
          { id: 'planign', type: 'raster', source: 'planign' },
          { id: 'scan25', type: 'raster', source: 'scan25' },
          { id: 'slopes', type: 'raster', source: 'slopes', paint: { 'raster-opacity': 0.6 }, layout: { visibility: 'none' } },
          // Forêts sous les randos : couleur par essence, contour plus soutenu.
          { id: 'forests', type: 'fill', source: 'forests', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.45 } },
          { id: 'forests-line', type: 'line', source: 'forests', paint: { 'line-color': ['get', 'color'], 'line-width': 1.2 } },
          { id: 'frame', type: 'line', source: 'frame', paint: { 'line-color': '#1d2421', 'line-width': 2, 'line-dasharray': [3, 2] } },
          { id: 'trails', type: 'line', source: 'trails', layout: { 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.75 } },
          // Couche invisible plus large : le doigt n'a pas besoin de tomber pile sur le trait.
          { id: 'trails-hit', type: 'line', source: 'trails', paint: { 'line-color': '#000', 'line-width': 18, 'line-opacity': 0 } },
          { id: 'trail-sel-casing', type: 'line', source: 'trailSel', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': 8 } },
          { id: 'trail-sel', type: 'line', source: 'trailSel', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#7b3fe4', 'line-width': 5 } },
          { id: 'imported', type: 'line', source: 'imported', paint: { 'line-color': '#7b3fe4', 'line-width': 4, 'line-opacity': 0.8 } },
          { id: 'recorded', type: 'line', source: 'recorded', paint: { 'line-color': '#e4572e', 'line-width': 4 } },
          { id: 'web-hikes', type: 'circle', source: 'webHikes', paint: { 'circle-radius': 8, 'circle-color': '#f28c28', 'circle-stroke-width': 3, 'circle-stroke-color': '#fff' } },
          { id: 'travel-casing', type: 'line', source: 'travel', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': ['case', ['get', 'sel'], 9, 6] } },
          { id: 'travel', type: 'line', source: 'travel', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'sel'], 6, 3], 'line-opacity': ['case', ['get', 'sel'], 1, 0.6] } },
          { id: 'travel-hit', type: 'line', source: 'travel', paint: { 'line-color': '#000', 'line-width': 18, 'line-opacity': 0 } },
          // Trait sommet ↔ parking et parking (point gris foncé), sous les points des sommets.
          { id: 'ski-link', type: 'line', source: 'skiPark', filter: ['==', ['geometry-type'], 'LineString'],
            paint: { 'line-color': ['case', ['get', 'sel'], '#7b3fe4', '#1d6fe0'], 'line-width': ['case', ['get', 'sel'], 3, 2], 'line-dasharray': [2, 1.5], 'line-opacity': 0.85 } },
          { id: 'ski-park', type: 'circle', source: 'skiPark', filter: ['==', ['geometry-type'], 'Point'],
            paint: { 'circle-radius': ['case', ['get', 'sel'], 8, 6], 'circle-color': '#3a4a44', 'circle-stroke-width': 3, 'circle-stroke-color': '#fff' } },
          { id: 'ski', type: 'circle', source: 'ski', paint: { 'circle-radius': 8, 'circle-color': '#1d6fe0', 'circle-stroke-width': 3, 'circle-stroke-color': '#fff' } },
          { id: 'me', type: 'circle', source: 'me', paint: { 'circle-radius': 7, 'circle-color': '#1d6fe0', 'circle-stroke-width': 3, 'circle-stroke-color': '#fff' } },
        ],
      },
    });
    // Carte toujours nord en haut : pas de rotation, donc pas de boussole (demande de Seb).
    m.dragRotate.disable();
    m.touchZoomRotate.disableRotation();
    // Bouton « me localiser » : 1er appui centre sur ma position et la suit, 2e appui arrête.
    // Le GPS du téléphone ne tourne que tant que le bouton est actif (et jamais appli en arrière-plan).
    const geo = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true, timeout: 20_000, maximumAge: 10_000 },
      trackUserLocation: true,
      showAccuracyCircle: true,
      fitBoundsOptions: { maxZoom: 15 },
    });
    m.addControl(geo, 'top-right'); // son bouton est masqué (CSS) : on passe par QuickButtons
    props.onGeolocate?.(geo);
    m.on('moveend', () => {
      const c = m.getCenter();
      try { localStorage.setItem(VIEW_KEY, JSON.stringify({ lon: c.lng, lat: c.lat, zoom: m.getZoom() })); } catch { /* ignoré */ }
    });
    m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    m.once('idle', () => {
      metrics.firstMapRenderMs = Math.round(performance.now() - metrics.appStart);
      bench('startup', { startup: 'map_idle', ms: metrics.firstMapRenderMs });
    });
    m.on('click', 'web-hikes', (e) => {
      const i = e.features?.[0]?.properties?.i;
      if (i != null) onHikeClick.current?.(Number(i));
    });
    m.on('click', 'ski', (e) => {
      const i = e.features?.[0]?.properties?.i;
      if (i != null) onSkiClick.current?.(Number(i));
    });
    // Parking d'une sortie (son nom et son altitude sont dans l'étiquette) : on choisit la sortie.
    m.on('click', 'ski-park', (e) => {
      const i = e.features?.[0]?.properties?.i;
      if (i != null) onSkiClick.current?.(Number(i));
    });
    m.on('click', 'travel-hit', (e) => {
      const i = e.features?.[0]?.properties?.i;
      if (i != null) onTravelClick.current?.(Number(i));
    });
    m.on('click', 'trails-hit', (e) => {
      const id = e.features?.[0]?.properties?.id;
      if (id != null) onTrailClick.current?.(Number(id), { lon: e.lngLat.lng, lat: e.lngLat.lat });
    });
    m.on('click', 'forests', (e) => {
      // Une rando touchée passe avant la forêt dessous.
      if (m.queryRenderedFeatures(e.point, { layers: ['trails-hit', 'web-hikes'] }).length) return;
      const p = e.features?.[0]?.properties;
      if (p) onForestClick.current?.({ essence: String(p.essence), type: String(p.type ?? ''), ha: Number(p.ha) });
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
    (map.current!.getSource('forests') as GeoJSONSource).setData(forestsGeoJson(props.forests, props.forestFilter));
  }, [props.forests, props.forestFilter, ready]);

  useEffect(() => {
    if (!ready) return;
    const m = map.current!;
    (m.getSource('webHikes') as GeoJSONSource).setData(webHikesGeoJson(props.webHikes));
    m.setPaintProperty('web-hikes', 'circle-color',
      ['case', ['==', ['get', 'i'], props.selectedHike ?? -1], '#7b3fe4', '#f28c28']);
    m.setPaintProperty('web-hikes', 'circle-radius', ['case', ['==', ['get', 'i'], props.selectedHike ?? -1], 11, 8]);
  }, [props.webHikes, props.selectedHike, ready]);

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

  // Itinéraires du voyage : le choisi par-dessus ; on cadre la carte sur tous quand ils arrivent.
  useEffect(() => {
    if (!ready) return;
    const m = map.current!;
    const rs = props.travelRoutes ?? [];
    const sel = props.travelSel ?? 0;
    const order = rs.map((r, i) => ({ r, i })).sort((a, b) => Number(a.i === sel) - Number(b.i === sel));
    (m.getSource('travel') as GeoJSONSource).setData({ type: 'FeatureCollection', features: order.map(({ r, i }) => ({
      type: 'Feature', properties: { i, color: r.color, sel: i === sel }, geometry: { type: 'LineString', coordinates: r.coords } })) });
  }, [props.travelRoutes, props.travelSel, ready]);
  useEffect(() => {
    const rs = props.travelRoutes ?? [];
    if (!ready || !rs.length) return;
    const b = new maplibregl.LngLatBounds();
    rs.forEach((r) => r.coords.forEach((c) => b.extend(c)));
    const panel = document.querySelector('.travel')?.getBoundingClientRect().height ?? 0;
    const h = map.current!.getContainer().clientHeight;
    map.current!.fitBounds(b, { padding: { top: 30, left: 30, right: 70, bottom: Math.max(30, Math.min(panel + 20, h - 220)) }, duration: 800 });
  }, [props.travelRoutes, ready]);

  useEffect(() => {
    if (!ready) return;
    const m = map.current!;
    (m.getSource('ski') as GeoJSONSource).setData({ type: 'FeatureCollection', features: (props.skiOutings ?? []).map((o, i) => ({
      type: 'Feature', properties: { i }, geometry: { type: 'Point', coordinates: [o.lon, o.lat] } })) });
    const sel = props.skiSel ?? -1;
    (m.getSource('skiPark') as GeoJSONSource).setData({ type: 'FeatureCollection', features: (props.skiOutings ?? []).flatMap((o, i) => o.parking ? [
      { type: 'Feature' as const, properties: { i, sel: i === sel }, geometry: { type: 'LineString' as const, coordinates: [[o.lon, o.lat], [o.parking.lon, o.parking.lat]] } },
      { type: 'Feature' as const, properties: { i, sel: i === sel }, geometry: { type: 'Point' as const, coordinates: [o.parking.lon, o.parking.lat] } },
    ] : []) });
    m.setPaintProperty('ski', 'circle-color', ['case', ['==', ['get', 'i'], sel], '#7b3fe4', '#1d6fe0']);
    m.setPaintProperty('ski', 'circle-radius', ['case', ['==', ['get', 'i'], sel], 11, 8]);
    const o = props.skiOutings?.[sel];
    // Sortie choisie : on montre le sommet et son parking ensemble.
    if (o?.parking) m.fitBounds([[Math.min(o.lon, o.parking.lon), Math.min(o.lat, o.parking.lat)], [Math.max(o.lon, o.parking.lon), Math.max(o.lat, o.parking.lat)]],
      { padding: { top: 60, left: 40, right: 200, bottom: Math.round(m.getContainer().clientHeight * 0.45) }, maxZoom: 15, duration: 600 });
    else if (o) m.easeTo({ center: [o.lon, o.lat], duration: 600 });
  }, [props.skiOutings, props.skiSel, ready]);

  // Étiquettes des sorties skitour à droite des points bleus (nom, étoiles, skiabilité) ; cachées en dessous du zoom 9.
  const skiMarkers = useRef<maplibregl.Marker[]>([]);
  useEffect(() => {
    const m = map.current;
    skiMarkers.current.forEach((k) => k.remove());
    skiMarkers.current = [];
    if (!m) return;
    // Étiquettes posées en haut à gauche, décalées par placeLabels pour éviter les chevauchements (sortie choisie d'abord).
    const tags: { mk: maplibregl.Marker; el: HTMLElement; ll: [number, number]; sel: boolean }[] = [];
    const add = (el: HTMLElement, ll: [number, number], sel: boolean) => {
      const mk = new maplibregl.Marker({ element: el, anchor: 'top-left', offset: [13, -8] }).setLngLat(ll).addTo(m);
      skiMarkers.current.push(mk); tags.push({ mk, el, ll, sel });
    };
    (props.skiOutings ?? []).forEach((o, i) => {
      const el = document.createElement('div');
      el.className = `ski-tag${i === props.skiSel ? ' sel' : ''}`;
      el.textContent = outingLabel(o);
      add(el, [o.lon, o.lat], i === props.skiSel);
      if (o.parking) {
        // Étiquette du parking : nom et altitude ; un appui choisit la sortie.
        const p = document.createElement('div');
        p.className = `ski-tag park${i === props.skiSel ? ' sel' : ''}`;
        p.textContent = parkingText(o.parking);
        p.onclick = () => onSkiClick.current?.(i);
        add(p, [o.parking.lon, o.parking.lat], i === props.skiSel);
      }
    });
    const order = [...tags.filter((t) => t.sel), ...tags.filter((t) => !t.sel)];
    const layout = () => {
      if (m.getZoom() < 9 || !order.length) return;
      const pts = order.map((t) => m.project(t.ll));
      const c = m.getContainer();
      // Écran sans la colonne d'icônes de droite (≈ 70 px).
      const offs = placeLabels(order.map((t, n) => ({ x: pts[n].x, y: pts[n].y, w: t.el.offsetWidth, h: t.el.offsetHeight })), pts,
        { w: c.clientWidth - 70, h: c.clientHeight });
      order.forEach((t, n) => t.mk.setOffset(offs[n]));
    };
    const zoom = () => m.getContainer().classList.toggle('ski-tags-off', m.getZoom() < 9);
    zoom(); m.on('zoom', zoom);
    m.on('moveend', layout);
    requestAnimationFrame(layout);
    return () => { m.off('zoom', zoom); m.off('moveend', layout); };
  }, [props.skiOutings, props.skiSel, ready]);

  const slopeMarkers = useRef<maplibregl.Marker[]>([]);
  useEffect(() => {
    const m = map.current;
    slopeMarkers.current.forEach((k) => k.remove());
    slopeMarkers.current = [];
    if (!m) return;
    for (const t of props.slopeTags ?? []) {
      const el = document.createElement('div');
      const a = Math.abs(t.deg);
      el.className = `slope-tag ${a >= 17 ? 'steep' : a >= 9 ? 'mid' : ''}`; // ≥ 30 % rouge, ≥ 16 % orange
      el.textContent = t.text;
      slopeMarkers.current.push(new maplibregl.Marker({ element: el }).setLngLat([t.lon, t.lat]).addTo(m));
    }
  }, [props.slopeTags]);

  const cursorMarker = useRef<maplibregl.Marker | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const c = props.cursor;
    if (!c) { cursorMarker.current?.remove(); cursorMarker.current = null; return; }
    if (!cursorMarker.current) {
      const el = document.createElement('div');
      el.className = 'slope-marker';
      cursorMarker.current = new maplibregl.Marker({ element: el });
    }
    cursorMarker.current.setLngLat([c.lon, c.lat]).addTo(m);
  }, [props.cursor]);

  useEffect(() => {
    const p = props.position;
    if (!p || !props.visible || !ready) return;
    const m = map.current!;
    (m.getSource('me') as GeoJSONSource).setData({ type: 'Point', coordinates: [p.lon, p.lat] });
    if (props.follow) m.jumpTo({ center: [p.lon, p.lat] });
  }, [props.position, props.follow, props.visible, ready]);

  return <div ref={el} className="map" />;
}
