import { useEffect, useRef, useState, type ReactElement } from 'react';
import { categorie, demandeRefuges, mergePlaces, searchPlacesWide, type Categorie, type NatureRefuge, type Place } from './search';
import { localNames, searchNames } from './places/placeNames';
import { MicIcon, Onde, useDictee } from './buddies/Dictee';
import { relayPost } from './travel/travel';
import type { OutingRow, TopoRow } from './ski/skitour';

/** Un résultat en ligne qui redit un nom déjà trouvé sur le téléphone (même nom, à moins de 300 m). */
export function mergeResults(local: Place[], online: Place[]): Place[] {
  return mergePlaces([local, online]);
}

/** Icônes au trait des catégories (pas d'emoji). */
const ICONES: Record<Categorie, ReactElement> = {
  courses: <path d="M3 19 L21 13 M6 9 l3 -5 l3 5 M12 9 l3 -3 l3 3" />,
  sommets: <path d="M2 20 L9 7 L13 13 L16 9 L22 20 Z" />,
  refuges: <path d="M3 12 L12 4 L21 12 M6 10 V20 H18 V10 M10 20 V15 H14 V20" />,
  lieux: <path d="M12 21 C12 21 5 14 5 9.5 A7 7 0 0 1 19 9.5 C19 14 12 21 12 21 Z M12 7.5 A2 2 0 1 0 12.01 7.5" />,
};
const Icone = ({ c }: { c: Categorie }) => <svg className="cat-icone" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
  strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">{ICONES[c]}</svg>;
const TITRES: Record<Categorie, string> = { courses: 'Courses skitour', sommets: 'Sommets et nature', refuges: 'Refuges, gîtes, auberges', lieux: 'Villes et lieux' };
const ORDRE: Categorie[] = ['courses', 'sommets', 'refuges', 'lieux'];
const NOMS_REFUGES: Record<NatureRefuge, string> = { refuge: 'Refuges et cabanes', cabane: 'Cabanes', gite: 'Gîtes', auberge: 'Auberges', hotel: 'Hôtels', hebergement: 'Hébergements' };
/** Lignes montrées par catégorie dans « Tout » ; « Voir plus » ouvre la catégorie. */
const PAR_CATEGORIE = 3;

interface Ligne { cle: string; titre: string; detail: string; choisir: () => void }

