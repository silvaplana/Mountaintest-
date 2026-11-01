import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { DEFAULT_FILTER, judgeFix, type FilterOptions } from '../gps/filter';
import type { GpsFix } from '../gps/types';
import { metrics } from '../metrics';
import { toGpx, type TrackPoint } from './gpx';

const CURRENT = 'tracks/current.json';
const SAVE_EVERY_MS = 30_000;

/** Reçoit les positions, garde les bonnes, et sauvegarde régulièrement la sortie en cours. */
export class TrackRecorder {
  points: TrackPoint[] = [];
  /** Dernière position reçue, même rejetée : sert à voir si l'on repart après un arrêt. */
  latest: GpsFix | null = null;
  /** Dernière position retenue. */
  last: GpsFix | null = null;
  private lastSave = 0;

  constructor(public filter: FilterOptions = DEFAULT_FILTER) {}

  /** Renvoie le nombre de points retenus. */
  add(fixes: GpsFix[]): number {
    let kept = 0;
    for (const f of fixes) {
      metrics.gpsFixes++;
      this.latest = f;
      const verdict = judgeFix(f, this.last, this.filter);
      if (verdict !== 'ok') {
        metrics.gpsRejected++;
        continue;
      }
      this.last = f;
      this.points.push({ lat: f.lat, lon: f.lon, ele: f.alt, time: f.time });
      kept++;
    }
    metrics.gpsBatches++;
    if (Date.now() - this.lastSave > SAVE_EVERY_MS) void this.save();
    return kept;
  }

  reset() {
    this.points = [];
    this.latest = null;
    this.last = null;
  }

  async save() {
    this.lastSave = Date.now();
    const data = JSON.stringify(this.points);
    if (Capacitor.isNativePlatform()) {
      await Filesystem.writeFile({ directory: Directory.Data, path: CURRENT, data, encoding: Encoding.UTF8, recursive: true });
    } else {
      try { localStorage.setItem(CURRENT, data); } catch { /* stockage indisponible */ }
    }
  }

  /** Recharge une sortie interrompue (appli tuée par le système, téléphone redémarré...). */
  async restore(): Promise<boolean> {
    try {
      const raw = Capacitor.isNativePlatform()
        ? ((await Filesystem.readFile({ directory: Directory.Data, path: CURRENT, encoding: Encoding.UTF8 })).data as string)
        : localStorage.getItem(CURRENT);
      if (!raw) return false;
      this.points = JSON.parse(raw);
      const p = this.points.at(-1);
      if (p) this.last = { lat: p.lat, lon: p.lon, alt: p.ele, accuracy: 0, speed: null, time: p.time ?? 0 };
      return this.points.length > 0;
    } catch {
      return false;
    }
  }

  async exportGpx(name: string): Promise<string> {
    return saveGpxFile(name, toGpx({ name, points: this.points }));
  }
}

/** Enregistre un GPX dans Documents/Assomoutain (appli) ou le télécharge (web). Renvoie l'emplacement. */
export async function saveGpxFile(name: string, gpx: string): Promise<string> {
  const file = `${name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w-]+/g, '_')}.gpx`;
  if (Capacitor.isNativePlatform()) {
    const r = await Filesystem.writeFile({ directory: Directory.Documents, path: `Assomoutain/${file}`, data: gpx, encoding: Encoding.UTF8, recursive: true });
    return r.uri;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
  a.download = file;
  a.click();
  URL.revokeObjectURL(a.href);
  return file;
}
