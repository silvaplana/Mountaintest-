import { useEffect, useMemo, useState } from 'react';
import { type Bike, byDistance, C2C_ATTRIBUTION, c2cLink, fetchRoutes, fetchSheet, formatDurations, savedSheet,
  type C2cActivity, type C2cRoute, type C2cSheet } from './topos/c2c';
import type { LonLat } from './trails/osmTrails';
import { fetchVgpx, fetchVgpxSheet, savedVgpxSheet, VGPX_ATTRIBUTION, vgpxLink } from './topos/visugpx';

const km = (m: number) => `${(m / 1000).toFixed(1).replace('.', ',')} km`;
const LIST_KEY = (act: C2cActivity) => `c2cListe:${act}`;
const VGPX_KEY = (act: C2cActivity) => `vgpxListe:${act}`;

/** Ligne d'infos d'un itinéraire : cotation, dénivelé, longueur, altitude max. */
export function routeInfo(r: C2cRoute) {
  return [r.rating, r.heightUpM != null ? `D+ ${r.heightUpM} m` : '', r.lengthM ? km(r.lengthM) : '',
    r.elevMaxM != null ? `${r.elevMaxM} m max` : '', formatDurations(r.durations)].filter(Boolean).join(' · ');
}

/**
 * 🥾 / 🚵 Itinéraires Camptocamp de l'écran affiché, sur le modèle des sorties skitour : liste puis fiche.
 * Pas de filtre de date (en rando et en VTT on veut tous les topos) : du plus proche au plus loin du centre
 * de l'écran. La dernière liste et les fiches ouvertes sont gardées sur le téléphone (hors ligne).
 * « 🗺 Sur la carte » ajoute le tracé à Mes traces (profil, type de chemin, ▶ Commencer, 📶 Hors ligne).
 * Les circuits VisuGPX (par le relais du VPS, qui garde la clé) s'ajoutent à la même liste, marqués « VisuGPX ».
 */
