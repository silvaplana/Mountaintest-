// Météo posée sur la carte : prévisions des modèles Météo-France (AROME France HD 1,5 km jusqu'à 2 jours,
// puis ARPEGE jusqu'à 4 jours) redistribuées par Open-Meteo (sans clé, gratuit en usage non commercial,
// données CC BY 4.0, 10 000 appels par jour). Même code côté Kotlin (Weather.kt).
import type { Bbox } from '../config';

export const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
export const ATTRIBUTION = 'Météo-France (AROME, ARPEGE) via Open-Meteo';
/** Jours de prévision demandés (AROME couvre 2 jours, ARPEGE prend le relais). */
export const DAYS = 4;
/** Au-delà, on redemande au serveur (les modèles sortent toutes les 3 h). */
export const FRESH_MS = 60 * 60 * 1000;
/** Nombre maximal de points demandés d'un coup (une seule requête, latitudes séparées par des virgules). */
export const MAX_POINTS = 30;

/** Prévision horaire en un point : une case par heure, à partir de `start` (heure locale, minutes à 0). */
export interface PointForecast {
  lat: number; lon: number;
  /** Heure de la première case, en ms. */
  start: number;
  /** Heure à laquelle on a reçu la prévision, en ms. */
  fetched: number;
  code: number[]; temp: number[]; wind: number[]; gust: number[]; dir: number[]; day: boolean[]; rain: number[];
}

/** Pas de la grille (degrés) pour une vue donnée : environ 4 colonnes d'icônes à l'écran, jamais plus fin que 2 km. */
const STEPS = [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 4];
export function gridStep(b: Bbox): number {
  const width = Math.max(b[2] - b[0], (b[3] - b[1]) * 0.75);
  const want = width / 4;
  return STEPS.find((s) => s >= want) ?? STEPS[STEPS.length - 1];
}

/** Points de la grille (alignés sur des multiples du pas, donc stables quand on fait glisser la carte). */
export function gridPoints(b: Bbox, step = gridStep(b)): { lat: number; lon: number }[] {
  const out: { lat: number; lon: number }[] = [];
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  const lon0 = Math.ceil(b[0] / step) * step, lat0 = Math.ceil(b[1] / step) * step;
  for (let lat = lat0; lat <= b[3] + 1e-9 && out.length < MAX_POINTS * 4; lat += step)
    for (let lon = lon0; lon <= b[2] + 1e-9; lon += step) out.push({ lat: r(lat), lon: r(lon) });
  // Trop de points (vue très large en hauteur) : on garde ceux du centre.
  if (out.length > MAX_POINTS) {
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    out.sort((p, q) => Math.hypot(p.lon - cx, (p.lat - cy) / 0.75) - Math.hypot(q.lon - cx, (q.lat - cy) / 0.75));
    out.length = MAX_POINTS;
  }
  return out;
}

export const pointKey = (p: { lat: number; lon: number }) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;

interface Hourly { time: string[]; weather_code: number[]; temperature_2m: number[]; wind_speed_10m: number[]; wind_gusts_10m: number[]; wind_direction_10m: number[]; is_day: number[]; precipitation: number[] }
interface Answer { latitude: number; longitude: number; hourly: Hourly; error?: boolean; reason?: string }

/** Lit la réponse d'Open-Meteo (un objet pour un point, un tableau sinon) ; les points sont rendus dans l'ordre demandé. */
export function parseForecast(json: unknown, asked: { lat: number; lon: number }[], now = Date.now()): PointForecast[] {
  const list = (Array.isArray(json) ? json : [json]) as Answer[];
  if (list[0]?.error) throw new Error(list[0].reason ?? 'Open-Meteo : erreur');
  return list.map((a, i) => {
    const h = a.hourly;
    const p = asked[i] ?? { lat: a.latitude, lon: a.longitude };
    return {
      lat: p.lat, lon: p.lon, start: new Date(h.time[0]).getTime(), fetched: now,
      code: h.weather_code, temp: h.temperature_2m, wind: h.wind_speed_10m, gust: h.wind_gusts_10m, dir: h.wind_direction_10m,
      day: h.is_day.map((d) => d === 1), rain: h.precipitation,
    };
  });
}

export function forecastUrl(points: { lat: number; lon: number }[]): string {
  const q = new URLSearchParams({
    latitude: points.map((p) => p.lat).join(','), longitude: points.map((p) => p.lon).join(','),
    hourly: 'weather_code,temperature_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,is_day,precipitation',
    models: 'meteofrance_seamless', forecast_days: String(DAYS), timezone: 'auto',
  });
  return `${OPEN_METEO}?${q}`;
}

export async function fetchForecast(points: { lat: number; lon: number }[], signal?: AbortSignal): Promise<PointForecast[]> {
  const res = await fetch(forecastUrl(points), { signal });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* réponse non JSON */ }
  if (!res.ok) throw new Error((json as { reason?: string } | null)?.reason ?? `Open-Meteo : HTTP ${res.status}`);
  return parseForecast(json, points);
}

// ---------- Cache (mémoire + stockage local, pour afficher la dernière météo sans réseau) ----------

