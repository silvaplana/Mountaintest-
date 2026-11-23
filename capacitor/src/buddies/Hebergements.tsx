import { useEffect } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';
import { searchPlaces } from '../search';
import type { Lodging } from '../Lodging';
import { Visage } from './Buddies';
import { lire, mettreCoeur, proposerHebergement, retenirHebergement, retirerHebergement, type Hebergement, type Sortie } from './store';

/**
 * Hébergement d'un Buddy Time (spec/buddies.md §5.11, écrans 9 et 23) : « Où on dort ? », les idées proposées par
 * chacun depuis la recherche, un ♥ par buddy, ✅ celui qu'on retient ; les épingles 🏨 sur la carte.
 * Mêmes écrans côté Kotlin (BuddiesPanel.kt, SharePanel.kt).
 */

/** Une image selon la nature : refuge, gîte, hôtel, camping… */
export function iconeHebergement(nature: string) {
  const n = nature.toLowerCase();
  return /refuge|cabane/.test(n) ? '🏔' : /camping|bivouac/.test(n) ? '⛺' : /hôtel|hotel/.test(n) ? '🏨' : /chalet/.test(n) ? '🛖' : '🏠';
}
export const prixHebergement = (h: { prix_nuit: number | null }) => (h.prix_nuit != null ? `${h.prix_nuit} € / nuit` : 'prix à voir');

/** Écran 9 : « Où on dort ? ». */
export function OuOnDort({ x, hebergements, onChercher, onRetour, onClose, onToast }: {
  x: Sortie; hebergements: Hebergement[]; onChercher: () => void; onRetour: () => void; onClose: () => void; onToast: (m: string) => void;
}) {
  const moi = lire().moi ?? 'moi';
  const hs = hebergements.filter((h) => h.sortie === x.id);
  const nuits = Math.max(0, Math.round((new Date(x.fin).getTime() - new Date(x.debut).getTime()) / 86_400_000));
  const qui = (id: string) => x.participants.find((p) => p.id === id) ?? { id, pseudo: '?', photo: null };
  return <div className="bd-corps bd-dodo">
    <div className="xp-head">
      <button onClick={onRetour} aria-label="Retour">‹</button>
      <span className="bd-titre"><b>{x.nom}</b><small>🏨 {nuits ? `${nuits} nuit${nuits > 1 ? 's' : ''}` : 'sur la journée'} · {x.participants.length} personne{x.participants.length > 1 ? 's' : ''}</small></span>
      <button onClick={onClose} aria-label="Fermer">✕</button>
    </div>
    <div className="bd-entre"><b className="bd-gros">Où on dort ?</b><small>{hs.length ? `${hs.length} idée${hs.length > 1 ? 's' : ''}` : ''}</small></div>
    {hs.map((h) => {
      const aime = h.coeurs.includes(moi);
      return <div key={h.id} className={`bd-heberg${h.retenu ? ' retenu' : ''}`}>
        <button className="bd-heberg-haut" onClick={() => h.url && window.open(h.url, '_system')} aria-label={`Voir ${h.nom}`}>
          <span className="bd-heberg-image">{iconeHebergement(h.nature)}</span>
          <span className="bd-texte"><b>{h.nom}</b><small>{[prixHebergement(h), h.nature, h.adresse].filter(Boolean).join(' · ')}</small>
            {h.resume && <small>{h.resume}</small>}</span>
          {h.retenu && <span className="bd-heberg-ok">✅</span>}
        </button>
        <div className="bd-heberg-bas">
          <button className={`bd-coeur${aime ? ' oui' : ''}`} aria-label={aime ? 'Retirer mon ♥' : 'Mettre un ♥'} onClick={() => mettreCoeur(h.id, !aime)}>{aime ? '♥' : '♡'}</button>
          <span className="bd-carte-qui">{h.coeurs.map((c) => <Visage key={c} b={qui(c)} taille={30} />)}{!h.coeurs.length && <small>pas encore de ♥</small>}</span>
          <span style={{ flex: 1 }} />
          <button className="bd-lien" onClick={() => { retenirHebergement(h.id, !h.retenu); onToast(h.retenu ? `« ${h.nom} » n'est plus retenu` : `✅ On dort à « ${h.nom} »`); }}>
            {h.retenu ? 'Plus retenu' : 'On le prend'}</button>
        </div>
        {h.attente && <small className="hint">🕓 partira au retour du réseau</small>}
        {!h.retenu && <button className="bd-lien petit" onClick={() => { retirerHebergement(h.id); onToast(`« ${h.nom} » retiré`); }}>Retirer l'idée</button>}
      </div>;
    })}
    {!hs.length && <p className="bd-vide">Pas encore d'idée : cherche un hébergement, puis « Proposer à mes buddies ». Chacun met un ♥, et vous en retenez un.</p>}
    <span style={{ flex: 1 }} />
    <button className="bd-grand" onClick={onChercher}>🔍 Chercher {hs.length ? "d'autres hébergements" : 'un hébergement'}</button>
  </div>;
}

/** Les épingles 🏨 sur la carte du Buddy Time ; celle qu'on a retenue en vert. */
export function HebergementsSurCarte({ map, hebergements }: { map: MlMap | null; hebergements: Hebergement[] }) {
  const placees = hebergements.filter((h) => h.lon != null && h.lat != null);
  const cle = placees.map((h) => `${h.id}${h.retenu}`).join();
  useEffect(() => {
    if (!map || !placees.length) return;
    const ms = placees.map((h) => {
      const el = document.createElement('div');
      el.className = `bd-heberg-carte${h.retenu ? ' retenu' : ''}`;
      el.textContent = '🏨';
      el.title = h.nom;
      return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([h.lon!, h.lat!]).addTo(map);
    });
    return () => ms.forEach((m) => m.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, cle]);
  return null;
}

/** Écran 23 : proposer un hébergement trouvé dans des Buddy Times ; placé sur la carte par son adresse (si on la trouve). */
export async function proposer(sorties: string[], l: Lodging) {
  let lon: number | null = null, lat: number | null = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const p = (await searchPlaces((l.adresse || l.nom).trim(), ctrl.signal))[0];
    clearTimeout(t);
    if (p) { lon = Math.round(p.lon * 1e5) / 1e5; lat = Math.round(p.lat * 1e5) / 1e5; }
  } catch { /* sans réseau : pas d'épingle sur la carte */ }
  proposerHebergement(sorties, { nom: l.nom, nature: l.type, prix_nuit: l.prix_nuit == null ? null : Math.round(l.prix_nuit), adresse: l.adresse,
    url: l.url, resume: l.resume, lon, lat });
}
