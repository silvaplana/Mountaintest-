// Randos trouvées sur le web par Claude : l'appli envoie la zone au relais du VPS (deploy/ia/relais.py),
// qui garde la clé API et renvoie un point de départ et un lien par rando. Même appel côté Kotlin (WebHikes.kt).
import type { Bbox } from '../config';

export const RELAIS_URL = 'https://silvaplana.cloud/mountaintest-ia/randos';

/** Mot de passe du relais intégré à l'APK par la CI (secret IA_MOT_DE_PASSE), vide pour le site web public. */
export const IA_MOT_DE_PASSE_INTEGRE: string = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_IA_MOT_DE_PASSE ?? '';

export interface WebHike {
  nom: string; lat: number; lon: number; url: string; site: string;
  distance_km: number | null; denivele_m: number | null; resume: string;
}

export function parseWebHikes(json: { randos?: WebHike[] }): WebHike[] {
  return (json.randos ?? []).filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lon) && /^https?:\/\//.test(h.url));
}

/** Coût de la recherche (0 si la zone était déjà en cache sur le relais) et cumuls, en dollars. */
export interface WebCost { cout: number; mois: number; total: number }

export function formatUsd(v: number) { return `${v < 0.1 ? v.toFixed(3) : v.toFixed(2)} $`.replace('.', ','); }

export function costLine(c: WebCost, cache: boolean) {
  return `${cache ? 'Zone déjà cherchée : gratuit' : `Coût : ${formatUsd(c.cout)}`} (ce mois-ci ${formatUsd(c.mois)}, total ${formatUsd(c.total)}).`;
}

export async function fetchWebHikes(b: Bbox, password: string, signal?: AbortSignal): Promise<{ hikes: WebHike[]; cache: boolean; cost: WebCost }> {
  const res = await fetch(RELAIS_URL, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'X-Mot-De-Passe': password },
    body: JSON.stringify({ ouest: b[0], sud: b[1], est: b[2], nord: b[3] }),
  });
  let json: { randos?: WebHike[]; erreur?: string; cache?: boolean; cout_usd?: number; cumul_mois_usd?: number; cumul_total_usd?: number } = {};
  try { json = await res.json(); } catch { /* réponse non JSON */ }
  if (!res.ok) throw new Error(json.erreur ?? `relais HTTP ${res.status}`);
  return { hikes: parseWebHikes(json), cache: !!json.cache,
    cost: { cout: json.cout_usd ?? 0, mois: json.cumul_mois_usd ?? 0, total: json.cumul_total_usd ?? 0 } };
}

export function webHikesGeoJson(hikes: WebHike[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: hikes.map((h, i) => ({ type: 'Feature', properties: { i }, geometry: { type: 'Point', coordinates: [h.lon, h.lat] } })),
  };
}

export function hikeDetail(h: WebHike): string {
  return [h.site, h.distance_km != null ? `${String(h.distance_km).replace('.', ',')} km` : '', h.denivele_m != null ? `D+ ${Math.round(h.denivele_m)} m` : '']
    .filter(Boolean).join(' · ');
}
