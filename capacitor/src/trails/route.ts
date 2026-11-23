// Tracé au doigt : la ligne dessinée devient un itinéraire. Soit on la garde telle quelle,
// soit on la recale sur les chemins par le calcul d'itinéraire piéton de la Géoplateforme IGN
// (gratuit, sans clé, BD TOPO). Même logique côté Kotlin (Trails.kt).
import { distanceM } from '../gps/adaptive';
import type { LonLat, Trail } from './osmTrails';

const URL_ROUTE = 'https://data.geopf.fr/navigation/itineraire';
/** Points de passage envoyés au calcul d'itinéraire (départ et arrivée compris). */
export const MAX_WAYPOINTS = 12;
/** Identifiant réservé au tracé au doigt (les randos OSM ont des identifiants positifs). */
export const DRAWN_ID = -1;
/** Violet : la trace dessinée se distingue des randos OSM et de l'enregistrement GPS (rouge). */
export const DRAWN_COLOR = '#7b3fe4';

export function lineLengthM(line: LonLat[]) {
  let d = 0;
  for (let i = 1; i < line.length; i++) d += distanceM(line[i - 1], line[i]);
  return d;
}

/** Points de passage régulièrement espacés le long de la ligne dessinée. */
export function waypoints(line: LonLat[], max = MAX_WAYPOINTS): LonLat[] {
  if (line.length <= 2) return line;
  const total = lineLengthM(line);
  const step = total / (max - 1);
  const out = [line[0]];
  let acc = 0;
  for (let i = 1; i < line.length - 1; i++) {
    acc += distanceM(line[i - 1], line[i]);
    if (acc >= step * out.length && out.length < max - 1) out.push(line[i]);
  }
  out.push(line[line.length - 1]);
  return out;
}

/** Itinéraire piéton passant par les points (ligne de coordonnées), ou erreur si hors réseau. */
export async function routeOnPaths(pts: LonLat[], signal?: AbortSignal): Promise<LonLat[]> {
  const f = (p: LonLat) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`;
  const q = new URLSearchParams({
    resource: 'bdtopo-pgr', profile: 'pedestrian', optimization: 'shortest',
    start: f(pts[0]), end: f(pts[pts.length - 1]), geometryFormat: 'geojson', getSteps: 'false',
  });
  if (pts.length > 2) q.set('intermediates', pts.slice(1, -1).map(f).join('|'));
  const res = await fetch(`${URL_ROUTE}?${q}`, { signal });
  if (!res.ok) throw new Error(`itinéraire HTTP ${res.status}`);
  return parseRoute(await res.json());
}

export function parseRoute(json: { geometry?: { coordinates?: number[][] } }): LonLat[] {
  const c = json.geometry?.coordinates ?? [];
  if (c.length < 2) throw new Error('itinéraire vide');
  return c.map(([lon, lat]) => ({ lon, lat }));
}

export function drawnTrail(line: LonLat[], onPaths: boolean, id = DRAWN_ID, color = DRAWN_COLOR): Trail {
  return {
    id, name: 'Mon tracé', kind: onPaths ? 'Tracé au doigt, recalé sur les chemins (IGN)' : 'Tracé au doigt, ligne libre',
    rank: 0, color, segments: [line], distanceM: lineLengthM(line), onPaths, savedId: null,
  };
}

/**
 * Plusieurs traces à moi (dessinées, enregistrées ou chargées d'un fichier) peuvent être affichées ensemble :
 * identifiants négatifs (-1, -2…) et une couleur chacune. Les randos OSM ont des identifiants positifs.
 */
export const TRACE_COLORS = [DRAWN_COLOR, '#e6007e', '#008c9e', '#f07800', '#2b50d6', '#5b8c00', '#8a4b08'];
export const isMine = (id: number) => id < 0;

/** Identifiant et couleur de la prochaine trace : première couleur libre, sinon on reprend la palette. */
export function nextMine(trails: Trail[]): { id: number; color: string } {
  const mine = trails.filter((t) => isMine(t.id));
  const id = Math.min(0, ...mine.map((t) => t.id)) - 1;
  const used = new Set(mine.map((t) => t.color));
  const color = TRACE_COLORS.find((c) => !used.has(c)) ?? TRACE_COLORS[mine.length % TRACE_COLORS.length];
  return { id, color };
}

/** Temps de marche estimé : 4 km/h à plat + 1 h par 300 m de montée + 1 h par 500 m de descente. */
export function walkingHours(distM: number, gainM: number, lossM: number) {
  return distM / 4000 + gainM / 300 + lossM / 500;
}

/** 🚵 Durée à VTT : 15 km/h sur le plat, plus 1 h par 600 m de montée (même calcul côté Kotlin). */
export function bikeHours(distM: number, gainM: number) {
  return distM / 15000 + gainM / 600;
}
