import { useEffect, useState } from 'react';
import type { Bbox } from './config';
import { loadOutings, outingDate, outingLine, type Outing } from './ski/skitour';

/** Sorties skitour.fr de la zone encadrée : liste (la plus récente d'abord) et points sur la carte. */
export function SkiPanel({ zone, password, outings, selected, onOutings, onSelect, onReframe, onSheet, onClose }: {
  zone: Bbox; password: string; outings: Outing[]; selected: number | null;
  onOutings: (o: Outing[]) => void; onSelect: (i: number | null) => void; onReframe: () => void;
  /** Ouvre la fiche complète de la sortie (façon skitour.fr). */
  onSheet: (o: Outing) => void; onClose: () => void;
}) {
  const [days, setDays] = useState(() => { try { return Number(localStorage.getItem('skitourJours')) || 30; } catch { return 30; } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    setBusy(true); setError(''); setOffline(null); onOutings([]);
    try { localStorage.setItem('skitourJours', String(days)); } catch { /* ignoré */ }
    loadOutings(zone, days, password)
      .then((r) => { if (live) { onOutings(r.outings); setOffline(r.offline ?? null); } })
      .catch((e) => { if (live) setError(`Recherche impossible : ${e instanceof TypeError ? 'pas de réseau' : (e as Error).message}`); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone, days, password]);
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
          <option value={90}>3 derniers mois</option><option value={365}>12 derniers mois</option></select></label>
        <button onClick={onReframe}>Autre zone</button>
      </span>
      {busy && <p className="hint">Recherche sur skitour.fr…</p>}
      {error && <p className="error">{error}</p>}
      {offline != null && <p className="hint">📴 Hors ligne : sorties gardées sur le téléphone, recherche du {new Date(offline).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.</p>}
      {!busy && !error && <p className="hint">{outings.length ? `${outings.length} sortie${outings.length > 1 ? 's' : ''} dans la zone (points bleus sur la carte).` : 'Aucune sortie dans cette zone sur la période.'}</p>}
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
