// Sources des itinéraires (Camptocamp, VisuGPX, Geotrek) : une seule liste, chaque ligne marquée de sa source.
import { C2C_ATTRIBUTION, c2cLink, type C2cRoute, type C2cSheet } from './c2c';
import { fetchGeotrekSheet, GEOTREK_ATTRIBUTION, savedGeotrekSheet } from './geotrek';
import { fetchVgpxSheet, savedVgpxSheet, VGPX_ATTRIBUTION, vgpxLink } from './visugpx';

export const srcLabel = (r: C2cRoute) => r.srcName ?? (r.src === 'visugpx' ? 'VisuGPX' : 'Camptocamp');

export function srcLink(r: C2cRoute): { url: string; label: string } {
  if (r.src === 'geotrek') return { url: r.link ?? '', label: 'Voir sur le site du territoire' };
  if (r.src === 'visugpx') return { url: vgpxLink(r.vid ?? ''), label: 'Voir sur visugpx.com' };
  return { url: c2cLink(r.id), label: 'Voir sur camptocamp.org' };
}

export const srcAttribution = (r: C2cRoute) =>
  r.src === 'geotrek' ? `${GEOTREK_ATTRIBUTION} (${r.srcName ?? 'Geotrek'}).` : r.src === 'visugpx' ? `${VGPX_ATTRIBUTION}.` : `Texte ${C2C_ATTRIBUTION}, non modifié.`;

/** Fiche d'un itinéraire hors Camptocamp (relais), déjà gardée ou à demander. */
export const savedOtherSheet = (r: C2cRoute) => (r.src === 'geotrek' ? savedGeotrekSheet(r) : savedVgpxSheet(r));
export const fetchOtherSheet = (r: C2cRoute, password: string): Promise<C2cSheet> =>
  (r.src === 'geotrek' ? fetchGeotrekSheet(r, password) : fetchVgpxSheet(r, password));

/** Pastilles de la liste : une par source, touchée pour la masquer ou la remettre (choix gardé, tous modes). */
export type SourceKey = 'c2c' | 'visugpx' | 'geotrek';
export const SOURCES: { key: SourceKey; name: string }[] = [
  { key: 'c2c', name: 'Camptocamp' }, { key: 'visugpx', name: 'VisuGPX' }, { key: 'geotrek', name: 'Geotrek' }];
export const srcKey = (r: C2cRoute): SourceKey => r.src ?? 'c2c';

const HIDDEN_KEY = 'sourcesMasquees';
export function loadHiddenSources(): SourceKey[] {
  try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]') as SourceKey[]; } catch { return []; }
}
export function toggleSource(hidden: SourceKey[], k: SourceKey): SourceKey[] {
  const next = hidden.includes(k) ? hidden.filter((x) => x !== k) : [...hidden, k];
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(next)); } catch { /* plein */ }
  return next;
}
