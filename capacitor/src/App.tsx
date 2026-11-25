import * as maplibregl from 'maplibre-gl';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { Preferences } from '@capacitor/preferences';
import type { Map as MlMap } from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BASE_MODES, type Bbox, DEFAULT_SCAN_KEY, LAYERS, OFFLINE_MAX_ZOOM, OFFLINE_MIN_ZOOM, offlinePlan, wmtsTileUrl, type BaseMode } from './config';
import { decideSettings, sameSettings } from './gps/adaptive';
import { EcoLocation } from './gps/ecoLocation';
import { filterForMode } from './gps/filter';
import { defaultSource, ReplaySource, type LocationSource } from './gps/sources';
import type { GpsFix, GpsMode, GpsSettings } from './gps/types';
import { MapView } from './MapView';
import { QuickButtons } from './QuickButtons';
import { ScaleBar } from './map/ScaleBar';
import { TravelPanel } from './TravelPanel';
import { Expenses } from './Expenses';
import { Account, ecouterCompte } from './Account';
import { connecte } from './compte/auth';
import { BandeauSortie, Buddies, ecouterBuddies, PartagePanel, useBuddies, type CarteBuddies, type DepartBuddies } from './buddies/Buddies';
import { PointSurCarte } from './buddies/Messages';
import { useEpingle } from './buddies/Positions';
import { BarreAppel, DoigtsSurCarte, EcranSonnerie, useAppel, useSonnerie } from './buddies/Appel';
import { montrer } from './buddies/appel';
import { lire as lireBuddies, nouveautes, vue as vueBuddies, type Sortie, type TraceBuddy } from './buddies/store';
import { useNotifMessages } from './buddies/notifs';
import { LodgingPanel, type Lodging, type PlacedLodging } from './Lodging';
import { LodgingsOnMap } from './LodgingMap';
import { SkiPanel } from './SkiPanel';
import { SkiTextPanel } from './SkiTextPanel';
import { rowOf, topoBounds, topoRowOf, type Outing, type OutingRow, type TopoRow, type TopoSheet } from './ski/skitour';
import type { SkiMode } from './SkiTabs';
import { TopoTextPanel } from './TopoTextPanel';
import { TopoMapPanel } from './TopoMapPanel';
import type { CarRoute } from './travel/travel';
import type { GeolocateControl } from 'maplibre-gl';
import { runCameraBench, type CameraBenchResult } from './cameraBench';
import { bench, metrics } from './metrics';
import { checkLayer } from './tiles/capabilities';
import { downloadTiles, getTileStore, type DownloadProgress } from './tiles/offlineStore';
import { registerIgnProtocol } from './tiles/protocol';
import { registerReliefProtocol } from './shade/terrain';
import { CORRIDOR_M, lineBbox, tilesForBbox, tilesForCorridor, type TileCoord } from './tiles/tileMath';
import { parseGpx, type TrackPoint } from './track/gpx';
import { SearchBar } from './SearchBar';
import { clearPlaceNames, savePlaceNames } from './places/placeNames';
import { saveGpxFile, TrackRecorder } from './track/recorder';
import { FrameOverlay } from './FrameOverlay';
import { DrawOverlay } from './DrawOverlay';
import { TraceList, TraceMenu } from './TraceMenu';
import { defaultTraceName, deleteTrace, listTraces, saveTrace, traceLine, type SavedTrace } from './trails/savedTraces';
import { removeTraceFile, shareTrace, writeTraceFile } from './trails/traceShare';
import { Profile, WayLegend } from './Profile';
import { buildProfile, nearestD, pointAt, slopeLabels, type ProfileData } from './trails/profile';
import { drawnTrail, isMine, nextMine, bikeHours, routeOnPaths, walkingHours, waypoints } from './trails/route';
import { parseTraceFile } from './trails/traceFile';
import { onTraceFileOpened, pickTraceFile } from './trails/pickFile';
import { navState, OFF_TRACK_M } from './trails/navigation';
import { loadShown, saveShown } from './trails/shownTraces';
import { junctionAlongs, junctionsFor, lineKey, nextJunctionM, prefetchWays, wayRunsFor } from './trails/junctions';
import { wayRunLines, type WayRun } from './trails/wayTypes';
import { ACTIVITY_ICON, isBike, loadActivity, saveActivity, type Activity } from './activity';
import { C2cPanel, isCovered } from './C2cPanel';
import { fetchLines, type Bike, type C2cActivity, type C2cRoute } from './topos/c2c';
import { fetchOtherSheet, srcLabel } from './topos/sources';
import { offTrackVibrateEnabled, setOffTrackVibrateEnabled, setTraceWakeEnabled, startTraceWake, stopTraceWake, traceWakeAvailable, traceWakeEnabled } from './trails/traceWake';
import { NavBar } from './NavBar';
import type { LonLat } from './trails/osmTrails';
import { Versions } from './Versions';
import { Usage } from './Usage';
import { ShadeFilm } from './ShadeFilm';
import { Survol } from './Survol';
import { WeatherLayer } from './WeatherLayer';
import { MNT_LAYER, mntTileUrl, mntTilesForZone } from './shade/dem';
import { BatteryShortcuts } from './BatteryShortcuts';
import { elevate, trailToGpx, type ElevatedTrail } from './trails/elevation';
import { costLine, fetchWebHikes, hikeDetail, IA_MOT_DE_PASSE_INTEGRE, type WebHike } from './trails/webHikes';
import { fetchTrails, MAX_ZONE_DEG, OSM_ATTRIBUTION, zoneTooBig, type Trail } from './trails/osmTrails';
import { BDFORET_ATTRIBUTION, fetchForests, forestZoneTooBig, formatHa, groupByEssence, MAX_FOREST_DEG, type Forest } from './forests/bdForet';
import { computeStats, formatDuration, formatKm } from './track/stats';

type Tab = 'sortie' | 'randos' | 'forets' | 'horsligne' | 'mesures' | 'versions' | 'usage';
type SourceKind = 'gps' | 'sim10' | 'sim60';

const prefs = { apiKey: DEFAULT_SCAN_KEY, cacheViewed: true };
registerIgnProtocol({ getApiKey: () => prefs.apiKey, cacheViewedTiles: () => prefs.cacheViewed });
registerReliefProtocol();

