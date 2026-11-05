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
  onSki: () => void;
  /** ⛷ 💬 : question en texte sur les sorties skitour. */
  onSkiText: () => void;
  /** Météo posée sur la carte (icône 🌦) ; appui long : ouvre l'appli Météo-France. */
  weather: boolean; onWeather: (on: boolean) => void;
}

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

export function QuickButtons({ geo, onToast, onDraw, onSearch, onBaseLayer, slopes, onSlopes, shade, onShade, onTravel, onExpenses, onLodging, onSki, onSkiText, weather, onWeather }: QuickProps) {
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
  const [pairOpen, setPairOpen] = useState<'avion' | 'relief' | 'ski' | null>(null);
  const pair = pairOpen === 'avion', relief = pairOpen === 'relief', ski = pairOpen === 'ski';
  const pairRef = useRef<HTMLDivElement>(null);
  const reliefRef = useRef<HTMLDivElement>(null);
  const skiRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pairOpen) return;
    const ref = pairOpen === 'avion' ? pairRef : pairOpen === 'relief' ? reliefRef : skiRef;
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

  // Écran noir dans la poche : on coupe le GPS du bouton ◎ (gros consommateur) et on le relance au réveil.
  // L'enregistrement d'une sortie, lui, continue (sinon la trace aurait des trous).
  useEffect(() => {
    if (!native || !geo) return;
    const state = () => (geo as unknown as { _watchState?: WatchState })._watchState ?? 'OFF';
    let paused = false;
    const sub = PocketMode.addListener('pocket', ({ black }) => {
      if (black && state() !== 'OFF') {
        paused = true;
        for (let i = 0; i < 2 && state() !== 'OFF'; i++) void geo.trigger();
      } else if (!black && paused) {
        paused = false;
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
  return (
    <>
    {tip && <div className="tip-close" onPointerDown={() => setTip(null)}>
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
    {help && <div className="help-close" onClick={() => setHelp(false)}><p>Touche n'importe où pour fermer l'aide</p></div>}
    <div className={help ? 'quick help' : 'quick'}>
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
      </div>
      <button disabled={!onDraw} aria-label="Tracer un parcours au doigt" data-help="Tracer au doigt" {...lp('draw')} onClick={onDraw}>✏</button>
      <div className="pair" ref={reliefRef}>
      <button className={slopes ? 'on' : ''} aria-label={relief ? 'Pentes' : 'Pentes et ombres'} data-help="Pentes · appui : montre aussi les ombres" {...lp('slopes')}
        onClick={() => { if (!relief && !help) { setPairOpen('relief'); return; } onSlopes(!slopes); }}>⛰</button>
      {(relief || help) && <button className={shade ? 'on' : ''} aria-label="Ombres du relief" data-help="Ombres" {...lp('shade')} onClick={() => onShade(!shade)}>🌗</button>}
      </div>
      <div className="pair" ref={skiRef}>
      <button aria-label={ski ? 'Sorties ski de rando sur la carte (skitour.fr)' : 'Sorties ski de rando : carte ou question'} data-help="Sorties ski sur la carte · appui : montre aussi la question en texte" {...lp('ski')}
        onClick={() => { if (!ski && !help) { setPairOpen('ski'); return; } setPairOpen(null); onSki(); }}>⛷<span className="badge">🗺</span></button>
      {(ski || help) && <button aria-label="Question en texte sur les sorties ski (skitour.fr)" data-help="Question en texte sur les sorties ski" {...lp('skiText')}
        onClick={() => { setPairOpen(null); onSkiText(); }}>⛷<span className="badge">💬</span></button>}
      </div>
      </>}
      {(show === 2 || help) && <>
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
