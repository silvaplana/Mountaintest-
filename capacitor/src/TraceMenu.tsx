import { Profile } from './Profile';
import type { ElevatedTrail } from './trails/elevation';
import type { Trail } from './trails/osmTrails';
import { walkingHours } from './trails/route';
import { traceLengthM, type SavedTrace } from './trails/savedTraces';
import { formatKm } from './track/stats';

function hours(h: number) {
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/**
 * Menu du bas de la trace violette (tracée au doigt ou chargée) : on y coche la pente et le profil,
 * on l'enregistre sur le téléphone ou on l'efface de la carte. Même menu côté Kotlin.
 */
export function TraceMenu({ trail, elevated, slopes, onSlopes, showProfile, onShowProfile, cursor, onCursor, savedId, onSave, onDelete, onClose }: {
  trail: Trail; elevated: ElevatedTrail | 'loading' | 'error' | null;
  slopes: boolean; onSlopes: (v: boolean) => void;
  showProfile: boolean; onShowProfile: (v: boolean) => void;
  cursor: number | null; onCursor: (d: number | null) => void;
  savedId: number | null; onSave: () => void; onDelete: () => void; onClose: () => void;
}) {
  const el = elevated && typeof elevated === 'object' ? elevated : null;
  const wait = elevated === 'loading' ? '…' : '—';
  return (
    <section className="trace-menu">
      <div className="head">
        <b>{trail.name}</b>
        <button className="close" onClick={onClose} aria-label="Fermer le menu de la trace">✕</button>
      </div>
      <span className="hint">{formatKm(trail.distanceM)} · D+ {el ? `${Math.round(el.gainM)} m` : wait} · D− {el ? `${Math.round(el.lossM)} m` : wait}
        {el && ` · ${hours(walkingHours(trail.distanceM, el.gainM, el.lossM))} de marche`}</span>
      <div className="checks">
        <label><input type="checkbox" checked={slopes} onChange={(e) => onSlopes(e.target.checked)} /> Afficher la pente</label>
        <label><input type="checkbox" checked={showProfile} onChange={(e) => onShowProfile(e.target.checked)} /> Afficher le profil</label>
      </div>
      {(slopes || showProfile) && elevated === 'error' && <p className="hint">Altitudes indisponibles (pas de réseau ?) : pente et profil ne peuvent pas être calculés.</p>}
      {showProfile && el && <Profile segments={el.segments} cursor={cursor} onCursor={onCursor} />}
      <div className="row">
        <button className="primary" onClick={onSave} disabled={savedId != null}>{savedId != null ? '✓ Enregistrée' : '💾 Sauvegarder'}</button>
        <button className="danger" onClick={onDelete}>🗑 Supprimer</button>
      </div>
    </section>
  );
}

/** Liste des traces enregistrées sur le téléphone : toucher pour l'afficher, 🗑 pour l'effacer. */
export function TraceList({ traces, onPick, onDelete, onClose }: {
  traces: SavedTrace[]; onPick: (t: SavedTrace) => void; onDelete: (t: SavedTrace) => void; onClose: () => void;
}) {
  return (
    <section className="trace-menu">
      <div className="head">
        <b>📂 Mes traces</b>
        <button className="close" onClick={onClose} aria-label="Fermer la liste des traces">✕</button>
      </div>
      {!traces.length && <p className="hint">Aucune trace enregistrée. Dessine une trace, touche-la puis « Sauvegarder ».</p>}
      <ul className="trail-list">
        {traces.map((t) => (
          <li key={t.id}>
            <button onClick={() => onPick(t)}>
              <i style={{ background: '#7b3fe4' }} />
              <span><b>{t.name}</b><small>{formatKm(traceLengthM(t))}{t.onPaths ? ' · recalée sur les chemins' : ''}</small></span>
            </button>
            <button className="del" onClick={() => onDelete(t)} aria-label={`Effacer ${t.name}`}>🗑</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
