import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import type { Bbox } from './config';
import { CITIES, CITY_MIN_ZOOM } from './weather/cities';
import {
  ATTRIBUTION, DAYS, MOMENTS, dayLabel, forecastFor, gridPoints, hourIndex, hourLabel, momentAvailable, momentTime, pointKey, weatherIcon, weatherText, windArrow, windColor, windRotation,
  type PointForecast,
} from './weather/openMeteo';

function viewBbox(m: MlMap): Bbox {
  const b = m.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

const fmtTime = (t: number) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Ce que montrent les icônes : le temps (soleil, pluie…) ou le vent (flèche colorée, vitesse et rafales). */
type Mode = 'temps' | 'vent';
const MODE_KEY = 'meteoMode';
const SIMPLE_KEY = 'meteoCarteSimple';
/** Voile clair posé sur le fond de carte quand la carte simplifiée est demandée. */
const VEIL = 'wx-veil';
const WORLD: GeoJSON.Feature = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] } };

/**
 * Météo posée sur la carte : une grille d'icônes (temps ou vent, température) par-dessus la carte,
 * et un bandeau avec un curseur d'heure sur 4 jours. Données Météo-France (AROME, ARPEGE) via Open-Meteo.
 * Carte simplifiée (fond pâle, quelques villes) tant que la météo est affichée, si la case est cochée.
 */
