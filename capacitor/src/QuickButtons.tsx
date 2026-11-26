import { ACTIVITY_ICON, type Activity } from './activity';
import { BASE_MODES, type BaseMode } from './config';
import { useEffect, useRef, useState } from 'react';
import type { GeolocateControl } from 'maplibre-gl';
import { App as CapApp } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { DRONE_HELP, DRONE_LEGEND, ICON_HELP, SLOPE_LEGEND, SLOPE_TAGS_HELP, type IconKey } from './iconHelp';
import { iconesAGauche } from './doigt';

/** Plugins natifs (android/.../PocketMode.java et BatterySettings.java, identiques côté Kotlin). */
const PocketMode = registerPlugin<{
  get(): Promise<{ on: boolean }>; set(o: { on: boolean }): Promise<{ on: boolean }>;
  addListener(e: 'pocket', f: (r: { black: boolean }) => void): Promise<{ remove: () => Promise<void> }>;
}>('PocketMode');
/** Plugin natif (android/.../PhotoCapture.java, identique côté Kotlin) : ouvre l'application Appareil photo. */
import { noterPrise, Photo } from './buddies/photoPrise';
/** Plugin natif (shared/Weather.java) : ouvre l'appli Météo-France, ou sa page Météo montagne. */
const Weather = registerPlugin<{ open(o: { mountain: boolean }): Promise<void> }>('Weather');
const BatterySettings = registerPlugin<{ open(o: { what: string }): Promise<void>; airplane(): Promise<{ on: boolean }> }>('BatterySettings');

type WatchState = 'OFF' | 'ACTIVE_LOCK' | 'WAITING_ACTIVE' | 'ACTIVE_ERROR' | 'BACKGROUND' | 'BACKGROUND_ERROR';

/**
 * Boutons toujours visibles sur la carte, même en mode nature : me localiser, mode avion, mode poche.
 * Android interdit à une appli de basculer le mode avion : le bouton montre son état et ouvre le réglage.
 */
export interface QuickProps {
  geo: GeolocateControl | null;
  onToast: (msg: string) => void;
  onDraw?: () => void;
  onSearch: () => void;
  /** 🗺 : appui = fond suivant ; appui long = choisir le fond. */
  onBaseLayer: () => void;
  baseLayer: BaseMode; onPickBaseLayer: (m: BaseMode) => void;
  slopes: boolean; onSlopes: (on: boolean) => void;
  shade: boolean; onShade: (on: boolean) => void;
  /** Vue 3D : 🗻 (variante de ⛰) incline la carte ; 🧭 sous la flèche, tant qu'elle est inclinée ou tournée, la remet à plat. */
  tilted: boolean; onTilt3d: () => void; onFlat: () => void;
  /** 🌲 à gauche de 🌗 : forêts par essence de la zone affichée ; allumé quand elles sont sur la carte. */
  forests: boolean; onForests: () => void;
  /** Drone à gauche de 🌲 : zones interdites ou limitées aux drones de loisir (carte DGAC). */
  drones: boolean; onDrones: (on: boolean) => void;
  /** Calque « Hors ligne » : zones gardées sur le téléphone et toutes les traces (Seb, 26/11). */
  offline: boolean; onOffline: (on: boolean) => void;
  /** 👥 Buddies (spec/buddies.md §5.1) ; pastille = nombre de groupes qui ont bougé. */
  onBuddies: () => void;
  /** Sortie ouverte sur la carte : pas de ✕ « Quitter l'appli », le ‹ de son bandeau suffit (Seb, 26/11). */
  /** ✕ revient à l'écran d'avant (sortie ouverte sur la carte) au lieu de quitter l'appli (Seb, 26/11). */
  onFermer?: () => void;
  nouveautes: number;
  /** ⛷ 💬 : question en texte sur les sorties skitour. */
  onSkiText: () => void;
  /** ⛷ 🚵 🚴 🚲 🥾 : appui long = choisir l'activité ; toucher ouvre les sorties ou les itinéraires de l'écran. */
  activity: Activity; onActivity: (a: Activity) => void; onTopos: () => void;
  /** Météo posée sur la carte (icône 🌦, avec 🏔 météo montagne à sa gauche) ; appui long : ouvre l'appli Météo-France. */
  weather: boolean; onWeather: (on: boolean) => void;
  /** ⑂ Écran rallumé avant les carrefours pendant le suivi d'une trace (à gauche de 👖). */
  junctionWake: boolean; onJunctionWake: (on: boolean) => void;
  /** Vibration quand on quitte la trace suivie (à gauche de ⑂). */
  offVibrate: boolean; onOffVibrate: (on: boolean) => void;
  /** Trace commencée : pastille sur ✏ (maquette B), verte ▶ en cours, orange ⏸ en pause. */
  traceState: 'none' | 'run' | 'pause';
}

