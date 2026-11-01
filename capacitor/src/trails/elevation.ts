// Altitudes d'une rando OSM (OSM ne donne pas l'altitude) : service d'altimétrie de la Géoplateforme IGN,
// gratuit et sans clé, modèle RGE ALTI. Même logique côté Kotlin (Trails.kt).
import { distanceM } from '../gps/adaptive';
import { OSM_ATTRIBUTION, type LonLat, type Trail } from './osmTrails';

const URL_ALTI = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json';
/** Points par requête (l'URL reste courte). */
export const ALTI_CHUNK = 100;
/** Au plus autant de points interrogés par rando, espacés d'au moins 10 m. */
export const MAX_SAMPLES = 1500;
/** Seuil de dénivelé : le modèle de terrain est peu bruité, 5 m suffisent. */
export const DEM_THRESHOLD_M = 5;

export interface ElevatedTrail { segments: (LonLat & { ele: number | null })[][]; gainM: number; lossM: number }

/** Indices des points à interroger dans chaque segment (premier et dernier toujours compris). */
export function sampleIndices(segments: LonLat[][], totalM: number): number[][] {
  const step = Math.max(10, totalM / MAX_SAMPLES);
  return segments.map((seg) => {
    const idx = [0];
    let acc = 0;
    for (let i = 1; i < seg.length; i++) {
      acc += distanceM(seg[i - 1], seg[i]);
      if (acc >= step || i === seg.length - 1) { idx.push(i); acc = 0; }
    }
    return seg.length > 1 ? idx : [0];
  });
}

/** Altitudes de tous les points, par interpolation le long du chemin entre les points interrogés. */
export function interpolate(seg: LonLat[], idx: number[], z: (number | null)[]): (number | null)[] {
  const out: (number | null)[] = new Array(seg.length).fill(null);
  idx.forEach((i, k) => { out[i] = z[k]; });
  for (let k = 1; k < idx.length; k++) {
    const a = idx[k - 1], b = idx[k], za = z[k - 1], zb = z[k];
    if (za === null || zb === null || b - a < 2) continue;
    let total = 0;
    for (let i = a + 1; i <= b; i++) total += distanceM(seg[i - 1], seg[i]);
    let acc = 0;
    for (let i = a + 1; i < b; i++) {
      acc += distanceM(seg[i - 1], seg[i]);
      out[i] = za + (zb - za) * (total ? acc / total : 0);
    }
  }
  return out;
}

/** D+ et D− avec hystérésis, sur les points interrogés (même règle que l'enregistrement). */
export function gainLoss(zs: (number | null)[], threshold = DEM_THRESHOLD_M) {
  let gain = 0, loss = 0, ref: number | null = null;
  for (const z of zs) {
    if (z === null) continue;
    if (ref === null) ref = z;
    else if (z - ref >= threshold) { gain += z - ref; ref = z; }
    else if (ref - z >= threshold) { loss += ref - z; ref = z; }
  }
  return { gain, loss };
}

/** Lit la réponse IGN : { elevations: [z…] } (zonly) ou { elevations: [{ z }…] } ; −99999 = pas de donnée. */
export function parseElevations(json: { elevations?: (number | { z: number })[] }): (number | null)[] {
  return (json.elevations ?? []).map((e) => {
    const z = typeof e === 'number' ? e : e?.z;
    return typeof z === 'number' && z > -1000 ? z : null;
  });
}

async function fetchChunk(pts: LonLat[], signal?: AbortSignal): Promise<(number | null)[]> {
  const q = new URLSearchParams({
    lon: pts.map((p) => p.lon.toFixed(6)).join('|'),
    lat: pts.map((p) => p.lat.toFixed(6)).join('|'),
    resource: 'ign_rge_alti_wld', delimiter: '|', indent: 'false', measures: 'false', zonly: 'true',
  });
  const res = await fetch(`${URL_ALTI}?${q}`, { signal });
  if (!res.ok) throw new Error(`altitudes HTTP ${res.status}`);
  const z = parseElevations(await res.json());
  return pts.map((_, i) => z[i] ?? null);
}

export async function elevate(trail: Trail, signal?: AbortSignal): Promise<ElevatedTrail> {
  const idx = sampleIndices(trail.segments, trail.distanceM);
  const pts = trail.segments.flatMap((seg, s) => idx[s].map((i) => seg[i]));
  const zs: (number | null)[] = [];
  for (let i = 0; i < pts.length; i += ALTI_CHUNK) zs.push(...await fetchChunk(pts.slice(i, i + ALTI_CHUNK), signal));
  let k = 0;
  const segments = trail.segments.map((seg, s) => {
    const z = idx[s].map(() => zs[k++]);
    const all = interpolate(seg, idx[s], z);
    return seg.map((p, i) => ({ ...p, ele: all[i] }));
  });
  const { gain, loss } = gainLoss(zs);
  return { segments, gainM: gain, lossM: loss };
}

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

/** GPX d'une rando OSM : un segment par morceau continu, source et licence dans les métadonnées. */
export function trailToGpx(trail: Trail, segments: (LonLat & { ele?: number | null })[][]): string {
  const segs = segments.map((seg) => '    <trkseg>\n' + seg.map((p) =>
    `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${p.ele != null ? `<ele>${p.ele.toFixed(1)}</ele>` : ''}</trkpt>`).join('\n') + '\n    </trkseg>').join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Assomoutain Rando" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${esc(trail.name)}</name>
    <copyright author="OpenStreetMap contributors"><license>https://opendatacommons.org/licenses/odbl/</license></copyright>
    <link href="https://www.openstreetmap.org/relation/${trail.id}"><text>${esc(OSM_ATTRIBUTION)}</text></link>
  </metadata>
  <trk>
    <name>${esc(trail.name)}</name>
${segs}
  </trk>
</gpx>
`;
}
