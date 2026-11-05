import { useEffect, useRef, useState } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import { SkiTabs, type SkiMode } from './SkiTabs';
import { PERIODS, SKI_LEVELS, fetchDetails, skiLabel, skiOk, hasDetails, inView, loadAll, outingDate, outingLine, periodLabel, periodOk, readDetails, withDetails, type Outing } from './ski/skitour';

/** En dessous de ce zoom, l'écran couvre trop de pays : on ne montre pas les points. */
export const SKI_MIN_ZOOM = 7;

/**
 * Sorties skitour.fr de l'écran affiché : toute la liste de la période est chargée une fois, puis filtrée sur l'écran
 * à chaque arrêt de la carte (aucune requête) ; étoiles, skiabilité et parking demandés pour les sorties visibles.
 */
export function SkiPanel({ map, password, outings, selected, onOutings, onSelect, onSheet, onClose, hidden, onMode }: {
  /** Onglets en haut du panneau (Sorties, Carte sorties, Topos, Carte topos). */
  onMode?: (m: SkiMode) => void;
  /** Caché (sans perdre la liste) pendant qu'une fiche de sortie est ouverte. */
  hidden?: boolean;
  map: MlMap; password: string; outings: Outing[]; selected: number | null;
  onOutings: (o: Outing[]) => void; onSelect: (i: number | null) => void;
  /** Ouvre la fiche complète de la sortie (façon skitour.fr). */
  onSheet: (o: Outing) => void; onClose: () => void;
}) {
  const [days, setDays] = useState(() => { try { return periodOk(Number(localStorage.getItem('skitourJours'))); } catch { return 30; } });
  const [skiMax, setSkiMax] = useState(() => { try { return Number(localStorage.getItem('skitourSkiMax')) || 0; } catch { return 0; } });
  // Un seul filtre déplié à la fois, au-dessus de la ligne des pastilles.
  const [menu, setMenu] = useState<'days' | 'ski' | null>(null);
  const skiRef = useRef(skiMax);
  skiRef.current = skiMax;
  // Cases « Trace » (GPX de la sortie) et « Itinéraire » (GPX de son topo), dessinées sur la carte comme sur skitour.fr.
  const [lines, setLines] = useState<{ trace: boolean; iti: boolean }>(() => {
    try { const v = JSON.parse(localStorage.getItem('skitourLignes') ?? 'null'); if (v) return { trace: !!v.trace, iti: !!v.iti }; } catch { /* ignoré */ }
    return { trace: true, iti: true };
  });
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState<number | null>(null);
  const [all, setAll] = useState<Outing[]>([]);
  const [tooFar, setTooFar] = useState(false);
  const det = useRef(readDetails());
  const asked = useRef(new Set<number>()); // déjà demandés (une fois par ouverture, même si la réponse manque)
  const selId = useRef<number | null>(null);
  selId.current = selected != null ? outings[selected]?.id ?? null : null;
  // Sortie venue de la fiche texte (🗺 Carte) : gardée sur la carte même si elle sort de la période choisie.
  const pinned = useRef<Outing | null>(selected != null ? outings[selected] ?? null : null);
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
      const L = linesRef.current;
      const vis: Outing[] = far ? [] : inView(all.filter((o) => skiOk(o, skiRef.current)), [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
        .map((o) => withDetails(o, det.current))
        .map((o) => ({ ...o, trace: L.trace ? o.trace : undefined, itineraire: L.iti ? o.itineraire : undefined }));
      const p = pinned.current;
      if (p && p.id === selId.current && !vis.some((o) => o.id === p.id)) vis.unshift(p);
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
  }, [map, all, password, skiMax, lines]);
  const sel = selected != null ? outings[selected] : null;
  // Première ligne (sans titre : on est déjà dans la recherche par carte) : nombre de sorties, pastille de période,
  // ▾ qui réduit le panneau à cette ligne pour voir la carte (▴ le remet) et ✕.
  const [low, setLow] = useState(true); // ouvert réduit : juste la première ligne, la carte d'abord
  // Pas de nombre de sorties (inutile) : seulement « Recherche… » pendant le chargement, ou « Zoome » de trop loin.
  const count = busy ? 'Recherche…' : error ? '' : tooFar ? 'Zoome' : '';
  const choices = <T extends number>(list: [T, string][], cur: T, pick: (v: T) => void, cls: string) => (
    <div className={`ski-menu ${cls}`} role="listbox">{list.map(([v, t]) => (
      <button key={v} role="option" aria-selected={v === cur} className={v === cur ? 'on' : ''}
        onClick={() => { pick(v); setMenu(null); }}>{t}</button>))}</div>);
  // Filtres en pastilles, tous visibles ; celui qu'on touche se déplie au-dessus (un seul à la fois), un choix le replie.
  const head = (<>
    {onMode && <SkiTabs mode="carte" onMode={onMode} />}
    {menu === 'days' && choices(PERIODS, days, setDays, '')}
    {menu === 'ski' && choices(SKI_LEVELS, skiMax, (v) => { setSkiMax(v); try { localStorage.setItem('skitourSkiMax', String(v)); } catch { /* ignoré */ } }, 'ski')}
    <div className="travel-head ski-head"><span className="hint">{count}</span>
      <span className="head-btns">
        <button className="ski-pill" aria-label="Période des sorties" aria-expanded={menu === 'days'}
          onClick={() => setMenu(menu === 'days' ? null : 'days')}>{periodLabel(days)} {menu === 'days' ? '▴' : '▾'}</button>
        <button className="ski-pill ski" aria-label="Difficulté ski maximale" aria-expanded={menu === 'ski'}
          onClick={() => setMenu(menu === 'ski' ? null : 'ski')}>{skiLabel(skiMax)} {menu === 'ski' ? '▴' : '▾'}</button>
        <button onClick={() => setLow(!low)} aria-label={low ? 'Agrandir le panneau' : 'Réduire le panneau'}>{low ? '▴' : '▾'}</button>
        <button onClick={onClose} aria-label="Fermer">✕</button>
      </span></div>
    {/* Cases toujours visibles, sous les filtres, aux couleurs des lignes de la carte. */}
    <div className="ski-menu lines">
      {([['trace', 'Trace GPX'], ['iti', 'Itinéraire']] as const).map(([k, t]) => (
        <button key={k} role="checkbox" aria-checked={lines[k]} className={`${k}${lines[k] ? ' on' : ''}`} onClick={() => {
          const v = { ...lines, [k]: !lines[k] }; setLines(v);
          try { localStorage.setItem('skitourLignes', JSON.stringify(v)); } catch { /* ignoré */ }
        }}>{lines[k] ? '☑' : '☐'} {t}</button>))}</div>
  </>);
  if (low) return <div className="travel" hidden={hidden}>{head}</div>;
  return (
    <div className="travel" hidden={hidden}>
      {head}
      {error && <p className="error">{error}</p>}
      {offline != null && <p className="hint">📴 Hors ligne : sorties gardées sur le téléphone, recherche du {new Date(offline).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.</p>}
      {!busy && !error && tooFar && <p className="hint">Rapproche la carte pour voir les sorties ({all.length} sur la période).</p>}
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
