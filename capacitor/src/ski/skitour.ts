// Sorties de ski de rando publiées sur skitour.fr, dans une zone encadrée. Passe par le relais du VPS
// (deploy/ia/relais.py), qui garde la clé de l'API skitour. Même appel côté Kotlin (Skitour.kt).
import { relayPost } from '../travel/travel';
import type { Bbox } from '../config';

export interface Outing {
  id: number; titre: string; date: number; massif: string; sommet: string; altitude: number | null;
  lat: number; lon: number; denivele: number | null; dif_ski: string | number | null; orientation: string;
  conditions: string; auteur: string; url: string;
}

export async function fetchOutings(b: Bbox, days: number, password: string): Promise<Outing[]> {
  const r = await relayPost<{ sorties?: Outing[] }>('skitour', { ouest: b[0], sud: b[1], est: b[2], nord: b[3], jours: days }, password);
  return (r.sorties ?? []).filter((o) => Number.isFinite(o.lat) && Number.isFinite(o.lon)).sort((x, y) => y.date - x.date);
}

export const outingDate = (o: Outing) => new Date(o.date * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

export const outingLine = (o: Outing) => [o.sommet + (o.altitude ? ` ${o.altitude} m` : ''), o.denivele ? `D+ ${o.denivele} m` : '',
  o.dif_ski ? `ski ${o.dif_ski}` : '', o.orientation].filter(Boolean).join(' · ');

// Hors ligne : chaque recherche réussie est gardée sur le téléphone (texte seulement : titre, date, sommet, point,
// D+, conditions, lien ; ni récit ni photos). Sans réseau, on rassemble les sorties gardées qui tombent dans la
// zone et la période demandées. Même logique côté Kotlin (SkitourCache).
export interface CachedSearch { zone: Bbox; days: number; t: number; sorties: Outing[] }
export const CACHE_MAX = 10;
const CACHE_KEY = 'skitourCache';

export function addToCache(list: CachedSearch[], zone: Bbox, days: number, sorties: Outing[], now: number): CachedSearch[] {
  const same = (c: CachedSearch) => c.days === days && c.zone.every((v, i) => Math.abs(v - zone[i]) < 1e-6);
  return [{ zone, days, t: now, sorties }, ...list.filter((c) => !same(c))].slice(0, CACHE_MAX);
}

/** Sorties gardées dans la zone et la période ; t = date de la plus ancienne recherche utilisée. null si aucune ne couvre la zone. */
export function fromCache(list: CachedSearch[], zone: Bbox, days: number, now: number): { sorties: Outing[]; t: number } | null {
  const [w, s, e, n] = zone;
  const used = list.filter((c) => c.zone[0] < e && c.zone[2] > w && c.zone[1] < n && c.zone[3] > s);
  if (!used.length) return null;
  const since = now / 1000 - days * 86400;
  const byId = new Map<number, Outing>();
  for (const c of used) for (const o of c.sorties)
    if (o.lon >= w && o.lon <= e && o.lat >= s && o.lat <= n && o.date >= since && !byId.has(o.id)) byId.set(o.id, o);
  return { sorties: [...byId.values()].sort((x, y) => y.date - x.date), t: Math.min(...used.map((c) => c.t)) };
}

function readCache(): CachedSearch[] {
  try { const v = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Cherche en ligne et garde le résultat ; sans réseau (ou relais en panne), répond avec les sorties gardées (offline = date de ces données). */
export async function loadOutings(b: Bbox, days: number, password: string): Promise<{ outings: Outing[]; offline?: number }> {
  try {
    const outings = await fetchOutings(b, days, password);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(addToCache(readCache(), b, days, outings, Date.now()))); } catch { /* stockage plein */ }
    return { outings };
  } catch (e) {
    const c = fromCache(readCache(), b, days, Date.now());
    if (!c) throw e;
    return { outings: c.sorties, offline: c.t };
  }
}

// Question en texte (icône ⛷ 💬) : le relais fait chercher Claude dans les sorties récentes et renvoie une réponse
// courte et les sorties citées. Les 10 dernières réponses restent sur le téléphone (relisibles hors ligne).
export interface SkiAnswer { q: string; texte: string; sorties: Outing[]; t: number; cout_usd?: number }
const ANSWERS_KEY = 'skitourReponses';

export async function askSki(q: string, center: { lat: number; lon: number } | null, password: string): Promise<SkiAnswer> {
  const r = await relayPost<{ texte?: string; sorties?: Outing[]; cout_usd?: number }>('skitour-texte',
    { question: q, ...(center ? { lat: center.lat, lon: center.lon } : {}) }, password);
  const a: SkiAnswer = { q, texte: r.texte ?? '', sorties: (r.sorties ?? []).filter((o) => Number.isFinite(o.lat) && Number.isFinite(o.lon)), t: Date.now(), cout_usd: r.cout_usd };
  try { localStorage.setItem(ANSWERS_KEY, JSON.stringify([a, ...readAnswers()].slice(0, 10))); } catch { /* stockage plein */ }
  return a;
}

export function readAnswers(): SkiAnswer[] {
  try { const v = JSON.parse(localStorage.getItem(ANSWERS_KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
