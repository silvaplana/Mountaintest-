import type { Map as MlMap } from 'maplibre-gl';
import { useRef, useState } from 'react';
import type { LonLat } from './trails/osmTrails';

/**
 * Tracé au doigt : un calque posé sur la carte capte le doigt et dessine la ligne ;
 * au lâcher, on la convertit en coordonnées (même principe côté Kotlin, DrawPathView).
 */
export function DrawOverlay({ map, onPaths, setOnPaths, onDone, onCancel, onLoad, onFile, onStart, rec }: {
  map: MlMap; onPaths: boolean; setOnPaths: (v: boolean) => void;
  onDone: (line: LonLat[]) => void; onCancel: () => void;
  /** 📂 Charger une trace enregistrée sur le téléphone. */
  onLoad: () => void;
  /** 📥 Ouvrir un fichier GPX, KML ou GeoJSON. */
  onFile: () => void;
  /** ▶ Commencer une nouvelle trace sans parcours prévu : le chemin parcouru se dessine au fur et à mesure. */
  onStart: () => void;
  /** Nouvelle trace en cours (commencée ici) : ⏸ / ▶ et ⏹ Terminer à la place de ▶ Commencer. */
  rec: { paused: boolean; onPause: () => void; onResume: () => void; onStop: () => void } | null;
}) {
  const el = useRef<HTMLDivElement>(null);
  const pts = useRef<[number, number][]>([]);
  const [path, setPath] = useState('');

  const local = (e: React.PointerEvent): [number, number] => {
    const r = el.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const toD = (p: [number, number][]) => p.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');

  return (
    <div ref={el} className="frame-overlay"
      onPointerDown={(e) => { el.current!.setPointerCapture(e.pointerId); pts.current = [local(e)]; setPath(''); }}
      onPointerMove={(e) => {
        if (!pts.current.length) return;
        const p = local(e), last = pts.current[pts.current.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 6) return;
        pts.current.push(p);
        setPath(toD(pts.current));
      }}
      onPointerUp={() => {
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
        <label className="paths"><input type="checkbox" checked={onPaths} onChange={(e) => setOnPaths(e.target.checked)} /> recaler sur sentiers</label>
        <div className="draw-actions">
          {rec ? <>
            {rec.paused ? <button className="primary" onClick={rec.onResume}>▶ Reprendre</button> : <button onClick={rec.onPause}>⏸ Pause</button>}
            <button className="stop" onClick={rec.onStop}>⏹ Terminer</button>
          </> : <button className="primary" onClick={onStart}>▶ Commencer</button>}
          <button onClick={onLoad}>📂 Charger des traces</button>
          <button onClick={onFile}>📥 Ouvrir un fichier</button>
          <button onClick={onCancel}>Annuler</button>
        </div>
      </div>
      <svg className="draw-svg"><path d={path} /></svg>
    </div>
  );
}
