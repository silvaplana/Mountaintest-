import { OFF_TRACK_M, type NavState } from './trails/navigation';
import type { Trail } from './trails/osmTrails';
import { walkingHours } from './trails/route';
import { formatKm } from './track/stats';

function hours(h: number) {
  const m = Math.round(h * 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/** 🧭 Bandeau de navigation sur une de mes traces : reste à faire, et alerte hors trace. Même bandeau côté Kotlin. */
export function NavBar({ trail, state, waiting, onStop }: {
  trail: Trail; state: NavState | null; waiting: boolean; onStop: () => void;
}) {
  const off = state != null && state.offM > OFF_TRACK_M;
  const arrived = state != null && !off && state.remainingM < 30;
  return (
    <section className={`nav-bar ${off ? 'off' : ''}`} style={{ borderLeftColor: trail.color }}>
      <div className="nav-text">
        <b>🧭 {trail.name}</b>
        {waiting || !state ? <span>En attente de la position GPS…</span>
          : arrived ? <span>🏁 Arrivée !</span>
          : <span>
              Reste {formatKm(state.remainingM)}
              {state.gainLeftM != null && ` · D+ ${Math.round(state.gainLeftM)} m · D− ${Math.round(state.lossLeftM ?? 0)} m`}
              {` · ≈ ${hours(walkingHours(state.remainingM, state.gainLeftM ?? 0, state.lossLeftM ?? 0))}`}
            </span>}
        {state && !waiting && <span className="nav-status">{off ? `⚠ Hors trace : ${Math.round(state.offM)} m` : '✓ Sur la trace'}</span>}
      </div>
      <button onClick={onStop}>Arrêter</button>
    </section>
  );
}
