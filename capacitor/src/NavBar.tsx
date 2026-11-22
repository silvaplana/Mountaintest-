import { OFF_TRACK_M, type NavState } from './trails/navigation';
import type { Trail } from './trails/osmTrails';
import { walkingHours } from './trails/route';
import { formatKm } from './track/stats';

/** Le prochain carrefour s'affiche dans le bandeau à moins de cette distance. */
export const JUNCTION_SHOW_M = 500;

function hours(h: number) {
  const m = Math.round(h * 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/** 👣 Bandeau de navigation sur une de mes traces : reste à faire, et alerte hors trace. Même bandeau côté Kotlin. */
export function NavBar({ trail, state, waiting, onStop, paused, onPause, onResume, onHelp, nextJunctionM }: {
  trail: Trail; state: NavState | null; waiting: boolean; onStop: () => void;
  /** ⏸ Pause : GPS coupé pour la batterie, ▶ reprend. */
  paused: boolean; onPause: () => void; onResume: () => void;
  /** Appui long sur une icône : son explication. */
  onHelp: (text: string) => void;
  /** ⑂ Distance du prochain carrefour le long de la trace (null : aucun ou inconnu). */
  nextJunctionM?: number | null;
}) {
  const help = (text: string) => ({ onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); onHelp(text); } });
  if (paused) {
    return (
      <section className="nav-bar paused" style={{ borderLeftColor: trail.color }}>
        <div className="nav-text"><b>👣 {trail.name}</b><span>⏸ En pause : GPS coupé pour la batterie</span></div>
        <button className="nav-icon" onClick={onResume} aria-label="Reprendre le suivi" title="Reprendre le suivi" {...help('▶ Reprendre le suivi : le GPS se rallume.')}>▶</button>
        <button className="nav-icon nav-stop" onClick={onStop} aria-label="Arrêter le suivi" title="Arrêter le suivi" {...help('⏹ Arrêter le suivi de la trace.')}>⏹</button>
      </section>
    );
  }
  const off = state != null && state.offM > OFF_TRACK_M;
  const arrived = state != null && !off && state.remainingM < 30;
  return (
    <section className={`nav-bar ${off ? 'off' : ''}`} style={{ borderLeftColor: trail.color }}>
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
      <button className="nav-icon" onClick={onPause} aria-label="Mettre le suivi en pause" title="Mettre en pause" {...help('⏸ Pause : coupe le GPS pour la batterie, ▶ pour reprendre.')}>⏸</button>
      <button className="nav-icon nav-stop" onClick={onStop} aria-label="Arrêter le suivi" title="Arrêter le suivi" {...help('⏹ Arrêter le suivi de la trace.')}>⏹</button>
    </section>
  );
}
