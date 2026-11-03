import { useEffect, useState } from 'react';
import type { Bbox } from './config';
import { fetchOutings, outingDate, outingLine, type Outing } from './ski/skitour';

/** Sorties skitour.fr de la zone encadrée : liste (la plus récente d'abord) et points sur la carte. */
export function SkiPanel({ zone, password, outings, selected, onOutings, onSelect, onReframe, onClose }: {
  zone: Bbox; password: string; outings: Outing[]; selected: number | null;
  onOutings: (o: Outing[]) => void; onSelect: (i: number | null) => void; onReframe: () => void; onClose: () => void;
}) {
  const [days, setDays] = useState(() => { try { return Number(localStorage.getItem('skitourJours')) || 30; } catch { return 30; } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setBusy(true); setError(''); onOutings([]);
    try { localStorage.setItem('skitourJours', String(days)); } catch { /* ignoré */ }
    fetchOutings(zone, days, password)
      .then((o) => { if (live) onOutings(o); })
      .catch((e) => { if (live) setError(`Recherche impossible : ${e instanceof TypeError ? 'pas de réseau' : (e as Error).message}`); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone, days, password]);
  const sel = selected != null ? outings[selected] : null;
  return (
    <div className="travel">
      <div className="travel-head"><b>⛷ Sorties ski de rando</b><button onClick={onClose} aria-label="Fermer">✕</button></div>
      <span className="row">
        <label className="field">Période<select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>7 derniers jours</option><option value={30}>30 derniers jours</option>
          <option value={90}>3 derniers mois</option><option value={365}>12 derniers mois</option></select></label>
        <button onClick={onReframe}>Autre zone</button>
      </span>
      {busy && <p className="hint">Recherche sur skitour.fr…</p>}
      {error && <p className="error">{error}</p>}
      {!busy && !error && <p className="hint">{outings.length ? `${outings.length} sortie${outings.length > 1 ? 's' : ''} dans la zone (points bleus sur la carte).` : 'Aucune sortie dans cette zone sur la période.'}</p>}
      {sel && <div className="cost">
        <p><b>{sel.titre}</b></p>
        <p className="hint">{outingDate(sel)} · {sel.massif} · par {sel.auteur}</p>
        <p>{outingLine(sel)}</p>
        {sel.conditions && <p className="hint">{sel.conditions}</p>}
        <button className="primary" onClick={() => window.open(sel.url, '_system')}>Lire la sortie sur skitour.fr</button>
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