export function WeatherLayer({ map, hidden, below, onToast, onClose }: { map: MlMap; hidden?: boolean; below?: boolean; onToast: (m: string) => void; onClose: () => void }) {
  // Moment choisi : jour (0 = aujourd'hui) et moment de la journée, comme dans l'appli Météo-France.
  const firstMoment = (d: number) => MOMENTS.findIndex((m) => momentAvailable(d, m.hour));
  const [day, setDay] = useState(() => (firstMoment(0) < 0 ? 1 : 0));
  const [moment, setMoment] = useState(() => firstMoment(firstMoment(0) < 0 ? 1 : 0));
  const [points, setPoints] = useState<PointForecast[]>([]);
  const [msg, setMsg] = useState('Météo…');
  const [loading, setLoading] = useState(false);
  const [mode, setModeState] = useState<Mode>(() => { try { return localStorage.getItem(MODE_KEY) === 'vent' ? 'vent' : 'temps'; } catch { return 'temps'; } });
  const setMode = (m: Mode) => { setModeState(m); try { localStorage.setItem(MODE_KEY, m); } catch { /* ignoré */ } };
  const [simple, setSimpleState] = useState(() => { try { return localStorage.getItem(SIMPLE_KEY) !== '0'; } catch { return true; } });
  const setSimple = (v: boolean) => { setSimpleState(v); try { localStorage.setItem(SIMPLE_KEY, v ? '1' : '0'); } catch { /* ignoré */ } };
  const markers = useRef(new Map<string, maplibregl.Marker>());
  const cityMarkers = useRef<{ m: maplibregl.Marker; minZoom: number }[]>([]);
  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;

  // Points de la vue : rechargés à l'ouverture et 600 ms après chaque déplacement de la carte (cache 1 h).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ctl: AbortController | null = null;
    const refresh = async () => {
      ctl?.abort();
      const my = new AbortController();
      ctl = my;
      setLoading(true);
      try {
        const { list, error } = await forecastFor(gridPoints(viewBbox(map)), my.signal);
        if (my.signal.aborted) return;
        setPoints(list);
        const newest = list.reduce((m, p) => Math.max(m, p.fetched), 0);
        if (error) setMsg(list.length ? `Sans réseau : météo reçue à ${fmtTime(newest)}` : `Météo indisponible : ${error}`);
        else setMsg(list.length ? `Prévision reçue à ${fmtTime(newest)} · ${ATTRIBUTION}` : 'Aucune prévision ici (modèles Météo-France : France et Europe proche)');
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setMsg(`Météo indisponible : ${(e as Error).message}`);
      } finally {
        if (!my.signal.aborted) setLoading(false);
      }
    };
    const onMove = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => void refresh(), 600); };
    map.on('moveend', onMove);
    void refresh();
    return () => { map.off('moveend', onMove); if (timer) clearTimeout(timer); ctl?.abort(); };
  }, [map]);

  // Carte simplifiée : voile clair sur le fond (sous les forêts et les tracés) et quelques villes (marqueurs HTML).
  useEffect(() => {
    if (!simple) return;
    if (!map.getSource(VEIL)) map.addSource(VEIL, { type: 'geojson', data: WORLD });
    if (!map.getLayer(VEIL)) map.addLayer({ id: VEIL, type: 'fill', source: VEIL, paint: { 'fill-color': '#f6f4ee', 'fill-opacity': 0.8 } },
      map.getLayer('forests') ? 'forests' : undefined);
    const list = CITIES.map(([name, lat, lon, rank]) => {
      const el = document.createElement('div');
      el.className = `wx-city wx-city-${rank}`;
      el.innerHTML = `<span class="wx-dot"></span><span class="wx-name">${name}</span>`;
      return { m: new maplibregl.Marker({ element: el, anchor: 'left' }).setLngLat([lon, lat]).addTo(map), minZoom: CITY_MIN_ZOOM[rank] };
    });
    cityMarkers.current = list;
    const apply = () => {
      const z = map.getZoom();
      for (const c of list) c.m.getElement().style.display = hidden || z < c.minZoom ? 'none' : '';
    };
    apply();
    map.on('zoomend', apply);
    return () => {
      map.off('zoomend', apply);
      list.forEach((c) => c.m.remove());
      cityMarkers.current = [];
      if (map.getLayer(VEIL)) map.removeLayer(VEIL);
      if (map.getSource(VEIL)) map.removeSource(VEIL);
    };
  }, [map, simple, hidden]);

  const t = momentTime(day, MOMENTS[Math.max(0, moment)]?.hour ?? 9);
  // Un marqueur HTML par point (les emoji ne passent pas par les glyphes MapLibre) : créé une fois, mis à jour à chaque moment.
  useEffect(() => {
    const keep = new Set<string>();
    for (const p of points) {
      const i = hourIndex(p, t);
      if (i < 0) continue;
      const k = pointKey(p);
      keep.add(k);
      let m = markers.current.get(k);
      if (!m) {
        const el = document.createElement('div');
        el.className = 'wx';
        el.innerHTML = '<span class="wx-ico"></span><span class="wx-txt"></span>';
        m = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([p.lon, p.lat]).addTo(map);
        markers.current.set(k, m);
      }
      const el = m.getElement();
      const cur = (el as HTMLElement & { _wx?: { p: PointForecast; i: number } });
      cur._wx = { p, i };
      el.onclick = (ev) => {
        ev.stopPropagation();
        const { p: q, i: j } = cur._wx!;
        const rain = q.rain[j] >= 0.1 ? ` · ${q.rain[j].toFixed(1).replace('.', ',')} mm/h` : '';
        onToastRef.current(`${hourLabel(t)} : ${weatherText(q.code[j])}, ${Math.round(q.temp[j])} °C, vent ${Math.round(q.wind[j])} km/h ${windArrow(q.dir[j])} (rafales ${Math.round(q.gust[j])})${rain}`);
      };
      const ico = el.querySelector('.wx-ico') as HTMLElement;
      const txt = el.querySelector('.wx-txt') as HTMLElement;
      if (mode === 'vent') {
        ico.textContent = '➤';
        ico.style.transform = `rotate(${windRotation(p.dir[i])}deg)`;
        ico.style.color = windColor(p.wind[i]);
        txt.textContent = `${Math.round(p.wind[i])} (${Math.round(p.gust[i])}) km/h`;
      } else {
        ico.textContent = weatherIcon(p.code[i], p.day[i]);
        ico.style.transform = '';
        ico.style.color = '';
        txt.textContent = `${Math.round(p.temp[i])} °C`;
      }
      el.classList.toggle('wx-wind', mode === 'vent');
      el.classList.toggle('wx-strong', p.gust[i] >= 60);
      el.style.display = hidden ? 'none' : '';
    }
    for (const [k, m] of markers.current) if (!keep.has(k)) { m.remove(); markers.current.delete(k); }
  }, [points, t, map, hidden, mode]);

  useEffect(() => () => { markers.current.forEach((m) => m.remove()); markers.current.clear(); }, []);

  const goDay = (d: number) => {
    setDay(d);
    // Si le moment choisi n'existe pas ce jour-là (déjà passé, ou au-delà de la prévision), on prend le premier possible.
    if (!momentAvailable(d, MOMENTS[moment]?.hour ?? 9)) setMoment(firstMoment(d));
  };
  return (
    <div className={`shade-bar wx-bar ${below ? 'wx-below' : ''}`} hidden={hidden}>
      <div className="shade-head">
        <b className="wx-time">{hourLabel(t)}</b>
        <span className="shade-sun">{loading ? 'Météo…' : ''}</span>
        <button onClick={onClose} aria-label="Fermer la météo">✕</button>
      </div>
      <div className="row wx-day">
        <button className="step" disabled={day <= 0} aria-label="Jour précédent" onClick={() => goDay(day - 1)}>‹</button>
        <b className="wx-day-label">{dayLabel(day)}</b>
        <button className="step" disabled={day >= DAYS - 1} aria-label="Jour suivant" onClick={() => goDay(day + 1)}>›</button>
      </div>
      <div className="row wx-days">
        {MOMENTS.map((m, i) => (
          <button key={m.key} className={moment === i ? 'on' : ''} disabled={!momentAvailable(day, m.hour)} onClick={() => setMoment(i)}>{m.label}</button>
        ))}
      </div>
      <div className="row wx-modes">
        <button className={mode === 'temps' ? 'on' : ''} onClick={() => setMode('temps')}>🌤 Temps</button>
        <button className={mode === 'vent' ? 'on' : ''} onClick={() => setMode('vent')} aria-label="Vent : flèche, vitesse et rafales en km/h">➤ Vent</button>
        <label className="wx-simple"><input type="checkbox" checked={simple} onChange={(e) => setSimple(e.target.checked)} /> Carte simple</label>
      </div>
      {mode === 'vent' && <p className="hint">Flèche : où va le vent · vent moyen (rafales) en km/h · vert &lt; 20, orange, rouge ≥ 40, violet ≥ 60</p>}
      <p className="hint">{msg}</p>
    </div>
  );
}
