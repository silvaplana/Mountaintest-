import { useState } from 'react';
import { askSki, outingDate, outingLine, readAnswers, type Outing, type SkiAnswer } from './ski/skitour';

/** ⛷ 💬 : question en texte sur les sorties skitour.fr, réponse en texte (Claude via le relais), sorties citées en points bleus. */
export function SkiTextPanel({ center, password, onOutings, onClose }: {
  center: { lat: number; lon: number } | null; password: string; onOutings: (o: Outing[]) => void; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<SkiAnswer[]>(readAnswers);
  const [shown, setShown] = useState<SkiAnswer | null>(null);
  const show = (a: SkiAnswer | null) => { setShown(a); onOutings(a?.sorties ?? []); };
  const ask = () => {
    if (q.trim().length < 3 || busy) return;
    setBusy(true); setError(''); show(null);
    askSki(q.trim(), center, password)
      .then((a) => { show(a); setHistory(readAnswers()); setQ(''); })
      .catch((e) => setError(`Pas de réponse : ${e instanceof TypeError ? 'pas de réseau (les réponses précédentes restent lisibles ci-dessous)' : (e as Error).message}`))
      .finally(() => setBusy(false));
  };
  return (
    <div className="travel">
      <div className="travel-head"><b>⛷ 💬 Question sur les sorties</b><button onClick={() => { onOutings([]); onClose(); }} aria-label="Fermer">✕</button></div>
      <textarea rows={2} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex. : comment est la neige en Belledonne cette semaine ?" />
      <button className="primary" disabled={busy || q.trim().length < 3} onClick={ask}>{busy ? 'Recherche dans les sorties skitour.fr…' : 'Demander'}</button>
      {error && <p className="error">{error}</p>}
      {shown && <div className="cost">
        <p className="hint">« {shown.q} »</p>
        {shown.texte.split('\n').filter(Boolean).map((l, i) => <p key={i}>{l}</p>)}
        {shown.cout_usd != null && <p className="hint">Coût : {shown.cout_usd.toFixed(3)} $</p>}
      </div>}
      {shown && shown.sorties.length > 0 && <ul className="routes lodgings">
        {shown.sorties.map((o) => (
          <li key={o.id}><button onClick={() => window.open(o.url, '_system')}>
            <b>{o.titre}</b><em>{outingDate(o)}</em><span>{outingLine(o)} · lire sur skitour.fr</span></button></li>
        ))}
      </ul>}
      {history.length > 0 && <>
        <p className="hint">Questions précédentes (lisibles hors ligne) :</p>
        <ul className="routes lodgings">
          {history.map((a) => (
            <li key={a.t}><button className={a.t === shown?.t ? 'sel' : ''} onClick={() => show(a)}>
              <b>{a.q}</b><em>{new Date(a.t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</em></button></li>
          ))}
        </ul>
      </>}
      <p className="hint">Réponse de Claude à partir des sorties skitour.fr (CC BY-NC-ND pour les récits).</p>
    </div>
  );
}
