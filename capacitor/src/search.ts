// Recherche de lieux : service d'autocomplétion de la Géoplateforme IGN (gratuit, sans clé).
// Communes, départements, régions, sommets, lieux-dits, adresses… (même service côté Kotlin, Search.kt).

export interface Place { label: string; detail: string; lon: number; lat: number; zoom: number }

const URL_COMPLETION = 'https://data.geopf.fr/geocodage/completion/';

interface CompletionResult {
  x: number; y: number; fulltext: string; kind?: string; poiType?: string[] | string; country?: string;
}

/** Zoom adapté au type de lieu : un département se voit en entier, un sommet de près. */
export function zoomFor(kind: string, poiTypes: string[]): number {
  const t = [kind, ...poiTypes].map((s) => s.toLowerCase());
  if (t.includes('région')) return 7;
  if (t.includes('département')) return 9;
  if (t.includes('commune')) return 13;
  if (t.some((s) => s === 'street' || s === 'housenumber')) return 16;
  return 15;
}

export function parseCompletion(json: { results?: CompletionResult[] }): Place[] {
  return (json.results ?? [])
    .filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y))
    .map((r) => {
      const poi = Array.isArray(r.poiType) ? r.poiType : r.poiType ? [r.poiType] : [];
      const kind = r.kind ?? '';
      // poiType va du plus précis au plus général, sauf pour l'administratif (« administratif, département »).
      const detail = (poi[0] === 'administratif' ? poi[1] : poi[0]) ?? (r.country === 'StreetAddress' ? 'adresse' : kind);
      return { label: r.fulltext, detail: detail === 'street' ? 'rue' : detail, lon: r.x, lat: r.y, zoom: zoomFor(kind, poi) };
    });
}

export async function searchPlaces(text: string, signal?: AbortSignal): Promise<Place[]> {
  const q = new URLSearchParams({ text, maximumResponses: '8' });
  const res = await fetch(`${URL_COMPLETION}?${q}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseCompletion(await res.json());
}
