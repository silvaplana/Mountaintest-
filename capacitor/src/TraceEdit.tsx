import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { distanceM } from './gps/adaptive';
import { cutSpurs, moveNode, nearestIndex, replaceSlice, snapToWays, splineNodesEvery, wayRunsOf, type Snap } from './trails/edit';
import { fetchWayLines } from './trails/junctions';
import type { LonLat, Trail } from './trails/osmTrails';
import { lineLengthM, routeOnPaths, waypoints } from './trails/route';
import { formatKm } from './track/stats';
import { useSheet } from './useSheet';
import { decalage } from './doigt';

type Outil = 'snap' | 'add' | 'spline';
/** Mode souple : nombre de ronds sur la trace (Peu, Moyen, Beaucoup). */
/** Mode souple : écart entre deux ronds à l'écran (Peu, Moyen, Beaucoup), en pixels ; recalculé quand on zoome. */
const ECART_PX = [110, 70, 45];
/** Couches de la trace dessinée par la carte, cachées pendant qu'un rond glisse (l'ancien tracé ne reste pas). */
const COUCHES_TRACE = ['trail-sel-casing', 'trail-sel', 'way-types-casing', 'way-types', 'way-gr'];
/** Un chemin plus loin que ça d'un point de la trace ne compte pas pour le recoller. */
const NEAR_M = 40;
/** Toucher la trace : à moins de tant de pixels. */
const TAP_PX = 40;

/** ✏ Crayon au trait (bouton du menu de la trace et titre de l'écran Modifier). */
export function PencilIcon({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
      <path d="M3 21l1.3-4.7L15.6 5a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L7.7 19.7z" /><path d="M13.5 7.1l3.4 3.4" /><path d="M3 21l.8-2.9 2.1 2.1z" fill="currentColor" />
    </svg>
  );
}

const ICONS: Record<Outil, ReactNode> = {
  snap: <svg width="34" height="30" viewBox="0 0 34 30" fill="none" strokeLinecap="round" aria-hidden="true"><path d="M2 24h30" stroke="currentColor" strokeWidth="2.4" strokeDasharray="5 3" /><path d="M3 10c5-7 9 3 14-2s9-1 14 3" stroke="#7b3fe4" strokeWidth="2.6" /><path d="M10 13v6m-2.5-2.5L10 19l2.5-2.5M24 13v6m-2.5-2.5L24 19l2.5-2.5" stroke="#2f9e5f" strokeWidth="2" /></svg>,
  add: <svg width="34" height="30" viewBox="0 0 34 30" fill="none" strokeLinecap="round" aria-hidden="true"><path d="M2 22c5-1 7-8 12-9" stroke="#7b3fe4" strokeWidth="2.6" /><path d="M14 13l9-4" stroke="#7b3fe4" strokeWidth="2.6" strokeDasharray="3 3" /><circle cx="24" cy="9" r="3" fill="#fff" stroke="#1d2421" strokeWidth="2" /><path d="M27 21h6m-3-3v6" stroke="#2f9e5f" strokeWidth="2.4" /></svg>,
  spline: <svg width="34" height="30" viewBox="0 0 34 30" fill="none" strokeLinecap="round" aria-hidden="true"><path d="M2 24C8 4 14 4 17 15s9 11 15-6" stroke="#7b3fe4" strokeWidth="2.6" /><circle cx="9" cy="10" r="3" fill="#fff" stroke="#1d2421" strokeWidth="2" /><circle cx="17" cy="15" r="3" fill="#fff" stroke="#1d2421" strokeWidth="2" /><circle cx="26" cy="19" r="3" fill="#fff" stroke="#1d2421" strokeWidth="2" /></svg>,
};
const NOMS: Record<Outil, string> = { snap: 'Recoller', add: 'Prolonger', spline: 'Souple' };

const SRC = 'trace-edit';
const coords = (l: LonLat[]) => l.map((p) => [p.lon, p.lat]);

/** Rond posé sur la carte : zone de 48 px pour le doigt, le rond visible au milieu. */
/** Flèche « Annuler » en gros trait foncé : ↶ seul était pâle et peu clair ; ↷ Refaire enlevé (Seb, 25/11). */
function Fleche() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.8"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

