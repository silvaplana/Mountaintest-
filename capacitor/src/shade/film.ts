// Film des ombres : une image toutes les 30 minutes sur 24 h (heure du téléphone), à la date choisie.
import { computeShade, LIT, NIGHT, shadeRatio } from './shadow';
import { sunPosition, type SunPos } from './sun';
import { cellMeters, gridBbox, type DemGrid } from './dem';

export const FILM_START_H = 0;
/** Exclu : la dernière image est 23:30. */
export const FILM_END_H = 24;
export const FILM_STEP_MIN = 30;

/** Heures du film pour un jour donné (date locale « AAAA-MM-JJ »). */
export function filmTimes(day: string): Date[] {
  const [y, m, d] = day.split('-').map(Number);
  const out: Date[] = [];
  for (let min = FILM_START_H * 60; min < FILM_END_H * 60; min += FILM_STEP_MIN) {
    out.push(new Date(y, m - 1, d, Math.floor(min / 60), min % 60));
  }
  return out;
}

/** Image affichée d'abord : l'heure actuelle si c'est aujourd'hui, sinon 8 h (départ de rando). */
export function startIndex(day: string, now = new Date()): number {
  const min = day === todayIso(now) ? now.getHours() * 60 + now.getMinutes() : 8 * 60;
  return Math.max(0, Math.floor((min - FILM_START_H * 60) / FILM_STEP_MIN));
}

export function todayIso(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** codes absent : nuit (soleil couché), toute la grille est dans l'ombre. */
export interface ShadeFrame { time: Date; sun: SunPos; ratio: number; codes: Uint8Array | null }

/** Calcule une image : position du soleil au centre de la grille, puis ombres. */
export function computeFrame(grid: DemGrid, time: Date): ShadeFrame {
  const b = gridBbox(grid.spec);
  const sun = sunPosition(time, (b[1] + b[3]) / 2, (b[0] + b[2]) / 2);
  if (sun.altitude <= 0) return { time, sun, ratio: 1, codes: null };
  const codes = computeShade(grid.dem, grid.w, grid.h, cellMeters(grid.spec), sun.azimuth, sun.altitude);
  return { time, sun, ratio: shadeRatio(codes), codes };
}

/** Couleur de l'ombre : bleu nuit translucide (plus sombre la nuit). */
export const SHADE_RGBA: [number, number, number, number] = [20, 30, 85, 115];
export const NIGHT_RGBA: [number, number, number, number] = [10, 15, 40, 150];

/** Pixels RGBA de l'image (transparent au soleil). */
export function framePixels(codes: Uint8Array): Uint8ClampedArray {
  const px = new Uint8ClampedArray(codes.length * 4);
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (c === LIT) continue;
    const col = c === NIGHT ? NIGHT_RGBA : SHADE_RGBA;
    px.set(col, i * 4);
  }
  return px;
}
