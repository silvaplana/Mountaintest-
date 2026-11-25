/**
 * Le point qu'on trace ou qu'on fait glisser se pose environ 1 cm au-dessus du doigt, pour qu'on le voie
 * (Seb, 25/11 : « le doigt est gros »). 1 cm ≈ 38 px CSS.
 */
export const DOIGT_PX = 40;
/** Et un peu de côté, à l'opposé de la main : en haut à gauche pour un droitier, à droite pour un gaucher. */
export const COTE_PX = 24;

export type Main = 'aucun' | 'droitier' | 'gaucher';

/** Décalage choisi dans 👤 Mon compte, gardé sur le téléphone ; aucun par défaut (Seb, 25/11 : « perturbant »). */
export function main(): Main {
  try { const v = localStorage.getItem('main'); return v === 'gaucher' || v === 'droitier' ? v : 'aucun'; } catch { return 'aucun'; }
}
export function choisirMain(m: Main) {
  try { localStorage.setItem('main', m); } catch { /* rien : pas de décalage */ }
}

/** Colonne d'icônes à droite (par défaut) ou à gauche : réglage à part de la main (Seb, 25/11). */
export function iconesAGauche(): boolean {
  try { return localStorage.getItem('icones') === 'gauche'; } catch { return false; }
}
export function choisirIcones(gauche: boolean) {
  try { localStorage.setItem('icones', gauche ? 'gauche' : 'droite'); } catch { /* rien : à droite */ }
  appliquerIcones();
}
/** Icônes à gauche : la colonne passe à gauche et le reste à droite (classe `icones-gauche` sur la page, voir styles.css). */
export function appliquerIcones() {
  document.documentElement.classList.toggle('icones-gauche', iconesAGauche());
}

/** Décalage [x, y] en px du point par rapport au doigt. */
export function decalage(): [number, number] {
  const m = main();
  return m === 'aucun' ? [0, 0] : [m === 'gaucher' ? COTE_PX : -COTE_PX, -DOIGT_PX];
}
