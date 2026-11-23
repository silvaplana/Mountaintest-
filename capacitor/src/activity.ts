// ⛷ / 🚵 : l'appli marche un peu différemment en ski de rando et en VTT (appui long sur ⛷ pour basculer,
// choix gardé). En 🚵 : circuits VTT au lieu des sorties ski, durée à vélo, pente d'abord en %,
// type de chemin le long des traces. Même réglage côté Kotlin (préférence « activite »).
export type Activity = 'ski' | 'vtt';
const KEY = 'activite';

export function loadActivity(): Activity {
  try { return localStorage.getItem(KEY) === 'vtt' ? 'vtt' : 'ski'; } catch { return 'ski'; }
}
export function saveActivity(a: Activity) {
  try { localStorage.setItem(KEY, a); } catch { /* ignoré */ }
}