const ACTIVITY_LABEL: Record<Activity, string> = { ski: 'Sorties ski', vtt: 'Itinéraires VTT', route: 'Circuits vélo de route', gravel: 'Circuits gravel', rando: 'Randos' };

/** Icône « double tap pour allumer l'écran » (maquette B) : un doigt qui tape, deux ondes, « ×2 » en rouge. Même dessin côté Kotlin : ic_double_tap.xml. */
export const DoubleTapIcon = ({ size = 34 }: { size?: number }) => (
  <svg viewBox="0 0 56 56" width={size} height={size} aria-hidden="true">
    <circle cx="24" cy="15" r="5" fill="none" stroke="#1d6fe0" strokeWidth="2.4" />
    <circle cx="24" cy="15" r="10" fill="none" stroke="#1d6fe0" strokeWidth="2" />
    <path d="M20 52V26a4 4 0 0 1 8 0V37l9 2a4 4 0 0 1 3 5l-3 8" fill="#ffd2a8" stroke="#8a5a2b" strokeWidth="2" strokeLinejoin="round" />
    <path d="M38 6l5 5M43 6l-5 5M46 7.5a2.6 2.6 0 0 1 5 1c0 1.5-1 2.5-5 6.5h5.5" stroke="#e53935" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);

/** Icône ⑂ « écran aux carrefours » (maquette A choisie par Seb) : téléphone allumé avec une fourche, rayons. Même dessin côté Kotlin : ic_carrefour.xml. */
export const JunctionWakeIcon = ({ size = 34 }: { size?: number }) => (
  <svg viewBox="0 0 56 56" width={size} height={size} aria-hidden="true">
    <rect x="14" y="4" width="28" height="48" rx="5" fill="#263238" />
    <rect x="17" y="9" width="22" height="37" rx="2" fill="#ffe27a" />
    <path d="M28 43V30M28 30L21 17M28 30L35 17" stroke="#7b3fe4" strokeWidth="3.2" strokeLinecap="round" fill="none" />
    <g stroke="#f5a400" strokeWidth="2.6" strokeLinecap="round">
      <path d="M6 14l4 3M4 28h5M6 42l4-3M50 14l-4 3M52 28h-5M50 42l-4-3" />
    </g>
  </svg>
);

/** Icône « vibration hors trace » (maquette C) : téléphone penché qui vibre, la trace et moi (point rouge) en dehors. Même dessin côté Kotlin : ic_vibre_hors_trace.xml. */
export const OffTrackVibrateIcon = ({ size = 34 }: { size?: number }) => (
  <svg viewBox="0 0 56 56" width={size} height={size} aria-hidden="true">
    <g transform="rotate(-12 28 28)">
      <rect x="16" y="8" width="24" height="40" rx="5" fill="#263238" />
      <rect x="19" y="13" width="18" height="29" rx="2" fill="#e3f2fd" />
      <path d="M24 34V26M24 26L20 19" stroke="#7b3fe4" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <circle cx="34" cy="22" r="3.2" fill="#e53935" />
    </g>
    <g stroke="#e53935" strokeWidth="2.6" strokeLinecap="round" fill="none">
      <path d="M8 20a14 14 0 0 0 0 16M4 16a20 20 0 0 0 0 24M48 20a14 14 0 0 1 0 16M52 16a20 20 0 0 1 0 24" />
    </g>
  </svg>
);

/** Icône drone au trait, vu de face : hélices, bras, corps, caméra et pieds (maquette « Drone B », Seb 26/11). */
const DroneIcon = () => (
  <svg viewBox="0 0 48 48" width="30" height="30" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 14h14M30 14h14M11 14v4M37 14v4M11 18h26" />
    <rect x="18" y="16" width="12" height="7" rx="2.5" />
    <path d="M19 23l-4 8M29 23l4 8M12 31h6M30 31h6" />
    <circle cx="24" cy="27.5" r="2.4" />
  </svg>
);

