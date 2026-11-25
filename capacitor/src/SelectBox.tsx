import type { Map as MlMap } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { TrashIcon } from './icones';
import type { Trail } from './trails/osmTrails';

type Pt = { x: number; y: number };
/** Ce que le rectangle attrape : des traces entières et des épingles (trace, numéro). */
export interface Prise { traces: number[]; pins: { id: number; i: number }[] }

/**
 * ⬚ Rectangle de sélection (Seb, 25/11) : un appui long sur la carte ouvre un rectangle qu'on étire du doigt ;
 * mes traces et les épingles dedans sont prises, puis la poubelle les efface (« ↶ Annuler » pendant quelques secondes).
 * Une trace est prise dès qu'un de ses points est dans le rectangle.
 */
export function SelectBox({ map, depart, trails, onFin, onEffacer }: {
  map: MlMap; depart: Pt; trails: Trail[]; onFin: () => void;
  /** Efface la prise ; rend de quoi annuler. */
  onEffacer: (p: Prise) => () => void;
}) {
  const [a, setA] = useState<Pt>(depart);
  const [b, setB] = useState<Pt>(depart);
  const [tire, setTire] = useState(true);
  const [annuler, setAnnuler] = useState<(() => void) | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = map.getContainer().getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // Le doigt de l'appui long est encore posé (sur la carte) : on suit ses déplacements sur toute la page.
  useEffect(() => {
    if (!tire) return;
    map.dragPan.disable();
    const move = (e: PointerEvent) => setB(local(e));
    const up = () => setTire(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      map.dragPan.enable();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tire, map]);

  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const dedans = (lon: number, lat: number) => {
    const p = map.project([lon, lat]);
    return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
  };
  const prise: Prise = { traces: [], pins: [] };
  if (x1 - x0 > 8 && y1 - y0 > 8) for (const t of trails) {
    if (t.segments.some((s) => s.some((p) => dedans(p.lon, p.lat)))) prise.traces.push(t.id);
    else (t.pins ?? []).forEach((p, i) => { if (dedans(p.lon, p.lat)) prise.pins.push({ id: t.id, i }); });
  }
  const rien = !prise.traces.length && !prise.pins.length;

  // Les traces prises en surbrillance jaune, pendant qu'on étire.
  useEffect(() => {
    if (!map.getLayer('trails')) return;
    const ids = prise.traces;
    map.setPaintProperty('trails', 'line-width', ids.length ? ['case', ['in', ['get', 'id'], ['literal', ids]], 8, 4] : 4);
    return () => { if (map.getLayer('trails')) map.setPaintProperty('trails', 'line-width', 4); };
  }, [map, prise.traces.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const fin = useRef(onFin);
  fin.current = onFin;
  useEffect(() => {
    if (!annuler) return;
    const t = setTimeout(() => fin.current(), 6000);
    return () => clearTimeout(t);
  }, [annuler]);

  if (annuler) return (
    <div className="sel-barre">
      <span>Effacé</span>
      <button className="primary" onClick={() => { annuler(); onFin(); }}>↶ Annuler</button>
    </div>
  );

  return (
    <>
      <div ref={box} className="sel-voile"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const p = local(e); setA(p); setB(p); }}
        onPointerMove={(e) => { if (e.buttons || e.pointerType === 'touch') setB(local(e)); }}>
        <div className="sel-rect" style={{ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }} />
      </div>
      <div className="sel-barre">
        <span>{rien ? 'Étire le rectangle sur des traces ou des 📍'
          : [prise.traces.length && `${prise.traces.length} trace${prise.traces.length > 1 ? 's' : ''}`,
            prise.pins.length && `${prise.pins.length} 📍`].filter(Boolean).join(' · ')}</span>
        <button className="sel-effacer" disabled={rien} aria-label="Effacer la sélection"
          onClick={() => { const u = onEffacer(prise); setAnnuler(() => u); }}><TrashIcon size={28} /></button>
        <button onClick={onFin} aria-label="Fermer la sélection">✕</button>
      </div>
    </>
  );
}
