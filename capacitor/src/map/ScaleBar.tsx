import type { Map as MlMap } from 'maplibre-gl';
import { useEffect, useState } from 'react';
import { metersPerPx, niceScale, type Scale } from './scale';

/** Barre d'échelle en bas à gauche (2 km, 5 km, 10 km… selon le zoom), au-dessus du menu du bas. */
export function ScaleBar({ map, bottom }: { map: MlMap; bottom: number }) {
  const [s, setS] = useState<Scale | null>(null);
  useEffect(() => {
    const update = () => setS(niceScale(metersPerPx(map.getCenter().lat, map.getZoom())));
    update();
    map.on('move', update);
    return () => { map.off('move', update); };
  }, [map]);
  if (!s) return null;
  return (
    <div className="scale-bar" style={{ bottom: `calc(env(safe-area-inset-bottom) + ${bottom}px)` }} aria-label={`Échelle : ${s.label}`}>
      <span>{s.label}</span>
      <div style={{ width: `${Math.round(s.px)}px` }} />
    </div>
  );
}
