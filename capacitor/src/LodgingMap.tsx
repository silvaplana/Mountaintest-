import { useEffect, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';
import type { Lodging, PlacedLodging } from './Lodging';
import { iconeHebergement } from './buddies/Hebergements';

/** Les épingles 🏨 (avec le prix) ; un toucher ouvre la fiche en bas : voir le site, proposer à mes buddies. */
export function LodgingsOnMap({ map, items, onProposer, onClose }: {
  map: MlMap | null; items: PlacedLodging[]; onProposer: (h: Lodging) => void; onClose: () => void;
}) {
  const [sel, setSel] = useState<PlacedLodging | null>(null);
  useEffect(() => {
    if (!map || !items.length) return;
    const ms = items.map((h) => {
      const el = document.createElement('button');
      el.className = 'lodging-pin';
      el.textContent = `${iconeHebergement(h.type)} ${h.prix_nuit != null ? `${Math.round(h.prix_nuit)} €` : ''}`.trim();
      el.setAttribute('aria-label', h.nom);
      el.onclick = (e) => { e.stopPropagation(); setSel(h); };
      return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([h.lon, h.lat]).addTo(map);
    });
    const lons = items.map((h) => h.lon), lats = items.map((h) => h.lat);
    map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 70, maxZoom: 13, duration: 600 });
    return () => ms.forEach((m) => m.remove());
  }, [map, items]);
  return <div className="lodging-sheet">
    {sel ? <>
      <b>{iconeHebergement(sel.type)} {sel.nom}</b>
      <small>{[sel.prix_nuit != null ? `${Math.round(sel.prix_nuit)} € / nuit` : 'prix ?', sel.type, sel.adresse].filter(Boolean).join(' · ')}</small>
      {sel.resume && <small>{sel.resume}</small>}
      <span>
        {sel.url && <button onClick={() => window.open(sel.url, '_system')}>Voir le site</button>}
        <button onClick={() => onProposer(sel)}>👥 Proposer à mes buddies</button>
      </span>
    </> : <small>{items.length} hébergement{items.length > 1 ? 's' : ''} sur la carte : touche une épingle 🏨</small>}
    <button className="lodging-sheet-close" onClick={onClose} aria-label="Retirer les hébergements de la carte">✕</button>
  </div>;
}
