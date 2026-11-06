import { useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { fetchTopo, savedTopo, topoRowOf, type TopoSheet } from './ski/skitour';
import { storedPhoto } from './ski/photoStore';

/** Une photo : la copie gardée sur le téléphone si elle existe, sinon celle de skitour.fr. */
function Photo({ url, alt, onOpen }: { url: string; alt: string; onOpen?: () => void }) {
  const [src, setSrc] = useState(url);
  useEffect(() => {
    let u: string | null = null, live = true;
    void storedPhoto(url).then((x) => { u = x; if (live && x) setSrc(x); });
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [url]);
  return <img src={src} alt={alt} loading="lazy" onClick={onOpen} />;
}

const go = (url: string) => { if (url) window.open(url, '_system'); };
/** Itinéraire Google Maps jusqu'au départ (sinon recherche par nom). */
export const gmapsTo = (p: { nom: string; lat?: number | null; lon?: number | null }, massif = '') =>
  p.lat != null && p.lon != null ? `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.nom} ${massif}`)}`;

/**
 * Fiche d'un topo dans l'appli : infos, départ (Google Maps), présentation, itinéraire… ; les 50 derniers ouverts sont
 * gardés sur le téléphone. Le bouton retour d'Android fait comme « ← ».
 */
export function TopoView({ topo, password, backLabel, onBack, onClose, onMap }: {
  topo: { id: number; nom: string; url: string }; password: string; backLabel: string; onBack: () => void; onClose: () => void;
  /** « 🗺 Sur la carte » : carte des topos centrée sur celui-ci (départ, sommets, itinéraire). */
  onMap?: (t: TopoSheet) => void;
}) {
  const [t, setT] = useState<TopoSheet | null>(() => savedTopo(topo.id));
  const [msg, setMsg] = useState('');
  const [big, setBig] = useState<number | null>(null);
  const bigRef = useRef<number | null>(null);
  bigRef.current = big;
  useEffect(() => {
    let live = true;
    const saved = savedTopo(topo.id);
    setT(saved); setMsg(saved ? '' : 'Chargement du topo…');
    fetchTopo(topo.id, password)
      .then((x) => { if (live) { setT(x); setMsg(''); } })
      .catch((e) => { if (live) setMsg(saved ? '📴 Hors ligne : topo gardé sur le téléphone.' : `Topo impossible : ${e instanceof TypeError ? 'pas de réseau' : (e as Error).message}`); });
    return () => { live = false; };
  }, [topo.id, password]);
  useEffect(() => {
    let sub: { remove: () => void } | null = null, live = true;
    void CapApp.addListener('backButton', () => { if (bigRef.current != null) setBig(null); else onBack(); }).then((h) => { if (live) sub = h; else void h.remove(); }).catch(() => { /* web */ });
    return () => { live = false; sub?.remove(); };
  }, [onBack]);
  const photos = t?.photos ?? [];
  const pt = (p: { nom: string; altitude?: number | null }) => p.nom + (p.altitude ? ` (${p.altitude} m)` : '');
  const info: [string, React.ReactNode][] = t ? [
    ['Massif', t.massif],
    ['Départ', t.depart ? <span className="ski-link">{pt(t.depart)}
      <button className="ski-pin" onClick={() => go(gmapsTo(t.depart!, t.massif))} aria-label={`${t.depart.nom} dans Google Maps`}>🚗 Google Maps</button></span> : ''],
    [`Sommet${t.sommets.length > 1 ? 's' : ''}`, t.sommets.map(pt).join(', ')],
    ['Orientation', t.orientation], ['Dénivelé', t.denivele ? `${t.denivele} m` : ''], ['Ski', t.dif_ski],
    ['Difficulté', t.difficulte], ['Exposition', t.expo], ['Auteur', t.auteur],
  ] : [];
  const sections: [string, string][] = t ? [['Présentation', t.presentation], ['Itinéraire', t.itineraire], ['Variantes', t.variantes],
    ['Remarques', t.remarques], ['Matériel', t.materiel], ['Bibliographie', t.biblio ?? '']] : [];
  return (
    <div className="ski-page">
      <div className="travel-head"><button onClick={onBack}>← {backLabel}</button>
        <span className="head-btns"><button onClick={onClose} aria-label="Fermer">✕</button></span></div>
      <div className="ski-title"><h2>📖 {t?.nom || topo.nom}</h2></div>
      {msg && <p className="hint">{msg}</p>}
      <dl className="ski-info">{info.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k} :</dt><dd>{v}</dd></div>)}</dl>
      {sections.filter(([, v]) => v).map(([k, v]) => <div key={k}><h3>{k}</h3><p className="ski-text">{v}</p></div>)}
      {photos.length > 0 && <><h3>Photos</h3>
        <div className="ski-photos">{photos.map((p, i) => <figure key={p.url}><Photo url={p.url} alt={p.legende || `Photo de ${p.auteur}`} onOpen={() => setBig(i)} /><figcaption>© {p.auteur}</figcaption></figure>)}</div></>}
      {big != null && photos[big] && <div className="ski-big" onClick={() => setBig(null)}>
        <button className="ski-big-close" onClick={() => setBig(null)} aria-label="Fermer la photo">✕</button>
        <Photo url={photos[big].url} alt={photos[big].legende} />
        <p>{photos[big].legende}{photos[big].legende ? ' · ' : ''}© {photos[big].auteur} · skitour.fr</p>
        <div className="row">
          <button disabled={big === 0} onClick={(e) => { e.stopPropagation(); setBig(big - 1); }}>‹</button>
          <span>{big + 1} / {photos.length}</span>
          <button disabled={big === photos.length - 1} onClick={(e) => { e.stopPropagation(); setBig(big + 1); }}>›</button>
        </div>
      </div>}
      <div className="row">
        {onMap && t && topoRowOf(t) && <button className="primary" onClick={() => onMap(t)}>🗺 Sur la carte</button>}
        <button className={onMap && t && topoRowOf(t) ? '' : 'primary'} onClick={() => go(topo.url)}>Voir sur skitour.fr</button>
        {t?.gpx && <button className="ski-gpx-btn" onClick={() => go(t.gpx)}>GPX</button>}
      </div>
      <p className="hint">Topo de {t?.auteur || 'skitour.fr'} sur skitour.fr, non modifié.</p>
    </div>
  );
}
