/**
 * Le point qu'on trace ou qu'on fait glisser se pose environ 1 cm au-dessus du doigt, pour qu'on le voie
 * (Seb, 25/11 : « le doigt est gros »). 1 cm ≈ 38 px CSS.
 */
export const DOIGT_PX = 40;
/** Et un peu de côté, à l'opposé de la main : en haut à gauche pour un droitier, à droite pour un gaucher. */
export const COTE_PX = 24;

export type Main = 'droitier' | 'gaucher';

/** Main choisie dans 👤 Mon compte, gardée sur le téléphone ; droitier si rien n'est choisi. */
export function main(): Main {
  try { return localStorage.getItem('main') === 'gaucher' ? 'gaucher' : 'droitier'; } catch { return 'droitier'; }
}
export function choisirMain(m: Main) {
  try { localStorage.setItem('main', m); } catch { /* rien : on reste droitier */ }
  appliquerMain();
}
/** Gaucher : la colonne d'icônes passe à gauche et le reste à droite (classe `gaucher` sur la page, voir styles.css). */
export function appliquerMain() {
  document.documentElement.classList.toggle('gaucher', main() === 'gaucher');
}

/** Décalage [x, y] en px du point par rapport au doigt. */
export function decalage(): [number, number] {
  return [main() === 'gaucher' ? COTE_PX : -COTE_PX, -DOIGT_PX];
}
