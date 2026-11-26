import type { Map as MlMap } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import type { LonLat } from './trails/osmTrails';
import { decalage, main } from './doigt';

/**
 * Tracé au doigt : la carte reste libre (on la déplace et on zoome comme d'habitude) ; un APPUI LONG d'un doigt
 * démarre le trait (petite vibration), puis on glisse sans lever (Seb, 25/11 : le premier contact traçait).
 * Au lâcher, on convertit en coordonnées (même principe côté Kotlin, DrawPathView).
 */
const APPUI_MS = 450, TRES_LONG_MS = 1400;
export function DrawOverlay({ map, onPaths, setOnPaths, onDone, onCancel, onLoad, onStart, rec, onSelect }: {
  map: MlMap; onPaths: boolean; setOnPaths: (v: boolean) => void;
  onDone: (line: LonLat[]) => void; onCancel: () => void;
  /** 📂 Charger des traces : écran avec 📥 Ouvrir un fichier puis Mes traces. */
  onLoad: () => void;
  /** ▶ Commencer une nouvelle trace sans parcours prévu : le chemin parcouru se dessine au fur et à mesure. */
  onStart: () => void;
  /** Nouvelle trace en cours (commencée ici) : ⏸ / ▶ et ⏹ Terminer à la place de ▶ Commencer. */
  rec: { paused: boolean; onPause: () => void; onResume: () => void; onStop: () => void } | null;
  /** Appui TRÈS long sans bouger : rectangle de sélection des traces (point de départ, pixels de la carte). */
  onSelect: (p: { x: number; y: number }) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const pts = useRef<[number, number][]>([]);
  const [path, setPath] = useState('');
  /** ⊕ Viseur : là où le trait se pose, 1 cm au-dessus du doigt. */
  const [vis, setVis] = useState<[number, number] | null>(null);

  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = el.current!.getBoundingClientRect();
    const [dx, dy] = decalage();
    return [e.clientX - r.left + dx, e.clientY - r.top + dy];
  };
  const toD = (p: [number, number][]) => p.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const cb = useRef({ onDone, onSelect });
  cb.current = { onDone, onSelect };

  useEffect(() => {
    const zone = map.getCanvasContainer();
    let doigts = 0, minuterie: ReturnType<typeof setTimeout> | null = null, t0: { x: number; y: number } | null = null, trace = false;
    let tresLong: ReturnType<typeof setTimeout> | null = null;
    const annule = () => { if (minuterie) clearTimeout(minuterie); minuterie = null; };
    const annuleTresLong = () => { if (tresLong) clearTimeout(tresLong); tresLong = null; };
    const fin = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      map.dragPan.enable(); map.touchZoomRotate.enable();
    };
    const move = (e: PointerEvent) => {
      if (!trace) return;
      e.stopPropagation();
      if (t0 && Math.hypot(e.clientX - t0.x, e.clientY - t0.y) > 8) annuleTresLong();
      const p = local(e), last = pts.current[pts.current.length - 1];
      setVis(p);
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 6) return;
      pts.current.push(p);
      setPath(toD(pts.current));
    };
    const up = () => {
      if (!trace) return;
      annuleTresLong();
      trace = false; fin(); setVis(null);
      const p = pts.current;
      pts.current = [];
      let len = 0;
      for (let i = 1; i < p.length; i++) len += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      if (len < 40) { setPath(''); return; } // trop court : on recommence
      // Le calque couvre exactement la carte : mêmes coordonnées écran.
      cb.current.onDone(p.map(([x, y]) => { const ll = map.unproject([x, y]); return { lon: ll.lng, lat: ll.lat }; }));
    };
    const down = (e: PointerEvent) => {
      doigts++;
      annule();
      if (doigts > 1 || trace) return; // deux doigts : on zoome
      t0 = { x: e.clientX, y: e.clientY };
      const depart = e;
      minuterie = setTimeout(() => {
        minuterie = null;
        if (doigts !== 1) return;
        // L'appui long démarre le trait : la carte ne bouge plus jusqu'au lâcher.
        trace = true;
        map.dragPan.disable(); map.touchZoomRotate.disable();
        navigator.vibrate?.(30);
        pts.current = [local(depart)]; setVis(local(depart)); setPath('');
        window.addEventListener('pointermove', move, true);
        window.addEventListener('pointerup', up, true);
        window.addEventListener('pointercancel', up, true);
        // Encore immobile un moment : c'est le rectangle de sélection, pas un trait (deuxième vibration).
        tresLong = setTimeout(() => {
          tresLong = null;
          trace = false; fin(); setVis(null); setPath(''); pts.current = [];
          navigator.vibrate?.([30, 60, 30]);
          const r = zone.getBoundingClientRect();
          cb.current.onSelect({ x: depart.clientX - r.left, y: depart.clientY - r.top });
        }, TRES_LONG_MS - APPUI_MS);
      }, APPUI_MS);
    };
    const bouge = (e: PointerEvent) => { if (t0 && minuterie && Math.hypot(e.clientX - t0.x, e.clientY - t0.y) > 8) annule(); };
    const leve = () => { doigts = Math.max(0, doigts - 1); annule(); };
    zone.addEventListener('pointerdown', down);
    zone.addEventListener('pointermove', bouge);
    zone.addEventListener('pointerup', leve);
    zone.addEventListener('pointercancel', leve);
    return () => {
      annule(); annuleTresLong(); fin();
      zone.removeEventListener('pointerdown', down);
      zone.removeEventListener('pointermove', bouge);
      zone.removeEventListener('pointerup', leve);
      zone.removeEventListener('pointercancel', leve);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  return (
    <div ref={el} className="frame-overlay">
      {/* Bandeau tout en bas de l'écran (demande de Seb) : le haut de la carte reste libre pour dessiner. */}
      <div className="frame-banner draw-banner" onPointerDown={(e) => e.stopPropagation()}>
        {/* Une croix toujours en haut à droite pour fermer, même si le titre passe sur deux lignes (Seb, 26/11). */}
        <div className="draw-head">
          <span className="draw-title">✏ Appui long puis glisse pour tracer · très long : sélection</span>
          <button className="draw-close" onClick={onCancel} aria-label="Fermer le menu">✕</button>
        </div>
        <label className="paths"><input type="checkbox" checked={onPaths} onChange={(e) => setOnPaths(e.target.checked)} /> recaler sur sentiers</label>
        {/* ▶ Commencer, ou ⏸ Pause / ▶ Reprendre et ⏹ Terminer : une ligne à eux sous « recaler sur sentiers » (demande de Seb). */}
        <div className="draw-actions">
          {rec ? <>
            {rec.paused ? <button className="primary" onClick={rec.onResume}>▶ Reprendre</button> : <button onClick={rec.onPause}>⏸ Pause</button>}
            <button className="stop" onClick={rec.onStop}>⏹ Terminer</button>
          </> : <button className="primary" onClick={onStart}>▶ Commencer une trace</button>}
        </div>
        <div className="draw-actions">
          <button onClick={onLoad}>📂 Charger des traces</button>
        </div>
      </div>
      <svg className="draw-svg"><path d={path} />
        {vis && main() !== 'aucun' && <g className="viseur" transform={`translate(${vis[0]} ${vis[1]})`}><circle r="9" /><path d="M-15 0h8M7 0h8M0-15v8M0 7v8" /></g>}
      </svg>
    </div>
  );
}
