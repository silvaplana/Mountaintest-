// 🎥 Écran caché du film (Seb, 25/11) : une deuxième carte, de la taille de l'écran mais hors de vue, sur laquelle
// le film se fabrique. La carte de l'appli reste libre : on peut fermer le panneau du film et continuer.
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';
import { ajouterImagesSens } from '../sensTrace';

/** Copie cachée de la carte (même fond, mêmes traces, relief 3D). `retirer` la détruit. */
export async function carteCachee(map: MlMap, signal: AbortSignal): Promise<{ carte: MlMap; retirer: () => void }> {
  const src = map.getContainer(), el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = `position:fixed;left:-300vw;top:0;width:${src.clientWidth}px;height:${src.clientHeight}px;pointer-events:none`;
  document.body.appendChild(el);
  const carte = new maplibregl.Map({
    container: el, style: map.getStyle(), center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(),
    maxZoom: map.getMaxZoom(), maxPitch: map.getMaxPitch(), pixelRatio: map.getPixelRatio(), fadeDuration: 0, attributionControl: false, interactive: false,
  });
  const retirer = () => { carte.remove(); el.remove(); };
  const charge = await new Promise<boolean>((ok) => {
    const fin = (v: boolean) => { clearTimeout(t); signal.removeEventListener('abort', non); ok(v); };
    const non = () => fin(false), t = setTimeout(non, 20_000);
    signal.addEventListener('abort', non);
    carte.once('load', () => fin(true));
  });
  if (!charge) { retirer(); throw new Error(signal.aborted ? 'arrêté' : 'carte du film indisponible'); }
  ajouterImagesSens(carte);
  // Pas de flèches de sens dans le film (Seb, 26/11 : « pas trop beau ») ; le départ et l'arrivée restent.
  for (const id of ['trails-sens', 'trail-sel-sens']) if (carte.getLayer(id)) carte.setLayoutProperty(id, 'visibility', 'none');
  // Le relief se pose quand on incline la carte de l'appli (MapView) ; ici il y est toujours.
  carte.setTerrain({ source: 'relief', exaggeration: 1 });
  const ciel = map.getSky();
  if (ciel) carte.setSky(ciel);
  return { carte, retirer };
}
