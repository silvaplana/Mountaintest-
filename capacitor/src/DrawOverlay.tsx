import type { Map as MlMap } from 'maplibre-gl';
import { useRef, useState } from 'react';
import type { LonLat } from './trails/osmTrails';
import { decalage } from './doigt';

/**
 * Tracé au doigt : un calque posé sur la carte capte le doigt et dessine la ligne ;
 * au lâcher, on la convertit en coordonnées (même principe côté Kotlin, DrawPathView).
 */
export function DrawOverlay({ map, onPaths, setOnPaths, onDone, onCancel, onLoad, onStart, rec }: {
  map: MlMap; onPaths: boolean; setOnPaths: (v: boolean) => void;
  onDone: (line: LonLat[]) => void; onCancel: () => void;
  /** 📂 Charger des traces : écran avec 📥 Ouvrir un fichier puis Mes traces. */
  onLoad: () => void;
  /** ▶ Commencer une nouvelle trace sans parcours prévu : le chemin parcouru se dessine au fur et à mesure. */
  onStart: () => void;
  /** Nouvelle trace en cours (commencée ici) : ⏸ / ▶ et ⏹ Terminer à la place de ▶ Commencer. */
  rec: { paused: boolean; onPause: () => void; onResume: () => void; onStop: () => void } | null;
}) {
  const el = useRef<HTMLDivElement>(null);
  const pts = useRef<[number, number][]>([]);
  const [path, setPath] = useState('');
  /** ⊕ Viseur : là où le trait se pose, 1 cm au-dessus du doigt. */
  const [vis, setVis] = useState<[number, number] | null>(null);

  const local = (e: React.PointerEvent): [number, number] => {
    const r = el.current!.getBoundingClientRect();
    const [dx, dy] = decalage();
    return [e.clientX - r.left + dx, e.clientY - r.top + dy];
  };
  const toD = (p: [number, number][]) => p.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');

  return (
    <div ref={el} className="frame-overlay"
      onPointerDown={(e) => { el.current!.setPointerCapture(e.pointerId); pts.current = [local(e)]; setVis(local(e)); setPath(''); }}
      onPointerMove={(e) => {
        if (!pts.current.length) return;
        const p = local(e), last = pts.current[pts.current.length - 1];
        setVis(p);
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 6) return;
        pts.current.push(p);
        setPath(toD(pts.current));
      }}
      onPointerUp={() => {
        setVis(null);
        const p = pts.current;
        pts.current = [];
        let len = 0;
        for (let i = 1; i < p.length; i++) len += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
        if (len < 40) { setPath(''); return; } // trop court : on recommence
        // Le calque couvre exactement la carte : mêmes coordonnées écran.
        onDone(p.map(([x, y]) => { const ll = map.unproject([x, y]); return { lon: ll.lng, lat: ll.lat }; }));
      }}>
      {/* Bandeau tout en bas de l'écran (demande de Seb) : le haut de la carte reste libre pour dessiner. */}
      <div className="frame-banner draw-banner" onPointerDown={(e) => e.stopPropagation()}>
        <span className="draw-title">✏ Trace ton parcours du doigt</span>
        {/* Une croix en haut à droite pour fermer, pas de bouton « Annuler » (demande de Seb). */}
        <button className="draw-close" onClick={onCancel} aria-label="Fermer le menu">✕</button>
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
        {vis && <g className="viseur" transform={`translate(${vis[0]} ${vis[1]})`}><circle r="9" /><path d="M-15 0h8M7 0h8M0-15v8M0 7v8" /></g>}
      </svg>
    </div>
  );
}
