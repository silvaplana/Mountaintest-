import type { Map as MlMap } from 'maplibre-gl';
import { useRef, useState } from 'react';
import type { LonLat } from './trails/osmTrails';

/**
 * Tracé au doigt : un calque posé sur la carte capte le doigt et dessine la ligne ;
 * au lâcher, on la convertit en coordonnées (même principe côté Kotlin, DrawPathView).
 */
export function DrawOverlay({ map, onPaths, setOnPaths, onDone, onCancel }: {
  map: MlMap; onPaths: boolean; setOnPaths: (v: boolean) => void;
  onDone: (line: LonLat[]) => void; onCancel: () => void;
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
      <div className="frame-banner" onPointerDown={(e) => e.stopPropagation()}>
        <span>Trace ton parcours du doigt</span>
        <label className="paths"><input type="checkbox" checked={onPaths} onChange={(e) => setOnPaths(e.target.checked)} /> chemins</label>
        <button onClick={onCancel}>Annuler</button>
      </div>
      <svg className="draw-svg"><path d={path} /></svg>
    </div>
  );
}
