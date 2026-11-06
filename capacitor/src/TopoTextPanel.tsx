import { useEffect, useMemo, useState } from 'react';
import { fetchMassifs, fetchTopoList, filterTopos, groupMassifs, readMassifs, readTopoList, topoLine, type Massif, type TopoRow, type TopoSheet } from './ski/skitour';
import { MASSIF_GROUPS } from './ski/massifs';
import { SkiTabs, type SkiMode } from './SkiTabs';
import { TopoView } from './TopoView';

/**
 * 📖 Topos : liste des topos skitour.fr des massifs choisis (mêmes massifs que la liste des sorties), avec recherche ;
 * un topo s'ouvre dans l'appli. Liste gardée 7 jours sur le serveur, la dernière aussi sur le téléphone.
 */
export function TopoTextPanel({ password, start, onMode, onClose, onShowOnMap }: {
  /** « 🗺 Sur la carte » d'un topo. */
  onShowOnMap?: (t: TopoSheet) => void;
  password: string;
  /** Topo à ouvrir tout de suite (touché sur la carte des topos) : « ← » revient alors à la carte. */
  start?: TopoRow;
  onMode: (m: SkiMode) => void; onClose: () => void;
}) {
  const [massifs, setMassifs] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('skitourMassifs') ?? '[]'); } catch { return []; } });
  const [picking, setPicking] = useState(false);
  const [allMassifs, setAllMassifs] = useState<Massif[]>(readMassifs);
  useEffect(() => { fetchMassifs(password).then((m) => { if (m.length) setAllMassifs(m); }).catch(() => { /* hors ligne */ }); }, [password]);
  const groups = allMassifs.length ? groupMassifs(allMassifs) : MASSIF_GROUPS;
  const ids = massifs.map((n) => allMassifs.find((m) => m.nom === n)?.id).filter((i): i is number => i != null).slice(0, 20);
  const idsKey = ids.join(',');
  const toggle = (m: string) => setMassifs((l) => {
    const n = l.includes(m) ? l.filter((x) => x !== m) : [...l, m];
    try { localStorage.setItem('skitourMassifs', JSON.stringify(n)); } catch { /* ignoré */ }
    return n;
  });
  const [topos, setTopos] = useState<TopoRow[]>(() => { const s = readTopoList(); return s && s.massifs.join(',') === idsKey ? s.topos : []; });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<TopoRow | null>(start ?? null);
  useEffect(() => {
    if (!idsKey || picking) return;
    let live = true;
    setBusy(true); setMsg('');
    fetchTopoList(idsKey.split(',').map(Number), password)
      .then((t) => { if (live) setTopos(t); })
      .catch((e) => {
        if (!live) return;
        const s = readTopoList();
        if (s && s.massifs.join(',') === idsKey) { setTopos(s.topos); setMsg('📴 Hors ligne : liste gardée sur le téléphone.'); }
        else setMsg(`Topos impossibles : ${e instanceof TypeError ? 'pas de réseau' : (e as Error).message}`);
      })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [idsKey, password, picking]);
  const rows = useMemo(() => filterTopos(topos, q), [topos, q]);

  if (open) return <TopoView topo={open} password={password} backLabel={start && open.id === start.id ? 'Carte' : 'Topos'}
    onBack={() => { if (start && open.id === start.id) onMode('carteTopos'); else setOpen(null); }} onClose={onClose} onMap={onShowOnMap} />;
  return (
    <div className="ski-page">
      <SkiTabs mode="topos" onMode={onMode} onClose={onClose} />
      <span className="row ski-filters">
        <button className="ski-massifs" onClick={() => setPicking(true)}>
          <small>Massifs</small> {massifs.length === 0 ? 'À choisir' : massifs.length === 1 ? massifs[0] : `${massifs.length} massifs`} ▾</button>
      </span>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher : sommet, départ…" />
      {picking && <div className="ski-picker">
        <div className="travel-head"><b>Massifs</b><span>
          <button onClick={() => { setMassifs([]); try { localStorage.setItem('skitourMassifs', '[]'); } catch { /* ignoré */ } }}>Aucun</button>
          <button className="primary" onClick={() => setPicking(false)}>OK</button></span></div>
        {groups.map(([g, ms]) => (
          <section key={g}><h3>{g}</h3>
            {ms.map((m) => <label key={m} className="check"><input type="checkbox" checked={massifs.includes(m)} onChange={() => toggle(m)} /> {m}</label>)}
          </section>
        ))}
      </div>}
      {!idsKey && <p className="hint">Choisis un ou plusieurs massifs pour voir leurs topos (20 au plus).</p>}
      {busy && <p className="hint">Chargement des topos skitour.fr…</p>}
      {msg && <p className="hint">{msg}</p>}
      {idsKey && !busy && <p className="hint">{rows.length} topo{rows.length > 1 ? 's' : ''}</p>}
      <ul className="ski-topos">
        {rows.map((t) => (
          <li key={t.id}><button onClick={() => setOpen(t)}>
            <b>{t.nom}</b>{t.gpx ? <span className="ski-gpx" title="Trace GPX">GPX</span> : null}
            <small>{[t.massif, topoLine(t)].filter(Boolean).join(' · ')}</small>
            {t.depart && <small>Départ : {t.depart.nom}{t.depart.altitude ? ` (${t.depart.altitude} m)` : ''}</small>}
          </button></li>))}
      </ul>
      <p className="hint">Topos skitour.fr.</p>
    </div>
  );
}
