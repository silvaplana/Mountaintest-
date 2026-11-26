// Dernières sorties et groupes ouverts (Seb, 25/11) : proposés en premier pour associer une trace.
import type { Sortie } from './store';

const KEY = 'buddiesOuverts';
const MAX = 12;

type Ouverts = { sorties: string[]; groupes: string[] };

function lireOuverts(): Ouverts {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { sorties: Array.isArray(o.sorties) ? o.sorties.map(String) : [], groupes: Array.isArray(o.groupes) ? o.groupes.map(String) : [] };
  } catch { return { sorties: [], groupes: [] }; }
}

/** On vient d'ouvrir cette sortie ou ce groupe : il passe en tête. */
export function noterOuvert(quoi: 'sorties' | 'groupes', id: string) {
  const o = lireOuverts();
  o[quoi] = [id, ...o[quoi].filter((x) => x !== id)].slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* ignoré */ }
}

/** Identifiants des derniers ouverts, le plus récent d'abord. */
export const derniersOuverts = (quoi: 'sorties' | 'groupes') => lireOuverts()[quoi];

/** Trie par dernier ouvert ; ceux jamais ouverts gardent leur ordre, après. */
export function parDernierOuvert<T extends { id: string }>(l: T[], ouverts: string[]): T[] {
  const rang = (x: T) => { const i = ouverts.indexOf(x.id); return i < 0 ? ouverts.length : i; };
  return l.map((x, i) => ({ x, i })).sort((a, b) => rang(a.x) - rang(b.x) || a.i - b.i).map((y) => y.x);
}

/** Lien d'une de mes traces : un groupe, et de préférence un de ses sorties (Seb, 25/11). */
export type LienBuddy = { groupe: string; sortie: string | null };

/** Nom affiché du lien : la sortie (et son groupe), ou le groupe seul. */
export function nomLien(l: LienBuddy, sorties: Sortie[], groupes: { id: string; nom: string; nature: string }[]) {
  const g = groupes.find((x) => x.id === l.groupe), x = l.sortie ? sorties.find((y) => y.id === l.sortie) : undefined;
  const gn = g ? (g.nature === 'me_time' ? 'Me Time' : g.nom) : '';
  return x ? { titre: x.nom, sous: gn, sortie: x } : { titre: gn || 'Groupe', sous: 'tout le groupe', sortie: undefined };
}
