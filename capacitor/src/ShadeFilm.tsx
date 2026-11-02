import type { ImageSource, Map as MlMap } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import type { Bbox } from './config';
import { gridBbox, gridFor, loadGrid, type DemGrid, type GridSpec } from './shade/dem';
import { computeFrame, filmTimes, framePixels, hhmm, startIndex, todayIso } from './shade/film';
import { NIGHT } from './shade/shadow';
import { compass, type SunPos } from './shade/sun';

/** Une image du film prête à l'affichage. */
interface Frame { time: Date; sun: SunPos; ratio: number; url: string }

const SRC = 'shade';
/** Durée d'une image pendant la lecture. */
const FRAME_MS = 900;

function viewBbox(m: MlMap): Bbox {
  const b = m.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

/** La grille déjà calculée couvre-t-elle encore la vue (même zoom de relief) ? */
function covers(cur: GridSpec, need: GridSpec, margin = 1): boolean {
  return cur.z === need.z
    && need.x0 + margin >= cur.x0 && need.y0 + margin >= cur.y0
    && need.x0 + need.nx - margin <= cur.x0 + cur.nx && need.y0 + need.ny - margin <= cur.y0 + cur.ny;
}

function toBlobUrl(codes: Uint8Array, w: number, h: number): Promise<string> {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.putImageData(new ImageData(framePixels(codes) as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  return new Promise((ok, ko) => c.toBlob((b) => (b ? ok(URL.createObjectURL(b)) : ko(new Error('image'))), 'image/png'));
}

const pause = () => new Promise((r) => setTimeout(r, 0));

/**
 * Film des ombres du relief, de 8 h à midi toutes les 30 min : calculé sur le téléphone
 * (relief IGN gardé sur le disque), affiché par-dessus la carte avec l'heure en gros.
 */
export function ShadeFilm({ map, hidden, onClose }: { map: MlMap; hidden?: boolean; onClose: () => void }) {
  const [day, setDay] = useState(todayIso());
  const [frames, setFrames] = useState<Frame[]>([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [msg, setMsg] = useState('');
  const grid = useRef<DemGrid | null>(null);
  const run = useRef(0);
  const [gridVersion, setGridVersion] = useState(0);

  // Relief de la vue : chargé à l'ouverture, puis seulement si la carte sort de la zone calculée.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const abort = { ctl: null as AbortController | null };
    const refresh = async () => {
      const need = gridFor(viewBbox(map), map.getZoom());
      if (grid.current && covers(grid.current.spec, need)) return;
      abort.ctl?.abort();
      const ctl = new AbortController();
      abort.ctl = ctl;
      setMsg('Relief : chargement…');
      try {
        const g = await loadGrid(need, ctl.signal, (d, t) => setMsg(`Relief : ${d}/${t} tuiles`));
        if (ctl.signal.aborted) return;
        if (g.missing === need.nx * need.ny) { setMsg('Relief indisponible ici (hors ligne ? télécharge la zone d\'abord).'); return; }
        grid.current = g;
        setGridVersion((v) => v + 1);
      } catch { /* annulé */ }
    };
    const onMove = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => void refresh(), 700); };
    void refresh();
    map.on('moveend', onMove);
    return () => { map.off('moveend', onMove); if (timer) clearTimeout(timer); abort.ctl?.abort(); };
  }, [map]);

  // Images du film (24 h) : recalculées quand le relief ou la date changent. Elles arrivent une à une :
  // le film se regarde pendant le calcul. Les images de nuit partagent une seule image.
  const owned = useRef<string[]>([]);
  useEffect(() => {
    const g = grid.current;
    if (!g) return;
    const my = ++run.current;
    owned.current.forEach((u) => URL.revokeObjectURL(u));
    owned.current = [];
    const made: Frame[] = [];
    setFrames([]);
    setIdx(startIndex(day));
    (async () => {
      const times = filmTimes(day);
      const t0 = performance.now();
      let nightUrl: string | null = null;
      for (let i = 0; i < times.length; i++) {
        setMsg(`Ombres : ${i + 1}/${times.length}`);
        await pause();
        if (run.current !== my) return;
        const f = computeFrame(g, times[i]);
        let url: string;
        if (f.codes) url = await toBlobUrl(f.codes, g.w, g.h);
        else url = nightUrl ??= await toBlobUrl(new Uint8Array(g.w * g.h).fill(NIGHT), g.w, g.h);
        if (run.current !== my) { URL.revokeObjectURL(url); return; }
        if (!owned.current.includes(url)) owned.current.push(url);
        made.push({ time: f.time, sun: f.sun, ratio: f.ratio, url });
        setFrames([...made]);
      }
      setMsg(g.missing ? `${g.missing} tuile(s) de relief manquante(s) : ombres incomplètes.` : `Calculé en ${((performance.now() - t0) / 1000).toFixed(1).replace('.', ',')} s sur le téléphone.`);
    })();
  }, [gridVersion, day]);

  // Affichage de l'image courante sur la carte (la dernière calculée si elle n'est pas encore prête).
  useEffect(() => {
    const f = frames[idx] ?? frames[frames.length - 1];
    const g = grid.current;
    if (!f || !g) return;
    const [w, s, e, n] = gridBbox(g.spec);
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [[w, n], [e, n], [e, s], [w, s]];
    const src = map.getSource(SRC) as ImageSource | undefined;
    if (src) src.updateImage({ url: f.url, coordinates });
    else {
      map.addSource(SRC, { type: 'image', url: f.url, coordinates });
      // Sous les forêts et les tracés, au-dessus du fond de carte.
      map.addLayer({ id: SRC, type: 'raster', source: SRC, paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' } },
        map.getLayer('forests') ? 'forests' : undefined);
    }
  }, [frames, idx, map]);

  useEffect(() => () => {
    if (map.getLayer(SRC)) map.removeLayer(SRC);
    if (map.getSource(SRC)) map.removeSource(SRC);
  }, [map]);
  useEffect(() => () => owned.current.forEach((u) => URL.revokeObjectURL(u)), []);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % frames.length), FRAME_MS);
    return () => clearInterval(t);
  }, [playing, frames.length]);

  const f = frames[idx] ?? frames[frames.length - 1];
  return (
    <div className="shade-bar" hidden={hidden}>
      <div className="shade-head">
        <b className="shade-time">{f ? hhmm(f.time) : '--:--'}</b>
        <span className="shade-sun">{f ? (f.sun.altitude > 0
          ? `☀ ${Math.round(f.sun.altitude)}° · ${compass(f.sun.azimuth)} (${Math.round(f.sun.azimuth)}°)`
          : '☾ soleil couché') : msg}</span>
        <button onClick={onClose} aria-label="Fermer les ombres">✕</button>
      </div>
      {/* Curseur large, avec − / + pour reculer ou avancer de 30 min (une image). */}
      <div className="row shade-slider">
        <button className="step" disabled={!frames.length} aria-label="30 min plus tôt"
          onClick={() => { setPlaying(false); setIdx((i) => Math.max(0, Math.min(i, frames.length - 1) - 1)); }}>−</button>
        <input type="range" className="big" min={0} max={Math.max(0, frames.length - 1)} value={Math.min(idx, Math.max(0, frames.length - 1))} disabled={!frames.length}
          onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }} />
        <button className="step" disabled={!frames.length} aria-label="30 min plus tard"
          onClick={() => { setPlaying(false); setIdx((i) => Math.min(frames.length - 1, i + 1)); }}>+</button>
      </div>
      <div className="row">
        <button className="play" disabled={frames.length < 2} onClick={() => setPlaying(!playing)}
          aria-label={playing ? 'Pause' : 'Lire le film'}>{playing ? '⏸' : '▶'}</button>
        <input type="date" value={day} onChange={(e) => { if (e.target.value) setDay(e.target.value); }} />
      </div>
      {f && msg && <p className="hint">{msg}</p>}
    </div>
  );
}