const dateCourte = (s: number) => new Date(s * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' });

/**
 * Loupe : on tape une ville, un sommet, une course, un refuge… Les résultats sont rangés par catégorie (courses skitour
 * d'abord, puis sommets, refuges, villes), avec des pastilles pour n'en voir qu'une.
 * Lieux : d'abord les noms gardés sur le téléphone avec les cartes hors ligne (marche sans réseau), puis l'IGN et
 * OpenStreetMap, les lieux proches du centre de la carte (near) en premier. Courses : topos et sorties skitour (relais).
 * Micro : on dit le nom au lieu de le taper (dictée dans l'appli, comme dans la messagerie).
 */
export function SearchBar({ onPick, onClose, near, onToast, onRefuges, password, onTopo, onSortie }: {
  onPick: (p: Place) => void; onClose: () => void; near?: { lon: number; lat: number }; onToast: (m: string) => void;
  /** « refuge », « gîte », « auberge », « hébergement »… (+ un lieu) : les poser sur la carte (refuges.info, OpenStreetMap). */
  onRefuges?: (d: { nature: NatureRefuge; lieu: string }) => void;
  /** Mot de passe du relais, pour chercher dans skitour. */
  password?: string; onTopo?: (t: TopoRow) => void; onSortie?: (s: OutingRow) => void;
}) {
  const [text, setText] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [ski, setSki] = useState<{ topos: TopoRow[]; sorties: OutingRow[] }>({ topos: [], sorties: [] });
  const [filtre, setFiltre] = useState<Categorie | 'tout'>('tout');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); }, []);

  useEffect(() => {
    const t = text.trim();
    if (t.length < 2) { setResults([]); setSki({ topos: [], sorties: [] }); setError(''); return; }
    const ctrl = new AbortController();
    const localP = localNames().then((names) => searchNames(names, t, near)).catch(() => [] as Place[]);
    void localP.then((local) => { if (!ctrl.signal.aborted) { setResults(local); setError(''); } });
    const timer = setTimeout(() => {
      void localP.then((local) => searchPlacesWide(t, ctrl.signal, near)
        .then((r) => { const all = mergeResults(local, r); setResults(all); setError(all.length ? '' : 'Aucun lieu trouvé'); })
        .catch((e) => {
          if ((e as Error).name === 'AbortError') return;
          setError(local.length ? '' : 'Pas de réseau, et ce nom n’est pas dans les cartes gardées hors ligne');
        }));
      if (password && t.length >= 3) {
        void relayPost<{ topos?: TopoRow[]; sorties?: OutingRow[] }>('skitour-chercher', { texte: t }, password, ctrl.signal)
          .then((r) => { if (!ctrl.signal.aborted) setSki({ topos: r.topos ?? [], sorties: r.sorties ?? [] }); })
          .catch(() => { if (!ctrl.signal.aborted) setSki({ topos: [], sorties: [] }); });
      }
    }, 300);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  // Une phrase dite = le nom cherché : on l'écrit dans le champ et on arrête d'écouter.
  const dictee = useDictee((t) => { setText(t); if (stopRef.current) void stopRef.current(); }, onToast);
  const stopRef = useRef<(() => Promise<void>) | null>(null);
  stopRef.current = dictee.ecoute ? dictee.basculer : null;

  // Les lignes de chaque catégorie, dans l'ordre où elles s'affichent.
  const t = text.trim();
  const demande = onRefuges ? demandeRefuges(t) ?? (filtre === 'refuges' && t.length >= 2 ? { nature: 'hebergement' as const, lieu: t } : null) : null;
  const lignes: Record<Categorie, Ligne[]> = { courses: [], sommets: [], refuges: [], lieux: [] };
  if (onTopo) ski.topos.forEach((x) => lignes.courses.push({ cle: `t${x.id}`, titre: x.nom, detail: ['topo', x.massif, x.denivele ? `${x.denivele} m D+` : '', x.dif_ski].filter(Boolean).join(' · '), choisir: () => onTopo(x) }));
  if (onSortie) ski.sorties.forEach((x) => lignes.courses.push({ cle: `s${x.id}`, titre: x.titre || x.sommet, detail: ['sortie', dateCourte(x.date), x.massif].filter(Boolean).join(' · '), choisir: () => onSortie(x) }));
  if (demande) lignes.refuges.push({ cle: 'refuges.info', titre: `${NOMS_REFUGES[demande.nature]} autour ${demande.lieu ? `de ${demande.lieu}` : 'de la carte'}`, detail: 'à 10 km, sur la carte', choisir: () => onRefuges?.(demande) });
  results.forEach((p, i) => lignes[categorie(p)].push({ cle: `p${i}`, titre: p.label, detail: p.detail, choisir: () => onPick(p) }));
  const premiere = ORDRE.map((c) => lignes[c][0]).find(Boolean);
  const montrees = filtre === 'tout' ? ORDRE.filter((c) => lignes[c].length) : [filtre];
  const rien = ORDRE.every((c) => !lignes[c].length);

  return (
    <div className="search">
      <div className="search-row">
        {dictee.ecoute ? <Onde niveau={dictee.niveau} partiel={dictee.partiel} /> : <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ville, sommet, course, refuge, auberge…"
          enterKeyHint="search" autoCorrect="off" autoCapitalize="words"
          onKeyDown={(e) => { if (e.key === 'Enter' && premiere) premiere.choisir(); if (e.key === 'Escape') onClose(); }} />}
        <button className={dictee.ecoute ? 'bd-ecoute' : 'micro'} aria-label={dictee.ecoute ? 'Arrêter la dictée' : 'Dire le nom'}
          onClick={() => void dictee.basculer()}>{dictee.ecoute ? '■' : <MicIcon />}</button>
        <button onClick={onClose} aria-label="Fermer la recherche">✕</button>
      </div>
      {t.length >= 2 && (
        <div className="search-pastilles">
          {(['tout', ...ORDRE] as const).map((c) => (
            <button key={c} className={filtre === c ? 'active' : ''} onClick={() => setFiltre(c)} aria-label={c === 'tout' ? 'Tout' : TITRES[c]}>
              {c === 'tout' ? 'Tout' : <><Icone c={c} />{lignes[c].length > 0 && <small>{lignes[c].length}</small>}</>}</button>
          ))}
        </div>
      )}
      {t.length >= 2 && (
        <ul className="search-results">
          {montrees.map((c) => <li key={c} className="search-cat">
            {filtre === 'tout' && <h4><Icone c={c} /> {TITRES[c]}</h4>}
            <ul>
              {(filtre === 'tout' ? lignes[c].slice(0, PAR_CATEGORIE) : lignes[c]).map((l) =>
                <li key={l.cle}><button onClick={l.choisir}><b>{l.titre}</b><span>{l.detail}</span></button></li>)}
              {filtre === 'tout' && lignes[c].length > PAR_CATEGORIE &&
                <li><button className="voir-plus" onClick={() => setFiltre(c)}>Voir plus ({lignes[c].length - PAR_CATEGORIE})</button></li>}
              {filtre !== 'tout' && !lignes[c].length && <li className="hint">Rien dans cette catégorie</li>}
            </ul>
          </li>)}
          {filtre === 'tout' && rien && error && <li className="hint">{error}</li>}
        </ul>
      )}
    </div>
  );
}