/** Icône du calque « Hors ligne » : carrés gardés et une trace, comme sur la carte (maquette « B », Seb 26/11). */
const OfflineLayerIcon = () => (
  <svg viewBox="0 0 48 48" width="30" height="30" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="6" width="36" height="36" rx="3" />
    <path d="M18 6v36M30 6v36M6 18h36M6 30h36" strokeWidth="1.4" />
    <path d="M8 40c6-2 6-10 12-12s10 2 14-6 4-10 6-14" strokeWidth="3.2" />
  </svg>
);

/** Icône « Calques » : trois strates empilées (maquette « Calques A », Seb 26/11). Ouvre la ligne des calques. */
const LayersIcon = () => (
  <svg viewBox="0 0 48 48" width="30" height="30" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M24 7 42 16 24 25 6 16Z" /><path d="M6 24l18 9 18-9" /><path d="M6 32l18 9 18-9" />
  </svg>
);

/** Icône vue 3D : un sommet au trait et « 3D » écrit dessous (maquette « 3D A », Seb 26/11). */
const View3dIcon = () => (
  <svg viewBox="0 0 48 48" width="30" height="30" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 28 17 10l6 8 4-5 13 15" />
    <text x="24" y="45" fontSize="16" fontWeight="800" fill="currentColor" stroke="none" textAnchor="middle" fontFamily="Roboto, Arial, sans-serif">3D</text>
  </svg>
);

/** Icône pentes : triangle plein et « pente » écrit dessous (maquette « Pente B », Seb 26/11). */
const SlopeIcon = () => (
  <svg viewBox="0 0 48 48" width="30" height="30" aria-hidden="true">
    <path d="M24 4 38 27H10Z" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    <text x="24" y="44" fontSize="15" fontWeight="800" fill="currentColor" textAnchor="middle" fontFamily="Roboto, Arial, sans-serif">pente</text>
  </svg>
);

/** Icône « me localiser » : cercle traversé d'une croix horizontale et verticale, point au centre (même dessin côté Kotlin : ic_locate.xml). */
const LocateIcon = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="7" />
    <path d="M12 1.5v6M12 16.5v6M1.5 12h6M16.5 12h6" />
    <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
  </svg>
);

const WIDE_KEY = 'iconesEtendu';
const ACTIVITIES = Object.keys(ACTIVITY_ICON) as Activity[];
const LAYER_SHORT: Record<BaseMode, string> = { auto: 'Auto', scan25: 'SCAN 25', planign: 'Plan IGN' };

