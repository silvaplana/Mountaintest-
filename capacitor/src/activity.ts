// ⛷ / 🚵 / 🥾 : l'appli marche un peu différemment en ski de rando, en VTT et en rando (appui long sur
// le bouton pour passer de l'un à l'autre, choix gardé). ⛷ : sorties skitour récentes. 🚵 et 🥾 : tous les
// itinéraires Camptocamp de l'écran, sans date. 🚵 : durée à vélo, pente d'abord en %, type de chemin.
// Même réglage côté Kotlin (préférence « activite »).
export type Activity = 'ski' | 'vtt' | 'rando';
/** Ordre de l'appui long, et icône de chaque mode. */
export const NEXT_ACTIVITY: Record<Activity, Activity> = { ski: 'vtt', vtt: 'rando', rando: 'ski' };
export const ACTIVITY_ICON: Record<Activity, string> = { ski: '⛷', vtt: '🚵', rando: '🥾' };
const KEY = 'activite';

export function loadActivity(): Activity {
  try { const v = localStorage.getItem(KEY); return v === 'vtt' || v === 'rando' ? v : 'ski'; } catch { return 'ski'; }
}
export function saveActivity(a: Activity) {
  try { localStorage.setItem(KEY, a); } catch { /* ignoré */ }
}
