import { useEffect, useMemo, useRef, useState } from 'react';
import type { LonLat } from './trails/osmTrails';
import { buildProfile, formatSlope, kmTick, pointAt, profileScale, PROFILE_EXAG, slopeAt, SLOPE_WINDOW_M } from './trails/profile';
import { GR_COLOR, isWide, sharePct, WAY_COLOR, WAY_TYPES, wayTotals, type WayRun } from './trails/wayTypes';

const km = (m: number) => `${(m / 1000).toFixed(1).replace('.', ',')} km`;

/** Pentes de repère dessinées en haut à droite, à la même échelle que le profil. */
const GAUGE = [5, 10, 20];

/**
 * Profil en coupe : altitude en fonction de la distance parcourue (même dessin côté Kotlin, ProfileView).
 * Échelle fixe (profileScale) : une même pente a toujours le même angle, quelle que soit la trace ;
 * une trace longue et plate défile de côté en glissant le doigt. Toucher place un curseur : distance,
 * altitude et pente à cet endroit, et le point sur la carte (sur une trace qui tient à l'écran, glisser
 * le doigt déplace le curseur, comme avant).
 * 🚵 runs : type de chemin par portion (mode VTT), en bande sous le profil, avec sa légende.
 */
export function Profile({ segments, cursor, onCursor, pctFirst = false, runs }: {
  segments: (LonLat & { ele: number | null })[][];
  cursor: number | null;
  onCursor: (d: number | null) => void;
  /** 🚵 Pente d'abord en %. */
  pctFirst?: boolean;
  runs?: WayRun[] | null;
}) {
  const prof = useMemo(() => buildProfile(segments), [segments]);
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(320);
  const [offset, setOffset] = useState(0);
  const drag = useRef<{ x: number; off: number; moved: boolean } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(200, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const ok = prof.d.length >= 2 && prof.total > 0;
  const d = ok ? prof.d[prof.d.length - 1] : 1;
  const zMin0 = ok ? Math.min(...prof.z) : 0, zMax0 = ok ? Math.max(...prof.z) : 1;
  const L = 34, R = 6, T = 6, B = 16;
  const band = runs?.length ? 8 : 0;
  const plotW = W - L - R;
  const sc = profileScale(d, zMax0 - zMin0, plotW);
  // Trace plus plate que la hauteur minimale : centrée verticalement.
  const extra = sc.plotH / sc.vPxPerM - (zMax0 - zMin0);
  const zMax = zMax0 + extra / 2;
  const G = 22; // rangée des pentes de repère, sous les km
  const H = T + sc.plotH + band + B + G;
  const maxOff = Math.max(0, sc.contentW - plotW);
  const off = Math.min(offset, maxOff);
  const x = (v: number) => L + v * sc.s - off;
  const y = (z: number) => T + (zMax - z) * sc.vPxPerM;
  // Curseur placé depuis la carte : on fait défiler pour le montrer.
  useEffect(() => {
    if (cursor == null || maxOff <= 0) return;
    const px = cursor * sc.s;
    if (px < off + 20 || px > off + plotW - 20) setOffset(Math.max(0, Math.min(maxOff, px - plotW / 2)));
  }, [cursor]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ok) return null;

  const line = prof.d.map((a, i) => `${i ? 'L' : 'M'}${x(a).toFixed(1)},${y(prof.z[i]).toFixed(1)}`).join('');
  const base = T + sc.plotH;
  const area = `${line}L${x(d).toFixed(1)},${base}L${x(0).toFixed(1)},${base}Z`;
  const tick = kmTick(sc.s);
  const ticks: number[] = [];
  for (let k = tick; k < d / 1000; k += tick) ticks.push(+k.toFixed(1));
  // Les runs sont mesurés sur la ligne de la trace : ramenés à la longueur du profil.
  const runScale = runs?.length ? d / (runs[runs.length - 1].to || d) : 1;

  const atX = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    return Math.max(0, Math.min(d, (clientX - r.left - L + off) / sc.s));
  };
  const c = cursor != null ? pointAt(prof, cursor) : null;
  const s = cursor != null ? slopeAt(prof, cursor) : null;

  return (
    <div className="profile-box">
      <p className="profile-info">{c && s
        ? <><b>{formatSlope(s, pctFirst)}</b> · {(c.d / 1000).toFixed(2).replace('.', ',')} km · {Math.round(c.z)} m</>
        : <>Touche le profil (ou le tracé) : pente moyenne sur {SLOPE_WINDOW_M} m.{maxOff > 0 ? ' Glisse pour le faire défiler.' : ''}</>}</p>
      <div ref={box} className="profile-scroll">
        <svg className="profile" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Profil en coupe"
          onPointerDown={(e) => {
            (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, off, moved: false };
            onCursor(atX(e.clientX));
          }}
          onPointerMove={(e) => {
            const g = drag.current;
            if (!g || !e.buttons) return;
            if (maxOff <= 0) { onCursor(atX(e.clientX)); return; }
            if (!g.moved && Math.abs(e.clientX - g.x) < 8) return;
            g.moved = true;
            setOffset(Math.max(0, Math.min(maxOff, g.off - (e.clientX - g.x))));
          }}
          onPointerUp={() => { drag.current = null; }}>
          <defs><clipPath id="profile-clip"><rect x={L} y={0} width={plotW} height={H} /></clipPath></defs>
          <g clipPath="url(#profile-clip)">
            <path d={area} className="profile-area" />
            <path d={line} className="profile-line" />
            {runs?.map((r, i) => <rect key={i} x={x(r.from * runScale)} y={isWide(r.type) ? base + 2 : base + 3.5} width={Math.max(1, (r.to - r.from) * runScale * sc.s)}
              height={isWide(r.type) ? band - 3 : 3} fill={WAY_COLOR[r.type]} />)}
            {runs?.filter((r) => r.gr).map((r, i) => <line key={`gr${i}`} x1={x(r.from * runScale)} x2={x(r.to * runScale)} y1={base + 1} y2={base + 1}
              stroke={GR_COLOR} strokeWidth={2} strokeDasharray="4 3" />)}
            {ticks.map((k) => <text key={k} x={x(k * 1000)} y={H - G - 3} textAnchor="middle">{String(k).replace('.', ',')}</text>)}
            {c && <>
              <line x1={x(c.d)} x2={x(c.d)} y1={T} y2={base} className="profile-cursor" />
              <circle cx={x(c.d)} cy={y(c.z)} r={3.5} className="profile-dot" />
            </>}
          </g>
          <text x={L - 4} y={T + 8} textAnchor="end">{Math.round(zMax0)}</text>
          <text x={L - 4} y={base} textAnchor="end">{Math.round(zMin0)}</text>
          <text x={L - 4} y={H - G - 3} textAnchor="end">km</text>
          {/* Pentes de repère à la même échelle (5 %, 10 %, 20 %) : même angle sur toutes les traces. */}
          <g className="profile-gauge">
            <text x={L - 4} y={H - 5} textAnchor="end">pente</text>
            {GAUGE.map((p, i) => {
              const gw = 18, x0 = L + 6 + i * 62, y0 = H - 4;
              return <g key={p}>
                <line x1={x0} y1={y0} x2={x0 + gw} y2={y0 - gw * p / 100 * PROFILE_EXAG} />
                <text x={x0 + gw + 4} y={y0 - 1}>{p} %</text>
              </g>;
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}

/** 🚵 Bilan des types de chemin, sous le profil : part de chacun en % et en km, puis la part sur GR. */
export function WayLegend({ runs }: { runs: WayRun[] }) {
  const t = wayTotals(runs);
  // Toujours le même ordre, des plus grandes voies aux plus petites, sans les types absents (demande de Seb) ; GR à la fin s'il y en a.
  const rows = WAY_TYPES.filter((w) => t.byType[w.key] > 0);
  return (
    <ul className="way-legend">
      {rows.map((w) => { const m = t.byType[w.key]; return (
        <li key={w.key}>
          <i style={{ background: w.color, height: isWide(w.key) ? 8 : 4 }} /><span>{w.label}</span>
          <small><b>{sharePct(m, t.total)}</b> · {km(m)}</small>
        </li>); })}
      {t.gr > 0 && <li>
        <i className="gr" /><span>Sur GR (balisage rouge et blanc)</span>
        <small><b>{sharePct(t.gr, t.total)}</b> · {km(t.gr)}</small>
      </li>}
    </ul>
  );
}