function rond(cls: string, txt = '') {
  const el = document.createElement('div');
  el.className = `edit-rond ${cls}`;
  const i = document.createElement('i');
  i.textContent = txt;
  el.appendChild(i);
  return el;
}

/**
 * Fait glisser un rond au doigt. On ne passe pas par le glisser de MapLibre : sur le téléphone, la carte
 * prenait le doigt et se déplaçait à la place du rond (Seb, 25/11).
 */
function glissable(map: MlMap, mk: maplibregl.Marker, onDrag: (ll: maplibregl.LngLat) => void, onEnd: (ll: maplibregl.LngLat) => void) {
  const el = mk.getElement();
  let actif = false, bouge = false;
  for (const ev of ['mousedown', 'touchstart', 'click', 'dblclick']) el.addEventListener(ev, (e) => e.stopPropagation());
  // L'appui long sur un point ne doit pas aussi poser le gros repère « Point choisi sur la carte » (Seb, 25/11).
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); e.preventDefault();
    el.setPointerCapture(e.pointerId);
    actif = true; bouge = false;
  });
  el.addEventListener('pointermove', (e) => {
    if (!actif) return;
    const r = map.getContainer().getBoundingClientRect();
    const [dx, dy] = decalage();
    mk.setLngLat(map.unproject([e.clientX - r.left + dx, e.clientY - r.top + dy]));
    bouge = true;
    onDrag(mk.getLngLat());
  });
  const fin = () => { if (!actif) return; actif = false; if (bouge) onEnd(mk.getLngLat()); };
  el.addEventListener('pointerup', fin);
  el.addEventListener('pointercancel', fin);
}

/**
 * ✏ Modifier une de mes traces (maquette validée par Seb le 25/11, maquettes/edition-trace/) : même place que
 * le menu de la trace, ← pour y revenir, « Annuler » pour revenir en arrière. Outils : Recoller un morceau sur les
 * chemins (bornes ▶ ■ posées sur la trace), Prolonger la fin (tout droit ou par les chemins), Souple (ronds
 * qu'on fait glisser). Chaque changement est gardé tout de suite dans la trace.
 */
