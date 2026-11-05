import { useEffect, useRef, useState } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import { allSavedTopos, fetchToposNear, savedToposNear, topoLine, type TopoRow } from './ski/skitour';
import { SkiTabs, type SkiMode } from './SkiTabs';

/** En dessous de ce zoom, on ne cherche pas de topos (l'API les donne autour d'un point). */
export const TOPO_MIN_ZOOM = 9;

/**
 * 🗺 Carte topos : un point orange par topo (à son départ) autour de l'écran affiché. Les topos sont demandés au relais
 * par cases de 0,1° (gardées 7 jours sur le téléphone et le serveur, pour ménager le quota skitour).
 */
export function TopoMapPanel({ map, password, topos, selected, onTopos, onSelect, onOpen, onMode, onClose, hidden }: {
  map: MlMap; password: string; topos: TopoRow[]; selected: number | null; hidden?: boolean;
  onTopos: (t: TopoRow[]) => void; onSelect: (i: number | null) => void; onOpen: (t: TopoRow) => void;
  onMode: (m: SkiMode) => void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [tooFar, setTooFar] = useState(false);
  const [low, setLow] = useState(true);
  const selId = useRef<number | null>(null);
  selId.current = selected != null ? topos[selected]?.id ?? null : null;
  useEffect(() => {
    let timer = 0, live = true;
    const show = () => {
      const far = map.getZoom() < TOPO_MIN_ZOOM;
      setTooFar(far);
      const b = map.getBounds();
      const vis = far ? [] : allSavedTopos().filter((t) => t.depart?.lat != null && t.depart.lon != null
        && t.depart.lon >= b.getWest() && t.depart.lon <= b.getEast() && t.depart.lat >= b.getSouth() && t.depart.lat <= b.getNorth()).slice(0, 300);
      onTopos(vis);
      const k = vis.findIndex((t) => t.id === selId.current);
      onSelect(k >= 0 ? k : null);
    };
    const update = () => {
      show();
      window.clearTimeout(timer);
      if (map.getZoom() < TOPO_MIN_ZOOM) return;
      const c = map.getCenter();
      if (savedToposNear(c.lat, c.lng)) return;
      timer = window.setTimeout(() => {
        setBusy(true); setMsg('');
        fetchToposNear(c.lat, c.lng, password)
          .then(() => { if (live) show(); })
          .catch((e) => { if (live) setMsg(`Topos impossibles : ${e instanceof TypeError ? 'pas de réseau' : (e as Error).message}`); })
          .finally(() => { if (live) setBusy(false); });
      }, 1000);
    };
    update();
    map.on('moveend', update);
    return () => { live = false; window.clearTimeout(timer); map.off('moveend', update); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, password]);
  const sel = selected != null ? topos[selected] : null;
  const head = (<>
    <SkiTabs mode="carteTopos" onMode={onMode} />
    <div className="travel-head ski-head"><span className="hint">{busy ? 'Recherche…' : tooFar ? 'Zoome pour voir les topos' : `${topos.length} topo${topos.length > 1 ? 's' : ''}`}</span>
      <span className="head-btns">
        <button onClick={() => setLow(!low)} aria-label={low ? 'Agrandir le panneau' : 'Réduire le panneau'}>{low ? '▴' : '▾'}</button>
        <button onClick={onClose} aria-label="Fermer">✕</button>
      </span></div>
  </>);
  if (low) return <div className="travel" hidden={hidden}>{head}{msg && <p className="error">{msg}</p>}</div>;
  return (
    <div className="travel" hidden={hidden}>
      {head}
      {msg && <p className="error">{msg}</p>}
      {sel && <div className="cost">
        <p><b>{sel.nom}</b></p>
        <p className="hint">{[sel.massif, topoLine(sel)].filter(Boolean).join(' · ')}</p>
        <span className="row"><button className="primary" onClick={() => onOpen(sel)}>Fiche du topo</button></span>
      </div>}
      <ul className="routes lodgings">
        {topos.map((t, i) => (
          <li key={t.id}><button className={i === selected ? 'sel' : ''} onClick={() => onSelect(i)}>
            <b>{t.nom}</b><span>{topoLine(t)}</span></button></li>))}
      </ul>
      <p className="hint">Topos skitour.fr, placés à leur départ.</p>
    </div>
  );
}
