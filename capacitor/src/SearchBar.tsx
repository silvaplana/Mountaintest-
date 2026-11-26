import { useEffect, useRef, useState } from 'react';
import { demandeRefuges, mergePlaces, searchPlacesWide, type NatureRefuge, type Place } from './search';
import { localNames, searchNames } from './places/placeNames';
import { MicIcon, Onde, useDictee } from './buddies/Dictee';

/** Un résultat en ligne qui redit un nom déjà trouvé sur le téléphone (même nom, à moins de 300 m). */
export function mergeResults(local: Place[], online: Place[]): Place[] {
  return mergePlaces([local, online]);
}

/**
 * Barre de recherche : on tape une ville, un département ou un lieu, on choisit, la carte y va.
 * D'abord les noms gardés sur le téléphone avec les cartes hors ligne (marche sans réseau),
 * puis la recherche de l'IGN, les lieux proches du centre de la carte (near) en premier.
 * Micro : on dit le nom au lieu de le taper (dictée dans l'appli, comme dans la messagerie).
 */
export function SearchBar({ onPick, onClose, near, onToast, onRefuges }: {
  onPick: (p: Place) => void; onClose: () => void; near?: { lon: number; lat: number }; onToast: (m: string) => void;
  /** « refuge », « gîte », « cabane » (+ un lieu) : les poser sur la carte d'après refuges.info. */
  onRefuges?: (d: { nature: NatureRefuge; lieu: string }) => void;
}) {
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
      void localP.then((local) => searchPlacesWide(t, ctrl.signal, near)
        .then((r) => { const all = mergeResults(local, r); setResults(all); setError(all.length ? '' : 'Aucun résultat'); })
        .catch((e) => {
          if ((e as Error).name === 'AbortError') return;
          setError(local.length ? '' : 'Pas de réseau, et ce nom n’est pas dans les cartes gardées hors ligne');
        }));
    }, 300);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  // Une phrase dite = le nom cherché : on l'écrit dans le champ et on arrête d'écouter.
  const dictee = useDictee((t) => { setText(t); if (stopRef.current) void stopRef.current(); }, onToast);
  const stopRef = useRef<(() => Promise<void>) | null>(null);
  stopRef.current = dictee.ecoute ? dictee.basculer : null;

  const refuges = onRefuges ? demandeRefuges(text) : null;
  const NOMS: Record<NatureRefuge, string> = { refuge: 'Refuges et cabanes', cabane: 'Cabanes', gite: 'Gîtes d’étape' };

  return (
    <div className="search">
      <div className="search-row">
        {dictee.ecoute ? <Onde niveau={dictee.niveau} partiel={dictee.partiel} /> : <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ville, département, sommet, lieu…"
          enterKeyHint="search" autoCorrect="off" autoCapitalize="words"
          onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) onPick(results[0]); if (e.key === 'Escape') onClose(); }} />}
        <button className={dictee.ecoute ? 'bd-ecoute' : 'micro'} aria-label={dictee.ecoute ? 'Arrêter la dictée' : 'Dire le nom'}
          onClick={() => void dictee.basculer()}>{dictee.ecoute ? '■' : <MicIcon />}</button>
        <button onClick={onClose} aria-label="Fermer la recherche">✕</button>
      </div>
      {(results.length > 0 || error || refuges) && (
        <ul className="search-results">
          {refuges && <li><button onClick={() => onRefuges?.(refuges)}>
            <b>{NOMS[refuges.nature]} autour {refuges.lieu ? `de ${refuges.lieu}` : 'de la carte'}</b><span>refuges.info, sur la carte</span></button></li>}
          {results.map((p, i) => (
            <li key={i}><button onClick={() => onPick(p)}><b>{p.label}</b><span>{p.detail}</span></button></li>
          ))}
          {error && <li className="hint">{error}</li>}
        </ul>
      )}
    </div>
  );
}
