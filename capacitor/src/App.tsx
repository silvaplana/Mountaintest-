import * as maplibregl from 'maplibre-gl';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { Preferences } from '@capacitor/preferences';
import type { Map as MlMap } from 'maplibre-gl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BASE_MODES, type Bbox, DEFAULT_SCAN_KEY, LA_CIOTAT_BBOX, LAYERS, OFFLINE_MAX_ZOOM, OFFLINE_MIN_ZOOM, offlinePlan, wmtsTileUrl, type BaseMode } from './config';
import { decideSettings, sameSettings } from './gps/adaptive';
import { EcoLocation } from './gps/ecoLocation';
import { filterForMode } from './gps/filter';
import { defaultSource, ReplaySource, type LocationSource } from './gps/sources';
import type { GpsFix, GpsMode, GpsSettings } from './gps/types';
import { MapView } from './MapView';
import { runCameraBench, type CameraBenchResult } from './cameraBench';
import { bench, metrics } from './metrics';
import { checkLayer } from './tiles/capabilities';
import { downloadTiles, getTileStore, type DownloadProgress } from './tiles/offlineStore';
import { registerIgnProtocol } from './tiles/protocol';
import { tilesForBbox } from './tiles/tileMath';
import { parseGpx, type TrackPoint } from './track/gpx';
import { SearchBar } from './SearchBar';
import { saveGpxFile, TrackRecorder } from './track/recorder';
import { FrameOverlay } from './FrameOverlay';
import { elevate, trailToGpx, type ElevatedTrail } from './trails/elevation';
import { fetchTrails, MAX_ZONE_DEG, OSM_ATTRIBUTION, zoneTooBig, type Trail } from './trails/osmTrails';
import { computeStats, formatDuration, formatKm } from './track/stats';

type Tab = 'sortie' | 'randos' | 'horsligne' | 'mesures';
type SourceKind = 'gps' | 'sim10' | 'sim60';

const prefs = { apiKey: DEFAULT_SCAN_KEY, cacheViewed: true };
registerIgnProtocol({ getApiKey: () => prefs.apiKey, cacheViewedTiles: () => prefs.cacheViewed });

