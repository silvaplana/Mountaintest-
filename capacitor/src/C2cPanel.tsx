import { useEffect, useMemo, useState } from 'react';
import { type Bike, byDistance, C2C_ATTRIBUTION, fetchRoutes, fetchSheet, formatDurations, savedSheet,
  type C2cActivity, type C2cRoute, type C2cSheet } from './topos/c2c';
import { fetchGeotrek, GEOTREK_ATTRIBUTION } from './topos/geotrek';
import { fetchOtherSheet, loadHiddenSources, savedOtherSheet, SOURCES, srcAttribution, srcKey, srcLabel, srcLink,
  toggleSource } from './topos/sources';
import type { LonLat } from './trails/osmTrails';
import { fetchVgpx, VGPX_ATTRIBUTION } from './topos/visugpx';

const km = (m: number) => `${(m / 1000).toFixed(1).replace('.', ',')} km`;
const LIST_KEY = (act: C2cActivity) => `c2cListe:${act}`;

/**
 * Une source passant par le relais (VisuGPX, Geotrek) : sa liste, gardée sur le téléphone pour le hors ligne,
 * et un message si elle ne répond pas (les autres sources s'affichent quand même).
 */
function useRelaySource(name: string, storeKey: string, load: () => Promise<C2cRoute[]>, deps: unknown[]) {
  const [list, setList] = useState<C2cRoute[] | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    let live = true;
    setList(null); setMsg('');
    load().then((r) => {
      if (!live) return;
      setList(r);
      try { localStorage.setItem(storeKey, JSON.stringify(r)); } catch { /* plein */ }
    }).catch((e) => {
      if (!live) return;
      try {
        const saved = JSON.parse(localStorage.getItem(storeKey) ?? 'null') as C2cRoute[] | null;
        if (saved) { setList(saved); setMsg(`📴 ${name} : dernière liste chargée.`); return; }
      } catch { /* rien */ }
      setList([]); setMsg(`${name} indisponible : ${(e as Error).message}`);
    });
    return () => { live = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return [list, msg] as const;
}

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
 * Les circuits VisuGPX (par le relais du VPS, qui garde la clé) et les itinéraires Geotrek (parcs, départements)
 * s'ajoutent à la même liste, présentés pareil et marqués de leur source (« VisuGPX », « Geotrek · Écrins »).
 */
export function C2cPanel({ act, bike, bbox, center, onRoutes, pick, onShowLine, onMap, hidden, onClose, password }: {
  /** Mot de passe du relais (VisuGPX, Geotrek). */
  password: string;
  /** Mode vélo : 🚵 VTT (Camptocamp, VisuGPX, Geotrek), 🚴 route ou 🚲 gravel (VisuGPX, Geotrek). */
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
  /** Camptocamp n'a pas de vélo de route ni de gravel : pastille masquée dans ces modes. */
  const withC2c = !bike || bike === 'vtt';
  const [routes, setRoutes] = useState<C2cRoute[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState<C2cSheet | C2cRoute | null>(null);
  const [sheetMsg, setSheetMsg] = useState('');

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
  const velo = act === 'mountain_biking';
  const [vgpx, vgpxMsg] = useRelaySource('VisuGPX', `vgpxListe:${act}`, () => fetchVgpx(center, velo, password), [bbox, act]);
  const [geotrek, geotrekMsg] = useRelaySource('Geotrek', `geotrekListe:${act}`, () => fetchGeotrek(center, velo, password), [bbox, act]);
  const all = useMemo(() => (routes || vgpx || geotrek ? [...(routes ?? []), ...(vgpx ?? []), ...(geotrek ?? [])] : null),
    [routes, vgpx, geotrek]);

  const [hiddenSrc, setHiddenSrc] = useState(loadHiddenSources);
  /** Itinéraires du mode (🚵 VTT, 🚴 route, 🚲 gravel), toutes sources : comptés sur les pastilles. */
  const ofMode = useMemo(() => (all ?? []).filter((r) => !bike || (r.src ? r.bike : 'vtt') === bike), [all, bike]);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return byDistance(ofMode.filter((r) => (!t || r.title.toLowerCase().includes(t)) && !hiddenSrc.includes(srcKey(r))), center);
  }, [ofMode, q, center, hiddenSrc]);
  // Sur la carte, seulement ceux du mode (🚵 VTT, 🚴 route, 🚲 gravel).
  useEffect(() => onRoutes(rows.map((x) => x.r)), [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (r: C2cRoute) => {
    setSheetMsg('');
    if (r.src) {
      setSheet(savedOtherSheet(r) ?? { ...r, summary: '' });
      fetchOtherSheet(r, password).then(setSheet).catch((e) => setSheetMsg(`Tracé indisponible : ${(e as Error).message}`));
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
          {srcLink(sheet).url && <button onClick={() => window.open(srcLink(sheet).url, '_system')}>{srcLink(sheet).label}</button>}
        </div>
        {full && !full.line.length && <p className="hint">Pas de tracé pour cet itinéraire.</p>}
        <p className="hint">{srcAttribution(sheet)}</p>
      </div>
    );
  }

  return (
    <div className="ski-page">
      <div className="travel-head"><b className="ski-head-title">{icon} {what}
        <button className="ski-map-btn" onClick={onMap} aria-label="Itinéraires tracés sur la carte">🗺</button></b>
        <button className="close" onClick={onClose} aria-label="Fermer">✕</button></div>
      <input type="search" placeholder="Chercher un nom" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="src-chips">
        {SOURCES.filter((x) => x.key !== 'c2c' || withC2c).map((x) => (
          <button key={x.key} className={hiddenSrc.includes(x.key) ? '' : 'on'} aria-pressed={!hiddenSrc.includes(x.key)}
            onClick={() => setHiddenSrc((h) => toggleSource(h, x.key))}>
            {hiddenSrc.includes(x.key) ? '○' : '✓'} {x.name} {ofMode.filter((r) => srcKey(r) === x.key).length}
          </button>
        ))}
      </div>
      {busy && <p className="hint">Recherche des itinéraires de l'écran…</p>}
      {error && <p className="error">{error}</p>}
      {offline && <p className="hint">📴 Hors ligne : dernière liste chargée.</p>}
      {(vgpx == null || geotrek == null) && <p className="hint">Recherche des circuits VisuGPX et Geotrek…</p>}
      {vgpxMsg && <p className="hint">{vgpxMsg}</p>}
      {geotrekMsg && <p className="hint">{geotrekMsg}</p>}
      {all && !busy && <p className="hint">{rows.length} itinéraire{rows.length > 1 ? 's' : ''}, toutes dates, du plus proche au plus loin du centre de l'écran.</p>}
      <table className="ski-table">
        <tbody>
          {rows.map(({ r, d }) => (
            <tr key={r.id} onClick={() => open(r)}>
              <td>{km(d)}</td>
              <td><b>{r.title}</b><br /><small>{[srcLabel(r), routeInfo(r)].filter(Boolean).join(' · ')}</small></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">Données {C2C_ATTRIBUTION}. {VGPX_ATTRIBUTION}. {GEOTREK_ATTRIBUTION}.</p>
    </div>
  );
}
