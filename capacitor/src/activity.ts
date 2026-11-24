// ⛷ / 🚵 / 🚴 / 🚲 / 🥾 : l'appli marche un peu différemment selon le mode (appui long sur le bouton pour passer
// au suivant, choix gardé). ⛷ : sorties skitour récentes. Les autres : tous les itinéraires de l'écran, sans date
// (Camptocamp en 🚵 et 🥾, VisuGPX dans tous). Modes vélo (🚵 VTT, 🚴 route, 🚲 gravel) : durée à vélo, pente
// d'abord en %. Hors ⛷ : type de chemin des traces.
export type Activity = 'ski' | 'vtt' | 'route' | 'gravel' | 'rando';
/** Ordre de l'appui long, et icône de chaque mode. */
export const NEXT_ACTIVITY: Record<Activity, Activity> = { ski: 'vtt', vtt: 'route', route: 'gravel', gravel: 'rando', rando: 'ski' };
export const ACTIVITY_ICON: Record<Activity, string> = { ski: '⛷', vtt: '🚵', route: '🚴', gravel: '🚲', rando: '🥾' };
export const isBike = (a: Activity) => a === 'vtt' || a === 'route' || a === 'gravel';
const KEY = 'activite';

export function loadActivity(): Activity {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'vtt' || v === 'route' || v === 'gravel' || v === 'rando' ? v : 'ski';
  } catch { return 'ski'; }
}
export function saveActivity(a: Activity) {
  try { localStorage.setItem(KEY, a); } catch { /* ignoré */ }
}
