import { OFF_TRACK_M, type NavState } from './trails/navigation';
import type { Trail } from './trails/osmTrails';
import { walkingHours } from './trails/route';
import type { TrackPoint } from './track/gpx';
import { computeStats, formatKm } from './track/stats';

/** Le prochain carrefour s'affiche dans le bandeau à moins de cette distance. */
export const JUNCTION_SHOW_M = 500;

function hours(h: number) {
  const m = Math.round(h * 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/** 👣 Bandeau de navigation sur une de mes traces : reste à faire, et alerte hors trace. Même bandeau côté Kotlin. */
export function NavBar({ trail, state, waiting, paused, nextJunctionM, onOpen }: {
  trail: Trail; state: NavState | null; waiting: boolean;
  /** ⏸ Pause (GPS coupé) : les boutons ⏸ ▶ ⏹ sont dans le menu de la trace (✏), pas sur la carte (demande de Seb). */
  paused: boolean;
  /** Toucher le bandeau : ouvre le menu de la trace (⏸ ▶ ⏹). */
  onOpen: () => void;
  /** ⑂ Distance du prochain carrefour le long de la trace (null : aucun ou inconnu). */
  nextJunctionM?: number | null;
}) {
  if (paused) {
    return (
      <section className="nav-bar paused" style={{ borderLeftColor: trail.color }} onClick={onOpen}>
        <div className="nav-text"><b>👣 {trail.name}</b><span>⏸ En pause : GPS coupé pour la batterie</span></div>
      </section>
    );
  }
  const off = state != null && state.offM > OFF_TRACK_M;
  const arrived = state != null && !off && state.remainingM < 30;
  return (
    <section className={`nav-bar ${off ? 'off' : ''}`} style={{ borderLeftColor: trail.color }} onClick={onOpen}>
      <div className="nav-text">
        <b>👣 {trail.name}</b>
        {waiting || !state ? <span>En attente de la position GPS…</span>
          : arrived ? <span>🏁 Arrivée !</span>
          : <span>
              Reste {formatKm(state.remainingM)}
              {state.gainLeftM != null && ` · D+ ${Math.round(state.gainLeftM)} m · D− ${Math.round(state.lossLeftM ?? 0)} m`}
              {` · ≈ ${hours(walkingHours(state.remainingM, state.gainLeftM ?? 0, state.lossLeftM ?? 0))}`}
            </span>}
        {state && !waiting && <span className="nav-status">{off ? `⚠ Hors trace : ${Math.round(state.offM)} m` : '✓ Sur la trace'}
          {!off && nextJunctionM != null && nextJunctionM <= JUNCTION_SHOW_M && ` · ⑂ carrefour dans ${Math.round(nextJunctionM / 10) * 10} m`}</span>}
      </div>
    </section>
  );
}

/** ⏺ Nouvelle trace commencée depuis ✏ (sans parcours prévu) : distance et durée. ⏸ et ⏹ sont dans le menu ✏. */
export function RecBar({ points, paused, onOpen }: { points: TrackPoint[]; paused: boolean; onOpen: () => void }) {
  const s = computeStats(points);
  return (
    <section className={`nav-bar ${paused ? 'paused' : ''}`} style={{ borderLeftColor: '#e4572e' }} onClick={onOpen}>
      <div className="nav-text">
        <b>⏺ Nouvelle trace</b>
        <span>{paused ? '⏸ En pause : GPS coupé pour la batterie'
          : points.length < 2 ? 'En attente de la position GPS…'
          : `${formatKm(s.distanceM)} · D+ ${Math.round(s.gainM)} m · ${hours(s.durationMs / 3_600_000)}`}</span>
      </div>
    </section>
  );
}