const CACHE_KEY = 'meteoCache';
const CACHE_MAX = 200;
let cache: Map<string, PointForecast> | null = null;

function loadCache(): Map<string, PointForecast> {
  if (cache) return cache;
  cache = new Map();
  try {
    const arr = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '[]') as PointForecast[];
    for (const p of arr) if (Number.isFinite(p.lat) && Array.isArray(p.code)) cache.set(pointKey(p), p);
  } catch { /* stockage indisponible */ }
  return cache;
}

function saveCache() {
  if (!cache) return;
  // On garde les plus récents.
  const arr = [...cache.values()].sort((a, b) => b.fetched - a.fetched).slice(0, CACHE_MAX);
  cache = new Map(arr.map((p) => [pointKey(p), p]));
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(arr)); } catch { /* ignoré */ }
}

export function cached(p: { lat: number; lon: number }): PointForecast | undefined { return loadCache().get(pointKey(p)); }

/**
 * Prévisions des points demandés : celles du cache si récentes, sinon une requête pour les manquants.
 * Sans réseau, renvoie ce qu'on a (même vieux) et l'erreur.
 */
export async function forecastFor(points: { lat: number; lon: number }[], signal?: AbortSignal): Promise<{ list: PointForecast[]; error: string | null }> {
  const c = loadCache();
  const now = Date.now();
  const missing = points.filter((p) => { const x = c.get(pointKey(p)); return !x || now - x.fetched > FRESH_MS; });
  let error: string | null = null;
  if (missing.length) {
    try {
      for (const p of await fetchForecast(missing, signal)) c.set(pointKey(p), p);
      saveCache();
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      error = (e as Error).message;
    }
  }
  return { list: points.map((p) => c.get(pointKey(p))).filter((p): p is PointForecast => !!p), error };
}

// ---------- Icônes ----------

/** Code temps OMM (weather_code) → icône. La nuit, ciel clair = lune. */
export function weatherIcon(code: number, day = true): string {
  if (code === 0) return day ? '☀️' : '🌙';
  if (code === 1) return day ? '🌤️' : '🌙';
  if (code === 2) return day ? '⛅' : '☁️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌦️';
  if (code >= 61 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '🌨️';
  if (code === 80 || code === 81) return day ? '🌦️' : '🌧️';
  if (code === 82) return '🌧️';
  if (code === 85 || code === 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '❓';
}

export function weatherText(code: number): string {
  const t: Record<number, string> = {
    0: 'Ciel dégagé', 1: 'Peu nuageux', 2: 'Partiellement nuageux', 3: 'Couvert', 45: 'Brouillard', 48: 'Brouillard givrant',
    51: 'Bruine faible', 53: 'Bruine', 55: 'Bruine forte', 56: 'Bruine verglaçante', 57: 'Bruine verglaçante forte',
    61: 'Pluie faible', 63: 'Pluie', 65: 'Pluie forte', 66: 'Pluie verglaçante', 67: 'Pluie verglaçante forte',
    71: 'Neige faible', 73: 'Neige', 75: 'Neige forte', 77: 'Grésil', 80: 'Averses faibles', 81: 'Averses', 82: 'Averses violentes',
    85: 'Averses de neige', 86: 'Fortes averses de neige', 95: 'Orage', 96: 'Orage avec grêle', 99: 'Orage avec forte grêle',
  };
  return t[code] ?? `Code ${code}`;
}

/** Flèche d'où vient le vent (direction météo = d'où il souffle) → vers où il va. */
export function windArrow(dirFrom: number): string {
  const arrows = ['↓', '↙', '←', '↖', '↑', '↗', '→', '↘'];
  return arrows[Math.round((((dirFrom % 360) + 360) % 360) / 45) % 8];
}

/** Index de l'heure `t` dans la prévision d'un point (−1 hors plage). */
export function hourIndex(p: PointForecast, t: number): number {
  const i = Math.floor((t - p.start) / 3_600_000);
  return i >= 0 && i < p.code.length ? i : -1;
}

/** Heures proposées par le curseur : de l'heure courante jusqu'à la fin des prévisions. */
export function sliderHours(now = Date.now()): number[] {
  const start = new Date(now); start.setMinutes(0, 0, 0);
  const end = new Date(start); end.setHours(0, 0, 0, 0); end.setDate(end.getDate() + DAYS);
  const out: number[] = [];
  for (let t = start.getTime(); t < end.getTime(); t += 3_600_000) out.push(t);
  return out;
}

export function hourLabel(t: number): string {
  const d = new Date(t);
  const day = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day} ${d.getHours()} h`;
}

/** Couleur d'une flèche de vent selon la vitesse (km/h) : vert, orange, rouge, violet. */
export function windColor(kmh: number): string {
  return kmh >= 60 ? '#7b3fe4' : kmh >= 40 ? '#e4572e' : kmh >= 20 ? '#e0a100' : '#2f9e44';
}

/** Rotation CSS (degrés) d'une flèche « ➤ » (qui pointe vers l'est) pour montrer où va le vent. */
export function windRotation(dirFrom: number): number {
  return (((dirFrom + 180 - 90) % 360) + 360) % 360;
}
