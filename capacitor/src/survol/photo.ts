// 📷 Photos aériennes de l'IGN (BD ORTHO, licence ouverte Etalab : libre avec la mention « © IGN ») comme fond du
// film, au choix à la place de la carte (Seb, 25/11). Elles sont chargées en direct pendant le tournage seulement
// (« télécharge-les seulement si on fait le film ») : rien n'est gardé sur le téléphone, et hors réseau la carte
// reste visible dessous.
import type { Map as MlMap } from 'maplibre-gl';

const TUILES = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS'
  + '&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg';
const ID = 'survol-photo';
export const CREDIT_PHOTO = '© IGN';

/** Pose les photos par-dessus les cartes (sous les pentes et les traces) ; rend de quoi les retirer. */
export function poserPhoto(map: MlMap): () => void {
  if (!map.getSource(ID)) map.addSource(ID, { type: 'raster', tiles: [TUILES], tileSize: 256, maxzoom: 19, attribution: '© IGN – BD ORTHO®' });
  if (!map.getLayer(ID)) map.addLayer({ id: ID, type: 'raster', source: ID }, map.getLayer('slopes') ? 'slopes' : undefined);
  return () => {
    if (map.getLayer(ID)) map.removeLayer(ID);
    if (map.getSource(ID)) map.removeSource(ID);
  };
}