export function TraceEdit({ map, trail, onLine, onBack, onToast }: {
  map: MlMap; trail: Trail; onLine: (line: LonLat[]) => void; onBack: () => void; onToast: (t: string) => void;
}) {
  const sheet = useSheet('modifier');
  const depart = useRef(trail.segments.flat());
  const [hist, setHist] = useState<{ l: LonLat[][]; i: number }>(() => ({ l: [depart.current], i: 0 }));
  const line = hist.l[hist.i];
  const [outil, setOutil] = useState<Outil | null>(null);
  const [A, setA] = useState<number | null>(null);
  const [B, setB] = useState<number | null>(null);
  const [apercu, setApercu] = useState<Snap | 'calcul' | 'erreur' | null>(null);
  const [prolonge, setProlonge] = useState<'droit' | 'chemin'>(() => (localStorage.getItem('prolonge') === 'droit' ? 'droit' : 'chemin'));
  const [densite, setDensite] = useState(1);
  /** Zoom de la carte (au demi-cran) : les ronds se replacent quand il change. */
  const [zoom, setZoom] = useState(() => Math.round(map.getZoom() * 2) / 2);
  useEffect(() => {
    const z = () => setZoom(Math.round(map.getZoom() * 2) / 2);
    map.on('zoomend', z);
    return () => { map.off('zoomend', z); };
  }, [map]);
  const [live, setLive] = useState<LonLat[] | null>(null);
  const arret = useRef<AbortController | null>(null);
  const ronds = useRef<{ line: LonLat[]; nodes: number[]; zoom: number } | null>(null);

  const garder = (l: LonLat[]) => {
    setHist((h) => ({ l: [...h.l.slice(0, h.i + 1), l], i: h.i + 1 }));
    onLine(l);
  };
  const aller = (i: number) => { setHist((h) => ({ ...h, i })); onLine(hist.l[i]); viderBornes(); };
  const viderBornes = () => { arret.current?.abort(); setA(null); setB(null); setApercu(null); };

  // Calques de l'écran : morceau choisi (surligné), aperçu du recollage, trace pendant qu'un rond glisse.
  useEffect(() => {
    map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'edit-hl', type: 'line', source: SRC, filter: ['==', ['get', 'k'], 'hl'], paint: { 'line-color': '#ffd000', 'line-width': 16, 'line-opacity': 0.55 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    map.addLayer({ id: 'edit-live', type: 'line', source: SRC, filter: ['==', ['get', 'k'], 'live'], paint: { 'line-color': trail.color, 'line-width': 5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    map.addLayer({ id: 'edit-on', type: 'line', source: SRC, filter: ['==', ['get', 'k'], 'on'], paint: { 'line-color': '#2f9e5f', 'line-width': 5.5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    map.addLayer({ id: 'edit-off', type: 'line', source: SRC, filter: ['==', ['get', 'k'], 'off'], paint: { 'line-color': '#f08a00', 'line-width': 5.5, 'line-dasharray': [1.4, 1] } });
    return () => {
      arret.current?.abort();
      for (const l of ['edit-hl', 'edit-live', 'edit-on', 'edit-off']) if (map.getLayer(l)) map.removeLayer(l);
      if (map.getSource(SRC)) map.removeSource(SRC);
    };
  }, [map]);

  useEffect(() => {
    const f: GeoJSON.Feature[] = [];
    const add = (k: string, l: LonLat[]) => { if (l.length >= 2) f.push({ type: 'Feature', properties: { k }, geometry: { type: 'LineString', coordinates: coords(l) } }); };
    if (outil === 'snap' && A != null && B != null) add('hl', line.slice(Math.min(A, B), Math.max(A, B) + 1));
    if (outil === 'snap' && apercu && typeof apercu === 'object') {
      // Vert : recollé sur un chemin ; orange pointillé : pas de chemin, le tracé reste.
      let i = 0;
      while (i < apercu.line.length - 1) {
        let j = i;
        while (j < apercu.line.length - 1 && apercu.onWay[j + 1] === apercu.onWay[i]) j++;
        add(apercu.onWay[i] ? 'on' : 'off', apercu.line.slice(i, Math.min(j + 2, apercu.line.length)));
        i = j + 1;
      }
    }
    if (live) add('live', live);
    (map.getSource(SRC) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: f });
  }, [map, outil, A, B, apercu, live, line]);

  // Pendant qu'un rond glisse, la carte ne dessine plus l'ancienne trace : seule la nouvelle se voit.
  const glisse = live != null;
  useEffect(() => {
    if (!glisse) return;
    for (const l of COUCHES_TRACE) if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', 'none');
    if (map.getLayer('trails')) map.setFilter('trails', ['!=', ['get', 'id'], trail.id]);
    return () => {
      for (const l of COUCHES_TRACE) if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', 'visible');
      if (map.getLayer('trails')) map.setFilter('trails', null);
    };
  }, [map, glisse, trail.id]);

  // Bornes ▶ ■ du morceau à recoller : on les fait glisser le long de la trace.
  useEffect(() => {
    if (outil !== 'snap') return;
    const mks: maplibregl.Marker[] = [];
    ([['debut', A, setA, '▶'], ['fin', B, setB, '■']] as const).forEach(([cls, i, set, txt]) => {
      if (i == null) return;
      const mk = new maplibregl.Marker({ element: rond(cls, txt) }).setLngLat([line[i].lon, line[i].lat]).addTo(map);
      // La borne glisse le long de la trace.
      const sur = (ll: maplibregl.LngLat) => nearestIndex(line, { lon: ll.lng, lat: ll.lat }).i;
      glissable(map, mk, (ll) => { const k = sur(ll); mk.setLngLat([line[k].lon, line[k].lat]); }, (ll) => set(sur(ll)));
      mks.push(mk);
    });
    return () => mks.forEach((m) => m.remove());
  }, [map, outil, A, B, line]);

  // Les deux bornes posées : on cherche les chemins autour du morceau et on prépare l'aperçu.
  useEffect(() => {
    if (outil !== 'snap' || A == null || B == null || A === B) { setApercu(null); return; }
    const seg = line.slice(Math.min(A, B), Math.max(A, B) + 1);
    arret.current?.abort();
    const ctrl = new AbortController();
    arret.current = ctrl;
    setApercu('calcul');
    void (async () => {
      try {
        const ways = await fetchWayLines(seg, NEAR_M + 10, ctrl.signal);
        const snap = snapToWays(seg, ways, NEAR_M);
        // Sur un chemin, on suit son vrai tracé (lacets compris) avec le calcul d'itinéraire IGN, si le réseau le permet.
        const out: LonLat[] = [], on: boolean[] = [];
        let k = 0;
        for (const [a, b] of wayRunsOf(snap)) {
          for (; k < a; k++) { out.push(snap.line[k]); on.push(snap.onWay[k]); }
          const run = snap.line.slice(a, b + 1);
          let path = run;
          try {
            const r = await routeOnPaths(waypoints(run, 8), ctrl.signal);
            if (lineLengthM(r) <= 3 * lineLengthM(run) + 100) path = cutSpurs([run[0], ...r, run[run.length - 1]], run);
          } catch (e) { if (ctrl.signal.aborted) throw e; }
          path.forEach((p) => { out.push(p); on.push(true); });
          k = b + 1;
        }
        for (; k < snap.line.length; k++) { out.push(snap.line[k]); on.push(snap.onWay[k]); }
        if (!ctrl.signal.aborted) setApercu({ line: out, onWay: on, share: snap.share });
      } catch { if (!ctrl.signal.aborted) setApercu('erreur'); }
    })();
    return () => ctrl.abort();
  }, [outil, A, B, line]);

  // Mode souple : les ronds, qu'on fait glisser du doigt ; la trace suit en douceur entre ses deux voisins.
  useEffect(() => {
    if (outil !== 'spline') return;
    // Après un glissé, les ronds restent où on les a laissés ; sinon ils sont répartis le long de la trace.
    // Écart en mètres pour ECART_PX pixels à ce zoom (tuiles de 512 px).
    const lat = line[0]?.lat ?? 45;
    const mParPx = (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
    const nodes = ronds.current?.line === line && ronds.current.zoom === zoom ? ronds.current.nodes : splineNodesEvery(line, ECART_PX[densite] * mParPx);
    const mks = nodes.map((i, k) => {
      const mk = new maplibregl.Marker({ element: rond('souple') }).setLngLat([line[i].lon, line[i].lat]).addTo(map);
      const at = (ll: maplibregl.LngLat) => moveNode(line, nodes, k, { lon: ll.lng, lat: ll.lat });
      glissable(map, mk, (ll) => setLive(at(ll).line), (ll) => { const r = at(ll); ronds.current = { ...r, zoom }; setLive(null); garder(r.line); });
      return mk;
    });
    return () => mks.forEach((m) => m.remove());
  }, [map, outil, densite, line, zoom]);

  // 🏁 Prolonger : le bout de la trace.
  useEffect(() => {
    if (outil !== 'add') return;
    const f = line[line.length - 1];
    const mk = new maplibregl.Marker({ element: rond('bout', '🏁') }).setLngLat([f.lon, f.lat]).addTo(map);
    return () => { mk.remove(); };
  }, [map, outil, line]);

  // Toucher la carte : borne du morceau (Recoller) ou nouveau bout de trace (Prolonger).
  const etat = useRef({ outil, A, B, line, prolonge });
  etat.current = { outil, A, B, line, prolonge };
  useEffect(() => {
    const click = (e: maplibregl.MapMouseEvent) => {
      const s = etat.current, p = { lon: e.lngLat.lng, lat: e.lngLat.lat };
      if (s.outil === 'snap' && (s.A == null || s.B == null)) {
        const { i } = nearestIndex(s.line, p);
        const q = map.project([s.line[i].lon, s.line[i].lat]);
        if (Math.hypot(q.x - e.point.x, q.y - e.point.y) > TAP_PX) { onToast('Touche sur la trace'); return; }
        if (s.A == null) setA(i); else setB(i);
      } else if (s.outil === 'add') void prolonger(p);
    };
    map.on('click', click);
    return () => { map.off('click', click); };
  }, [map]);

  async function prolonger(p: LonLat) {
    const l = etat.current.line, fin = l[l.length - 1];
    if (etat.current.prolonge === 'droit') { garder([...l, p]); return; }
    try {
      const r = await routeOnPaths([fin, p]);
      garder([...l, ...r.slice(distanceM(r[0], fin) < 1 ? 1 : 0), p]);
    } catch {
      onToast('Pas de chemin trouvé (pas de réseau ?) : ajouté tout droit');
      garder([...l, p]);
    }
  }

  function recoller() {
    if (!apercu || typeof apercu !== 'object' || A == null || B == null) return;
    // L'aperçu va du plus petit au plus grand indice, comme replaceSlice.
    garder(replaceSlice(line, A, B, apercu.line));
    viderBornes();
    onToast('✓ Morceau recollé');
  }

  const km = lineLengthM(line), dk = (km - lineLengthM(depart.current)) / 1000;
  const choisir = (o: Outil) => { viderBornes(); setOutil(outil === o ? null : o); };

  let aide: ReactNode;
  if (!outil) aide = <p className="edit-aide muted">Choisis un outil. Tout s’annule avec « Annuler ».</p>;
  else if (outil === 'snap') {
    if (A == null) aide = <>
      <p className="edit-aide"><span className="edit-n debut">▶</span>Touche le <b>début</b> du morceau sur la trace</p>
      <div className="survol-choix"><button onClick={() => { setA(0); setB(line.length - 1); }}>⇤⇥ Toute la trace</button></div></>;
    else if (B == null) aide = <>
      <p className="edit-aide"><span className="edit-n fin">■</span>Touche la <b>fin</b> du morceau</p>
      <div className="survol-choix"><button onClick={() => setB(line.length - 1)}>⇥ Jusqu’au bout</button></div></>;
    else aide = <>
      {apercu === 'calcul' && <p className="edit-aide muted">Recherche des chemins…</p>}
      {apercu === 'erreur' && <p className="edit-aide">Chemins introuvables : il faut du réseau pour recoller.</p>}
      {apercu && typeof apercu === 'object' && <p className="edit-aide small">Chemin trouvé sur <b>{apercu.share} %</b> du morceau.
        <i className="edit-leg on" /> recollé <i className="edit-leg off" /> pas de chemin, ton tracé reste</p>}
      <div className="edit-actions">
        <button onClick={viderBornes} aria-label="Annuler ce morceau">✕</button>
        <button className="primary" disabled={!apercu || typeof apercu !== 'object'} onClick={recoller}>✓ Recoller</button>
      </div></>;
  } else if (outil === 'add') aide = <>
    <p className="edit-aide">Touche la carte : la trace s’allonge jusque-là 🏁</p>
    <div className="survol-choix">
      {(['droit', 'chemin'] as const).map((v) => <button key={v} className={prolonge === v ? 'on' : ''}
        onClick={() => { setProlonge(v); try { localStorage.setItem('prolonge', v); } catch { /* ignoré */ } }}>{v === 'droit' ? '📏 Tout droit' : '🥾 Par les chemins'}</button>)}
    </div></>;
  else aide = <>
    <p className="edit-aide">Fais glisser un rond : la trace suit en douceur</p>
    {/* « Peu / Moyen / Beaucoup » ne disait pas que c'est le nombre de ronds (Seb, 25/11) : on les dessine. */}
    <div className="survol-choix edit-ronds"><span>Ronds :</span>{['Peu', 'Moyen', 'Beaucoup'].map((n, i) => (
      <button key={n} aria-label={`${n} de ronds`} className={densite === i ? 'on' : ''} onClick={() => { ronds.current = null; setDensite(i); }}>
        {Array.from({ length: i + 1 }, (_, k) => <i key={k} />)}
      </button>))}</div></>;

  return (
    <section className={`trace-menu survol trace-edit${sheet.classe}`}>
      <div {...sheet.prise}><div className="handle" />
      <div className="head">
        <button className="retour" onClick={onBack} aria-label="Retour au menu de la trace">←</button>
        <b><span style={{ color: trail.color, display: 'flex' }}><PencilIcon size={24} /></span> Modifier</b>
        <button className="annuler" disabled={hist.i === 0} onClick={() => aller(hist.i - 1)}><Fleche />Annuler</button>
      </div></div>
      <span className="hint">{formatKm(km)}{Math.abs(dk) >= 0.05 && <b className={dk < 0 ? 'edit-moins' : 'edit-plus'}> ({dk > 0 ? '+' : ''}{dk.toFixed(1).replace('.', ',')} km)</b>}</span>
      <div className="edit-outils">
        {(Object.keys(NOMS) as Outil[]).map((o) => (
          <button key={o} className={outil === o ? 'on' : ''} onClick={() => choisir(o)}>{ICONS[o]}<span>{NOMS[o]}</span></button>
        ))}
      </div>
      {aide}
    </section>
  );
}
