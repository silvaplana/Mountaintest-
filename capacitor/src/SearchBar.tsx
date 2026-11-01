import { useEffect, useRef, useState } from 'react';
import { searchPlaces, type Place } from './search';

/** Barre de recherche : on tape une ville, un département ou un lieu, on choisit, la carte y va. */
export function SearchBar({ onPick, onClose }: { onPick: (p: Place) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); }, []);

  useEffect(() => {
    const t = text.trim();
    if (t.length < 2) { setResults([]); setError(''); return; }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      searchPlaces(t, ctrl.signal)
        .then((r) => { setResults(r); setError(r.length ? '' : 'Aucun résultat'); })
        .catch((e) => { if ((e as Error).name !== 'AbortError') setError('Recherche impossible (pas de réseau ?)'); });
    }, 300);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [text]);

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