/** Ouvre Google Maps (appli si installée) en itinéraire voiture vers le point. */
function openDirections(lat: number, lon: number) {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lon.toFixed(6)}&travelmode=driving`;
  // Dans l'appli, Capacitor confie les liens externes à Android, qui ouvre Google Maps.
  if (Capacitor.isNativePlatform()) window.location.href = url; else window.open(url, '_blank');
}

/** Ouvre une page web dans le navigateur du téléphone (pas dans l'appli). */
function openLink(url: string) {
  if (Capacitor.isNativePlatform()) window.location.href = url; else window.open(url, '_blank', 'noopener');
}

/** Au-delà, le téléchargement serait long et lourd : on demande de zoomer (même limite côté Kotlin). */
const MAX_ZONE_TILES = 6000;
/** Taille moyenne d'une tuile IGN 256 px (JPEG SCAN 25 / PNG Plan IGN), pour l'estimation avant téléchargement. */
const TILE_BYTES_ESTIMATE = 25_000;

function formatMo(bytes: number) { return `${(bytes / 1e6).toFixed(1).replace('.', ',')} Mo`; }

export function App() {
  const [tab, setTab] = useState<Tab>('sortie');
  const [open, setOpen] = useState(false); // l'appli démarre menu fermé
  const [baseLayer, setBaseLayer] = useState<BaseMode>('auto');
  const [showSlopes, setShowSlopes] = useState(false);
  /** Film des ombres du relief (8 h → midi). */
  const [showShade, setShowShade] = useState(false);
  // 🌦 Météo posée sur la carte (Météo-France via Open-Meteo).
  const [showWeather, setShowWeather] = useState(false);
  const [searching, setSearching] = useState(false);
  // Menu Voyage : panneau ouvert, itinéraires trouvés et celui choisi.
  const [travel, setTravel] = useState(false);
  const [expenses, setExpenses] = useState(false);
  /** 👥 Mon compte (connexion Logto, marche hors ligne une fois connecté). */
  // Tant qu'on n'est pas connecté, l'écran de connexion s'ouvre au lancement (« Plus tard » le ferme) : demande de Seb.
  const [account, setAccount] = useState(() => !connecte());
  /** 👥 Buddies (spec/buddies.md) : copie locale, marche hors ligne. */
  const [buddies, setBuddies] = useState(false);
  /** ‹ depuis la carte d'un Buddy Time : on revient sur son Buddy Group. */
  const [buddiesDepart, setBuddiesDepart] = useState<DepartBuddies | undefined>();
  /** Un Buddy Time ouvert sur la carte (écran 4). */
  const [carteSortie, setCarteSortie] = useState<{ sortie: Sortie; traces: TraceBuddy[]; parler?: boolean } | null>(null);
  // 📍 Le point d'un message d'un Buddy Group (« Julie est ici »), montré sur la carte.
  const [pointBuddy, setPointBuddy] = useState<CarteBuddies['point'] | null>(null);
  /** Panneau de partage d'une trace (écran 22). */
  const [partage, setPartage] = useState<{ nom: string; ligne: [number, number][]; ailleurs: () => void; hebergement?: Lodging } | null>(null);
  const buddiesEtat = useBuddies();
  const [lodging, setLodging] = useState(false);
  const [lodgingPins, setLodgingPins] = useState<PlacedLodging[]>([]);
  const proposerHebergementTrouve = (h: Lodging) => setPartage({ nom: h.nom, ligne: [], hebergement: h,
    ailleurs: () => void (navigator.share?.({ title: h.nom, text: [h.nom, h.adresse, h.url].filter(Boolean).join('\n') }) ?? Promise.resolve()).catch(() => undefined) });
  // ⛷ Sorties skitour.fr : zone encadrée, sorties trouvées, celle choisie.
  // ⛷🗺 : sorties de l'écran affiché (plus de zone à encadrer).
  const [skiOn, setSkiOn] = useState(false);
  const [skiOutings, setSkiOutings] = useState<Outing[]>([]);
  const [skiSel, setSkiSel] = useState<number | null>(null);
  const [skiText, setSkiText] = useState(false);
  // Fiche d'une sortie choisie sur la carte (⛷🗺), par-dessus le panneau de la zone.
  const [skiSheet, setSkiSheet] = useState<OutingRow | null>(null);
  // 📖 Topos : liste en texte, carte des topos (points à leur départ), topo touché sur la carte.
  const [topoText, setTopoText] = useState(false);
  const [topoMapOn, setTopoMapOn] = useState(false);
  const [topos, setTopos] = useState<TopoRow[]>([]);
  const [topoSel, setTopoSel] = useState<number | null>(null);
  const [topoSheet, setTopoSheet] = useState<TopoRow | null>(null);
  const [topoPin, setTopoPin] = useState<TopoRow | null>(null);
  /** « 🗺 Sur la carte » d'un topo : carte des topos, ce topo choisi (avec son itinéraire) et cadré. */
  const showTopoOnMap = (t: TopoSheet) => {
    const row = topoRowOf(t);
    if (!row) return;
    skiMode('carteTopos');
    setTopoPin(row); setTopos([row]); setTopoSel(0);
    const b = topoBounds(t);
    if (b && map) {
      const pad = Math.round(map.getContainer().clientHeight * 0.3);
      if (b[0] === b[2] && b[1] === b[3]) map.easeTo({ center: [b[0], b[1]], zoom: Math.max(map.getZoom(), 13), duration: 700 });
      else map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 60, left: 40, right: 200, bottom: pad }, maxZoom: 15, duration: 700 });
    }
  };
  /** Onglets du ski : ferme les autres écrans ski (et panneaux) puis ouvre celui choisi. */
  const skiMode = (m: SkiMode) => {
    setTravel(false); setLodging(false); setOpen(false); setSearching(false);
    setSkiText(false); setSkiOn(false); setSkiOutings([]); setSkiSel(null); setSkiSheet(null);
    setTopoText(false); setTopoMapOn(false); setTopos([]); setTopoSel(null); setTopoSheet(null); setTopoPin(null);
    if (m === 'sorties') setSkiText(true);
    else if (m === 'carte') setSkiOn(true);
    else if (m === 'topos') setTopoText(true);
    else setTopoMapOn(true);
  };
  const [travelRoutes, setTravelRoutes] = useState<CarRoute[]>([]);
  const [travelSel, setTravelSel] = useState(0);
  /** Mode nature : carte seule, plein écran, toute l'interface masquée. */
  // L'appli s'ouvre carte seule : le bandeau du bas (onglets) n'apparaît qu'avec ☰ (demande de Seb).
  const [nature, setNature] = useState(true);
  const [geo, setGeo] = useState<GeolocateControl | null>(null);
  /** Petit message passager, visible même en mode nature. */
  const [toast, setToast] = useState('');
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t); }, [toast]);
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
  const [stored, setStored] = useState({ scan25: 0, planign: 0, scan25Bytes: 0, planignBytes: 0, mnt: 0, mntBytes: 0 });
  const [downloading, setDownloading] = useState('');
  const abort = useRef<AbortController | null>(null);

  // Randos libres (OpenStreetMap) d'une zone encadrée
  const [framing, setFraming] = useState(false);
  /** Le même outil rectangle sert aux randos OSM et au téléchargement hors ligne. */
  const [framingFor, setFramingFor] = useState<'randos' | 'forets' | 'horsligne'>('randos');
  const [frame, setFrame] = useState<Bbox | null>(null);
  const [trails, setTrails] = useState<Trail[]>([]);
  const [trailsMsg, setTrailsMsg] = useState('');
  const [selected, setSelected] = useState<Trail | null>(null);
  const [elevated, setElevated] = useState<ElevatedTrail | 'loading' | 'error' | null>(null);
  /** Tracé au doigt en cours, et recalage sur les chemins (IGN) ou ligne libre. */
  const [drawing, setDrawing] = useState(false);
  /** Vue 3D : carte inclinée ou tournée. */
  const [tilted, setTilted] = useState(false);
  /** Menu du bas de la trace violette, liste 📂 des traces enregistrées (null : fermée). */
  const [traceMenu, setTraceMenu] = useState(false);
  /** 🎥 Survol 3D de la trace choisie : remplace son menu tant qu'il est ouvert. */
  const [survol, setSurvol] = useState(false);
  useEffect(() => { if (!traceMenu) setSurvol(false); }, [traceMenu]);
  const [traceList, setTraceList] = useState<SavedTrace[] | null>(null);
  const [drawnSlopes, setDrawnSlopes] = useState(false);
  const [drawnProfile, setDrawnProfile] = useState(false);
  /** ⛷ ski de rando / 🚵 VTT (appui long sur ⛷ pour basculer), et 🚵 type de chemin le long de la trace choisie. */
  const [activity, setActivityState] = useState<Activity>(loadActivity);
  /** Modes vélo (🚵 VTT, 🚴 route, 🚲 gravel) : durée à vélo, pente d'abord en %. */
  const vtt = isBike(activity);
  const setActivity = (a: Activity) => { setActivityState(a); saveActivity(a); setWayTypesOn(a !== 'ski'); };
  // Coche « Type de chemin » du menu de la trace (Seb) : cochée d'office en 🚵 et 🥾, absente en ⛷.
  const [wayTypesOn, setWayTypesOn] = useState(() => loadActivity() !== 'ski');
  // 🥾 / 🚵 Itinéraires Camptocamp de l'écran : liste ou carte (tracés des plus proches, façon Komoot), fiche touchée.
  const [c2c, setC2c] = useState<{ act: C2cActivity; bike?: Bike; bbox: [number, number, number, number]; center: LonLat } | null>(null);
  const [c2cRoutes, setC2cRoutes] = useState<C2cRoute[]>([]);
  const [c2cLines, setC2cLines] = useState<{ id: number; line: LonLat[] }[]>([]);
  const [c2cMap, setC2cMap] = useState(false);
  const [c2cPick, setC2cPick] = useState<{ id: number } | null>(null);
  /** « 🔍 Rechercher ici » : cadre de la carte affichée, et recherche en cours. */
  const [c2cView, setC2cView] = useState<[number, number, number, number] | null>(null);
  const [c2cLoading, setC2cLoading] = useState(false);
  useEffect(() => {
    if (!c2c || !c2cMap || !c2cRoutes.length) return;
    const sig = { stop: false };
    setC2cLines([]);
    void fetchLines(c2cRoutes, c2c.center, (id, line) => setC2cLines((cur) => [...cur.filter((x) => x.id !== id), { id, line }]), sig,
      (r) => fetchOtherSheet(r, [IA_MOT_DE_PASSE_INTEGRE, iaPassword].filter(Boolean).join('\n')));
    return () => { sig.stop = true; };
  }, [c2c, c2cMap, c2cRoutes]);
  // Sur la carte, aussi les itinéraires balisés d'OpenStreetMap (randos, ou circuits VTT en 🚵) : toucher l'un ouvre son profil.
  useEffect(() => {
    if (!c2c || !c2cMap || zoneTooBig(c2c.bbox)) return;
    const ctrl = new AbortController();
    void fetchTrails(c2c.bbox, ctrl.signal, c2c.act === 'mountain_biking')
      .then((found) => setTrails((prev) => [...prev.filter((x) => isMine(x.id)), ...found])).catch(() => {});
    return () => ctrl.abort();
  }, [c2c, c2cMap]);
  const openC2c = (act: C2cActivity, bike?: Bike, onMap = false) => {
    if (!map) return;
    const b = map.getBounds(), c = map.getCenter();
    setTravel(false); setLodging(false); setOpen(false); setSearching(false); setSkiText(false); setSkiOn(false);
    setC2cRoutes([]); setC2cLines([]); setC2cMap(onMap); setC2cPick(null);
    setC2c({ act, bike, bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], center: { lon: c.lng, lat: c.lat } });
  };
  const closeC2c = () => { setC2c(null); setC2cRoutes([]); setC2cLines([]); setC2cMap(false); setC2cPick(null); };
  /** Types de chemin de la trace choisie, repérée par son empreinte (les numéros des traces sont réutilisés). */
  const [wayRunsSel, setWayRunsSel] = useState<{ key: string; v: WayRun[] | 'loading' | 'error' } | null>(null);
  /** 🧭 Navigation sur une de mes traces (identifiant), et dernière position GPS connue. */
  const [navId, setNavIdState] = useState<number | null>(null);
  /** ⏸ Suivi en pause : GPS du bouton ◎ coupé, plus d'alerte ; ▶ reprend. */
  const [navPaused, setNavPaused] = useState(false);
  /** ⑂ Écran rallumé avant les carrefours pendant le suivi (bouton à gauche de 👖), et carrefours de la trace suivie. */
  const [junctionWake, setJunctionWake] = useState(true);
  useEffect(() => { void traceWakeEnabled().then(setJunctionWake); }, []);
  /** Vibration quand on quitte la trace suivie (bouton à gauche de ⑂). */
  const [offVibrate, setOffVibrate] = useState(true);
  useEffect(() => { void offTrackVibrateEnabled().then(setOffVibrate); }, []);
  // 👥 Retour de la page de connexion (fr.assomoutain.rando://callback) et synchro du compte au retour du réseau.
  useEffect(() => ecouterCompte(setToast, () => setAccount(true)), []);
  // 👥 Liens d'invitation (fr.assomoutain.rando://rejoindre?c=…) et synchro des Buddies.
  useEffect(() => ecouterBuddies(setToast, () => setBuddies(true)), []);
  // 📞 Appel : la sonnerie (écran 10) et, une fois en ligne, la carte à l'écran avec la barre d'appel (écran 24).
  useSonnerie(setToast);
  // 🔔 Toucher la notification d'un message : sa conversation s'ouvre (celle d'un Buddy Time, sur sa carte).
  useNotifMessages((c) => {
    const v = vueBuddies(lireBuddies());
    const x = c.sortie ? v.sorties.find((y) => y.id === c.sortie) : undefined;
    if (x) montrerBuddies({ sortie: x, traces: v.traces.filter((t) => t.sortie === x.id), parler: true });
    else if (c.groupe) { setCarteSortie(null); setBuddiesDepart({ ecran: 'conv', id: c.groupe }); setBuddies(true); }
  });
  const appel = useAppel();
  const enAppel = !!appel && appel.phase !== 'sonne';
  useEffect(() => { if (enAppel) setBuddies(false); }, [enAppel]);
  // 📍 Épingle enfoncée dans un Buddy Time : la position part toutes les 5 minutes (spec/buddies.md §5.9).
  useEpingle();
  const [junctions, setJunctions] = useState<{ id: number; pts: LonLat[] | null }>({ id: 0, pts: null });
  const setNavId = (id: number | null) => { setNavIdState(id); setNavPaused(false); };
  // Traces affichées et suivi en cours gardés quand l'appli se ferme ; remis à la réouverture (le suivi reprend).
  const shownLoaded = useRef(false);
  const [pendingNav, setPendingNav] = useState<{ id: number; paused: boolean } | null>(null);
  useEffect(() => {
    void loadShown().then((st) => {
      shownLoaded.current = true;
      if (st.trails.length) setTrails((prev) => [...st.trails, ...prev.filter((x) => !st.trails.some((y) => y.id === x.id))]);
      if (st.navId != null) setPendingNav({ id: st.navId, paused: st.navPaused });
    });
  }, []);
  const [navPos, setNavPos] = useState<{ lon: number; lat: number; acc: number } | null>(null);
  /** 📶 Hors ligne de la trace sélectionnée : message affiché dans son menu. */
  const [traceOffline, setTraceOffline] = useState<{ id: number; msg: string } | null>(null);
  // Par défaut : ligne libre (le recalage peut dévier) ; le choix est retenu.
  /** Curseur de pente : distance le long de la rando affichée. */
  const [profCursor, setProfCursor] = useState<number | null>(null);
  const profile = useMemo(() => (elevated && typeof elevated === 'object' ? buildProfile(elevated.segments) : null), [elevated]);
  useEffect(() => setProfCursor(null), [elevated]);
  // Pentes cochées + tracé affiché (rando ou tracé au doigt, GPX importé) : étiquettes de pente régulières.
  const [importProfile, setImportProfile] = useState<{ prof: ProfileData; gps: boolean } | null>(null);
  useEffect(() => {
    setImportProfile(null);
    if (!showSlopes || imported.length < 2) return;
    const pts = imported.map((p) => ({ lon: p.lon, lat: p.lat, ele: p.ele }));
    // Altitudes du GPX si elles y sont, sinon relief IGN (réseau).
    if (pts.filter((p) => p.ele != null).length >= pts.length * 0.8) { setImportProfile({ prof: buildProfile([pts]), gps: true }); return; }
    let live = true;
    const t = drawnTrail(pts, false);
    elevate(t).then((el) => { if (live) setImportProfile({ prof: buildProfile(el.segments), gps: false }); }).catch(() => {});
    return () => { live = false; };
  }, [imported, showSlopes]);
  // « Afficher la pente » du menu de la trace violette : étiquettes sur cette trace seule.
  const drawnSel = selected != null && isMine(selected.id);
  const slopeTags = useMemo(() => {
    const own = showSlopes || (drawnSel && drawnSlopes);
    if (!own) return [];
    return [
      ...(profile ? slopeLabels(profile, undefined, undefined, vtt) : []),
      ...(showSlopes && importProfile ? slopeLabels(importProfile.prof, importProfile.gps ? 100 : 50, undefined, vtt) : []),
    ];
  }, [showSlopes, profile, importProfile, drawnSel, drawnSlopes, vtt]);
  // Types de chemin de la trace choisie, en 🚵 🚴 🚲 🥾 (Seb : aussi gravel et marche, et pas seulement mes traces :
  // sentiers balisés et itinéraires touchés sur la carte aussi) : gardés sur le téléphone, sinon cherchés sur le réseau.
  const wantWays = activity !== 'ski' && wayTypesOn && selected != null;
  const selKey = useMemo(() => (selected ? lineKey(selected.segments.flat()) : ''), [selected]);
  useEffect(() => {
    if (!wantWays || !selected) return;
    const line = selected.segments.flat(), key = selKey;
    if (wayRunsSel?.key === key && wayRunsSel.v !== 'error') return;
    setWayRunsSel({ key, v: 'loading' });
    void wayRunsFor(line)
      .then((v) => setWayRunsSel((cur) => (cur?.key === key ? { key, v } : cur)))
      .catch(() => setWayRunsSel((cur) => (cur?.key === key ? { key, v: 'error' } : cur)));
  }, [wantWays, selKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const selRuns = wantWays && selected && wayRunsSel?.key === selKey ? wayRunsSel.v : null;
  // Dès qu'une de mes traces s'affiche (dessinée, chargée, rouverte), ses types de chemin sont calculés en avance et gardés.
  useEffect(() => { for (const t of trails) if (isMine(t.id)) prefetchWays(t.segments.flat()); }, [trails]);
  const wayLines = useMemo(() => (selected && Array.isArray(selRuns) ? wayRunLines(selected.segments.flat(), selRuns) : []), [selected, selRuns]);
  const [onPaths, setOnPathsState] = useState(() => { try { return localStorage.getItem('recaler') === '1'; } catch { return false; } });
  const setOnPaths = (v: boolean) => { setOnPathsState(v); try { localStorage.setItem('recaler', v ? '1' : '0'); } catch { /* ignoré */ } };
  const trailsAbort = useRef<AbortController | null>(null);
  // Randos trouvées sur le web par Claude (via le relais du VPS) : un point par rando.
  const [iaPassword, setIaPassword] = useState('');
  const [webHikes, setWebHikes] = useState<WebHike[]>([]);
  const [webMsg, setWebMsg] = useState('');
  const [hikeSel, setHikeSel] = useState<number | null>(null);
  const webAbort = useRef<AbortController | null>(null);

  // Forêts par essence (BD Forêt IGN) d'une zone
  const [forests, setForests] = useState<Forest[]>([]);
  const [forestsMsg, setForestsMsg] = useState('');
  /** Essences choisies dans la liste ; vide : toutes les forêts sont dessinées. */
  const [forestFilter, setForestFilter] = useState<Set<string>>(new Set());
  const forestsAbort = useRef<AbortController | null>(null);
  /** Recherche des forêts en cours (🌲 allumé, un appui l'annule). */
  const [forestsLoading, setForestsLoading] = useState(false);

  // Mesures (rafraîchies à la demande pour ne pas réveiller l'écran inutilement)
  const [, setTick] = useState(0);
  const [map, setMap] = useState<MlMap | null>(null);
  // Tracer au doigt et encadrer une zone se font sur la carte à plat : on quitte la 3D.
  useEffect(() => { if ((drawing || framing) && tilted) map?.jumpTo({ pitch: 0, bearing: 0 }); }, [drawing, framing, tilted, map]);
  // Itinéraires sur la carte : on suit les déplacements pour proposer « 🔍 Rechercher ici » hors de la zone cherchée.
  useEffect(() => {
    if (!map || !c2c || !c2cMap) { setC2cView(null); return; }
    const seen = () => { const b = map.getBounds(); setC2cView([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]); };
    seen();
    map.on('moveend', seen);
    return () => { map.off('moveend', seen); };
  }, [map, c2c, c2cMap]);
  /** Lieu choisi dans le champ de la liste des itinéraires : la carte y va, la recherche s'y refait. */
  const placeC2c = (p: { lon: number; lat: number; zoom: number }) => {
    if (!map || !c2c) return;
    map.jumpTo({ center: [p.lon, p.lat], zoom: Math.min(p.zoom, 12) });
    const b = map.getBounds();
    setC2cPick(null);
    setC2c({ ...c2c, bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], center: { lon: p.lon, lat: p.lat } });
  };
  const searchHere = () => {
    if (!map || !c2c) return;
    const b = map.getBounds(), c = map.getCenter();
    setC2cPick(null);
    setC2c({ ...c2c, bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], center: { lon: c.lng, lat: c.lat } });
  };
  /** Centre la carte sur un point (départ ou sommet d'une sortie), après le cadrage automatique de la sortie. */
  const flyTo = (at?: [number, number]) => { if (at) window.setTimeout(() => map?.flyTo({ center: at, zoom: Math.max(map.getZoom(), 14) }), 700); };
  const [camBench, setCamBench] = useState<CameraBenchResult | 'running' | null>(null);

  useEffect(() => {
    (async () => {
      const k = (await Preferences.get({ key: 'apiKey' })).value;
      if (k) { prefs.apiKey = k; setApiKey(k); }
      setIaPassword((await Preferences.get({ key: 'iaPassword' })).value ?? '');
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
    // Le panneau du bas est toujours fermé quand on ouvre l'appli, même en revenant de l'arrière-plan (demande de Seb).
    const sub = CapApp.addListener('appStateChange', ({ isActive }) => { setVisible(isActive); if (isActive) setOpen(false); });
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
    // Pendant un appel, l'appui long montre l'endroit aux autres (👉, spec §5.7) au lieu d'y aller.
    const onLong = (e: maplibregl.MapMouseEvent) => montrer(e.lngLat.lng, e.lngLat.lat) || setTarget({ lon: e.lngLat.lng, lat: e.lngLat.lat, label: 'Point choisi sur la carte' });
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

  /** ⏸ : GPS de l'enregistrement coupé, le parcours déjà fait est gardé ; ▶ reprend à la suite. */
  async function pauseRecording() {
    await source.current?.stop();
    source.current = null; applied.current = null;
    await recorder.current.save();
  }
  async function resumeRecording() {
    if (source.current || !recording) return;
    const src = defaultSource();
    const d = decideSettings({ mode, lastKept: null, latest: null, appVisible: true, battery: battery.current, now: Date.now(), stopPoint: null });
    try { await src.start(d.settings, onFixes); source.current = src; applied.current = d.settings; }
    catch (e) { setToast(String((e as Error).message ?? e)); }
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
    const mnt = await getTileStore(MNT_LAYER);
    setStored({ scan25: scan.count(), planign: plan.count(), scan25Bytes: scan.bytes(), planignBytes: plan.bytes(), mnt: mnt.count(), mntBytes: mnt.bytes() });
  }

  /**
   * Étapes d'un téléchargement hors ligne : le fond affiché (zooms 10 à 16) sur les tuiles données,
   * puis le relief pour les ombres (zooms 10 à 14) sur le rectangle donné, pour le film sans réseau.
   */
  function offlineSteps(tilesFor: (minZoom: number, maxZoom: number) => TileCoord[], reliefBbox: Bbox) {
    return [
      ...offlinePlan(baseLayer, OFFLINE_MIN_ZOOM, OFFLINE_MAX_ZOOM).map((st) => {
        const layer = LAYERS[st.layer];
        return { layer, label: `${layer.label}, zooms ${st.minZoom} à ${st.maxZoom}`, tiles: tilesFor(st.minZoom, st.maxZoom),
          url: (t: TileCoord) => wmtsTileUrl(layer, t.z, t.x, t.y, apiKey) };
      }),
      { layer: MNT_LAYER, label: `${MNT_LAYER.label}, pour les ombres`, tiles: mntTilesForZone(reliefBbox), url: mntTileUrl },
    ];
  }

  async function runDownload(steps: ReturnType<typeof offlineSteps>) {
    abort.current = new AbortController();
    let failed = 0;
    for (const step of steps) {
      if (abort.current.signal.aborted) break;
      const store = await getTileStore(step.layer);
      setDownloading(step.label);
      bench('download-start', { layer: step.layer.id, tiles: step.tiles.length });
      const res = await downloadTiles(store, step.tiles, step.url, setProgress, abort.current.signal);
      failed += res.failed;
      bench('download-end', { layer: step.layer.id, ...res });
    }
    setDownloading('');
    await refreshStored();
    return { failed, aborted: abort.current.signal.aborted };
  }

  /** Télécharge le rectangle choisi sur la carte, pour le fond affiché. */
  async function downloadZone(bbox: Bbox) {
    const steps = offlineSteps((a, b) => tilesForBbox(bbox, a, b), bbox);
    const total = steps.slice(0, -1).reduce((n, st) => n + st.tiles.length, 0);
    if (total > MAX_ZONE_TILES) {
      setStatus(`Zone trop grande (${total} tuiles, maximum ${MAX_ZONE_TILES}) : trace un rectangle plus petit.`);
      return;
    }
    setStatus(`Rectangle : ${total} tuiles, environ ${formatMo(total * TILE_BYTES_ESTIMATE)}.`);
    const r = await runDownload(steps);
    // Noms des sommets, cols, lieux-dits… de la zone : la loupe 🔍 les trouve ensuite sans réseau.
    if (!r.aborted) await savePlaceNames(bbox).catch(() => 0);
  }

  /** 📶 Cartes et relief dans un couloir d'environ 1 km autour d'une de mes traces. */
  function traceSteps(t: Trail) {
    const line = t.segments.flat();
    return offlineSteps((a, b) => tilesForCorridor(line, CORRIDOR_M, a, b), lineBbox(line, CORRIDOR_M));
  }

  /** Tuiles du couloir déjà sur le téléphone : la coche ✓ du menu de la trace. */
  async function traceOfflineReady(t: Trail) {
    for (const st of traceSteps(t)) {
      const store = await getTileStore(st.layer);
      if (st.tiles.some((x) => !store.has(x))) return false;
    }
    return true;
  }

  async function downloadTrace(t: Trail, ask = false) {
    if (downloading) { setTraceOffline({ id: t.id, msg: 'Un téléchargement est déjà en cours, patiente un peu.' }); return; }
    const steps = traceSteps(t);
    const missing: number[] = [];
    for (const st of steps) { const store = await getTileStore(st.layer); missing.push(st.tiles.filter((x) => !store.has(x)).length); }
    const total = missing.reduce((a, b) => a + b, 0);
    // Noms des lieux autour de la trace, pour la loupe 🔍 sans réseau (rien à faire s'ils sont déjà là).
    const names = () => savePlaceNames(lineBbox(t.segments.flat(), CORRIDOR_M)).catch(() => 0);
    if (!total) { void junctionsFor(t.segments.flat()).catch(() => null); void names(); setTraceOffline({ id: t.id, msg: '✓ Cartes et relief déjà disponibles hors ligne autour de cette trace.' }); return; }
    const mapTiles = missing.slice(0, -1).reduce((a, b) => a + b, 0);
    if (mapTiles > MAX_ZONE_TILES) {
      setTraceOffline({ id: t.id, msg: `Trace trop longue pour le hors ligne d'un coup (${mapTiles} tuiles, maximum ${MAX_ZONE_TILES}).` });
      return;
    }
    const size = formatMo(mapTiles * TILE_BYTES_ESTIMATE);
    if (ask && !window.confirm(`Télécharger les cartes à 1 km autour de « ${t.name} » pour le hors ligne (environ ${size}) ?`)) return;
    setTraceOffline({ id: t.id, msg: `📶 Téléchargement des cartes autour de la trace (environ ${size})…` });
    const r = await runDownload(steps);
    // ⑂ Carrefours de la trace, gardés pour l'écran rallumé avant les carrefours hors ligne.
    if (!r.aborted) { await junctionsFor(t.segments.flat()).catch(() => null); await names(); }
    setTraceOffline({ id: t.id, msg: r.aborted ? 'Téléchargement arrêté.'
      : r.failed ? `Téléchargement terminé, mais ${r.failed} tuiles ont échoué (réseau ?) : relance 📶 Hors ligne.`
      : '✓ Cartes et relief disponibles hors ligne autour de cette trace.' });
  }

  async function clearZone() {
    for (const l of [LAYERS.scan25, LAYERS.planign, MNT_LAYER]) await (await getTileStore(l)).clear();
    await clearPlaceNames();
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
    void searchWebHikes(b);
    setTrails((prev) => prev.filter((x) => isMine(x.id)));
    if (!selected || !isMine(selected.id)) { setSelected(null); setElevated(null); }
    setTrailsMsg('Recherche des randos dans OpenStreetMap…');
    trailsAbort.current?.abort();
    const ctrl = new AbortController();
    trailsAbort.current = ctrl;
    const t0 = performance.now();
    try {
      const found = await fetchTrails(b, ctrl.signal);
      bench('trails-search', { found: found.length, ms: Math.round(performance.now() - t0) });
      setTrails((prev) => [...prev.filter((x) => isMine(x.id)), ...found]);
      setTrailsMsg(found.length ? `${found.length} rando${found.length > 1 ? 's' : ''} balisée${found.length > 1 ? 's' : ''} trouvée${found.length > 1 ? 's' : ''}. Touche-en une (liste ou carte).`
        : 'Aucune rando balisée dans OpenStreetMap sur cette zone.');
    } catch (e) {
      if (!ctrl.signal.aborted) setTrailsMsg(`Recherche impossible (pas de réseau ? serveur saturé ?) : ${(e as Error).message}`);
    }
  }

  async function searchWebHikes(b: Bbox) {
    webAbort.current?.abort();
    setWebHikes([]); setHikeSel(null);
    const pwd = IA_MOT_DE_PASSE_INTEGRE || iaPassword;
    if (!pwd) { setWebMsg('Pour ajouter les randos trouvées sur le web, saisis le mot de passe de recherche ci-dessous.'); return; }
    const ctrl = new AbortController();
    webAbort.current = ctrl;
    setWebMsg('Je cherche des randos sur le web (1 à 2 minutes)…');
    const t0 = performance.now();
    try {
      const r = await fetchWebHikes(b, pwd, ctrl.signal);
      bench('web-hikes', { found: r.hikes.length, cache: r.cache, ms: Math.round(performance.now() - t0) });
      setWebHikes(r.hikes);
      setWebMsg((r.hikes.length ? `${r.hikes.length} rando${r.hikes.length > 1 ? 's' : ''} trouvée${r.hikes.length > 1 ? 's' : ''} sur le web (points orange). Touche un point pour ouvrir sa page.`
        : 'Aucune page de rando trouvée sur cette zone.') + ' ' + costLine(r.cost, r.cache));
    } catch (e) {
      if (!ctrl.signal.aborted) setWebMsg(`Recherche web impossible : ${(e as Error).message}`);
    }
  }

  function selectHike(i: number | null) {
    setHikeSel(i);
    if (i == null) return;
    const h = webHikes[i];
    setOpen(true); setTab('randos'); setFollow(false);
    map?.easeTo({ center: [h.lon, h.lat], duration: 600 });
  }

  async function saveIaPassword(p: string) {
    setIaPassword(p);
    await Preferences.set({ key: 'iaPassword', value: p });
  }

  function clearForests() {
    forestsAbort.current?.abort(); setForestsLoading(false);
    setForests([]); setForestFilter(new Set()); if (!trails.length) setFrame(null); setForestsMsg('');
  }

  /** quiet : lancé par 🌲 sur la carte, le menu reste fermé et les messages passent en bandeau. */
  async function searchForests(b: Bbox, quiet = false) {
    if (!quiet) {
      setFraming(false);
      setOpen(true);
      setTab('forets');
    }
    if (forestZoneTooBig(b)) {
      setForestsMsg(`Zone trop grande : zoome ou encadre au plus ${Math.round(MAX_FOREST_DEG * 100)} km de côté environ.`);
      if (quiet) setToast(`🌲 Zone trop grande : zoome pour voir les forêts (${Math.round(MAX_FOREST_DEG * 100)} km de côté au plus).`);
      return;
    }
    if (!quiet) setFrame(b);
    setForests([]); setForestFilter(new Set());
    setForestsMsg('Recherche des forêts dans la carte forestière IGN…');
    if (quiet) setToast('🌲 Recherche des forêts…');
    setForestsLoading(true);
    forestsAbort.current?.abort();
    const ctrl = new AbortController();
    forestsAbort.current = ctrl;
    const t0 = performance.now();
    try {
      const found = await fetchForests(b, ctrl.signal);
      bench('forests-search', { found: found.length, ms: Math.round(performance.now() - t0) });
      setForests(found);
      const n = groupByEssence(found).length;
      setForestsMsg(!found.length ? 'Aucune forêt dans la carte forestière IGN sur cette zone.'
        : `${found.length} massifs, ${n} essence${n > 1 ? 's' : ''}. Touche une essence pour ne voir qu'elle (plusieurs possibles).`
          + (found.length >= 5000 ? ' Zone très boisée : tout n\'a pas pu être chargé, zoome pour être complet.' : ''));
      if (quiet) setToast(!found.length ? '🌲 Aucune forêt dans la carte forestière IGN sur cette zone.'
        : `🌲 ${found.length} massifs, ${n} essences. Touche une forêt pour son essence.`);
    } catch (e) {
      if (!ctrl.signal.aborted) {
        setForestsMsg(`Recherche impossible (pas de réseau ?) : ${(e as Error).message}`);
        if (quiet) setToast(`🌲 Recherche impossible (pas de réseau ?) : ${(e as Error).message}`);
      }
    } finally {
      if (forestsAbort.current === ctrl) setForestsLoading(false);
    }
  }

  /** Choisit ou retire une essence, puis cadre la carte sur les forêts choisies. */
  function toggleEssence(essence: string) {
    const next = new Set(forestFilter);
    if (next.has(essence)) next.delete(essence); else next.add(essence);
    setForestFilter(next);
    if (!map || !next.size) return;
    const b = new maplibregl.LngLatBounds();
    forests.filter((f) => next.has(f.essence)).forEach((f) => f.polygons.forEach((p) => p[0].forEach((c) => b.extend(c))));
    if (b.isEmpty()) return;
    setFollow(false);
    const sheet = document.querySelector('.sheet')?.getBoundingClientRect().height ?? 0;
    const h = map.getContainer().clientHeight;
    map.fitBounds(b, { padding: { top: 140, left: 30, right: 70, bottom: Math.max(20, Math.min(sheet + 20, h - 200)) }, duration: 800, maxZoom: 16 });
  }

  async function selectTrail(t: Trail | null) {
    setSelected(t);
    setElevated(t ? 'loading' : null);
    setFollow(false);
    // La trace violette a son propre menu en bas ; les randos s'ouvrent dans le panneau.
    setTraceMenu(t != null && isMine(t.id));
    if (!t) return;
    if (isMine(t.id)) { setTraceList(null); setOpen(false); } else { setOpen(true); setTab('randos'); }
    const first = t.segments[0][0];
    setTarget({ lon: first.lon, lat: first.lat, label: `Départ de « ${t.name} »` });
    try {
      const el = await elevate(t);
      setSelected((cur) => { if (cur?.id === t.id) setElevated(el); return cur; });
    } catch {
      setSelected((cur) => { if (cur?.id === t.id) setElevated('error'); return cur; });
    }
  }

  function startDrawing() {
    // ✏ pendant le suivi d'une trace : on ouvre le menu de la trace suivie, pas un nouveau tracé (demande de Seb).
    const followed = navId != null ? trails.find((t) => t.id === navId) : null;
    if (followed) {
      setTraceList(null); setOpen(false); setSearching(false);
      if (selected?.id === followed.id) setTraceMenu(true); else void selectTrail(followed);
      return;
    }
    // Nouveau tracé : les traces déjà affichées restent sur la carte (chacune sa couleur).
    setTraceMenu(false); setTraceList(null);
    setDrawing(true); setOpen(false); setSearching(false);
  }

  async function drawDone(line: LonLat[]) {
    setDrawing(false);
    let final = line, used = onPaths;
    if (onPaths) {
      setToast('Calcul du chemin sur les sentiers…');
      try { final = await routeOnPaths(waypoints(line)); setToast(''); }
      catch { used = false; setToast('Chemins introuvables (pas de réseau ?) : la ligne dessinée est gardée telle quelle.'); }
    }
    showMine(final, { onPaths: used });
  }

  /** Ajoute une de mes traces (dessinée, enregistrée ou chargée), avec sa propre couleur, et ouvre son menu en bas. */
  function showMine(line: LonLat[], o: { onPaths: boolean; name?: string; savedId?: number | null; kind?: string }) {
    const { id, color } = nextMine(trails);
    const base = drawnTrail(line, o.onPaths, id, color);
    const t: Trail = { ...base, name: o.name ?? base.name, kind: o.kind ?? base.kind, savedId: o.savedId ?? null };
    setTrails((prev) => [t, ...prev]);
    void selectTrail(t);
    return t;
  }

  /**
   * 👥 Un Buddy Time sur la carte (écran 4) ou une trace partagée dans un groupe : ses traces s'ajoutent à mes
   * traces affichées (profil, 🚗 Y aller, ▶ Commencer, 📶 Hors ligne marchent comme pour les miennes).
   */
  function montrerBuddies(x: CarteBuddies) {
    setBuddies(false); setBuddiesDepart(undefined); setTraceList(null);
    setCarteSortie(x.sortie ? { sortie: x.sortie, traces: x.traces, parler: x.parler } : null);
    setPointBuddy(x.point ?? null);
    const pts: LonLat[] = [];
    for (const t of x.traces) {
      const line = t.ligne.map(([lon, lat]) => ({ lon, lat }));
      pts.push(...line);
      const kind = `Partagée par ${t.par.pseudo}`;
      if (!trails.some((y) => isMine(y.id) && y.name === t.nom && y.kind === kind)) showMine(line, { onPaths: false, name: t.nom, kind });
    }
    if (x.sortie) setTraceMenu(false);
    if (map && pts.length) {
      const lons = pts.map((p) => p.lon), lats = pts.map((p) => p.lat);
      map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 70, maxZoom: 15, duration: 600 });
    }
  }

  /** 📥 Ouvrir un fichier GPX, KML ou GeoJSON du téléphone : il s'ajoute aux traces affichées. */
  async function openTraceFile() {
    setDrawing(false); setTraceList(null);
    try {
      const f = await pickTraceFile();
      if (f) loadTraceText(f);
    } catch (e) {
      setToast(`Fichier illisible : ${(e as Error).message}`);
    }
  }

  /** Texte d'un fichier de trace (choisi ici, ou ouvert depuis une autre appli) : il s'ajoute aux traces affichées. */
  function loadTraceText(f: { name: string; text: string }) {
    setDrawing(false); setTraceList(null);
    try {
      const t = parseTraceFile(f.text, f.name);
      const shown = showMine(t.line, { onPaths: false, name: t.name, kind: `Fichier ${f.name || 'chargé'}` });
      setToast(`📥 « ${t.name} » chargée : 🚗 Y aller pour s'y rendre, ▶ Commencer la trace sur place`);
      // On propose tout de suite les cartes autour de la trace, pour partir tranquille sans réseau.
      void downloadTrace(shown, true);
    } catch (e) {
      setToast(`Fichier illisible : ${(e as Error).message}`);
    }
  }

  async function openTraceList() {
    setDrawing(false); setTraceMenu(false); setOpen(false);
    const list = await listTraces();
    setTraceList(list);
    // Traces sauvegardées avant les fichiers GPX : on les écrit dans Téléchargements/Mountain Buddies.
    for (const st of list) void writeTraceFile(st, false);
  }

  function loadTrace(st: SavedTrace) {
    setTraceList(null);
    // Déjà affichée : on la sélectionne simplement.
    const shown = trails.find((x) => isMine(x.id) && x.savedId === st.id);
    if (shown) { void selectTrail(shown); return; }
    showMine(traceLine(st), { onPaths: st.onPaths, name: st.name, savedId: st.id });
  }

  async function saveDrawn() {
    if (!selected || !isMine(selected.id)) return;
    const name = window.prompt('Nom de la trace', defaultTraceName())?.trim();
    if (name == null) return;
    try {
      const st = await saveTrace(name || defaultTraceName(), selected.segments.flat(), selected.onPaths ?? false);
      void writeTraceFile(st);
      const t = { ...selected, name: st.name, savedId: st.id };
      setSelected(t);
      setTrails((prev) => prev.map((x) => (x.id === t.id ? t : x)));
      setToast(`💾 Trace « ${st.name} » enregistrée sur le téléphone`);
    } catch (e) {
      setToast(`Enregistrement impossible : ${(e as Error).message}`);
    }
  }

  /** 🗑 Supprimer : la trace quitte la carte (une trace enregistrée reste dans 📂 Mes traces). */
  function deleteDrawn() {
    const id = selected?.id;
    setTrails((prev) => prev.filter((x) => x.id !== id));
    if (navId === id) setNavId(null);
    void selectTrail(null);
  }

  /** ▶ Commencer la trace : GPS en suivi (bouton ◎), bandeau « reste … / hors trace », et le parcours réel
   *  s'enregistre et se dessine en rouge au fur et à mesure. */
  function startNav() {
    if (!selected) return;
    setNavId(selected.id); setNavPos(null); setTraceMenu(false); setFollow(true);
    gpsOn();
    void startTraceRecording();
  }

  /** Enregistrement du parcours réel lancé par ▶ Commencer (arrêté avec la trace). */
  const recByTrace = useRef(false);
  async function startTraceRecording() {
    if (recording) return;
    recByTrace.current = true;
    await startRecording();
  }
  // ⏹ Arrêter la trace : on arrête aussi l'enregistrement qu'elle avait lancé, et on propose de garder le parcours réel.
  const navName = useRef<string | null>(null);
  useEffect(() => { if (navId != null) navName.current = trails.find((t) => t.id === navId)?.name ?? null; }, [navId, trails]);
  useEffect(() => {
    if (navId == null && !freeRec && recByTrace.current && recording) {
      recByTrace.current = false;
      const pts = recorder.current.points.map((p) => ({ lon: p.lon, lat: p.lat }));
      const base = navName.current;
      void stopRecording().then(() => offerSave(pts, base ? `${base} (${defaultTraceName().replace('Tracé du ', 'parcours du ')})` : defaultTraceName().replace('Tracé', 'Trace')));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navId]);

  /** ⏹ Fin d'une trace commencée : « Sauvegarder la trace ? » avec un nom proposé, modifiable (Annuler : pas gardée). */
  async function offerSave(line: LonLat[], name: string): Promise<SavedTrace | null> {
    if (line.length < 2) { setToast('Trace trop courte : rien à garder.'); return null; }
    const n = window.prompt('⏹ Trace terminée. La sauvegarder ? Nom :', name)?.trim();
    if (n == null) { setToast('Trace non sauvegardée'); return null; }
    try {
      const st = await saveTrace(n || name, line, false);
      const path = await writeTraceFile(st);
      setToast(`💾 Trace « ${st.name} » sauvegardée (📂 Mes traces${path ? ` et ${path}` : ''})`);
      return st;
    } catch (e) {
      setToast(`Sauvegarde impossible : ${(e as Error).message}`);
      return null;
    }
  }

  /** ▶ Commencer (menu ✏) : nouvelle trace sans parcours prévu, dessinée au fur et à mesure. */
  const [freeRec, setFreeRec] = useState(false);
  async function startFree() {
    setDrawing(false); setTraceList(null); setTraceMenu(false); setFollow(true);
    gpsOn();
    if (recording) await stopRecording();
    recByTrace.current = true;
    setFreeRec(true);
    await startRecording();
  }
  /** ⏹ : le parcours enregistré devient une de mes traces (💾 pour la garder). */
  async function stopFree() {
    setFreeRec(false); recByTrace.current = false;
    const pts = [...recorder.current.points];
    await stopRecording();
    if (pts.length < 2) { setToast('Trace trop courte : rien à garder.'); return; }
    const line = pts.map((p) => ({ lon: p.lon, lat: p.lat }));
    const name = defaultTraceName().replace('Tracé', 'Trace');
    const st = await offerSave(line, name);
    showMine(line, { onPaths: false, name: st?.name ?? name, savedId: st?.id ?? null, kind: 'Parcours enregistré au GPS' });
  }

  const geoState = () => (geo as unknown as { _watchState?: string } | null)?._watchState ?? 'OFF';
  function gpsOn() { const st = geoState(); if (geo && (st === 'OFF' || st === 'BACKGROUND')) void geo.trigger(); }

  useEffect(() => { if (shownLoaded.current) void saveShown(trails, navId, navPaused); }, [trails, navId, navPaused]);
  // Appli rouverte pendant un suivi : il reprend dès que le GPS de la carte est prêt.
  useEffect(() => {
    if (!pendingNav || !geo || !trails.some((t) => t.id === pendingNav.id)) return;
    setNavIdState(pendingNav.id); setNavPaused(pendingNav.paused); setNavPos(null);
    if (!pendingNav.paused) { setFollow(true); gpsOn(); }
    setPendingNav(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNav, geo, trails]);

  /** ⏸ Pause du suivi : on coupe le GPS (batterie) et l'enregistrement ; ▶ les relance, sur la même trace. */
  function pauseNav() {
    setNavPaused(true); setNavPos(null);
    for (let i = 0; i < 2 && geo && geoState() !== 'OFF'; i++) void geo.trigger();
    if (recByTrace.current) void pauseRecording();
  }
  function resumeNav() { setNavPaused(false); setFollow(true); gpsOn(); if (recByTrace.current) void resumeRecording(); }

  async function exportTrail() {
    if (!selected) return;
    const segs = elevated && typeof elevated === 'object' ? elevated.segments : selected.segments;
    try {
      setStatus(`GPX enregistré : ${await saveGpxFile(selected.name, trailToGpx(selected, segs))}`);
    } catch (e) {
      setStatus(`Export impossible : ${(e as Error).message}`);
    }
  }

  // Menu d'une de mes traces : coche ✓ si ses cartes sont déjà sur le téléphone.
  useEffect(() => {
    if (!selected || !isMine(selected.id) || downloading) return;
    let live = true;
    const t = selected;
    void traceOfflineReady(t).then((ok) => {
      if (live) setTraceOffline((cur) => (cur?.id === t.id && !ok ? cur : ok ? { id: t.id, msg: '✓ Cartes et relief disponibles hors ligne autour de cette trace.' } : null));
    });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, baseLayer]);

  // 📥 Fichier ouvert depuis une autre appli (Gmail, Fichiers…) : chargé comme « Ouvrir un fichier ».
  const loadTraceRef = useRef(loadTraceText);
  loadTraceRef.current = loadTraceText;
  useEffect(() => onTraceFileOpened((r) => {
    if (r.error || r.text == null) setToast(`Fichier illisible : ${r.error ?? 'vide'}`);
    else loadTraceRef.current({ name: r.name ?? '', text: r.text });
  }), []);

  // 🧭 Position suivie : bouton ◎ (GeolocateControl) ou enregistrement en cours.
  useEffect(() => {
    if (!geo || navId == null || navPaused) return;
    const on = (e: { coords: GeolocationCoordinates }) => setNavPos({ lon: e.coords.longitude, lat: e.coords.latitude, acc: e.coords.accuracy });
    geo.on('geolocate', on);
    return () => { geo.off('geolocate', on); };
  }, [geo, navId, navPaused]);
  useEffect(() => { if (navId != null && !navPaused && position) setNavPos({ lon: position.lon, lat: position.lat, acc: position.accuracy ?? 0 }); }, [position, navId, navPaused]);
  const navTrail = navId == null ? null : trails.find((t) => t.id === navId) ?? null;
  useEffect(() => { if (navId != null && !trails.some((t) => t.id === navId)) setNavId(null); }, [trails, navId]);
  const nav = useMemo(() => (navTrail && navPos
    ? navState(navTrail.segments.flat(), navPos, selected?.id === navTrail.id ? profile : null) : null), [navTrail, navPos, selected, profile]);
  // Une vibration quand on sort de la trace (pas à chaque position).
  const wasOff = useRef(false);

  // ⑂ Carrefours de la trace suivie : gardés sur le téléphone (📶 Hors ligne), sinon cherchés dans OpenStreetMap.
  useEffect(() => {
    if (!navTrail || junctions.id === navTrail.id) return;
    const t = navTrail;
    setJunctions({ id: t.id, pts: null });
    void junctionsFor(t.segments.flat()).then((pts) => setJunctions((cur) => (cur.id === t.id ? { id: t.id, pts } : cur)))
      .catch(() => {
        setJunctions((cur) => (cur.id === t.id ? { id: t.id, pts: [] } : cur));
        if (junctionWake) setToast('Carrefours introuvables sans réseau : l’écran se rallumera seulement si tu quittes la trace. Fais 📶 Hors ligne avant de partir.');
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navTrail?.id]);
  // Service natif pendant le suivi : GPS qui continue écran éteint, vibration hors trace ; avec ⑂, écran rallumé
  // avant les carrefours et hors trace (Android).
  const wakeOn = navTrail != null && !navPaused && junctions.id === navTrail.id && junctions.pts != null;
  useEffect(() => {
    if (!wakeOn || !navTrail) return;
    void startTraceWake(navTrail.segments.flat(), junctions.pts ?? [], junctionWake, offVibrate).catch((e) => setToast(`Écran aux carrefours impossible : ${(e as Error).message}`));
    return () => { void stopTraceWake().catch(() => {}); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wakeOn, navTrail?.id, junctions, junctionWake, offVibrate]);
  // Nouvelle trace (✏ ▶ Commencer) : même service, sans trace prévue, pour passer devant l'écran de verrouillage.
  useEffect(() => {
    if (!freeRec || navPaused) return;
    void startTraceWake([], [], false, false).catch(() => {});
    return () => { void stopTraceWake().catch(() => {}); };
  }, [freeRec, navPaused]);
  const alongs = useMemo(() => (navTrail && junctions.id === navTrail.id && junctions.pts?.length
    ? junctionAlongs(navTrail.segments.flat(), junctions.pts) : []), [navTrail, junctions]);
  const nextJunction = nav ? nextJunctionM(alongs, nav.alongM) : null;
  useEffect(() => {
    const off = nav != null && nav.offM > OFF_TRACK_M + (navPos?.acc ?? 0) / 2;
    // Avec le service natif (Android), c'est lui qui vibre, même écran éteint.
    if (off && !wasOff.current && offVibrate && !(wakeOn && traceWakeAvailable())) try { navigator.vibrate?.([200, 100, 200]); } catch { /* ignoré */ }
    wasOff.current = off;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, navPos]);

  const stats = computeStats(recorded);
  const avgTile = metrics.tilesFromDisk + metrics.tilesFromNetwork ? metrics.tileLoadTotalMs / (metrics.tilesFromDisk + metrics.tilesFromNetwork) : 0;

  return (
    <div className={`app ${nature ? 'nature' : ''}`}>
      {nature && <button className="restore" onClick={() => setNature(false)} aria-label="Afficher les boutons">☰</button>}
      <MapView baseLayer={baseLayer} showSlopes={showSlopes} recorded={recorded} imported={imported}
        position={position} follow={follow && camBench !== 'running'} visible={visible}
        onMapReady={setMap} onGeolocate={setGeo} onTilt={setTilted} trails={trails} selectedTrail={selected} frame={frame}
        onTrailClick={(id, at) => {
          // Toucher le tracé déjà ouvert : pente à cet endroit ; sinon, ouvrir cette rando.
          if (isMine(id) && selected?.id === id) { if (profile) setProfCursor(nearestD(profile, at.lon, at.lat)); setTraceList(null); setTraceMenu(true); return; }
          if (selected?.id === id && profile) { setProfCursor(nearestD(profile, at.lon, at.lat)); setOpen(true); return; }
          void selectTrail(trails.find((t) => t.id === id) ?? null);
        }}
        slopeTags={slopeTags} wayLines={wayLines}
        c2cPoints={c2c ? c2cRoutes : []} c2cLines={c2c && c2cMap ? c2cLines : []}
        onC2cClick={(id) => { setC2cMap(false); setC2cPick({ id }); }}
        cursor={profile && profCursor != null ? pointAt(profile, profCursor) : null}
        webHikes={webHikes} selectedHike={hikeSel} onHikeClick={selectHike}
        forests={forests} forestFilter={forestFilter}
        travelRoutes={travelRoutes} travelSel={travelSel} onTravelClick={setTravelSel}
        skiOutings={skiOutings} skiSel={skiSel}
        // Appui sur une sortie (point, étiquette ou parking) : on la choisit et on ouvre sa fiche texte.
        onSkiClick={(i) => setSkiSel(i)}
        onSkiClear={() => { setSkiSel(null); setTopoSel(null); }}
        topos={topos} topoSel={topoSel} onTopoClick={setTopoSel}
        onTopoOpen={(i) => { setTopoSel(i); const t = topos[i]; if (t) setTopoSheet(t); }}
        onSkiOpen={(i) => { setSkiSel(i); const o = skiOutings[i]; if (o) setSkiSheet(rowOf(o)); }}
        onForestClick={(f) => setToast(`🌲 ${f.essence}${f.type && f.type !== f.essence ? ` · ${f.type}` : ''} · ${formatHa(f.ha)}`)} />
      {map && <ScaleBar map={map} top={10} />}
      {drawing && map && <DrawOverlay map={map} onPaths={onPaths} setOnPaths={setOnPaths}
        onDone={(l) => void drawDone(l)} onCancel={() => setDrawing(false)} onLoad={() => void openTraceList()} onStart={() => void startFree()}
        rec={freeRec ? { paused: navPaused,
          onPause: () => { setNavPaused(true); void pauseRecording(); setDrawing(false); },
          onResume: () => { setNavPaused(false); setFollow(true); gpsOn(); void resumeRecording(); setDrawing(false); },
          onStop: () => { setNavPaused(false); setDrawing(false); void stopFree(); } } : null} />}
      {navTrail && !drawing && <NavBar trail={navTrail} state={nav} waiting={!navPos} paused={navPaused} nextJunctionM={nextJunction} onOpen={startDrawing} />}
      {survol && traceMenu && selected && isMine(selected.id) && !drawing && map && (
        <Survol map={map} trail={selected} sortie={carteSortie?.sortie ?? null} sorties={lireBuddies().sorties} onClose={() => setSurvol(false)} onToast={setToast} />
      )}
      {!survol && traceMenu && selected && isMine(selected.id) && !drawing && (
        <TraceMenu trail={selected} onFilm={() => { setShowShade(false); setSurvol(true); }} elevated={elevated} slopes={drawnSlopes} onSlopes={setDrawnSlopes}
          showProfile={drawnProfile} onShowProfile={setDrawnProfile} cursor={profCursor} onCursor={setProfCursor}
          savedId={selected.savedId ?? null} onSave={() => void saveDrawn()} onDelete={deleteDrawn} onClose={() => setTraceMenu(false)}
          onShare={() => {
            const st = { id: 0, name: selected.name, onPaths: false, line: selected.segments.flat().map((p) => [p.lon, p.lat] as [number, number]) };
            setPartage({ nom: st.name, ligne: st.line, ailleurs: () => void shareTrace(st).catch((e) => setToast(`Partage impossible : ${(e as Error).message}`)) });
          }}
          navigating={navId === selected.id} onNavigate={startNav} onStopNav={() => { setNavId(null); setTraceMenu(false); }}
          paused={navPaused} onPause={pauseNav} onResume={resumeNav}
          offline={traceOffline?.id === selected.id ? traceOffline.msg + (downloading && progress ? ` ${progress.done + progress.failed}/${progress.total}` : '') : null}
          onOffline={() => void downloadTrace(selected)}
          onGo={() => { const p = selected.segments[0][0]; openDirections(p.lat, p.lon); }}
          vtt={vtt} ways={activity !== 'ski'} wayTypes={wayTypesOn} onWayTypes={setWayTypesOn} runs={selRuns} />
      )}
      {traceList && !drawing && (
        <TraceList traces={traceList} onPick={loadTrace} onClose={() => setTraceList(null)} onFile={() => void openTraceFile()}
          onShare={(t) => setPartage({ nom: t.name, ligne: t.line, ailleurs: () => void shareTrace(t).catch((e) => setToast(`Partage impossible : ${(e as Error).message}`)) })}
          onDelete={(t) => {
            if (!window.confirm(`Effacer « ${t.name} » du téléphone ?`)) return;
            void removeTraceFile(t);
            void deleteTrace(t.id).then(listTraces).then(setTraceList);
            setTrails((prev) => prev.map((x) => (x.savedId === t.id ? { ...x, savedId: null } : x)));
            setSelected((cur) => (cur?.savedId === t.id ? { ...cur, savedId: null } : cur));
          }} />
      )}
      {!framing && !drawing && <QuickButtons geo={geo} onToast={setToast} onDraw={map ? startDrawing : undefined}
        onSearch={() => { setNature(false); setSearching(true); }}
        onBaseLayer={() => {
          // Fond de carte : Carte auto → SCAN 25 → Plan IGN → …
          const keys = Object.keys(BASE_MODES) as BaseMode[];
          const next = keys[(keys.indexOf(baseLayer) + 1) % keys.length];
          setBaseLayer(next); setToast(`Fond de carte : ${BASE_MODES[next]}`);
        }}
        baseLayer={baseLayer} onPickBaseLayer={(m) => { setBaseLayer(m); setToast(`Fond de carte : ${BASE_MODES[m]}`); }}
        slopes={showSlopes} onSlopes={setShowSlopes} shade={showShade} onShade={setShowShade}
        tilted={tilted} onTilt3d={() => map?.easeTo({ pitch: 60, duration: 900 })} onFlat={() => map?.easeTo({ pitch: 0, bearing: 0, duration: 700 })}
        forests={forests.length > 0 || forestsLoading} onForests={() => {
          // 🌲 : forêts de la zone affichée sans ouvrir le menu ; un 2e appui les efface.
          if (forests.length > 0 || forestsLoading) { clearForests(); return; }
          if (!map) return;
          const b = map.getBounds();
          void searchForests([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], true);
        }}
        weather={showWeather} onWeather={setShowWeather}
        junctionWake={junctionWake} onJunctionWake={(on) => { setJunctionWake(on); void setTraceWakeEnabled(on); }}
        traceState={navId != null || freeRec ? (navPaused ? 'pause' : 'run') : 'none'}
        offVibrate={offVibrate} onOffVibrate={(on) => { setOffVibrate(on); void setOffTrackVibrateEnabled(on); }}
        onBuddies={() => { setBuddies(true); setOpen(false); setSearching(false); }}
        nouveautes={nouveautes(buddiesEtat)}
        onSkiText={() => skiMode('sorties')}
        activity={activity} onActivity={(a) => {
          setActivity(a); closeC2c();
          setToast(a === 'vtt' ? '🚵 Mode VTT : itinéraires VTT, durée à vélo, pente en %, type de chemin des traces'
            : a === 'route' ? '🚴 Mode vélo de route : circuits VisuGPX et Geotrek, durée à vélo, pente en %'
            : a === 'gravel' ? '🚲 Mode gravel : circuits VisuGPX et Geotrek, durée à vélo, pente en %, type de chemin des traces'
            : a === 'rando' ? '🥾 Mode rando : toutes les randos de l’écran (Camptocamp, VisuGPX, Geotrek)' : '⛷ Mode ski de rando : sorties skitour');
        }}
        onTopos={() => openC2c(isBike(activity) ? 'mountain_biking' : 'hiking', isBike(activity) ? activity as Bike : undefined)} />}
      {c2c && <C2cPanel password={[IA_MOT_DE_PASSE_INTEGRE, iaPassword].filter(Boolean).join('\n')} act={c2c.act} bike={c2c.bike} bbox={c2c.bbox} center={c2c.center} onRoutes={setC2cRoutes} onLoading={setC2cLoading} onPlace={placeC2c} pick={c2cPick}
        hidden={c2cMap} onMap={() => setC2cMap(true)} onClose={closeC2c}
        onShowLine={(sh) => {
          closeC2c();
          showMine(sh.line, { onPaths: false, name: sh.title, kind: srcLabel(sh) });
          setToast(`« ${sh.title} » ajoutée à tes traces : profil, 🚗 Y aller, ▶ Commencer, 📶 Hors ligne`);
        }} />}
      {c2c && c2cMap && <div className="c2c-bar">
        <span>{ACTIVITY_ICON[activity]} {c2cRoutes.length} itinéraire{c2cRoutes.length > 1 ? 's' : ''} · touche un tracé</span>
        <button onClick={() => setC2cMap(false)}>☰ Liste</button>
        <button className="close" onClick={closeC2c} aria-label="Fermer les itinéraires">✕</button>
      </div>}
      {c2c && c2cMap && (() => {
        const fresh = !!c2cView && !isCovered(c2c.bbox, c2cView);
        return <button className={`search-here${c2cLoading ? ' loading' : ''}`} disabled={!fresh || c2cLoading} onClick={searchHere}>
          {c2cLoading ? '↻ Recherche…' : '↻ Rechercher dans cette zone'}</button>;
      })()}
      {/* Dans un mode 🚵 🚴 🚲 🥾, le même bouton directement sur la carte (Seb) : les itinéraires de l'écran, tracés dessus. */}
      {!c2c && activity !== 'ski' && !open && !travel && !lodging && !searching && !framing && map
        && <button className="search-here alone"
          onClick={() => openC2c(isBike(activity) ? 'mountain_biking' : 'hiking', isBike(activity) ? activity as Bike : undefined, true)}>
          ↻ Rechercher dans cette zone</button>}
      {skiOn && map && !framing && <SkiPanel map={map} password={[IA_MOT_DE_PASSE_INTEGRE, iaPassword].filter(Boolean).join('\n')}
        outings={skiOutings} selected={skiSel} onOutings={setSkiOutings} onSelect={setSkiSel} hidden={!!skiSheet}
        onSheet={(o) => setSkiSheet(rowOf(o))} onMode={skiMode}
        onClose={() => { setSkiOn(false); setSkiOutings([]); setSkiSel(null); }} />}
      {skiSheet && <SkiTextPanel key={skiSheet.id} password={[IA_MOT_DE_PASSE_INTEGRE, iaPassword].filter(Boolean).join('\n')} start={skiSheet}
        onShowOnMap={(_o, at) => { setSkiSheet(null); flyTo(at); }} onClose={() => setSkiSheet(null)} />}
      {skiText && <SkiTextPanel password={[IA_MOT_DE_PASSE_INTEGRE, iaPassword].filter(Boolean).join('\n')}
        onShowOnMap={(o, at) => { setSkiText(false); setTravel(false); setLodging(false); setOpen(false); setSearching(false); setSkiOutings([o]); setSkiSel(0); setSkiOn(true); flyTo(at); }} onClose={() => setSkiText(false)}
        onMode={skiMode} onTopoOnMap={showTopoOnMap} />}
      {topoText && <TopoTextPanel onShowOnMap={showTopoOnMap} password={[IA_MOT_DE_PASSE_INTEGRE, iaPassword].filter(Boolean).join('\n')} onMode={skiMode} onClose={() => setTopoText(false)} />}
      {topoMapOn && map && !framing && <TopoMapPanel map={map} password={[IA_MOT_DE_PASSE_INTEGRE, iaPassword].filter(Boolean).join('\n')}
        topos={topos} selected={topoSel} onTopos={setTopos} onSelect={setTopoSel} hidden={!!topoSheet}
        onOpen={setTopoSheet} onMode={skiMode} pinned={topoPin} onClose={() => { setTopoMapOn(false); setTopos([]); setTopoSel(null); }} />}
      {topoSheet && <TopoTextPanel key={topoSheet.id} onShowOnMap={(t) => { setTopoSheet(null); showTopoOnMap(t); }} password={[IA_MOT_DE_PASSE_INTEGRE, iaPassword].filter(Boolean).join('\n')} start={topoSheet}
        onMode={(m) => { if (m === 'carteTopos') setTopoSheet(null); else skiMode(m); }} onClose={() => setTopoSheet(null)} />}
      {lodging && <LodgingPanel password={[IA_MOT_DE_PASSE_INTEGRE, iaPassword].filter(Boolean).join('\n')} onClose={() => setLodging(false)}
        onProposer={proposerHebergementTrouve}
        onShowOnMap={(p) => { setLodging(false); setLodgingPins(p); }} />}
      {lodgingPins.length > 0 && !lodging && <LodgingsOnMap map={map} items={lodgingPins} onProposer={proposerHebergementTrouve} onList={() => setLodging(true)} onClose={() => setLodgingPins([])} />}
      {buddies && <Buddies key={JSON.stringify(buddiesDepart ?? '')} onToast={setToast} onClose={() => { setBuddies(false); setBuddiesDepart(undefined); }} onAccount={() => setAccount(true)}
        onExpenses={() => setExpenses(true)} onLodging={() => { setBuddies(false); setLodging(true); }} depart={buddiesDepart}
        onTravel={() => { setBuddies(false); setLodging(false); setTravel(true); setOpen(false); setSearching(false); }}
        onCarte={montrerBuddies} />}
      {pointBuddy && !buddies && <PointSurCarte map={map} p={pointBuddy} />}
      {carteSortie && !buddies && !drawing && <BandeauSortie key={`${carteSortie.sortie.id}${carteSortie.parler}`} x={carteSortie.sortie} traces={carteSortie.traces} parler={carteSortie.parler}
        onRetour={() => { setBuddiesDepart(carteSortie.sortie.groupe); setCarteSortie(null); setBuddies(true); }}
        onAlbum={() => { setBuddiesDepart({ ecran: 'album', sortie: carteSortie.sortie.id, groupe: carteSortie.sortie.groupe }); setCarteSortie(null); setBuddies(true); }}
        onCarnet={() => { setBuddiesDepart({ ecran: 'carnet', sortie: carteSortie.sortie.id, groupe: carteSortie.sortie.groupe }); setCarteSortie(null); setBuddies(true); }}
        onCount={() => { setBuddiesDepart({ ecran: 'count', sortie: carteSortie.sortie.id, groupe: carteSortie.sortie.groupe }); setCarteSortie(null); setBuddies(true); }}
        onDodo={() => { setBuddiesDepart({ ecran: 'dodo', sortie: carteSortie.sortie.id, groupe: carteSortie.sortie.groupe }); setCarteSortie(null); setBuddies(true); }}
        onToast={setToast} map={map} />}
      {partage && <PartagePanel nom={partage.nom} ligne={partage.ligne} hebergement={partage.hebergement} onAilleurs={partage.ailleurs} onFermer={() => setPartage(null)} onToast={setToast} />}
      {account && <Account onToast={setToast} onClose={() => setAccount(false)} />}
      {expenses && <Expenses password={[IA_MOT_DE_PASSE_INTEGRE, iaPassword].filter(Boolean).join('\n')} onToast={setToast} onClose={() => setExpenses(false)} />}
      {travel && <TravelPanel password={[IA_MOT_DE_PASSE_INTEGRE, iaPassword].filter(Boolean).join('\n')}
        here={position ? { label: 'Ma position', lon: position.lon, lat: position.lat } : null}
        routes={travelRoutes} selected={travelSel}
        onRoutes={(r, i) => { setTravelRoutes(r); setTravelSel(i); }}
        onClose={() => { setTravel(false); setTravelRoutes([]); }} />}
      <DoigtsSurCarte map={map} onToast={setToast} />
      <BarreAppel />
      <EcranSonnerie onToast={setToast} />
      {toast && <div className="toast">{toast}</div>}
      {showShade && map && <ShadeFilm map={map} hidden={framing || drawing} onClose={() => setShowShade(false)} />}
      {showWeather && map && <WeatherLayer map={map} hidden={framing || drawing} below={showShade} onToast={setToast} onClose={() => setShowWeather(false)} />}

      {framing && map && <FrameOverlay map={map} label={undefined}
        onDone={(b) => {
          if (framingFor === 'randos') { void searchTrails(b); return; }
          if (framingFor === 'forets') { void searchForests(b); return; }
          setFraming(false); setTab('horsligne'); setOpen(true);
          void downloadZone(b);
        }}
        onCancel={() => { setFraming(false); setOpen(true); }} />}

      {searching ? (
        <SearchBar near={map ? { lon: map.getCenter().lng, lat: map.getCenter().lat } : undefined} onClose={() => setSearching(false)} onPick={(p) => {
          setSearching(false);
          setFollow(false);
          // Quitter le suivi de ◎ : MapLibre ne le lâche pas sur un flyTo qui zoome (isZooming), et le GPS
          // ramenait la carte sur moi. Un jumpTo sans zoom le passe en arrière-plan ; ◎ recentre ensuite.
          map?.jumpTo({ center: map.getCenter() });
          map?.flyTo({ center: [p.lon, p.lat], zoom: p.zoom, duration: 1500 });
          setTarget({ lon: p.lon, lat: p.lat, label: p.label });
        }} />
      ) : null}

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
          <button className="close" onClick={() => { setNature(true); setSearching(false); }} aria-label="Masquer l'interface (mode nature)">✕</button>
          <button className={`icon ${tab === 'usage' ? 'active' : ''}`} onClick={() => { setTab('usage'); setOpen(true); }}
            aria-label="Usage IA et mémoire" title="Usage IA et mémoire">📊</button>
          {(['sortie', 'randos', 'forets', 'horsligne', 'mesures', 'versions'] as Exclude<Tab, 'usage'>[]).map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => { setTab(t); setOpen(true); void refreshStored(); }}>
              {{ sortie: 'Sortie', randos: 'Randos', forets: 'Forêts', horsligne: 'Hors ligne', mesures: 'Mesures', versions: 'Versions' }[t]}
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
            <BatteryShortcuts />
            <div className="row">
              <button onClick={exportGpx} disabled={!recorded.length}>Exporter GPX</button>
              <label className="file">Importer GPX<input type="file" accept=".gpx,application/gpx+xml" onChange={(e) => e.target.files?.[0] && importGpx(e.target.files[0])} /></label>
              {imported.length > 0 && <button onClick={() => setImported([])}>Effacer l'import</button>}
            </div>
          </div>
        )}

        {open && tab === 'randos' && (
          <div className="pane">
            <p className="hint">Encadre une zone : les randos balisées d'OpenStreetMap s'affichent en tracés ({OSM_ATTRIBUTION}), et celles trouvées sur le web en points orange, avec le lien de leur page.</p>
            <div className="row">
              <button className="primary" disabled={!map} onClick={() => { setFramingFor('randos'); setFraming(true); setOpen(false); }}>Encadrer une zone</button>
              <button disabled={!map} onClick={startDrawing}>✏ Tracer au doigt</button>
              <button onClick={() => void openTraceList()}>📂 Mes traces</button>
              <button onClick={() => void openTraceFile()}>📥 Ouvrir un fichier</button>
              <button disabled={!map} onClick={() => {
                const b = map!.getBounds();
                void searchTrails([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
              }}>Zone affichée</button>
            </div>
            {trailsMsg && <p className="hint">{trailsMsg}</p>}
            {webMsg && <p className="hint">{webMsg}</p>}
            {hikeSel != null && webHikes[hikeSel] && (() => { const h = webHikes[hikeSel]; return (
              <div className="trail-card hike-card">
                <b>{h.nom}</b>
                <span className="hint">{hikeDetail(h)}</span>
                {h.resume && <span>{h.resume}</span>}
                <div className="row">
                  <button className="primary" onClick={() => openLink(h.url)}>Ouvrir la page</button>
                  <button onClick={() => setTarget({ lon: h.lon, lat: h.lat, label: `Départ de « ${h.nom} »` })}>Y aller</button>
                  <button onClick={() => setHikeSel(null)}>Fermer</button>
                </div>
              </div>); })()}
            {selected && (
              <div className="trail-card">
                <b>{selected.name}</b>
                <span className="hint">{selected.kind}{selected.id > 0 && <> · <a href={`https://www.openstreetmap.org/relation/${selected.id}`} target="_blank" rel="noreferrer">fiche OSM</a></>}
                  {selected.segments.length > 1 && ` · ${selected.segments.length} morceaux`}</span>
                <div className="stats">
                  <div><b>{formatKm(selected.distanceM)}</b><span>distance</span></div>
                  <div><b>{typeof elevated === 'object' && elevated ? `${Math.round(elevated.gainM)} m` : elevated === 'loading' ? '…' : '—'}</b><span>D+</span></div>
                  <div><b>{typeof elevated === 'object' && elevated ? `${Math.round(elevated.lossM)} m` : elevated === 'loading' ? '…' : '—'}</b><span>D−</span></div>
                  <div><b>{typeof elevated === 'object' && elevated ? formatHours(vtt ? bikeHours(selected.distanceM, elevated.gainM) : walkingHours(selected.distanceM, elevated.gainM, elevated.lossM)) : elevated === 'loading' ? '…' : '—'}</b><span>{vtt ? 'à vélo' : 'marche'}</span></div>
                </div>
                {typeof elevated === 'object' && elevated && <Profile segments={elevated.segments} cursor={profCursor} onCursor={setProfCursor} pctFirst={vtt}
                  runs={Array.isArray(selRuns) ? selRuns : null} />}
                {wantWays && (selRuns === 'loading' ? <p className="hint">Recherche des types de chemin…</p>
                  : Array.isArray(selRuns) && <WayLegend runs={selRuns} />)}
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
            {webHikes.length > 0 && (
              <ul className="trail-list">
                {webHikes.map((h, i) => (
                  <li key={h.url + i}>
                    <button className={hikeSel === i ? 'active' : ''} onClick={() => selectHike(i)}>
                      <i style={{ background: '#f28c28' }} />
                      <span><b>{h.nom}</b><small>{hikeDetail(h)}</small></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {(trails.length > 0 || webHikes.length > 0) && <button onClick={() => {
              webAbort.current?.abort();
              setTrails([]); setFrame(null); void selectTrail(null); setTrailsMsg(''); setWebHikes([]); setHikeSel(null); setWebMsg('');
            }}>Effacer les randos de la carte</button>}
            {<label className="field">{IA_MOT_DE_PASSE_INTEGRE ? 'Mot de passe de recherche de secours (vide : celui intégré à l’appli)' : 'Mot de passe de recherche (randos sur le web, prix, hébergements)'}
              <input type="password" value={iaPassword} onChange={(e) => void saveIaPassword(e.target.value)} autoCapitalize="off" autoCorrect="off" />
            </label>}
          </div>
        )}

        {open && tab === 'forets' && (
          <div className="pane">
            <p className="hint">Forêts par essence (hêtraies, pinèdes, chênaies…) de la carte forestière IGN. Touche une forêt sur la carte pour son détail. {BDFORET_ATTRIBUTION}.</p>
            <div className="row">
              <button className="primary" disabled={!map} onClick={() => {
                const b = map!.getBounds();
                void searchForests([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
              }}>Zone affichée</button>
              <button disabled={!map} onClick={() => { setFramingFor('forets'); setFraming(true); setOpen(false); }}>Encadrer une zone</button>
            </div>
            {forestsMsg && <p className="hint">{forestsMsg}</p>}
            {forests.length > 0 && (
              <ul className="trail-list">
                {groupByEssence(forests).map((g) => (
                  <li key={g.essence}>
                    <button className={forestFilter.has(g.essence) ? 'active' : ''} onClick={() => toggleEssence(g.essence)}>
                      <i style={{ background: g.color }} />
                      <span><b>{forestFilter.has(g.essence) ? '✓ ' : ''}{g.essence}</b><small>{formatHa(g.areaHa)} · {g.count} massif{g.count > 1 ? 's' : ''}</small></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {forests.length > 0 && (
              <div className="row">
                {forestFilter.size > 0 && <button onClick={() => setForestFilter(new Set())}>Toutes les essences</button>}
                <button onClick={clearForests}>Effacer les forêts</button>
              </div>
            )}
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
            <p className="hint">« Tracer un rectangle » : trace du doigt le coin de la rando sur la carte, ses tuiles se téléchargent. Fond affiché ({BASE_MODES[baseLayer]}) : {offlinePlan(baseLayer, OFFLINE_MIN_ZOOM, OFFLINE_MAX_ZOOM)
              .map((p) => `${LAYERS[p.layer].label} z${p.minZoom}-${p.maxZoom}`).join(' + ')}.
              En stock : {stored.scan25} tuiles SCAN 25 ({formatMo(stored.scan25Bytes)}), {stored.planign} tuiles Plan IGN ({formatMo(stored.planignBytes)}), {stored.mnt} tuiles de relief pour les ombres ({formatMo(stored.mntBytes)}).</p>
            <p className="hint"><b>Place prise sur le téléphone : {formatMo(stored.scan25Bytes + stored.planignBytes + stored.mntBytes)}</b>. Les tuiles sont gardées quand l'appli se met à jour ; seule la désinstallation les efface.</p>
            <div className="row">
              <button className="primary" disabled={!map} onClick={() => { setFramingFor('horsligne'); setFraming(true); setOpen(false); }}>Tracer un rectangle</button>
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

        {open && tab === 'versions' && <div className="pane"><Versions /></div>}
        {open && tab === 'usage' && <div className="pane"><Usage /></div>}

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

/** 2,6 h → « 2h35 ». */
function formatHours(h: number) {
  const min = Math.round(h * 60);
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}
