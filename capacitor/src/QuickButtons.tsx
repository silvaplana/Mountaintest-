import { useEffect, useState } from 'react';
import type { GeolocateControl } from 'maplibre-gl';
import { App as CapApp } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';

/** Plugins natifs (android/.../PocketMode.java et BatterySettings.java, identiques côté Kotlin). */
const PocketMode = registerPlugin<{
  get(): Promise<{ on: boolean }>; set(o: { on: boolean }): Promise<{ on: boolean }>;
  addListener(e: 'pocket', f: (r: { black: boolean }) => void): Promise<{ remove: () => Promise<void> }>;
}>('PocketMode');
/** Plugin natif (android/.../PhotoCapture.java, identique côté Kotlin) : ouvre l'application Appareil photo. */
const Photo = registerPlugin<{ open(): Promise<void> }>('Photo');
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
}

const HIDDEN_KEY = 'iconesCachees';

export function QuickButtons({ geo, onToast, onDraw, onSearch, onBaseLayer, slopes, onSlopes, shade, onShade }: QuickProps) {
  // Flèche en haut : affiche ou cache toutes les icônes (choix retenu).
  const [hidden, setHiddenState] = useState(() => { try { return localStorage.getItem(HIDDEN_KEY) === '1'; } catch { return false; } });
  const setHidden = (v: boolean) => { setHiddenState(v); try { localStorage.setItem(HIDDEN_KEY, v ? '1' : '0'); } catch { /* ignoré */ } };
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
  return (
    <div className="quick">
      <button className="toggle" aria-label={hidden ? 'Afficher les icônes' : 'Cacher les icônes'} onClick={() => setHidden(!hidden)}>{hidden ? '◂' : '▸'}</button>
      {!hidden && <>
      <button className={locating ? 'on' : ''} aria-label="Me localiser"
        onClick={() => { void geo?.trigger(); setTimeout(() => setWatch(((geo as unknown as { _watchState?: WatchState })?._watchState) ?? 'OFF'), 50); }}>◎</button>
      <button aria-label="Rechercher un lieu" onClick={onSearch}>🔍</button>
      <button disabled={!native} aria-label="Prendre une photo"
        onClick={() => {
          Photo.open().catch((e) => onToast(String((e as Error).message ?? e)));
        }}>📷</button>
      <button aria-label="Changer de fond de carte" onClick={onBaseLayer}>🗺</button>
      <button className={airplane ? 'on' : ''} disabled={!native} aria-label="Mode avion (sans réseau, Wi-Fi ni Bluetooth)"
        onClick={() => {
          onToast(airplane ? 'Désactive le mode avion' : 'Active le mode avion : ni réseau, ni Wi-Fi, ni Bluetooth. Le GPS continue.');
          void BatterySettings.open({ what: 'avion' });
        }}>✈</button>
      <button className={pocket ? 'on' : ''} disabled={!native} aria-label="Mode poche (écran noir quand le téléphone est vertical)"
        onClick={() => {
          const on = !pocket;
          setPocket(on);
          void PocketMode.set({ on });
          onToast(on ? 'Mode poche activé : téléphone vertical 3 s = écran noir ; à plat ou 2 secousses pour rallumer' : 'Mode poche désactivé');
        }}>👖</button>
      <button disabled={!onDraw} aria-label="Tracer un parcours au doigt" onClick={onDraw}>✏</button>
      <button className={slopes ? 'on' : ''} aria-label="Pentes" onClick={() => onSlopes(!slopes)}>⛰</button>
      <button className={shade ? 'on' : ''} aria-label="Ombres du relief" onClick={() => onShade(!shade)}>🌗</button>
      </>}
    </div>
  );
}
