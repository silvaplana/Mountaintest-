// Trace chargée depuis un fichier du téléphone (GPX, KML ou GeoJSON) : elle devient la trace violette,
// celle sur laquelle on peut naviguer. Même lecture côté Kotlin (TraceFile.kt).
import type { LonLat } from './osmTrails';

export interface FileTrace { name: string; line: LonLat[] }

/** Extensions et types proposés par le sélecteur de fichier. */
export const TRACE_FILE_ACCEPT = '.gpx,.kml,.geojson,.json,application/gpx+xml,application/vnd.google-earth.kml+xml,application/geo+json,application/json';

const ok = (p: LonLat) => Number.isFinite(p.lon) && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

/** Nom du fichier sans son extension, utilisé quand le fichier ne donne pas de nom. */
export function baseName(fileName: string) {
  return fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').trim() || 'Trace chargée';
}

function parseXml(text: string) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('fichier illisible');
  return doc;
}

const tags = (n: Document | Element, name: string) => [...n.getElementsByTagNameNS('*', name)];
const firstText = (n: Document | Element, name: string) => tags(n, name)[0]?.textContent?.trim() || '';

function fromGpx(doc: Document): FileTrace {
  // Les segments de trace (trkseg), à défaut les routes (rte), mis bout à bout.
  let pts = tags(doc, 'trkpt');
  if (!pts.length) pts = tags(doc, 'rtept');
  const line = pts.map((n) => ({ lon: Number(n.getAttribute('lon')), lat: Number(n.getAttribute('lat')) }));
  const holder = tags(doc, 'trk')[0] ?? tags(doc, 'rte')[0] ?? tags(doc, 'metadata')[0];
  return { name: (holder && firstText(holder, 'name')) || firstText(doc, 'name'), line };
}

function fromKml(doc: Document): FileTrace {
  const line: LonLat[] = [];
  // <LineString><coordinates>lon,lat[,alt] …</coordinates>
  for (const ls of tags(doc, 'LineString')) {
    for (const c of firstText(ls, 'coordinates').split(/\s+/)) {
      const [lon, lat] = c.split(',').map(Number);
      if (c) line.push({ lon, lat });
    }
  }
  // <gx:Track><gx:coord>lon lat alt</gx:coord>
  if (!line.length) {
    for (const c of tags(doc, 'coord')) {
      const [lon, lat] = (c.textContent ?? '').trim().split(/\s+/).map(Number);
      line.push({ lon, lat });
    }
  }
  const pm = tags(doc, 'Placemark').find((p) => tags(p, 'LineString').length || tags(p, 'Track').length);
  return { name: (pm && firstText(pm, 'name')) || firstText(doc, 'name'), line };
}

function fromGeoJson(text: string): FileTrace {
  const root = JSON.parse(text);
  const line: LonLat[] = [];
  let name = '';
  const add = (cs: unknown) => (cs as number[][]).forEach((c) => line.push({ lon: Number(c[0]), lat: Number(c[1]) }));
  const geom = (g: { type?: string; coordinates?: unknown; geometries?: unknown[] } | null | undefined) => {
    if (!g) return;
    if (g.type === 'LineString') add(g.coordinates);
    else if (g.type === 'MultiLineString') (g.coordinates as unknown[]).forEach(add);
    else if (g.type === 'GeometryCollection') (g.geometries as never[]).forEach(geom);
  };
  const feat = (f: { type?: string; geometry?: never; properties?: { name?: string } }) => {
    const before = line.length;
    geom(f.geometry);
    if (!name && line.length > before && f.properties?.name) name = String(f.properties.name);
  };
  if (root?.type === 'FeatureCollection') (root.features ?? []).forEach(feat);
  else if (root?.type === 'Feature') feat(root);
  else geom(root);
  return { name: name || (root?.name ? String(root.name) : ''), line };
}

/** Lit un fichier de trace d'après son contenu (le nom du fichier sert de secours pour le nom). */
export function parseTraceFile(text: string, fileName = ''): FileTrace {
  const t = text.replace(/^﻿/, '').trimStart();
  let res: FileTrace;
  if (t.startsWith('{') || t.startsWith('[')) res = fromGeoJson(t);
  else {
    const doc = parseXml(t);
    const root = doc.documentElement.localName.toLowerCase();
    if (root === 'gpx') res = fromGpx(doc);
    else if (root === 'kml') res = fromKml(doc);
    else throw new Error('format inconnu (GPX, KML ou GeoJSON attendu)');
  }
  const line = res.line.filter(ok);
  if (line.length < 2) throw new Error('aucune trace dans ce fichier');
  return { name: res.name || baseName(fileName), line };
}
