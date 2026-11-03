import { useRef, useState } from 'react';
import { costLine } from './trails/webHikes';
import { relayPost } from './travel/travel';

/** Hébergements trouvés par Claude (relais du VPS, recherche web), du moins cher au plus cher. Même écran côté Kotlin (LodgingPanel.kt). */
export interface Lodging { nom: string; type: string; prix_nuit: number | null; adresse: string; url: string; resume: string }
interface Answer { hebergements?: Lodging[]; conseil?: string; cache?: boolean; cout_usd?: number; cumul_mois_usd?: number; cumul_total_usd?: number }

export const sortByPrice = (l: Lodging[]) => [...l].sort((x, y) => (x.prix_nuit ?? Infinity) - (y.prix_nuit ?? Infinity));

const KEY = 'hebergement';
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

export function LodgingPanel({ password, onClose }: { password: string; onClose: () => void }) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>; } catch { return {}; } })();
  const [city, setCity] = useState(saved.city ?? '');
  const [people, setPeople] = useState(saved.people ?? '2');
  const [max, setMax] = useState(saved.max ?? '100');
  const [date, setDate] = useState(saved.date && saved.date >= new Date().toISOString().slice(0, 10) ? saved.date : tomorrow());
  const [nights, setNights] = useState(saved.nights ?? '1');
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  async function search() {
    const p = Number(people), m = Number(max.replace(',', '.')), n = Number(nights);
    if (city.trim().length < 2 || !(p >= 1) || !(m > 0) || !(n >= 1)) { setError('Indique la ville, le nombre de personnes, le prix maxi et les nuits'); return; }
    try { localStorage.setItem(KEY, JSON.stringify({ city, people, max, date, nights })); } catch { /* ignoré */ }
    setBusy(true); setError(''); setAnswer(null); setElapsed(0);
    const t0 = Date.now();
    const tick = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    const ctrl = new AbortController();
    const stop = setTimeout(() => ctrl.abort(), 240_000);
    try {
      const r = await relayPost<Answer>('hebergement', { ville: city.trim(), personnes: p, prix_max: m, arrivee: date, nuits: n }, password, ctrl.signal);
      setAnswer({ ...r, hebergements: sortByPrice(r.hebergements ?? []) });
    } catch (e) {
      setError(`Recherche impossible : ${(e as Error).name === 'AbortError' ? 'pas de réponse en 4 minutes' : e instanceof TypeError ? 'pas de réseau' : (e as Error).message}`);
    }
    clearInterval(tick); clearTimeout(stop); setBusy(false);
    setTimeout(() => bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }), 50);
  }

  return (
    <div className="travel">
      <div className="travel-head"><b>🏨 Trouver un hébergement</b><button onClick={onClose} aria-label="Fermer">✕</button></div>
      <label className="field">Ville ou lieu<input value={city} onChange={(e) => setCity(e.target.value)} placeholder="ex. Chamonix" /></label>
      <span className="row">
        <label className="field">Personnes<input type="number" inputMode="numeric" min="1" value={people} onChange={(e) => setPeople(e.target.value)} /></label>
        <label className="field">Prix maxi / nuit (€)<input inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} /></label>
      </span>
      <span className="row">
        <label className="field">Arrivée<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field">Nuits<input type="number" inputMode="numeric" min="1" value={nights} onChange={(e) => setNights(e.target.value)} /></label>
      </span>
      <button className="primary" disabled={busy || !password} onClick={() => void search()}>
        {busy ? `Claude cherche les meilleurs prix… ${elapsed} s` : 'Chercher (IA)'}</button>
      {busy && <p className="hint">Claude compare plusieurs sites : 30 s à 2 min.</p>}
      {!password && <p className="hint">Mot de passe IA manquant (onglet Randos).</p>}
      {error && <p className="error">{error}</p>}
      {answer && <>
        {(answer.hebergements ?? []).length === 0 && <p className="hint">Aucun hébergement trouvé sous ce prix.</p>}
        <ul className="routes lodgings">
          {(answer.hebergements ?? []).map((h, i) => (
            <li key={i}><button onClick={() => window.open(h.url, '_system')}>
              <b>{h.nom}</b><em>{h.prix_nuit != null ? `${Math.round(h.prix_nuit)} €` : 'prix ?'}</em>
              <span>{h.type}{h.adresse ? ` · ${h.adresse}` : ''}</span><span>{h.resume}</span></button></li>
          ))}
        </ul>
        {answer.conseil && <p className="hint">{answer.conseil}</p>}
        <p className="hint">{costLine({ cout: answer.cout_usd ?? 0, mois: answer.cumul_mois_usd ?? 0, total: answer.cumul_total_usd ?? 0 }, !!answer.cache).replace('Zone déjà cherchée', 'Déjà cherché')}</p>
      </>}
      <div ref={bottom} />
    </div>
  );
}
