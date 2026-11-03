import { useEffect, useRef, useState } from 'react';
import type { GeolocateControl } from 'maplibre-gl';
import { App as CapApp } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { ShareIcon } from './Expenses';

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
}

const MODE_KEY = 'iconesMode';
/** Flèche : 0 = toutes les icônes, 1 = l'appareil photo seul, 2 = menu Voyage (météo, voiture), 3 = aucune (puis 0). */
type IconsMode = 0 | 1 | 2 | 3;

export function QuickButtons({ geo, onToast, onDraw, onSearch, onBaseLayer, slopes, onSlopes, shade, onShade, onTravel, onExpenses }: QuickProps) {
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
  return (
    <>
    {help && <div className="help-close" onClick={() => setHelp(false)}><p>Touche n'importe où pour fermer l'aide</p></div>}
    <div className={help ? 'quick help' : 'quick'}>
      <button className="toggle" aria-label="Quitter l'appli" data-help="Quitter l'appli"
        onClick={() => { if (native) void CapApp.exitApp(); else onToast('Quitter : seulement dans l’appli'); }}>✕</button>
      <button className="toggle" aria-label={mode === 3 ? 'Afficher les icônes' : 'Changer les icônes'} data-help="Appui : icônes suivantes · appui long : aide"
        onPointerDown={() => { press.current.long = false; press.current.timer = setTimeout(() => { press.current.long = true; setHelp(true); }, 550); }}
        onPointerUp={() => { if (press.current.timer) clearTimeout(press.current.timer); }}
        onPointerLeave={() => { if (press.current.timer) clearTimeout(press.current.timer); }}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => { if (press.current.long) { press.current.long = false; return; } if (help) { setHelp(false); return; } nextMode(); }}>{mode === 3 ? '◂' : '▸'}</button>
      {show === 0 && <>
      <button className={locating ? 'on' : ''} aria-label="Me localiser" data-help="Me localiser"
        onClick={() => { void geo?.trigger(); setTimeout(() => setWatch(((geo as unknown as { _watchState?: WatchState })?._watchState) ?? 'OFF'), 50); }}>◎</button>
      <button aria-label="Rechercher un lieu" data-help="Chercher un lieu" onClick={onSearch}>🔍</button>
      </>}
      {show < 2 && <button disabled={!native} aria-label="Prendre une photo" data-help="Appareil photo"
        onClick={() => {
          Photo.open().catch((e) => onToast(String((e as Error).message ?? e)));
        }}>📷</button>}
      {show === 0 && <>
      <button aria-label="Changer de fond de carte" data-help="Fond de carte" onClick={onBaseLayer}>🗺</button>
      <button className={airplane ? 'on' : ''} disabled={!native} aria-label="Mode avion (sans réseau, Wi-Fi ni Bluetooth)" data-help="Mode avion"
        onClick={() => {
          onToast(airplane ? 'Désactive le mode avion' : 'Active le mode avion : ni réseau, ni Wi-Fi, ni Bluetooth. Le GPS continue.');
          void BatterySettings.open({ what: 'avion' });
        }}>✈</button>
      <button className={pocket ? 'on' : ''} disabled={!native} aria-label="Mode poche (écran noir quand le téléphone est vertical)" data-help="Mode poche (écran noir)"
        onClick={() => {
          const on = !pocket;
          setPocket(on);
          void PocketMode.set({ on });
          onToast(on ? 'Mode poche activé : téléphone vertical 3 s = écran noir ; à plat ou 2 secousses pour rallumer' : 'Mode poche désactivé');
        }}>👖</button>
      <button disabled={!onDraw} aria-label="Tracer un parcours au doigt" data-help="Tracer au doigt" onClick={onDraw}>✏</button>
      <button className={slopes ? 'on' : ''} aria-label="Pentes" data-help="Pentes" onClick={() => onSlopes(!slopes)}>⛰</button>
      <button className={shade ? 'on' : ''} aria-label="Ombres du relief" data-help="Ombres" onClick={() => onShade(!shade)}>🌗</button>
      </>}
      {(show === 2 || help) && <>
      <button aria-label="Météo" data-help="Météo (Météo-France)" onClick={() => openWeather(false)}>🌦</button>
      <button aria-label="Météo montagne" data-help="Météo montagne" onClick={() => openWeather(true)}>🏔</button>
      <button aria-label="Préparer un voyage en voiture" data-help="Voyage en voiture (km, coût, péages)" onClick={onTravel}>🚗</button>
      <button aria-label="Partage des frais" data-help="Partage des frais (façon Tricount)" onClick={onExpenses}><ShareIcon /></button>
      </>}
    </div>
    </>
  );
}