export function C2cPanel({ act, bike, bbox, center, onRoutes, pick, onShowLine, onMap, hidden, onClose, password }: {
  /** Mot de passe du relais (circuits VisuGPX). */
  password: string;
  /** Mode vélo : 🚵 VTT (Camptocamp + VisuGPX), 🚴 route ou 🚲 gravel (VisuGPX seulement). */
  bike?: Bike;
  act: C2cActivity;
  /** Cadre de l'écran affiché quand le panneau s'ouvre, et son centre (tri par distance). */
  bbox: [number, number, number, number]; center: LonLat;
  /** Itinéraires trouvés : un point chacun sur la carte. */
  onRoutes: (r: C2cRoute[]) => void;
  /** Itinéraire touché sur la carte : sa fiche s'ouvre. */
  pick: { id: number } | null;
  onShowLine: (s: C2cSheet) => void; onClose: () => void;
  /** 🗺 à droite du titre : les itinéraires tracés sur la carte (le panneau se cache). */
  onMap: () => void; hidden: boolean;
}) {
  const icon = act === 'hiking' ? '🥾' : bike === 'route' ? '🚴' : bike === 'gravel' ? '🚲' : '🚵';
  const what = act === 'hiking' ? 'Randos' : bike === 'route' ? 'Vélo de route' : bike === 'gravel' ? 'Gravel' : 'Itinéraires VTT';
  /** Camptocamp n'a pas de vélo de route ni de gravel : VisuGPX seul dans ces modes. */
  const withC2c = !bike || bike === 'vtt';
  const [routes, setRoutes] = useState<C2cRoute[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState<C2cSheet | C2cRoute | null>(null);
  const [sheetMsg, setSheetMsg] = useState('');
  const [vgpx, setVgpx] = useState<C2cRoute[] | null>(null);
  const [vgpxMsg, setVgpxMsg] = useState('');

  useEffect(() => {
    let live = true;
    setBusy(true); setError(''); setOffline(false);
    if (!withC2c) { setRoutes(null); setBusy(false); return; }
    fetchRoutes(bbox, act).then((r) => {
      if (!live) return;
      setRoutes(r);
      try { localStorage.setItem(LIST_KEY(act), JSON.stringify(r)); } catch { /* plein */ }
    }).catch((e) => {
      if (!live) return;
      try {
        const saved = JSON.parse(localStorage.getItem(LIST_KEY(act)) ?? 'null') as C2cRoute[] | null;
        if (saved) { setRoutes(saved); setOffline(true); return; }
      } catch { /* rien */ }
      setError(`Camptocamp injoignable (pas de réseau ?) : ${(e as Error).message}`);
    }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [bbox, act]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    setVgpx(null); setVgpxMsg('');
    fetchVgpx(center, act === 'mountain_biking', password).then((r) => {
      if (!live) return;
      setVgpx(r);
      try { localStorage.setItem(VGPX_KEY(act), JSON.stringify(r)); } catch { /* plein */ }
    }).catch((e) => {
      if (!live) return;
      try {
        const saved = JSON.parse(localStorage.getItem(VGPX_KEY(act)) ?? 'null') as C2cRoute[] | null;
        if (saved) { setVgpx(saved); setVgpxMsg('📴 VisuGPX : dernière liste chargée.'); return; }
      } catch { /* rien */ }
      setVgpx([]); setVgpxMsg(`VisuGPX indisponible : ${(e as Error).message}`);
    });
    return () => { live = false; };
  }, [bbox, act]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => (routes || vgpx ? [...(routes ?? []), ...(vgpx ?? [])] : null), [routes, vgpx]);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return byDistance((all ?? []).filter((r) => (!t || r.title.toLowerCase().includes(t))
      && (!bike || (r.src ? r.bike : 'vtt') === bike)), center);
  }, [all, q, center, bike]);
  // Sur la carte, seulement ceux du mode (🚵 VTT, 🚴 route, 🚲 gravel).
  useEffect(() => onRoutes(rows.map((x) => x.r)), [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (r: C2cRoute) => {
    setSheetMsg('');
    if (r.src) {
      setSheet(savedVgpxSheet(r) ?? { ...r, summary: '' });
      fetchVgpxSheet(r, password).then(setSheet).catch((e) => setSheetMsg(`Tracé indisponible : ${(e as Error).message}`));
      return;
    }
    setSheet(savedSheet(r.id) ?? r);
    fetchSheet(r.id).then(setSheet).catch((e) => setSheetMsg(`Fiche complète indisponible (pas de réseau ?) : ${(e as Error).message}`));
  };
  useEffect(() => {
    const r = pick ? all?.find((x) => x.id === pick.id) : null;
    if (r) open(r);
  }, [pick]); // eslint-disable-line react-hooks/exhaustive-deps

  if (hidden) return null;
  if (sheet) {
    const full = 'line' in sheet ? sheet : null;
    const desc = full?.description || (sheet.src ? sheet.vdesc : '');
    return (
      <div className="ski-page">
        <div className="travel-head"><button onClick={() => setSheet(null)}>← Liste</button>
          <button className="close" onClick={onClose} aria-label="Fermer">✕</button></div>
        <div className="ski-title"><h2>{sheet.title}</h2></div>
        <p className="ski-meta">{routeInfo(sheet)}</p>
        {sheetMsg && <p className="hint">{sheetMsg}</p>}
        {sheet.summary && <p className="ski-text"><b>{sheet.summary}</b></p>}
        {desc && <><h3>Description</h3><p className="ski-text">{desc}</p></>}
        <div className="row">
          <button className="primary" disabled={!full?.line.length} onClick={() => full && onShowLine(full)}>🗺 Sur la carte</button>
          {sheet.src
            ? <button onClick={() => window.open(vgpxLink(sheet.vid ?? ''), '_system')}>Voir sur visugpx.com</button>
            : <button onClick={() => window.open(c2cLink(sheet.id), '_system')}>Voir sur camptocamp.org</button>}
        </div>
        {full && !full.line.length && <p className="hint">Pas de tracé pour cet itinéraire.</p>}
        <p className="hint">{sheet.src ? `${VGPX_ATTRIBUTION}.` : `Texte ${C2C_ATTRIBUTION}, non modifié.`}</p>
      </div>
    );
  }

  return (
    <div className="ski-page">
      <div className="travel-head"><b className="ski-head-title">{icon} {what}
        <button className="ski-map-btn" onClick={onMap} aria-label="Itinéraires tracés sur la carte">🗺</button></b>
        <button className="close" onClick={onClose} aria-label="Fermer">✕</button></div>
      <input type="search" placeholder="Chercher un nom" value={q} onChange={(e) => setQ(e.target.value)} />
      {busy && <p className="hint">Recherche des itinéraires de l'écran…</p>}
      {error && <p className="error">{error}</p>}
      {offline && <p className="hint">📴 Hors ligne : dernière liste chargée.</p>}
      {vgpx == null && <p className="hint">Recherche des circuits VisuGPX…</p>}
      {vgpxMsg && <p className="hint">{vgpxMsg}</p>}
      {all && !busy && <p className="hint">{rows.length} itinéraire{rows.length > 1 ? 's' : ''}, toutes dates, du plus proche au plus loin du centre de l'écran.</p>}
      <table className="ski-table">
        <tbody>
          {rows.map(({ r, d }) => (
            <tr key={r.id} onClick={() => open(r)}>
              <td>{km(d)}</td>
              <td><b>{r.title}</b><br /><small>{[r.src ? 'VisuGPX' : 'Camptocamp', routeInfo(r)].filter(Boolean).join(' · ')}</small></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">Données {C2C_ATTRIBUTION}. {VGPX_ATTRIBUTION}.</p>
    </div>
  );
}
