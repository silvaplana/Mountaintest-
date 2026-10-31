import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { parseGpx } from '../track/gpx';
import { distanceM } from './adaptive';
import { EcoLocation } from './ecoLocation';
import type { GpsFix, GpsSettings } from './types';

export type FixesHandler = (fixes: GpsFix[]) => void;

export interface LocationSource {
  readonly name: string;
  start(settings: GpsSettings, onFixes: FixesHandler): Promise<void>;
  update(settings: GpsSettings): Promise<void>;
  stop(): Promise<void>;
}

export class NativeEcoSource implements LocationSource {
  readonly name = 'GPS natif (plugin EcoLocation)';
  private handle: PluginListenerHandle | null = null;

  async start(settings: GpsSettings, onFixes: FixesHandler) {
    const perm = await EcoLocation.requestPermissions();
    if (perm.location !== 'granted') throw new Error('Autorisation de localisation refusée');
    this.handle = await EcoLocation.addListener('fixes', (e) => onFixes(e.fixes));
    await EcoLocation.start({ ...settings, title: 'Enregistrement de la sortie', text: 'Le GPS suit votre trace.' });
  }
  update(settings: GpsSettings) { return EcoLocation.update(settings); }
  async stop() {
    await EcoLocation.stop();
    await this.handle?.remove();
    this.handle = null;
  }
}

/** Pour le développement dans un navigateur : pas d'arrière-plan, pas de réglage d'énergie. */
export class BrowserSource implements LocationSource {
  readonly name = 'GPS du navigateur';
  private id: number | null = null;

  async start(_s: GpsSettings, onFixes: FixesHandler) {
    this.id = navigator.geolocation.watchPosition(
      (p) => onFixes([{ lat: p.coords.latitude, lon: p.coords.longitude, alt: p.coords.altitude, accuracy: p.coords.accuracy, speed: p.coords.speed, time: p.timestamp }]),
      (e) => console.warn('[gps]', e.message),
      { enableHighAccuracy: true },
    );
  }
  async update() {}
  async stop() { if (this.id !== null) navigator.geolocation.clearWatch(this.id); this.id = null; }
}

/** Rejoue la trace du scénario commun, avec un facteur d'accélération. */
export class ReplaySource implements LocationSource {
  readonly name = 'Simulation (trace de référence)';
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private gpxUrl: string, private speedFactor: number) {}

  async start(_s: GpsSettings, onFixes: FixesHandler) {
    const track = parseGpx(await (await fetch(this.gpxUrl)).text());
    const pts = track.points;
    if (pts.length < 2) throw new Error('Trace de simulation vide');
    const t0 = pts[0].time ?? 0, wall0 = Date.now();
    let i = 0;
    // Les positions gardent l'écart de temps du GPX (le filtre « intervalle min » s'applique comme côté Kotlin),
    // mais sont envoyées plus vite. Précision fictive de 5 m.
    this.timer = setInterval(() => {
      const simNow = t0 + (Date.now() - wall0) * this.speedFactor;
      const batch: GpsFix[] = [];
      while (i < pts.length && (pts[i].time ?? 0) <= simNow) {
        const p = pts[i++];
        const prev = pts[i - 2];
        const dt = prev?.time && p.time ? (p.time - prev.time) / 1000 : 1;
        const speed = prev ? distanceM(prev, p) / Math.max(dt, 0.001) : 0;
        batch.push({ lat: p.lat, lon: p.lon, alt: p.ele, accuracy: 5, speed, time: wall0 + ((p.time ?? 0) - t0) });
      }
      if (batch.length) onFixes(batch);
      if (i >= pts.length) this.stop();
    }, 1000);
  }
  async update() {}
  async stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

export function defaultSource(): LocationSource {
  return Capacitor.isNativePlatform() ? new NativeEcoSource() : new BrowserSource();
}

