import { useEffect, useRef, useState } from 'react';
import type { GeolocateControl } from 'maplibre-gl';
import { App as CapApp } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { ShareIcon } from './Expenses';
import { ICON_HELP, SLOPE_LEGEND, SLOPE_TAGS_HELP, type IconKey } from './iconHelp';

/** Plugins natifs (android/.../PocketMode.java et BatterySettings.java, identiques côté Kotlin). */
const PocketMode = registerPlugin<{
  get(): Promise<{ on: boolean }>; set(o: { on: boolean }): Promise<{ on: boolean }>;
  addListener(e: 'pocket', f: (r: { black: boolean }) => void): Promise<{ remove: () => Promise<void> }>;
}>('PocketMode');
/** Plugin natif (android/.../PhotoCapture.java, identique côté Kotlin) : ouvre l'application Appareil photo. */
const Photo = registerPlugin<{ open(): Promise<void> }>('Photo');
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
  onBaseLayer: () => void;
  slopes: boolean; onSlopes: (on: boolean) => void;
  shade: boolean; onShade: (on: boolean) => void;
  onTravel: () => void;
  onExpenses: () => void;
  onLodging: () => void;
  /** 👥 Groupes / mon compte. */
  onAccount: () => void;
  /** Pastille de 👥 : connecté (vert), à reconnecter (orange), pas de compte. */
  compte: 'ok' | 'reconnecter' | 'aucun';
  /** ⛷ 💬 : question en texte sur les sorties skitour. */
  onSkiText: () => void;
  /** ⛷ ski de rando / 🚵 VTT : appui long sur le bouton pour basculer ; en 🚵, toucher cherche les circuits VTT de l'écran. */
  activity: 'ski' | 'vtt'; onActivity: (a: 'ski' | 'vtt') => void; onVtt: () => void;
  /** Météo posée sur la carte (icône 🌦) ; appui long : ouvre l'appli Météo-France. */
  weather: boolean; onWeather: (on: boolean) => void;
  /** ⑂ Écran rallumé avant les carrefours pendant le suivi d'une trace (à gauche de 👖). */
  junctionWake: boolean; onJunctionWake: (on: boolean) => void;
  /** Vibration quand on quitte la trace suivie (à gauche de ⑂). */
  offVibrate: boolean; onOffVibrate: (on: boolean) => void;
  /** Trace commencée : pastille sur ✏ (maquette B), verte ▶ en cours, orange ⏸ en pause. */
  traceState: 'none' | 'run' | 'pause';
}

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

/** Icône « me localiser » : cercle traversé d'une croix horizontale et verticale, point au centre (même dessin côté Kotlin : ic_locate.xml). */
const LocateIcon = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="7" />
    <path d="M12 1.5v6M12 16.5v6M1.5 12h6M16.5 12h6" />
    <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
  </svg>
);

const MODE_KEY = 'iconesMode';
/** Flèche : 0 = toutes les icônes, 1 = l'appareil photo seul, 2 = menu Voyage (météo, voiture), 3 = aucune (puis 0). */
type IconsMode = 0 | 1 | 2 | 3;

