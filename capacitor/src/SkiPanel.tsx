import { useEffect, useRef, useState } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import { fetchDetails, hasDetails, inView, loadAll, outingDate, outingLine, readDetails, withDetails, type Outing } from './ski/skitour';

/** En dessous de ce zoom, l'écran couvre trop de pays : on ne montre pas les points. */
export const SKI_MIN_ZOOM = 7;

/**
 * Sorties skitour.fr de l'écran affiché : toute la liste de la période est chargée une fois, puis filtrée sur l'écran
 * à chaque arrêt de la carte (aucune requête) ; étoiles, skiabilité et parking demandés pour les sorties visibles.
 */
export function SkiPanel({ map, password, outings, selected, onOutings, onSelect, onSheet, onClose }: {
  map: MlMap; password: string; outings: Outing[]; selected: number | null;
  onOutings: (o: Outing[]) => void; onSelect: (i: number | null) => void;
  /** Ouvre la fiche complète de la sortie (façon skitour.fr). */
  onSheet: (o: Outing) => void; onClose: () => void;
}) {
  const [days, setDays] = useState(() => { try { return Math.min(90, Number(localStorage.getItem('skitourJours')) || 30); } catch { return 30; } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState<number | null>(null);
  const [all, setAll] = useState<Outing[]>([]);
  const [tooFar, setTooFar] = useState(false);
  const det = useRef(readDetails());
  const asked = useRef(new Set<number>()); // déjà demandés (une fois par ouverture, même si la réponse manque)
  const selId = useRef<number | null>(null);
  selId.current = selected != null ? outings[selected]?.id ?? null : null;
  useEffect(() => {
    let live = true;
    setBusy(true); setError(''); setOffline(null); setAll([]);
    try { localStorage.setItem('skitourJours', String(days)); } catch { /* ignoré */ }
    loadAll(days, password)
      .then((r) => { if (live) { setAll(r.outings); setOffline(r.offline ?? null); } })
      .catch((e) => { if (live) setError(`Recherche impossible : ${e instanceof TypeError ? 'pas de réseau' : (e as Error).message}`); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [days, password]);

  // À chaque arrêt de la carte : sorties de l'écran, puis (après une seconde sans bouger) leurs détails manquants.
  useEffect(() => {
    let timer = 0, live = true;
    const show = () => {
      const far = map.getZoom() < SKI_MIN_ZOOM;
      setTooFar(far);
      const b = map.getBounds();
      const vis = far ? [] : inView(all, [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]).map((o) => withDetails(o, det.current));
      onOutings(vis);
      const k = vis.findIndex((o) => o.id === selId.current);
      onSelect(k >= 0 ? k : null);
      return vis;
    };
    const update = () => {
      const vis = show();
      window.clearTimeout(timer);
      const missing = vis.filter((o) => !hasDetails(o, det.current) && !asked.current.has(o.id)).slice(0, 30).map((o) => o.id);
      if (!missing.length) return;
      timer = window.setTimeout(() => {
        missing.forEach((id) => asked.current.add(id));
        fetchDetails(missing, password).then((d) => { det.current = d; if (live) show(); }).catch(() => { /* hors ligne : sans détails */ });
      }, 1000);
    };
    update();
    map.on('moveend', update);
    return () => { live = false; window.clearTimeout(timer); map.off('moveend', update); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, all, password]);
  const sel = selected != null ? outings[selected] : null;
  // ▾ réduit le panneau à sa première ligne (titre, flèche, croix) pour voir la carte ; ▴ le remet.
  const [low, setLow] = useState(false);
  const head = (
    <div className="travel-head"><b>⛷ Sorties ski de rando</b>
      <span className="head-btns">
        <button onClick={() => setLow(!low)} aria-label={low ? 'Agrandir le panneau' : 'Réduire le panneau'}>{low ? '▴' : '▾'}</button>
        <button onClick={onClose} aria-label="Fermer">✕</button>
      </span></div>
  );
  if (low) return <div className="travel">{head}</div>;
  return (
    <div className="travel">
      {head}
      <span className="row">
        <label className="field">Période<select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>7 derniers jours</option><option value={30}>30 derniers jours</option>
          <option value={90}>3 derniers mois</option></select></label>
      </span>
      {busy && <p className="hint">Recherche sur skitour.fr…</p>}
      {error && <p className="error">{error}</p>}
      {offline != null && <p className="hint">📴 Hors ligne : sorties gardées sur le téléphone, recherche du {new Date(offline).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.</p>}
      {!busy && !error && <p className="hint">{tooFar ? `Zoome sur une région pour voir ses sorties (${all.length} sur la période).`
        : outings.length ? `${outings.length} sortie${outings.length > 1 ? 's' : ''} à l'écran : bouge la carte pour en voir d'autres.` : 'Aucune sortie à l\'écran sur la période.'}</p>}
      {sel && <div className="cost">
        <p><b>{sel.titre}</b></p>
        <p className="hint">{outingDate(sel)} · {sel.massif} · par {sel.auteur}</p>
        <p>{outingLine(sel)}</p>
        {sel.conditions && <p className="hint">{sel.conditions}</p>}
        <span className="row">
          <button className="primary" onClick={() => onSheet(sel)}>Fiche de la sortie</button>
          <button onClick={() => window.open(sel.url, '_system')}>Sur skitour.fr</button>
        </span>
      </div>}
      <ul className="routes lodgings">
        {outings.map((o, i) => (
          <li key={o.id}><button className={i === selected ? 'sel' : ''} onClick={() => onSelect(i)}>
            <b>{o.titre}</b><em>{outingDate(o)}</em><span>{outingLine(o)}</span></button></li>
        ))}
      </ul>
      <p className="hint">Données skitour.fr (CC BY-NC-ND pour les récits).</p>
    </div>
  );
}
