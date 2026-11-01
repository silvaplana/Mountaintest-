import { distanceM } from './gps/adaptive';
import type { LonLat } from './trails/osmTrails';

/** Profil en coupe : altitude en fonction de la distance parcourue (même dessin côté Kotlin, ProfileView). */
export function Profile({ segments }: { segments: (LonLat & { ele: number | null })[][] }) {
  const pts: [number, number][] = [];
  let d = 0;
  segments.forEach((seg, s) => seg.forEach((p, i) => {
    if (i > 0) d += distanceM(seg[i - 1], p);
    else if (s > 0) { /* saut entre morceaux : on ne compte pas la distance */ }
    if (p.ele !== null) pts.push([d, p.ele]);
  }));
  if (pts.length < 2 || d <= 0) return null;
  const zs = pts.map((p) => p[1]);
  let zMin = Math.min(...zs), zMax = Math.max(...zs);
  if (zMax - zMin < 50) { const m = (zMax + zMin) / 2; zMin = m - 25; zMax = m + 25; }
  const W = 320, H = 120, L = 34, B = 16, T = 6;
  const x = (v: number) => L + (v / d) * (W - L - 4);
  const y = (z: number) => T + (1 - (z - zMin) / (zMax - zMin)) * (H - T - B);
  const line = pts.map(([a, z], i) => `${i ? 'L' : 'M'}${x(a).toFixed(1)},${y(z).toFixed(1)}`).join('');
  const area = `${line}L${x(d).toFixed(1)},${H - B}L${x(0).toFixed(1)},${H - B}Z`;
  const km = d / 1000;
  const tick = km > 20 ? 5 : km > 8 ? 2 : km > 3 ? 1 : 0.5;
  const ticks: number[] = [];
  for (let k = tick; k < km; k += tick) ticks.push(k);
  return (
    <svg className="profile" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Profil en coupe">
      <path d={area} className="profile-area" />
      <path d={line} className="profile-line" />
      <text x={L - 4} y={T + 8} textAnchor="end">{Math.round(zMax)}</text>
      <text x={L - 4} y={H - B} textAnchor="end">{Math.round(zMin)}</text>
      {ticks.map((k) => <text key={k} x={x(k * 1000)} y={H - 3} textAnchor="middle">{k}</text>)}
      <text x={W - 4} y={H - 3} textAnchor="end">km</text>
    </svg>
  );
}
