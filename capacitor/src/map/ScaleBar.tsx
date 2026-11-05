import type { Map as MlMap } from 'maplibre-gl';
import { useEffect, useState } from 'react';
import { metersPerPx, niceScale, type Scale } from './scale';

/** Barre d'échelle toujours en haut à gauche (2 km, 5 km, 10 km… selon le zoom) : jamais cachée par un panneau du bas. */
export function ScaleBar({ map, top }: { map: MlMap; top: number }) {
  const [s, setS] = useState<Scale | null>(null);
  useEffect(() => {
    const update = () => setS(niceScale(metersPerPx(map.getCenter().lat, map.getZoom())));
    update();
    map.on('move', update);
    return () => { map.off('move', update); };
  }, [map]);
  if (!s) return null;
  return (
    <div className="scale-bar" style={{ top: `calc(env(safe-area-inset-top) + ${top}px)` }} aria-label={`Échelle : ${s.label}`}>
      <span>{s.label}</span>
      <div style={{ width: `${Math.round(s.px)}px` }} />
    </div>
  );
}
