import { useEffect, useRef, useState } from 'react';
import { searchPlaces, type Place } from './search';
import { localNames, normalize, searchNames } from './places/placeNames';

/** Un résultat en ligne qui redit un nom déjà trouvé sur le téléphone (même nom, à moins de 300 m). */
export function mergeResults(local: Place[], online: Place[]): Place[] {
  const dup = (o: Place) => local.some((l) => normalize(o.label).startsWith(normalize(l.label))
    && Math.abs(o.lon - l.lon) < 0.004 && Math.abs(o.lat - l.lat) < 0.003);
  return [...local, ...online.filter((o) => !dup(o))];
}

/**
 * Barre de recherche : on tape une ville, un département ou un lieu, on choisit, la carte y va.
 * D'abord les noms gardés sur le téléphone avec les cartes hors ligne (marche sans réseau),
 * puis la recherche de l'IGN, les lieux proches du centre de la carte (near) en premier.
 */
export function SearchBar({ onPick, onClose, near }: { onPick: (p: Place) => void; onClose: () => void; near?: { lon: number; lat: number } }) {
  const [text, setText] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); }, []);

  useEffect(() => {
    const t = text.trim();
    if (t.length < 2) { setResults([]); setError(''); return; }
    const ctrl = new AbortController();
    const localP = localNames().then((names) => searchNames(names, t, near)).catch(() => [] as Place[]);
    void localP.then((local) => { if (!ctrl.signal.aborted) { setResults(local); setError(''); } });
    const timer = setTimeout(() => {
      void localP.then((local) => searchPlaces(t, ctrl.signal, near)
        .then((r) => { const all = mergeResults(local, r); setResults(all); setError(all.length ? '' : 'Aucun résultat'); })
        .catch((e) => {
          if ((e as Error).name === 'AbortError') return;
          setError(local.length ? '' : 'Pas de réseau, et ce nom n’est pas dans les cartes gardées hors ligne');
        }));
    }, 300);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="search">
      <div className="search-row">
        <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ville, département, sommet, lieu…"
          enterKeyHint="search" autoCorrect="off" autoCapitalize="words"
          onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) onPick(results[0]); if (e.key === 'Escape') onClose(); }} />
        <button onClick={onClose} aria-label="Fermer la recherche">✕</button>
      </div>
      {(results.length > 0 || error) && (
        <ul className="search-results">
          {results.map((p, i) => (
            <li key={i}><button onClick={() => onPick(p)}><b>{p.label}</b><span>{p.detail}</span></button></li>
          ))}
          {error && <li className="hint">{error}</li>}
        </ul>
      )}
    </div>
  );
}