export function QuickButtons({ onFermer, geo, onToast, onDraw, onSearch, onBaseLayer, baseLayer, onPickBaseLayer, slopes, onSlopes, shade, onShade, tilted, onTilt3d, onFlat, forests, onForests, drones, onDrones, offline, onOffline, onBuddies, nouveautes, onSkiText, activity, onActivity, onTopos, weather, onWeather, junctionWake, onJunctionWake, offVibrate, onOffVibrate, traceState }: QuickProps) {
  // Flèche : barre réduite (✕, flèche, ◎, 📷) ou étendue, tout sur une colonne (demande de Seb, 24/11). Choix gardé.
  const [wide, setWideState] = useState(() => { try { return localStorage.getItem(WIDE_KEY) === '1'; } catch { return false; } });
  const toggleWide = () => {
    setWideState(!wide);
    try { localStorage.setItem(WIDE_KEY, wide ? '0' : '1'); } catch { /* ignoré */ }
  };
  const native = Capacitor.isNativePlatform();
  const [watch, setWatch] = useState<WatchState>('OFF');
  const [airplane, setAirplane] = useState(false);
  const [pocket, setPocket] = useState(false);
  // Duos : ✈ seul d'habitude, un appui le « déplie » et 👖 apparaît à sa gauche ; de même Calques puis la ligne des calques, 🌦 puis 🏔.
  // Ensuite chaque icône bascule son mode ; toucher ailleurs replie. La colonne ne bouge pas (alignée à droite).
  const [pairOpen, setPairOpen] = useState<'avion' | 'relief' | 'meteo' | null>(null);
  const pair = pairOpen === 'avion', relief = pairOpen === 'relief', meteo = pairOpen === 'meteo';
  // ⚙ réglages du suivi (à gauche de 👖) : un appui déplie ⑂, la vibration hors trace et le double tap ; replié avec le duo.
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => { if (!pair) setSettingsOpen(false); }, [pair]);
  // Bulle du double tap : l'appli ne peut pas activer ce réglage, elle explique et ouvre les réglages du téléphone.
  const [dtBubble, setDtBubble] = useState(false);
  const pairRef = useRef<HTMLDivElement>(null);
  const reliefRef = useRef<HTMLDivElement>(null);
  const meteoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pairOpen) return;
    const ref = pairOpen === 'avion' ? pairRef : pairOpen === 'relief' ? reliefRef : meteoRef;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setPairOpen(null); };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [pairOpen]);

  useEffect(() => {
    if (!geo) return;
    const read = () => setWatch(((geo as unknown as { _watchState?: WatchState })._watchState) ?? 'OFF');
    const evts = ['geolocate', 'error', 'trackuserlocationstart', 'trackuserlocationend'] as const;
    evts.forEach((e) => geo.on(e, read));
    read();
    return () => evts.forEach((e) => geo.off(e, read));
  }, [geo]);

  // Centrage gardé (demande de Seb) : après ◎, la carte reste centrée sur moi tant que je ne touche à rien,
  // même après extinction et rallumage de l'écran. Un toucher (carte ou bouton) dans la seconde et demie qui
  // précède la perte du centrage = choix de l'utilisateur ; sinon (écran éteint, GPS perdu, appli en arrière-plan)
  // on recentre tout seul.
  const pocketPaused = useRef(false);
  const wantCenter = useRef(false);
  const lastTouch = useRef(0);
  /** Recentrages automatiques ratés d'affilée (GPS refusé…) : on abandonne à 3 au lieu de boucler. */
  const retries = useRef(0);
  useEffect(() => {
    if (!geo) return;
    const state = () => (geo as unknown as { _watchState?: WatchState })._watchState ?? 'OFF';
    const touch = () => { lastTouch.current = Date.now(); };
    document.addEventListener('pointerdown', touch, true);
    const recenter = () => {
      if (!wantCenter.current || pocketPaused.current || document.hidden || retries.current >= 3) return;
      const st = state();
      if (st === 'OFF' || st === 'BACKGROUND' || st === 'BACKGROUND_ERROR') { retries.current++; void geo.trigger(); }
    };
    const onState = () => {
      const st = state();
      if (st === 'ACTIVE_LOCK' || st === 'WAITING_ACTIVE') { wantCenter.current = true; if (st === 'ACTIVE_LOCK') retries.current = 0; return; }
      if (st === 'ACTIVE_ERROR') return; // GPS perdu un moment : MapLibre recentre seul au retour
      if (Date.now() - lastTouch.current < 1500) wantCenter.current = false;
      else setTimeout(recenter, 300);
    };
    const evts = ['geolocate', 'error', 'trackuserlocationstart', 'trackuserlocationend'] as const;
    evts.forEach((e) => geo.on(e, onState));
    const visible = () => { if (!document.hidden) setTimeout(recenter, 500); };
    document.addEventListener('visibilitychange', visible);
    const sub = CapApp.addListener('resume', () => setTimeout(recenter, 500));
    return () => {
      document.removeEventListener('pointerdown', touch, true);
      document.removeEventListener('visibilitychange', visible);
      evts.forEach((e) => geo.off(e, onState));
      void sub.then((x) => x.remove());
    };
  }, [geo]);

  // Écran noir dans la poche : on coupe le GPS du bouton ◎ (gros consommateur) et on le relance au réveil.
  // L'enregistrement d'une sortie, lui, continue (sinon la trace aurait des trous).
  useEffect(() => {
    if (!native || !geo) return;
    const state = () => (geo as unknown as { _watchState?: WatchState })._watchState ?? 'OFF';
    const sub = PocketMode.addListener('pocket', ({ black }) => {
      if (black && state() !== 'OFF') {
        pocketPaused.current = true;
        for (let i = 0; i < 2 && state() !== 'OFF'; i++) void geo.trigger();
      } else if (!black && pocketPaused.current) {
        pocketPaused.current = false;
        if (state() === 'OFF') void geo.trigger();
      }
    });
    return () => { void sub.then((s) => s.remove()); };
  }, [native, geo]);

  useEffect(() => {
    if (!native) return;
    const refresh = () => {
      BatterySettings.airplane().then((r) => setAirplane(r.on)).catch(() => {});
      PocketMode.get().then((r) => setPocket(r.on)).catch(() => {});
    };
    refresh();
    const sub = CapApp.addListener('resume', refresh);
    return () => { void sub.then((s) => s.remove()); };
  }, [native]);

  const locating = watch !== 'OFF';
  const openWeather = (mountain: boolean) => {
    if (native) Weather.open({ mountain }).catch((e) => onToast(String((e as Error).message ?? e)));
    else window.open(mountain ? 'https://meteofrance.com/meteo-montagne' : 'https://meteofrance.com/', '_blank');
  };
  // Appui long sur la flèche : aide (une étiquette à gauche de chaque icône) ; toucher n'importe où la ferme.
  const [help, setHelp] = useState(false);
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | null; long: boolean }>({ timer: null, long: false });
  const all = help || wide;
  const wx = useRef<{ timer: ReturnType<typeof setTimeout> | null; long: boolean }>({ timer: null, long: false });
  // Appui long sur une icône : bulle d'aide à sa gauche (pour ⛰, la légende des couleurs en degrés) ; toucher ailleurs la ferme.
  const [tip, setTip] = useState<{ key: IconKey; top: number; right?: number; left?: number; maxWidth: number } | null>(null);
  const tipPress = useRef<{ timer: ReturnType<typeof setTimeout> | null; long: boolean }>({ timer: null, long: false });
  const lp = (key: IconKey) => {
    const stop = () => { if (tipPress.current.timer) { clearTimeout(tipPress.current.timer); tipPress.current.timer = null; } };
    return {
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        stop(); tipPress.current.long = false;
        const el = e.currentTarget;
        tipPress.current.timer = setTimeout(() => {
          tipPress.current.long = true;
          const r = el.getBoundingClientRect();
          const side = iconesAGauche() ? window.innerWidth - r.right - 16 : r.left - 16;
          // Trop peu de place à côté (icône d'une rangée dépliée) : la bulle passe sous l'icône, sur toute la largeur.
          if (side < 200) { setTip({ key, top: Math.min(r.bottom + 8, window.innerHeight - 260), left: 8, maxWidth: window.innerWidth - 16 }); return; }
          setTip({ key, top: Math.max(8, Math.min(r.top, window.innerHeight - 260)), ...(iconesAGauche()
            ? { left: r.right + 8, maxWidth: side }
            : { right: window.innerWidth - r.left + 8, maxWidth: side }) });
        }, 550);
      },
      onPointerUp: stop, onPointerLeave: stop, onPointerCancel: stop,
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
      // Après un appui long, l'appui ne déclenche pas l'icône.
      onClickCapture: (e: React.MouseEvent) => { if (tipPress.current.long) { tipPress.current.long = false; e.stopPropagation(); e.preventDefault(); } },
    };
  };
  // Règle générale (Seb, 24/11) : appui long sur un bouton qui a des variantes = elles s'ouvrent à sa gauche,
  // on en touche une (une seule à la fois) ; toucher ailleurs ferme.
  const [pick, setPick] = useState<{ kind: 'activity' | 'layer'; top: number; right?: number; left?: number } | null>(null);
  const lpPick = (kind: 'activity' | 'layer') => ({
    ...lp(kind === 'activity' ? 'skiText' : 'layer'),
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (tipPress.current.timer) clearTimeout(tipPress.current.timer);
      tipPress.current.long = false;
      const el = e.currentTarget;
      tipPress.current.timer = setTimeout(() => {
        tipPress.current.long = true;
        const r = el.getBoundingClientRect();
        setPairOpen(null);
        setPick({ kind, top: r.top + r.height / 2, ...(iconesAGauche() ? { left: r.right + 6 } : { right: window.innerWidth - r.left + 6 }) });
      }, 550);
    },
  });
  return (
    <>
    {tip && <div className="tip-close" onPointerDown={() => setTip(null)} onContextMenu={(e) => e.preventDefault()}>
      <div className="icon-tip" style={{ top: tip.top, right: tip.right, left: tip.left, maxWidth: tip.maxWidth }}>
        <b>{ICON_HELP[tip.key].title}</b>
        <p>{ICON_HELP[tip.key].text}</p>
        {tip.key === 'slopes' && <>
          <ul className="slope-legend">
            {SLOPE_LEGEND.map((l) => <li key={l.label}><span style={{ background: l.color }} />{l.label}</li>)}
          </ul>
          <p>{SLOPE_TAGS_HELP}</p>
        </>}
        {tip.key === 'drones' && <>
          <ul className="slope-legend">
            {DRONE_LEGEND.map((l) => <li key={l.label}><span style={{ background: l.color }} />{l.label}</li>)}
          </ul>
          <p>{DRONE_HELP}</p>
        </>}
      </div>
    </div>}
    {pick && <div className="tip-close" onPointerDown={(e) => { if (e.target === e.currentTarget) setPick(null); }} onContextMenu={(e) => e.preventDefault()}>
      <div className="variants" style={{ top: pick.top, right: pick.right, left: pick.left }}>
        {pick.kind === 'activity'
          ? ACTIVITIES.map((a) => <button key={a} className={a === activity ? 'sel' : ''} aria-label={ACTIVITY_LABEL[a]}
              onClick={() => { setPick(null); if (a !== activity) onActivity(a); }}>{ACTIVITY_ICON[a]}</button>)
          : (Object.keys(BASE_MODES) as BaseMode[]).map((m) => <button key={m} className={`txt ${m === baseLayer ? 'sel' : ''}`} aria-label={BASE_MODES[m]}
              onClick={() => { setPick(null); if (m !== baseLayer) onPickBaseLayer(m); }}>{LAYER_SHORT[m]}</button>)}
      </div>
    </div>}
    {dtBubble && <div className="tip-close" onPointerDown={(e) => { if (e.target === e.currentTarget) setDtBubble(false); }} onContextMenu={(e) => e.preventDefault()}>
      <div className="icon-tip dt-bubble">
        <b>Double tap pour allumer l'écran</b>
        <p>Dans la page qui s'ouvre, active « Appuyer deux fois pour allumer l'écran ». Sur Samsung : Fonctions avancées › Mouvements et gestes. Ensuite deux petits coups sur l'écran éteint le rallument, pratique avec des gants ou sur le vélo.</p>
        <button className="dt-open" onClick={() => {
          setDtBubble(false);
          if (native) void BatterySettings.open({ what: 'doubletap' }); else onToast('Réglages : seulement dans l’appli');
        }}>Ouvrir les réglages</button>
      </div>
    </div>}
    {help && <div className="help-close" onClick={() => setHelp(false)}><p className="help-haut">Touche n'importe où pour fermer l'aide</p></div>}
    <div className={help ? 'quick help' : 'quick'} onContextMenu={(e) => e.preventDefault()}>
      <button className="toggle" aria-label={onFermer ? 'Fermer' : "Quitter l'appli"} data-help={onFermer ? 'Revenir à l’écran d’avant' : "Quitter l'appli"} {...lp('close')}
        onClick={() => { if (onFermer) onFermer(); else if (native) void CapApp.exitApp(); else onToast('Quitter : seulement dans l’appli'); }}>✕</button>
      <button className="toggle arrow" aria-label={wide ? 'Moins d’icônes' : 'Toutes les icônes'} data-help={help ? "Plus ou moins d'icônes" : "Appui : plus ou moins d'icônes · appui long : aide"}
        onPointerDown={() => { press.current.long = false; press.current.timer = setTimeout(() => { press.current.long = true; setHelp(true); }, 550); }}
        onPointerUp={() => { if (press.current.timer) clearTimeout(press.current.timer); }}
        onPointerLeave={() => { if (press.current.timer) clearTimeout(press.current.timer); }}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => { if (press.current.long) { press.current.long = false; return; } if (help) { setHelp(false); return; } toggleWide(); }}>{wide ? '◂' : '▸'}</button>
      {/* Rangée : seuls ✕ et la flèche ; la flèche fait glisser toutes les autres icônes d'un bloc (Seb, 26/11). */}
      <div className={`quick-reste${all ? ' ouverte' : ''}`} inert={!all}>
      {(tilted || help) && <button aria-label="Remettre la carte à plat, nord en haut" data-help="À plat, nord en haut" {...lp('compass')} onClick={onFlat}>🧭</button>}
      <button className={locating ? 'on' : ''} aria-label="Me localiser" data-help="Me localiser" {...lp('locate')}
        onClick={() => { void geo?.trigger(); setTimeout(() => setWatch(((geo as unknown as { _watchState?: WatchState })?._watchState) ?? 'OFF'), 50); }}><LocateIcon /></button>
      {/* 🔍 de nouveau visible sous ◎, même en colonne réduite (Seb, 25/11). */}
      <button aria-label="Rechercher un lieu" data-help="Chercher un lieu" {...lp('search')} onClick={onSearch}>🔍</button>
      <button disabled={!native} aria-label="Prendre une photo" data-help="Appareil photo" {...lp('photo')}
        onClick={() => {
          noterPrise();
          Photo.open().catch((e) => onToast(String((e as Error).message ?? e)));
        }}>📷</button>
      <div className="pair" ref={pairRef}>
      <button className={airplane ? 'on' : ''} aria-label={pair ? 'Mode avion (sans réseau, Wi-Fi ni Bluetooth)' : 'Mode avion et mode poche'} data-help="Mode avion (et mode poche)" {...lp('avion')}
        onClick={() => {
          if (!pair && !help) { setPairOpen('avion'); return; }
          if (!native) { onToast('Mode avion : seulement dans l’appli'); return; }
          onToast(airplane ? 'Désactive le mode avion' : 'Active le mode avion : ni réseau, ni Wi-Fi, ni Bluetooth. Le GPS continue.');
          void BatterySettings.open({ what: 'avion' });
        }}>✈</button>
      {(pair || help) && <button className={pocket ? 'on' : ''} disabled={!native} aria-label="Mode poche (écran noir quand le téléphone est vertical)" data-help="Mode poche (écran noir)" {...lp('poche')}
        onClick={() => {
          const on = !pocket;
          setPocket(on);
          void PocketMode.set({ on });
          onToast(on ? 'Mode poche activé : téléphone vertical 3 s = écran noir ; à plat ou 2 secousses pour rallumer' : 'Mode poche désactivé');
        }}>👖</button>}
      {/* Pas d'aide pour les 4 réglages du suivi (Seb, 26/11) : cachés pendant l'aide. */}
      {pair && !help && <button className={`ring ${settingsOpen || junctionWake || offVibrate ? 'on' : 'off'}`} aria-label="Réglages du suivi de trace" data-help="Réglages du suivi de trace" {...lp('reglages')}
        onClick={() => setSettingsOpen(!settingsOpen)}><span className="gear">⚙</span></button>}
      {pair && settingsOpen && !help && <button className={`ring ${junctionWake ? 'on' : 'off'}`} aria-label="Écran rallumé avant les carrefours pendant le suivi de trace" data-help="Écran aux carrefours" {...lp('carrefours')}
        onClick={() => {
          const on = !junctionWake;
          onJunctionWake(on);
          onToast(on ? 'Écran aux carrefours activé : pendant ▶ Commencer la trace, l’écran se rallume avant chaque carrefour et si tu quittes la trace'
            : 'Écran aux carrefours désactivé');
        }}><JunctionWakeIcon /></button>}
      {pair && settingsOpen && !help && <button className={`ring ${offVibrate ? 'on' : 'off'}`} aria-label="Vibration quand je quitte la trace suivie" data-help="Vibration hors trace" {...lp('vibre')}
        onClick={() => {
          const on = !offVibrate;
          onOffVibrate(on);
          onToast(on ? 'Vibration hors trace activée : pendant ▶ Commencer la trace, le téléphone vibre si tu t’éloignes de plus de 50 m'
            : 'Vibration hors trace désactivée');
        }}><OffTrackVibrateIcon /></button>}
      {pair && settingsOpen && !help && <button aria-label="Double tap pour allumer l'écran (réglage du téléphone)" data-help="Double tap pour allumer l'écran" {...lp('doubletap')}
        onClick={() => setDtBubble(true)}><DoubleTapIcon /></button>}
      </div>
      <button disabled={!onDraw} aria-label="Tracer un parcours au doigt" data-help="Tracer au doigt" {...lp('draw')} onClick={onDraw}>✏
        {traceState !== 'none' && <span className={`pencil-badge ${traceState}`} aria-label={traceState === 'run' ? 'Trace en cours' : 'Trace en pause'}>{traceState === 'run' ? '▶' : '⏸'}</span>}</button>
      <div className="pair calques" ref={reliefRef}>
      {/* Calques (Seb, 26/11) : ouvre ou referme la ligne des calques ; chacun s'allume à part, on peut les mélanger. */}
      {/* Aide : une seule bulle pour tous les calques (Seb, 26/11). */}
      <button className="aide-long" aria-label="Calques de la carte" data-help="Calques : pentes, vue 3D, ombres, forêts, zones drones, hors ligne, fond de carte" {...lp('layers')}
        onClick={() => { if (!help) setPairOpen(relief ? null : 'relief'); }}><LayersIcon /></button>
      {relief && !help && <button className={slopes ? 'on' : ''} aria-label="Pentes" data-help="Pentes" {...lp('slopes')} onClick={() => onSlopes(!slopes)}><SlopeIcon /></button>}
      {relief && !help && <button className={tilted ? 'on' : ''} aria-label="Vue 3D du relief" data-help="Vue 3D" {...lp('view3d')} onClick={() => (tilted ? onFlat() : onTilt3d())}><View3dIcon /></button>}
      {relief && !help && <button className={shade ? 'on' : ''} aria-label="Ombres du relief" data-help="Ombres" {...lp('shade')} onClick={() => onShade(!shade)}>🌗</button>}
      {relief && !help && <button className={forests ? 'on' : ''} aria-label="Forêts" data-help="Forêts" {...lp('forests')} onClick={onForests}>🌲</button>}
      {relief && !help && <button className={drones ? 'on' : ''} aria-label="Zones drones" data-help="Zones drones · appui long : légende" {...lp('drones')}
        onClick={() => {
          onDrones(!drones);
          if (!drones) onToast('Drones : rouge = interdit, orange = hauteur limitée, sans couleur = 120 m max. Appui long : légende');
        }}><DroneIcon /></button>}
      {relief && !help && <button className={offline ? 'on' : ''} aria-label="Hors ligne : ce qui est gardé sur le téléphone" data-help="Hors ligne" {...lp('offline')}
        onClick={() => onOffline(!offline)}><OfflineLayerIcon /></button>}
      {/* 🗺 avec ⛰ : tout ce qui touche à la vue de la carte au même endroit (Seb, 24/11). */}
      {relief && !help && <button aria-label="Changer de fond de carte (appui long : choisir)" data-help="Fond de carte · appui long : choisir" {...lpPick('layer')} onClick={onBaseLayer}>🗺</button>}
      </div>
      {/* Activité : toucher ouvre les sorties ⛷ ou les itinéraires ; appui long : ⛷ 🚵 🚴 🚲 🥾 au choix. */}
      <button aria-label={`${ACTIVITY_LABEL[activity]} (appui long : changer d'activité)`}
        data-help={`${ACTIVITY_LABEL[activity]} · appui long : changer`} {...lpPick('activity')}
        onClick={() => { setPairOpen(null); if (activity === 'ski') onSkiText(); else onTopos(); }}>{ACTIVITY_ICON[activity]}</button>
      <button aria-label="Buddies" data-help="Mes « buddies »" {...lp('groups')} onClick={onBuddies}>👥
        {nouveautes > 0 && <span className="nb-dot">{nouveautes}</span>}</button>
      <div className="pair" ref={meteoRef}>
      <button className={weather ? 'on' : ''} aria-label={meteo ? 'Météo sur la carte' : 'Météo et météo montagne'} data-help="Météo · appui long : Météo-France"
        onPointerDown={() => { wx.current.long = false; wx.current.timer = setTimeout(() => { wx.current.long = true; openWeather(false); }, 550); }}
        onPointerUp={() => { if (wx.current.timer) clearTimeout(wx.current.timer); }}
        onPointerLeave={() => { if (wx.current.timer) clearTimeout(wx.current.timer); }}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          if (wx.current.long) { wx.current.long = false; return; }
          // 1er appui : la météo s'affiche et 🏔 apparaît à gauche (demande de Seb) ; ensuite 🌦 l'allume ou l'éteint.
          if (!meteo && !help) { setPairOpen('meteo'); if (!weather) onWeather(true); return; }
          onWeather(!weather);
        }}>🌦</button>
      {(meteo || help) && <button aria-label="Météo montagne" data-help="Météo montagne" {...lp('weatherMountain')} onClick={() => openWeather(true)}>🏔</button>}
      </div>
      </div>
    </div>
    </>
  );
}
