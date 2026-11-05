import { useEffect, useMemo, useState } from 'react';
import { fetchList, fetchMassifs, linkText, fetchSheet, filterRows, groupMassifs, readList, readMassifs, sheetPhotos, savedSheet, shortDate,
  type Massif, type Outing, type OutingRow, type SkiPhoto, type OutingSheet, type SavedList } from './ski/skitour';

import { LIMITS, MASSIF_GROUPS } from './ski/massifs';
import { storedPhoto } from './ski/photoStore';

/** Une photo : la copie gardée sur le téléphone si elle existe, sinon celle de skitour.fr. */
function Photo({ p, onOpen }: { p: SkiPhoto; onOpen?: () => void }) {
  const [src, setSrc] = useState(p.url);
  useEffect(() => {
    let url: string | null = null, live = true;
    void storedPhoto(p.url).then((u) => { url = u; if (live && u) setSrc(u); });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [p.url]);
  return <img src={src} alt={p.legende || `Photo de ${p.auteur}`} loading="lazy" onClick={onOpen} />;
}

/**
 * ⛷💬 : sorties skitour.fr en texte, comme sur le site : tableau date / titre / auteurs, puis la fiche
 * (massif, départ, sommet, orientation, dénivelé, ski, conditions, neige, récit). Liste et fiches gardées hors ligne.
 */
export function SkiTextPanel({ password, start, onShowOnMap, onClose }: {
  password: string;
  /** Fiche à ouvrir tout de suite (sortie choisie sur la carte) ; « ← » ferme alors le panneau. */
  start?: OutingRow;
  onShowOnMap: (o: Outing) => void; onClose: () => void;
}) {
  const [jours, setJours] = useState(() => { try { return Number(localStorage.getItem('skitourTexteJours')) || 14; } catch { return 14; } });
  const [list, setList] = useState<SavedList | null>(readList);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState<OutingSheet | null>(null);
  const [sheetRow, setSheetRow] = useState<OutingRow | null>(null);
  const [sheetMsg, setSheetMsg] = useState('');
  const [big, setBig] = useState<number | null>(null);
  // Massifs choisis (vide = tous), retenus d'une fois sur l'autre, comme la disquette du site.
  const [massifs, setMassifs] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('skitourMassifs') ?? '[]'); } catch { return []; } });
  const [picking, setPicking] = useState(false);
  // Liste des massifs de skitour (relais), sinon celle gardée, sinon celle du site recopiée dans massifs.ts.
  const [allMassifs, setAllMassifs] = useState<Massif[]>(readMassifs);
  useEffect(() => { fetchMassifs(password).then((m) => { if (m.length) setAllMassifs(m); }).catch(() => { /* hors ligne */ }); }, [password]);
  const groups = allMassifs.length ? groupMassifs(allMassifs) : MASSIF_GROUPS;
  const ids = massifs.map((n) => allMassifs.find((m) => m.nom === n)?.id).filter((i): i is number => i != null);
  // Un massif sans identifiant connu : on demande tout et on filtre ici par nom.
  const idsKey = ids.length === massifs.length ? ids.join(',') : '';
  const toggleMassif = (m: string) => setMassifs((l) => {
    const n = l.includes(m) ? l.filter((x) => x !== m) : [...l, m];
    try { localStorage.setItem('skitourMassifs', JSON.stringify(n)); } catch { /* ignoré */ }
    return n;
  });

  useEffect(() => {
    let live = true;
    setBusy(true); setError(''); setOffline(false);
    try { localStorage.setItem('skitourTexteJours', String(jours)); } catch { /* ignoré */ }
    fetchList(jours, idsKey ? idsKey.split(',').map(Number) : [], password)
      .then((l) => { if (live) setList(l); })
      .catch((e) => {
        if (!live) return;
        const saved = readList();
        if (saved) { setList(saved); setOffline(true); } else setError(`Liste impossible : ${e instanceof TypeError ? 'pas de réseau' : (e as Error).message}`);
      })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [jours, password, idsKey]);

  useEffect(() => { if (start) open(start); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => filterRows((list?.sorties ?? []).filter((o) => !massifs.length || massifs.includes(o.massif)), q), [list, q, massifs]);

  const open = (o: OutingRow) => {
    setSheetRow(o); setSheetMsg('');
    const saved = savedSheet(o.id);
    setSheet(saved);
    if (!saved) setSheetMsg('Chargement de la sortie…');
    fetchSheet(o.id, password)
      .then((f) => { setSheet(f); setSheetMsg(''); })
      .catch((e) => setSheetMsg(saved ? '📴 Hors ligne : fiche gardée sur le téléphone.'
        : `Fiche impossible : ${e instanceof TypeError ? 'pas de réseau' : (e as Error).message}`));
  };

  if (sheetRow) {
    const f = sheet;
    const o = f ?? sheetRow;
    const go = (url: string) => { if (url) window.open(url, '_system'); };
    const onMap = () => { if (o.lat != null && o.lon != null) onShowOnMap({ ...o, lat: o.lat, lon: o.lon, auteur: o.auteurs, conditions: f?.conditions ?? '' }); };
    const L = f?.liens;
    // Lien vers la page skitour.fr (comme sur le site) ; 📍 montre la sortie sur la carte (sommet et départ).
    const link = (l: { nom: string; url: string; altitude?: number | null }, pin: boolean, k?: number) => (
      <span key={k ?? l.url} className="ski-link">
        {l.url ? <a href={l.url} onClick={(e) => { e.preventDefault(); go(l.url); }}>{linkText(l)}</a> : linkText(l)}
        {pin && o.lat != null && <button className="ski-pin" onClick={onMap} aria-label={`${l.nom} sur la carte`}>📍</button>}
      </span>);
    const info: [string, React.ReactNode][] = [
      ['Massif', o.massif],
      ['Départ', L?.depart ? link(L.depart, true) : f?.depart ?? ''],
      [`Topo${(L?.topos.length ?? 0) > 1 ? 's' : ''} associé${(L?.topos.length ?? 0) > 1 ? 's' : ''}`, L?.topos.length ? L.topos.map((t, k) => link(t, false, k)) : f?.topos.join(', ') ?? ''],
      [`Sommet${(L?.sommets.length ?? 0) > 1 ? 's' : ''} associé${(L?.sommets.length ?? 0) > 1 ? 's' : ''}`,
        L?.sommets.length ? L.sommets.map((t, k) => link(t, true, k)) : f?.sommets.length ? f.sommets.join(', ') : o.sommet + (o.altitude ? ` (${o.altitude} m)` : '')],
      ['Orientation', o.orientation], ['Dénivelé', o.denivele ? `${o.denivele} m` : ''], ['Ski', o.dif_ski ? String(o.dif_ski) : ''],
      ['Exposition', f?.exposition ?? ''], ['Skiabilité', f?.skiabilite ?? ''],
    ];
    const photos = sheetPhotos(f);
    return (
      <div className="ski-page">
        <div className="travel-head"><button onClick={() => { if (start) { onClose(); return; } setSheetRow(null); setSheet(null); setBig(null); }}>{start ? '← Carte' : '← Liste'}</button>
          <button onClick={onClose} aria-label="Fermer">✕</button></div>
        {/* En-tête façon skitour.fr : titre et étoiles dans un cadre, puis date et auteurs. */}
        <div className="ski-title"><h2>{o.titre}</h2>{o.etoiles ? <div className="ski-stars">{'★'.repeat(o.etoiles)}</div> : null}</div>
        <p className="ski-meta">📅 <b>Sortie du</b> {new Date(o.date * 1000).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        <p className="ski-meta">👤 {o.auteurs}</p>
        {sheetMsg && <p className="hint">{sheetMsg}</p>}
        <dl className="ski-info">{info.filter(([, v]) => v && (!Array.isArray(v) || v.length)).map(([k, v]) => <div key={k}><dt>{k} :</dt><dd>{v}</dd></div>)}</dl>
        {f?.conditions && <><h3>❄ Conditions nivologiques, accès et météo</h3><p className="ski-text">{f.conditions}</p></>}
        {f && f.neige.length > 0 && <><h3>Neige observée</h3><ul className="ski-text">{f.neige.map((n, i) => <li key={i}>{n}</li>)}</ul></>}
        {f?.recit && <><h3>Récit</h3><p className="ski-text">{f.recit}</p></>}
        {photos.length > 0 && <><h3>Photos</h3>
          <div className="ski-photos">{photos.map((p, i) => <figure key={p.url}><Photo p={p} onOpen={() => setBig(i)} /><figcaption>© {p.auteur}</figcaption></figure>)}</div></>}
        {big != null && photos[big] && <div className="ski-big" onClick={() => setBig(null)}>
          <Photo p={photos[big]} />
          <p>{photos[big].legende}{photos[big].legende ? ' · ' : ''}© {photos[big].auteur} · skitour.fr</p>
          <div className="row">
            <button disabled={big === 0} onClick={(e) => { e.stopPropagation(); setBig(big - 1); }}>‹</button>
            <span>{big + 1} / {photos.length}</span>
            <button disabled={big === photos.length - 1} onClick={(e) => { e.stopPropagation(); setBig(big + 1); }}>›</button>
          </div>
        </div>}
        <div className="row">
          <button className="primary" onClick={() => window.open(o.url, '_system')}>Voir sur skitour.fr</button>
          {o.lat != null && o.lon != null && <button onClick={onMap}>Sur la carte</button>}
        </div>
        <p className="hint">Texte de {o.auteurs} sur skitour.fr (CC BY-NC-ND), non modifié.</p>
      </div>
    );
  }

  return (
    <div className="ski-page">
      <div className="travel-head"><b>⛷💬 Sorties ski de rando</b><button onClick={onClose} aria-label="Fermer">✕</button></div>
      <span className="row ski-filters">
        <button className="ski-massifs" onClick={() => setPicking(true)}>
          <small>Massifs</small> {massifs.length === 0 ? 'Tous' : massifs.length === 1 ? massifs[0] : `${massifs.length} massifs`} ▾</button>
        <label className="ski-limit"><small>Limiter à</small>
          <select value={jours} onChange={(e) => setJours(Number(e.target.value))}>
            {LIMITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      </span>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer : sommet, auteur…" />
      {picking && <div className="ski-picker">
        <div className="travel-head"><b>Massifs</b><span>
          <button onClick={() => { setMassifs([]); try { localStorage.setItem('skitourMassifs', '[]'); } catch { /* ignoré */ } }}>Tous</button>
          <button className="primary" onClick={() => setPicking(false)}>OK</button></span></div>
        {groups.map(([g, ms]) => (
          <section key={g}><h3>{g}</h3>
            {ms.map((m) => <label key={m} className="check"><input type="checkbox" checked={massifs.includes(m)} onChange={() => toggleMassif(m)} /> {m}</label>)}
          </section>
        ))}
      </div>}
      {busy && <p className="hint">Chargement des sorties skitour.fr…</p>}
      {error && <p className="error">{error}</p>}
      {offline && list && <p className="hint">📴 Hors ligne : liste du {new Date(list.t).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} ({list.jours} jours).</p>}
      {list && !busy && <p className="hint">{rows.length} sortie{rows.length > 1 ? 's' : ''}</p>}
      <table className="ski-table">
        <thead><tr><th>Date</th><th>Titre</th><th>Auteurs</th></tr></thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} onClick={() => open(o)}>
              <td>{shortDate(o.date)}</td>
              <td><b>{o.titre}</b>{o.etoiles ? <span className="ski-stars"> {'★'.repeat(o.etoiles)}</span> : null}{o.dif_ski ? <span className="ski-dif"> ski {o.dif_ski}</span> : null}<br /><small>{o.massif}{o.skiabilite ? ` · skiabilité ${o.skiabilite}` : ''}</small></td>
              <td>{o.auteurs}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">Données skitour.fr (CC BY-NC-ND pour les récits).</p>
    </div>
  );
}