export function QuickButtons({ geo, onToast, onDraw, onSearch, onBaseLayer, slopes, onSlopes, shade, onShade, onTravel, onExpenses, onLodging, onAccount, compte, onSkiText, activity, onActivity, onVtt, weather, onWeather, junctionWake, onJunctionWake, offVibrate, onOffVibrate, traceState }: QuickProps) {
  // Flèche en haut : affiche ou cache toutes les icônes (choix retenu).
  const [mode, setModeState] = useState<IconsMode>(() => {
    try { const v = Number(localStorage.getItem(MODE_KEY)); return v === 1 || v === 2 || v === 3 ? v : 0; } catch { return 0; }
  });
  const nextMode = () => {
    const v = ((mode + 1) % 4) as IconsMode;
    setModeState(v);
    try { localStorage.setItem(MODE_KEY, String(v)); } catch { /* ignoré */ }
  };
  const native = Capacitor.isNativePlatform();
  const [watch, setWatch] = useState<WatchState>('OFF');
  const [airplane, setAirplane] = useState(false);
  const [pocket, setPocket] = useState(false);
  // Duos : ✈ seul d'habitude, un appui le « déplie » et 👖 apparaît à sa gauche ; de même ⛰ puis 🌗.
  // Ensuite chaque icône bascule son mode ; toucher ailleurs replie. La colonne ne bouge pas (alignée à droite).
  const [pairOpen, setPairOpen] = useState<'avion' | 'relief' | null>(null);
  const pair = pairOpen === 'avion', relief = pairOpen === 'relief';
  // ⚙ réglages du suivi (à gauche de 👖) : un appui déplie ⑂, la vibration hors trace et le double tap ; replié avec le duo.
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => { if (!pair) setSettingsOpen(false); }, [pair]);
  // Bulle du double tap : l'appli ne peut pas activer ce réglage, elle explique et ouvre les réglages du téléphone.
  const [dtBubble, setDtBubble] = useState(false);
  const pairRef = useRef<HTMLDivElement>(null);
  const reliefRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pairOpen) return;
    const ref = pairOpen === 'avion' ? pairRef : reliefRef;
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
  const show = help ? 0 : mode;
  const wx = useRef<{ timer: ReturnType<typeof setTimeout> | null; long: boolean }>({ timer: null, long: false });
  // Appui long sur une icône : bulle d'aide à sa gauche (pour ⛰, la légende des couleurs en degrés) ; toucher ailleurs la ferme.
  const [tip, setTip] = useState<{ key: IconKey; top: number; right: number; maxWidth: number } | null>(null);
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
          setTip({ key, top: Math.max(8, Math.min(r.top, window.innerHeight - 260)), right: window.innerWidth - r.left + 8, maxWidth: Math.max(160, r.left - 16) });
        }, 550);
      },
      onPointerUp: stop, onPointerLeave: stop, onPointerCancel: stop,
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
      // Après un appui long, l'appui ne déclenche pas l'icône.
      onClickCapture: (e: React.MouseEvent) => { if (tipPress.current.long) { tipPress.current.long = false; e.stopPropagation(); e.preventDefault(); } },
    };
  };
  /** Appui long qui bascule ⛷ / 🚵 au lieu d'ouvrir la bulle d'aide. */
  const lpSwitch = (to: 'ski' | 'vtt') => ({
    ...lp('skiText'),
    onPointerDown: () => {
      if (tipPress.current.timer) clearTimeout(tipPress.current.timer);
      tipPress.current.long = false;
      tipPress.current.timer = setTimeout(() => { tipPress.current.long = true; onActivity(to); }, 550);
    },
  });
  return (
    <>
    {tip && <div className="tip-close" onPointerDown={() => setTip(null)} onContextMenu={(e) => e.preventDefault()}>
      <div className="icon-tip" style={{ top: tip.top, right: tip.right, maxWidth: tip.maxWidth }}>
        <b>{ICON_HELP[tip.key].title}</b>
        <p>{ICON_HELP[tip.key].text}</p>
        {tip.key === 'slopes' && <>
          <ul className="slope-legend">
            {SLOPE_LEGEND.map((l) => <li key={l.label}><span style={{ background: l.color }} />{l.label}</li>)}
          </ul>
          <p>{SLOPE_TAGS_HELP}</p>
        </>}
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
    {help && <div className="help-close" onClick={() => setHelp(false)}><p>Touche n'importe où pour fermer l'aide</p></div>}
    <div className={help ? 'quick help' : 'quick'} onContextMenu={(e) => e.preventDefault()}>
      <button className="toggle" aria-label="Quitter l'appli" data-help="Quitter l'appli" {...lp('close')}
        onClick={() => { if (native) void CapApp.exitApp(); else onToast('Quitter : seulement dans l’appli'); }}>✕</button>
      <button className="toggle arrow" aria-label={mode === 3 ? 'Afficher les icônes' : 'Changer les icônes'} data-help="Appui : icônes suivantes · appui long : aide"
        onPointerDown={() => { press.current.long = false; press.current.timer = setTimeout(() => { press.current.long = true; setHelp(true); }, 550); }}
        onPointerUp={() => { if (press.current.timer) clearTimeout(press.current.timer); }}
        onPointerLeave={() => { if (press.current.timer) clearTimeout(press.current.timer); }}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => { if (press.current.long) { press.current.long = false; return; } if (help) { setHelp(false); return; } nextMode(); }}>{mode === 3 ? '◂' : '▸'}</button>
      {show === 0 && <>
      <button className={locating ? 'on' : ''} aria-label="Me localiser" data-help="Me localiser" {...lp('locate')}
        onClick={() => { void geo?.trigger(); setTimeout(() => setWatch(((geo as unknown as { _watchState?: WatchState })?._watchState) ?? 'OFF'), 50); }}><LocateIcon /></button>
      <button aria-label="Rechercher un lieu" data-help="Chercher un lieu" {...lp('search')} onClick={onSearch}>🔍</button>
      </>}
      {show < 2 && <button disabled={!native} aria-label="Prendre une photo" data-help="Appareil photo" {...lp('photo')}
        onClick={() => {
          Photo.open().catch((e) => onToast(String((e as Error).message ?? e)));
        }}>📷</button>}
      {show === 0 && <>
      <button aria-label="Changer de fond de carte" data-help="Fond de carte" {...lp('layer')} onClick={onBaseLayer}>🗺</button>
      <div className="pair" ref={pairRef}>
      <button className={airplane ? 'on' : ''} aria-label={pair ? 'Mode avion (sans réseau, Wi-Fi ni Bluetooth)' : 'Mode avion et mode poche'} data-help="Mode avion · appui : montre aussi le mode poche" {...lp('avion')}
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
      {(pair || help) && <button className={`ring ${settingsOpen || junctionWake || offVibrate ? 'on' : 'off'}`} aria-label="Réglages du suivi de trace" data-help="Réglages du suivi · appui : ⑂, vibration, double tap" {...lp('reglages')}
        onClick={() => setSettingsOpen(!settingsOpen)}><span className="gear">⚙</span></button>}
      {((pair && settingsOpen) || help) && <button className={`ring ${junctionWake ? 'on' : 'off'}`} aria-label="Écran rallumé avant les carrefours pendant le suivi de trace" data-help="Écran aux carrefours" {...lp('carrefours')}
        onClick={() => {
          const on = !junctionWake;
          onJunctionWake(on);
          onToast(on ? 'Écran aux carrefours activé : pendant ▶ Commencer la trace, l’écran se rallume avant chaque carrefour et si tu quittes la trace'
            : 'Écran aux carrefours désactivé');
        }}><JunctionWakeIcon /></button>}
      {((pair && settingsOpen) || help) && <button className={`ring ${offVibrate ? 'on' : 'off'}`} aria-label="Vibration quand je quitte la trace suivie" data-help="Vibration hors trace" {...lp('vibre')}
        onClick={() => {
          const on = !offVibrate;
          onOffVibrate(on);
          onToast(on ? 'Vibration hors trace activée : pendant ▶ Commencer la trace, le téléphone vibre si tu t’éloignes de plus de 50 m'
            : 'Vibration hors trace désactivée');
        }}><OffTrackVibrateIcon /></button>}
      {((pair && settingsOpen) || help) && <button aria-label="Double tap pour allumer l'écran (réglage du téléphone)" data-help="Double tap pour allumer l'écran" {...lp('doubletap')}
        onClick={() => setDtBubble(true)}><DoubleTapIcon /></button>}
      </div>
      <button disabled={!onDraw} aria-label="Tracer un parcours au doigt" data-help="Tracer au doigt" {...lp('draw')} onClick={onDraw}>✏
        {traceState !== 'none' && <span className={`pencil-badge ${traceState}`} aria-label={traceState === 'run' ? 'Trace en cours' : 'Trace en pause'}>{traceState === 'run' ? '▶' : '⏸'}</span>}</button>
      <div className="pair" ref={reliefRef}>
      <button className={slopes ? 'on' : ''} aria-label={relief ? 'Pentes' : 'Pentes et ombres'} data-help="Pentes · appui : montre aussi les ombres" {...lp('slopes')}
        onClick={() => { if (!relief && !help) { setPairOpen('relief'); return; } onSlopes(!slopes); }}>⛰</button>
      {(relief || help) && <button className={shade ? 'on' : ''} aria-label="Ombres du relief" data-help="Ombres" {...lp('shade')} onClick={() => onShade(!shade)}>🌗</button>}
      </div>
      {/* ⛷ : la liste « Sorties ski » ; sa carte s'ouvre avec 🗺 à droite du titre. */}
      {/* Appui long : bascule ⛷ ski de rando ↔ 🚵 VTT (demande de Seb), au lieu de la bulle d'aide. */}
      {activity === 'vtt'
        ? <button aria-label="Circuits VTT de l'écran (appui long : ski de rando)" data-help="Circuits VTT · appui long : ⛷ ski" {...lpSwitch('ski')}
            onClick={() => { setPairOpen(null); onVtt(); }}>🚵</button>
        : <button aria-label="Sorties ski (skitour.fr) (appui long : VTT)" data-help="Sorties ski · appui long : 🚵 VTT" {...lpSwitch('vtt')}
            onClick={() => { setPairOpen(null); onSkiText(); }}>⛷</button>}
      </>}
      {(show === 2 || help) && <>
      {/* 👥 Groupes et compte : bouton important, en haut de la seconde barre (demande de Seb). */}
      <button aria-label="Groupes et mon compte" data-help="Groupes · mon compte" {...lp('groups')} onClick={onAccount}>👥
        {compte !== 'aucun' && <span className={`acc-dot ${compte === 'ok' ? 'vert' : 'orange'}`} />}</button>
      <button className={weather ? 'on' : ''} aria-label="Météo sur la carte" data-help="Météo sur la carte · appui long : appli Météo-France"
        onPointerDown={() => { wx.current.long = false; wx.current.timer = setTimeout(() => { wx.current.long = true; openWeather(false); }, 550); }}
        onPointerUp={() => { if (wx.current.timer) clearTimeout(wx.current.timer); }}
        onPointerLeave={() => { if (wx.current.timer) clearTimeout(wx.current.timer); }}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => { if (wx.current.long) { wx.current.long = false; return; } onWeather(!weather); }}>🌦</button>
      <button aria-label="Météo montagne" data-help="Météo montagne" {...lp('weatherMountain')} onClick={() => openWeather(true)}>🏔</button>
      <button aria-label="Préparer un voyage en voiture" data-help="Voyage en voiture (km, coût, péages)" {...lp('travel')} onClick={onTravel}>🚗</button>
      <button aria-label="Trouver un hébergement" data-help="Hébergement (meilleurs prix, IA)" {...lp('lodging')} onClick={onLodging}>🏨</button>
      <button aria-label="Partage des frais" data-help="Partage des frais (façon Tricount)" {...lp('expenses')} onClick={onExpenses}><ShareIcon /></button>
      </>}
    </div>
    </>
  );
}