/** Ouvre Google Maps (appli si installée) en itinéraire voiture vers le point. */
function openDirections(lat: number, lon: number) {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lon.toFixed(6)}&travelmode=driving`;
  // Dans l'appli, Capacitor confie les liens externes à Android, qui ouvre Google Maps.
  if (Capacitor.isNativePlatform()) window.location.href = url; else window.open(url, '_blank');
}

/** Au-delà, le téléchargement serait long et lourd : on demande de zoomer (même limite côté Kotlin). */
const MAX_ZONE_TILES = 6000;

function formatMo(bytes: number) { return `${(bytes / 1e6).toFixed(1).replace('.', ',')} Mo`; }

export function App() {
  const [tab, setTab] = useState<Tab>('sortie');
  const [open, setOpen] = useState(true);
  const [baseLayer, setBaseLayer] = useState<BaseMode>('auto');
  const [showSlopes, setShowSlopes] = useState(false);
  const [searching, setSearching] = useState(false);
  /** Lieu choisi (recherche, appui long, départ d'une trace importée) : « Y aller » ouvre Google Maps. */
  const [target, setTarget] = useState<{ lon: number; lat: number; label: string } | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const [visible, setVisible] = useState(true);

  // Sortie
  const recorder = useRef(new TrackRecorder());
  const source = useRef<LocationSource | null>(null);
  const applied = useRef<GpsSettings | null>(null);
  const battery = useRef<number | null>(null);
  const stopPoint = useRef<GpsFix | null>(null);
  const [mode, setMode] = useState<GpsMode>('rando');
  const [sourceKind, setSourceKind] = useState<SourceKind>('gps');
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState<TrackPoint[]>([]);
  const [position, setPosition] = useState<GpsFix | null>(null);
  const [follow, setFollow] = useState(true);
  const [reasons, setReasons] = useState<string[]>([]);
  const [imported, setImported] = useState<TrackPoint[]>([]);
  const [status, setStatus] = useState('');

  // Hors ligne
  const [apiKey, setApiKey] = useState(DEFAULT_SCAN_KEY);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [stored, setStored] = useState({ scan25: 0, planign: 0, scan25Bytes: 0, planignBytes: 0 });
  const [downloading, setDownloading] = useState('');
  const abort = useRef<AbortController | null>(null);

  // Randos libres (OpenStreetMap) d'une zone encadrée
  const [framing, setFraming] = useState(false);
  const [frame, setFrame] = useState<Bbox | null>(null);
  const [trails, setTrails] = useState<Trail[]>([]);
  const [trailsMsg, setTrailsMsg] = useState('');
  const [selected, setSelected] = useState<Trail | null>(null);
  const [elevated, setElevated] = useState<ElevatedTrail | 'loading' | 'error' | null>(null);
  const trailsAbort = useRef<AbortController | null>(null);

  // Mesures (rafraîchies à la demande pour ne pas réveiller l'écran inutilement)
  const [, setTick] = useState(0);
  const [map, setMap] = useState<MlMap | null>(null);
  const [camBench, setCamBench] = useState<CameraBenchResult | 'running' | null>(null);

  useEffect(() => {
    (async () => {
      const k = (await Preferences.get({ key: 'apiKey' })).value;
      if (k) { prefs.apiKey = k; setApiKey(k); }
      await refreshStored();
      if (await recorder.current.restore()) {
        // Si le système a tué l'appli pendant la sortie, le service natif a continué à noter les positions.
        if (Capacitor.isNativePlatform()) {
          const after = recorder.current.last?.time ?? 0;
          recorder.current.add((await EcoLocation.drainBuffer()).fixes.filter((f) => f.time > after));
        }
        setRecorded([...recorder.current.points]);
        setStatus(`Sortie précédente récupérée (${recorder.current.points.length} points).`);
      }
    })();
    const sub = CapApp.addListener('appStateChange', ({ isActive }) => setVisible(isActive));
    const onVis = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    return () => { void sub.then((h) => h.remove()); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  /** Recalcule les réglages GPS et ne les envoie au natif que s'ils changent. */
  const adapt = useCallback(async (isVisible: boolean) => {
    if (!source.current) return;
    const r = recorder.current;
    const d = decideSettings({ mode, lastKept: r.last, latest: r.latest, appVisible: isVisible, battery: battery.current, now: Date.now(), stopPoint: stopPoint.current });
    stopPoint.current = d.stopPoint;
    setReasons(d.reasons);
    if (sameSettings(applied.current, d.settings)) return;
    applied.current = d.settings;
    bench('gps-settings', { ...d.settings, reasons: d.reasons });
    await source.current.update(d.settings);
  }, [mode]);

  const onFixes = useCallback((fixes: GpsFix[]) => {
    const kept = recorder.current.add(fixes);
    const last = fixes[fixes.length - 1];
    // En arrière-plan le JS reçoit toujours les lots (pour les règles d'économie)
    // mais ne touche pas à l'affichage : le rendu sera fait au retour.
    if (document.visibilityState === 'visible') {
      setPosition(last);
      if (kept) setRecorded([...recorder.current.points]);
    }
    void adapt(document.visibilityState === 'visible');
  }, [adapt]);

  useEffect(() => {
    if (!recording) return;
    void adapt(visible);
    if (visible) setRecorded([...recorder.current.points]);
    else void recorder.current.save();
  }, [visible, recording, adapt, onFixes]);

  // À l'arrêt, le filtre de distance natif ne laisse plus rien passer : il faut une horloge
  // pour constater les 2 min sans position. Une fois par 30 s suffit.
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => void adapt(document.visibilityState === 'visible'), 30_000);
    return () => clearInterval(id);
  }, [recording, adapt]);

  // Niveau de batterie : lu toutes les 5 min pendant l'enregistrement seulement.
  useEffect(() => {
    if (!recording) return;
    const read = () => Device.getBatteryInfo().then((b) => { battery.current = b.batteryLevel ?? null; }).catch(() => {});
    void read();
    const id = setInterval(read, 5 * 60_000);
    return () => clearInterval(id);
  }, [recording]);

  // Appui long sur la carte : choisir un lieu où aller.
  useEffect(() => {
    if (!map) return;
    const onLong = (e: maplibregl.MapMouseEvent) => setTarget({ lon: e.lngLat.lng, lat: e.lngLat.lat, label: 'Point choisi sur la carte' });
    map.on('contextmenu', onLong);
    return () => { map.off('contextmenu', onLong); };
  }, [map]);

  useEffect(() => {
    marker.current?.remove();
    marker.current = null;
    if (map && target) marker.current = new maplibregl.Marker({ color: '#c0392b' }).setLngLat([target.lon, target.lat]).addTo(map);
  }, [map, target]);

  async function startRecording() {
    setStatus('');
    recorder.current.reset();
    recorder.current.filter = filterForMode(mode);
    setRecorded([]);
    const src = sourceKind === 'gps' ? defaultSource() : new ReplaySource('./la-ciotat-rando.gpx', sourceKind === 'sim10' ? 10 : 60);
    stopPoint.current = null;
    const d = decideSettings({ mode, lastKept: null, latest: null, appVisible: true, battery: battery.current, now: Date.now(), stopPoint: null });
    try {
      await src.start(d.settings, onFixes);
      source.current = src;
      applied.current = d.settings;
      setRecording(true);
      bench('recording-start', { source: src.name, mode, ...d.settings });
    } catch (e) {
      setStatus(String((e as Error).message ?? e));
    }
  }

  async function stopRecording() {
    await source.current?.stop();
    source.current = null;
    applied.current = null;
    setRecording(false);
    await recorder.current.save();
    bench('recording-stop', { points: recorder.current.points.length, fixes: metrics.gpsFixes, batches: metrics.gpsBatches });
  }

  async function exportGpx() {
    const name = `sortie-${new Date().toISOString().slice(0, 16).replace(':', 'h')}`;
    setStatus(`GPX enregistré : ${await recorder.current.exportGpx(name)}`);
  }

  async function importGpx(file: File) {
    try {
      const t = parseGpx(await file.text());
      setImported(t.points);
      if (t.points[0]) setTarget({ lon: t.points[0].lon, lat: t.points[0].lat, label: `Départ de « ${t.name} »` });
      const s = computeStats(t.points);
      setStatus(`« ${t.name} » : ${formatKm(s.distanceM)}, D+ ${Math.round(s.gainM)} m`);
    } catch (e) {
      setStatus(`Import impossible : ${(e as Error).message}`);
    }
  }

  async function saveKey(k: string) {
    setApiKey(k);
    prefs.apiKey = k;
    await Preferences.set({ key: 'apiKey', value: k });
  }

  async function testKey() {
    setStatus('Vérification de la clé…');
    try {
      const c = await checkLayer(LAYERS.scan25, apiKey);
      setStatus(c.found
        ? `Clé OK. SCAN 25 servi en PM du zoom ${c.minZoom} au zoom ${c.maxZoom} (${c.formats?.join(', ')}).`
        : 'La clé répond mais la couche SCAN25TOUR est absente : clé sans droits SCAN ?');
    } catch (e) {
      setStatus(`Échec : ${(e as Error).message}`);
    }
  }

  async function refreshStored() {
    const scan = await getTileStore(LAYERS.scan25);
    const plan = await getTileStore(LAYERS.planign);
    setStored({ scan25: scan.count(), planign: plan.count(), scan25Bytes: scan.bytes(), planignBytes: plan.bytes() });
  }

  /** bbox absente : zone du scénario (La Ciotat) ; sinon la zone affichée à l'écran. */
  async function downloadZone(bbox: Bbox = LA_CIOTAT_BBOX) {
    const plan = offlinePlan(baseLayer, OFFLINE_MIN_ZOOM, OFFLINE_MAX_ZOOM);
    const total = plan.reduce((n, st) => n + tilesForBbox(bbox, st.minZoom, st.maxZoom).length, 0);
    if (total > MAX_ZONE_TILES) {
      setStatus(`Zone trop grande (${total} tuiles, maximum ${MAX_ZONE_TILES}) : zoome un peu sur le coin de la rando.`);
      return;
    }
    setStatus('');
    abort.current = new AbortController();
    for (const step of plan) {
      if (abort.current.signal.aborted) break;
      const layer = LAYERS[step.layer];
      const store = await getTileStore(layer);
      const tiles = tilesForBbox(bbox, step.minZoom, step.maxZoom);
      setDownloading(`${layer.label}, zooms ${step.minZoom} à ${step.maxZoom}`);
      bench('download-start', { layer: layer.id, tiles: tiles.length });
      const res = await downloadTiles(store, tiles, (t) => wmtsTileUrl(layer, t.z, t.x, t.y, apiKey), setProgress, abort.current.signal);
      bench('download-end', { layer: layer.id, ...res });
    }
    setDownloading('');
    await refreshStored();
  }

  async function clearZone() {
    for (const id of ['scan25', 'planign']) await (await getTileStore(LAYERS[id])).clear();
    await refreshStored();
    setProgress(null);
  }

  async function searchTrails(b: Bbox) {
    setFraming(false);
    setOpen(true);
    setTab('randos');
    if (zoneTooBig(b)) {
      setTrailsMsg(`Zone trop grande : encadre au plus ${Math.round(MAX_ZONE_DEG * 100)} km de côté environ.`);
      return;
    }
    setFrame(b);
    setTrails([]); setSelected(null); setElevated(null);
    setTrailsMsg('Recherche des randos dans OpenStreetMap…');
    trailsAbort.current?.abort();
    const ctrl = new AbortController();
    trailsAbort.current = ctrl;
    const t0 = performance.now();
    try {
      const found = await fetchTrails(b, ctrl.signal);
      bench('trails-search', { found: found.length, ms: Math.round(performance.now() - t0) });
      setTrails(found);
      setTrailsMsg(found.length ? `${found.length} rando${found.length > 1 ? 's' : ''} balisée${found.length > 1 ? 's' : ''} trouvée${found.length > 1 ? 's' : ''}. Touche-en une (liste ou carte).`
        : 'Aucune rando balisée dans OpenStreetMap sur cette zone.');
    } catch (e) {
      if (!ctrl.signal.aborted) setTrailsMsg(`Recherche impossible (pas de réseau ? serveur saturé ?) : ${(e as Error).message}`);
    }
  }

  async function selectTrail(t: Trail | null) {
    setSelected(t);
    setElevated(t ? 'loading' : null);
    setFollow(false);
    if (!t) return;
    setOpen(true); setTab('randos');
    const first = t.segments[0][0];
    setTarget({ lon: first.lon, lat: first.lat, label: `Départ de « ${t.name} »` });
    try {
      const el = await elevate(t);
      setSelected((cur) => { if (cur?.id === t.id) setElevated(el); return cur; });
    } catch {
      setSelected((cur) => { if (cur?.id === t.id) setElevated('error'); return cur; });
    }
  }

  async function exportTrail() {
    if (!selected) return;
    const segs = elevated && typeof elevated === 'object' ? elevated.segments : selected.segments;
    try {
      setStatus(`GPX enregistré : ${await saveGpxFile(selected.name, trailToGpx(selected, segs))}`);
    } catch (e) {
      setStatus(`Export impossible : ${(e as Error).message}`);
    }
  }

  const stats = computeStats(recorded);
  const avgTile = metrics.tilesFromDisk + metrics.tilesFromNetwork ? metrics.tileLoadTotalMs / (metrics.tilesFromDisk + metrics.tilesFromNetwork) : 0;

  return (
    <div className="app">
      <MapView baseLayer={baseLayer} showSlopes={showSlopes} recorded={recorded} imported={imported}
        position={position} follow={follow && camBench !== 'running'} visible={visible}
        onMapReady={setMap} trails={trails} selectedTrail={selected} frame={frame}
        onTrailClick={(id) => void selectTrail(trails.find((t) => t.id === id) ?? null)} />

      {framing && map && <FrameOverlay map={map} onDone={(b) => void searchTrails(b)} onCancel={() => { setFraming(false); setOpen(true); }} />}

      {searching ? (
        <SearchBar onClose={() => setSearching(false)} onPick={(p) => {
          setSearching(false);
          setFollow(false);
          map?.flyTo({ center: [p.lon, p.lat], zoom: p.zoom, duration: 1500 });
          setTarget({ lon: p.lon, lat: p.lat, label: p.label });
        }} />
      ) : (
      <div className="layers">
        <button className="icon" onClick={() => setSearching(true)} aria-label="Rechercher un lieu">🔍</button>
        <select value={baseLayer} onChange={(e) => setBaseLayer(e.target.value as BaseMode)}>
          {(Object.keys(BASE_MODES) as BaseMode[]).map((k) => <option key={k} value={k}>{BASE_MODES[k]}</option>)}
        </select>
        <label><input type="checkbox" checked={showSlopes} onChange={(e) => setShowSlopes(e.target.checked)} /> Pentes</label>
      </div>
      )}

      {target && !searching && (
        <div className="target">
          <span>📍 {target.label}</span>
          <button className="primary" onClick={() => openDirections(target.lat, target.lon)}>Y aller (Google Maps)</button>
          <button onClick={() => setTarget(null)} aria-label="Effacer le lieu choisi">✕</button>
        </div>
      )}

      <section className={`sheet ${open ? 'open' : ''}`}>
        <button className="handle" onClick={() => setOpen(!open)} aria-label="Ouvrir ou fermer le panneau" />
        <nav className="tabs">
          {(['sortie', 'randos', 'horsligne', 'mesures'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => { setTab(t); setOpen(true); void refreshStored(); }}>
              {{ sortie: 'Sortie', randos: 'Randos', horsligne: 'Hors ligne', mesures: 'Mesures' }[t]}
            </button>
          ))}
        </nav>

        {open && tab === 'sortie' && (
          <div className="pane">
            <div className="stats">
              <div><b>{formatKm(stats.distanceM)}</b><span>distance</span></div>
              <div><b>{Math.round(stats.gainM)} m</b><span>D+</span></div>
              <div><b>{formatDuration(stats.durationMs)}</b><span>durée</span></div>
              <div><b>{recorded.length}</b><span>points</span></div>
            </div>
            <div className="row">
              <select value={mode} disabled={recording} onChange={(e) => setMode(e.target.value as GpsMode)}>
                <option value="rando">Rando (10 m)</option>
                <option value="velo">Vélo (20 m)</option>
                <option value="eco">Économie (50 m)</option>
              </select>
              <select value={sourceKind} disabled={recording} onChange={(e) => setSourceKind(e.target.value as SourceKind)}>
                <option value="gps">GPS réel</option>
                <option value="sim10">Simulation ×10</option>
                <option value="sim60">Simulation ×60</option>
              </select>
            </div>
            <div className="row">
              {recording
                ? <button className="primary stop" onClick={stopRecording}>Arrêter</button>
                : <button className="primary" onClick={startRecording}>Démarrer</button>}
              <label><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Suivre</label>
            </div>
            {recording && reasons.length > 0 && <p className="hint">Économie active : {reasons.join(', ')}</p>}
            <div className="row">
              <button onClick={exportGpx} disabled={!recorded.length}>Exporter GPX</button>
              <label className="file">Importer GPX<input type="file" accept=".gpx,application/gpx+xml" onChange={(e) => e.target.files?.[0] && importGpx(e.target.files[0])} /></label>
              {imported.length > 0 && <button onClick={() => setImported([])}>Effacer l'import</button>}
            </div>
          </div>
        )}

        {open && tab === 'randos' && (
          <div className="pane">
            <p className="hint">Randos balisées libres de droits (GR, PR, boucles locales) trouvées dans OpenStreetMap. {OSM_ATTRIBUTION}.</p>
            <div className="row">
              <button className="primary" disabled={!map} onClick={() => { setFraming(true); setOpen(false); }}>Encadrer une zone</button>
              <button disabled={!map} onClick={() => {
                const b = map!.getBounds();
                void searchTrails([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
              }}>Zone affichée</button>
            </div>
            {trailsMsg && <p className="hint">{trailsMsg}</p>}
            {selected && (
              <div className="trail-card">
                <b>{selected.name}</b>
                <span className="hint">{selected.kind} · <a href={`https://www.openstreetmap.org/relation/${selected.id}`} target="_blank" rel="noreferrer">fiche OSM</a>
                  {selected.segments.length > 1 && ` · ${selected.segments.length} morceaux`}</span>
                <div className="stats">
                  <div><b>{formatKm(selected.distanceM)}</b><span>distance</span></div>
                  <div><b>{typeof elevated === 'object' && elevated ? `${Math.round(elevated.gainM)} m` : elevated === 'loading' ? '…' : '—'}</b><span>D+</span></div>
                  <div><b>{typeof elevated === 'object' && elevated ? `${Math.round(elevated.lossM)} m` : elevated === 'loading' ? '…' : '—'}</b><span>D−</span></div>
                </div>
                {elevated === 'error' && <p className="hint">Altitudes indisponibles (service IGN injoignable) : le GPX sera exporté sans altitude.</p>}
                <div className="row">
                  <button className="primary" onClick={exportTrail} disabled={elevated === 'loading'}>Exporter GPX</button>
                  <button onClick={() => void selectTrail(null)}>Fermer</button>
                </div>
              </div>
            )}
            {trails.length > 0 && (
              <ul className="trail-list">
                {trails.map((t) => (
                  <li key={t.id}>
                    <button className={selected?.id === t.id ? 'active' : ''} onClick={() => void selectTrail(t)}>
                      <i style={{ background: t.color }} />
                      <span><b>{t.name}</b><small>{t.kind} · {formatKm(t.distanceM)}</small></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {trails.length > 0 && <button onClick={() => { setTrails([]); setFrame(null); void selectTrail(null); setTrailsMsg(''); }}>Effacer les randos de la carte</button>}
          </div>
        )}

        {open && tab === 'horsligne' && (
          <div className="pane">
            <label className="field">Clé IGN pour le SCAN 25
              <input value={apiKey} onChange={(e) => saveKey(e.target.value.trim())} autoCapitalize="off" autoCorrect="off" />
            </label>
            <div className="row">
              <button onClick={testKey}>Tester la clé</button>
              <label><input type="checkbox" defaultChecked onChange={(e) => { prefs.cacheViewed = e.target.checked; }} /> Garder les tuiles vues</label>
            </div>
            <p className="hint">Télécharge la zone du scénario (La Ciotat) ou ce que montre l'écran (zoome sur le coin de la rando avant). Fond affiché ({BASE_MODES[baseLayer]}) : {offlinePlan(baseLayer, OFFLINE_MIN_ZOOM, OFFLINE_MAX_ZOOM)
              .map((p) => `${LAYERS[p.layer].label} z${p.minZoom}-${p.maxZoom}`).join(' + ')}.
              En stock : {stored.scan25} tuiles SCAN 25 ({formatMo(stored.scan25Bytes)}), {stored.planign} tuiles Plan IGN ({formatMo(stored.planignBytes)}).</p>
            <p className="hint"><b>Place prise sur le téléphone : {formatMo(stored.scan25Bytes + stored.planignBytes)}</b>. Les tuiles sont gardées quand l'appli se met à jour ; seule la désinstallation les efface.</p>
            <div className="row">
              <button className="primary" onClick={() => downloadZone()}>Zone La Ciotat</button>
              <button className="primary" disabled={!map} onClick={() => {
                const b = map!.getBounds();
                void downloadZone([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
              }}>Zone affichée</button>
            </div>
            <div className="row">
              <button onClick={() => abort.current?.abort()}>Annuler</button>
              <button onClick={clearZone}>Vider</button>
            </div>
            {progress && (
              <>
                {downloading && <p className="hint">En cours : {downloading}</p>}
                <progress max={progress.total} value={progress.done + progress.failed} />
                <p className="hint">{progress.done}/{progress.total} tuiles, {progress.failed} échecs, {(progress.bytes / 1e6).toFixed(1)} Mo, {(progress.elapsedMs / 1000).toFixed(1)} s</p>
              </>
            )}
          </div>
        )}

        {open && tab === 'mesures' && (
          <div className="pane">
            <table className="metrics"><tbody>
              <tr><td>Plateforme</td><td>{Capacitor.getPlatform()}</td></tr>
              <tr><td>Tuiles hors ligne</td><td>{stored.scan25 + stored.planign} ({formatMo(stored.scan25Bytes + stored.planignBytes)})</td></tr>
              <tr><td>Première carte affichée</td><td>{metrics.firstMapRenderMs} ms</td></tr>
              <tr><td>Tuiles disque / réseau / erreurs</td><td>{metrics.tilesFromDisk} / {metrics.tilesFromNetwork} / {metrics.tileErrors}</td></tr>
              <tr><td>Temps moyen par tuile</td><td>{avgTile.toFixed(1)} ms</td></tr>
              <tr><td>Positions reçues / lots / rejetées</td><td>{metrics.gpsFixes} / {metrics.gpsBatches} / {metrics.gpsRejected}</td></tr>
              <tr><td>Réglage GPS</td><td>{applied.current ? `${applied.current.priority}, ${applied.current.intervalMs / 1000} s, ${applied.current.minDistanceM} m, lot ${applied.current.maxDelayMs / 1000} s` : '—'}</td></tr>
              <tr><td>Bench caméra</td><td>{camBench === 'running' ? 'en cours…' : camBench
                ? `${camBench.fps} img/s, p50 ${camBench.p50} / p95 ${camBench.p95} / p99 ${camBench.p99} ms, ${camBench.late} en retard`
                : '—'}</td></tr>
            </tbody></table>
            <div className="row">
              <button onClick={() => setTick((n) => n + 1)}>Rafraîchir</button>
              <button disabled={!map || camBench === 'running'} onClick={async () => {
                setCamBench('running');
                setOpen(false);
                setCamBench(await runCameraBench(map!));
                setOpen(true);
              }}>Bench caméra 30 s</button>
            </div>
          </div>
        )}
        {open && status && <p className="status">{status}</p>}
      </section>
    </div>
  );
}
