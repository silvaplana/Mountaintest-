/**
 * Barre d'échelle de la carte : longueur « ronde » (1, 2 ou 5 × 10^n mètres) la plus grande
 * qui tient dans la largeur maximale. Même calcul dans l'appli Kotlin (ScaleBar.kt).
 */
export interface Scale { meters: number; px: number; label: string }

/** Mètres par pixel CSS (MapLibre : tuile de 512 px au zoom 0, projection Mercator). */
export function metersPerPx(lat: number, zoom: number): number {
  return (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

export function scaleLabel(m: number): string {
  return m >= 1000 ? `${(m / 1000).toLocaleString('fr-FR')} km` : `${m} m`;
}

export function niceScale(mPerPx: number, maxPx = 110): Scale {
  const max = mPerPx * maxPx;
  const pow = 10 ** Math.floor(Math.log10(max));
  const meters = [5, 2, 1].map((k) => k * pow).find((v) => v <= max) ?? pow;
  return { meters, px: meters / mPerPx, label: scaleLabel(meters) };
}
