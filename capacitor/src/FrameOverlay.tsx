import type { Map as MlMap } from 'maplibre-gl';
import { useRef, useState } from 'react';
import type { Bbox } from './config';

/**
 * Encadrer une zone : un calque posé sur la carte capte le doigt, on trace un rectangle,
 * et au lâcher on le convertit en coordonnées (même principe côté Kotlin, FrameDrawView).
 */
export function FrameOverlay({ map, onDone, onCancel, label }: { map: MlMap; onDone: (b: Bbox) => void; onCancel: () => void; label?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const start = useRef<[number, number] | null>(null);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const local = (e: React.PointerEvent): [number, number] => {
    const r = el.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  return (
    <div ref={el} className="frame-overlay"
      onPointerDown={(e) => { el.current!.setPointerCapture(e.pointerId); start.current = local(e); setRect(null); }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const [x, y] = local(e), [x0, y0] = start.current;
        setRect({ x: Math.min(x, x0), y: Math.min(y, y0), w: Math.abs(x - x0), h: Math.abs(y - y0) });
      }}
      onPointerUp={(e) => {
        const s = start.current;
        start.current = null;
        if (!s) return;
        const [x, y] = local(e);
        if (Math.abs(x - s[0]) < 20 || Math.abs(y - s[1]) < 20) { setRect(null); return; } // simple appui : on recommence
        // Le calque couvre exactement la carte : mêmes coordonnées écran.
        const a = map.unproject([s[0], s[1]]), b = map.unproject([x, y]);
        onDone([Math.min(a.lng, b.lng), Math.min(a.lat, b.lat), Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)]);
      }}>
      <div className="frame-banner" onPointerDown={(e) => e.stopPropagation()}>
        <span>{label ?? 'Trace un rectangle du doigt sur la zone'}</span>
        <button onClick={onCancel}>Annuler</button>
      </div>
      {rect && <div className="frame-rect" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />}
    </div>
  );
}
