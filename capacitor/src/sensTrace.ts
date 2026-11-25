import type { Map as MlMap, SymbolLayerSpecification } from 'maplibre-gl';

/**
 * Sens d'une trace sur la carte (Seb, 25/11, maquette « Sens de la trace », variante B) : rond vert ▶ au départ,
 * rond à damier à l'arrivée, petites flèches blanches le long du trait. Images dessinées ici, sans fichier.
 */
const R = 2; // pixels de l'image par pixel d'écran (net sur les écrans fins)

function image(taille: number, dessin: (c: CanvasRenderingContext2D, t: number) => void) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = taille * R;
  const c = cv.getContext('2d')!;
  c.scale(R, R);
  dessin(c, taille);
  return c.getImageData(0, 0, taille * R, taille * R);
}

export function ajouterImagesSens(m: MlMap) {
  if (typeof document === 'undefined' || !document.createElement('canvas').getContext('2d')) return;
  const D = 30, r = 12.5;
  m.addImage('sens-depart', image(D, (c) => {
    c.beginPath(); c.arc(D / 2, D / 2, r, 0, 7); c.fillStyle = '#1f9d55'; c.fill();
    c.lineWidth = 3; c.strokeStyle = '#fff'; c.stroke();
    c.beginPath(); c.moveTo(11.5, 9); c.lineTo(21.5, 15); c.lineTo(11.5, 21); c.closePath(); c.fillStyle = '#fff'; c.fill();
  }), { pixelRatio: R });
  m.addImage('sens-arrivee', image(D, (c) => {
    c.save(); c.beginPath(); c.arc(D / 2, D / 2, r - 1.5, 0, 7); c.clip();
    c.fillStyle = '#fff'; c.fillRect(0, 0, D, D); c.fillStyle = '#1d2421';
    const k = 5;
    for (let i = 0; i < D / k; i++) for (let j = 0; j < D / k; j++) if ((i + j) % 2) c.fillRect(i * k, j * k, k, k);
    c.restore();
    c.beginPath(); c.arc(D / 2, D / 2, r, 0, 7); c.lineWidth = 3; c.strokeStyle = '#1d2421'; c.stroke();
  }), { pixelRatio: R });
  // Chevron pointé vers la droite : MapLibre le tourne dans le sens du trait.
  m.addImage('sens-fleche', image(18, (c) => {
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(6, 4); c.lineTo(12, 9); c.lineTo(6, 14);
    c.strokeStyle = '#0008'; c.lineWidth = 4.6; c.stroke();
    c.strokeStyle = '#fff'; c.lineWidth = 2.6; c.stroke();
  }), { pixelRatio: R });
}

export const SENS_LAYOUT: SymbolLayerSpecification['layout'] = {
  'symbol-placement': 'line', 'symbol-spacing': 70, 'icon-image': 'sens-fleche',
  'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
};
