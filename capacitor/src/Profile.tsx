import { useMemo, useRef } from 'react';
import type { LonLat } from './trails/osmTrails';
import { buildProfile, formatSlope, pointAt, slopeAt, SLOPE_WINDOW_M } from './trails/profile';

/**
 * Profil en coupe : altitude en fonction de la distance parcourue (même dessin côté Kotlin, ProfileView).
 * Glisser le doigt dessus place un curseur : distance, altitude et pente à cet endroit, et le point sur la carte.
 */
export function Profile({ segments, cursor, onCursor }: {
  segments: (LonLat & { ele: number | null })[][];
  cursor: number | null;
  onCursor: (d: number | null) => void;
}) {
  const prof = useMemo(() => buildProfile(segments), [segments]);
  const svg = useRef<SVGSVGElement>(null);
  if (prof.d.length < 2 || prof.total <= 0) return null;
  const d = prof.d[prof.d.length - 1];
  let zMin = Math.min(...prof.z), zMax = Math.max(...prof.z);
  if (zMax - zMin < 50) { const m = (zMax + zMin) / 2; zMin = m - 25; zMax = m + 25; }
  const W = 320, H = 120, L = 34, B = 16, T = 6;
  const x = (v: number) => L + (v / d) * (W - L - 4);
  const y = (z: number) => T + (1 - (z - zMin) / (zMax - zMin)) * (H - T - B);
  const line = prof.d.map((a, i) => `${i ? 'L' : 'M'}${x(a).toFixed(1)},${y(prof.z[i]).toFixed(1)}`).join('');
  const area = `${line}L${x(d).toFixed(1)},${H - B}L${x(0).toFixed(1)},${H - B}Z`;
  const km = d / 1000;
  const tick = km > 20 ? 5 : km > 8 ? 2 : km > 3 ? 1 : 0.5;
  const ticks: number[] = [];
  for (let k = tick; k < km; k += tick) ticks.push(k);

  const fromEvent = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const vx = (e.clientX - r.left) / r.width * W;
    onCursor(Math.max(0, Math.min(d, (vx - L) / (W - L - 4) * d)));
  };
  const c = cursor != null ? pointAt(prof, cursor) : null;
  const s = cursor != null ? slopeAt(prof, cursor) : null;

  return (
    <div className="profile-box">
      <p className="profile-info">{c && s
        ? <><b>{formatSlope(s)}</b> · {(c.d / 1000).toFixed(2).replace('.', ',')} km · {Math.round(c.z)} m</>
        : <>Glisse le doigt sur le profil (ou touche le tracé) : pente moyenne sur {SLOPE_WINDOW_M} m.</>}</p>
      <svg ref={svg} className="profile" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Profil en coupe"
        onPointerDown={(e) => { svg.current!.setPointerCapture(e.pointerId); fromEvent(e); }}
        onPointerMove={(e) => { if (e.buttons) fromEvent(e); }}>
        <path d={area} className="profile-area" />
        <path d={line} className="profile-line" />
        <text x={L - 4} y={T + 8} textAnchor="end">{Math.round(zMax)}</text>
        <text x={L - 4} y={H - B} textAnchor="end">{Math.round(zMin)}</text>
        {ticks.map((k) => <text key={k} x={x(k * 1000)} y={H - 3} textAnchor="middle">{String(k).replace('.', ',')}</text>)}
        <text x={W - 4} y={H - 3} textAnchor="end">km</text>
        {c && <>
          <line x1={x(c.d)} x2={x(c.d)} y1={T} y2={H - B} className="profile-cursor" />
          <circle cx={x(c.d)} cy={y(c.z)} r={3.5} className="profile-dot" />
        </>}
      </svg>
    </div>
  );
}
