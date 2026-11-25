import { useRef, useState } from 'react';
import { Profile, WayLegend } from './Profile';
import type { ElevatedTrail } from './trails/elevation';
import type { Trail } from './trails/osmTrails';
import { bikeHours, walkingHours } from './trails/route';
import type { WayRun } from './trails/wayTypes';
import { traceLengthM, type SavedTrace } from './trails/savedTraces';
import { TRACE_FOLDER } from './trails/traceShare';
import { formatKm } from './track/stats';
import { CameraIcon } from './Survol';
import { PinIcon } from './PinLayer';
import { PencilIcon } from './TraceEdit';
import type { Pin } from './trails/edit';
import { useSheet } from './useSheet';

function hours(h: number) {
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/**
 * Menu du bas de la trace violette (tracée au doigt ou chargée) : on y coche la pente et le profil,
 * on l'enregistre sur le téléphone ou on l'efface de la carte. Même menu côté Kotlin.
 */
export function TraceMenu({ trail, onFilm, onEdit, pique, onPique, pin, onPinText, onPinDone, onPinDelete, elevated, slopes, onSlopes, showProfile, onShowProfile, cursor, onCursor, savedId, onSave, onDelete, onShare, onClose, navigating, onNavigate, onStopNav, paused, onPause, onResume, offline, onOffline, onGo, vtt, ways, wayTypes, onWayTypes, runs }: {
  trail: Trail; elevated: ElevatedTrail | 'loading' | 'error' | null;
  /** 🎥 Survol 3D le long de la trace (grisé tant que la trace n'a pas deux points). */
  onFilm: () => void;
  /** ✏ Écran « Modifier » de la trace. */
  onEdit: () => void;
  /** 📍 allumé : toucher la carte pique un point (pas d'écran à part, demande de Seb). */
  pique: boolean; onPique: () => void;
  /** Point dont on écrit le mot (après l'avoir piqué ou touché). */
  pin: Pin | null; onPinText: (t: string) => void; onPinDone: () => void; onPinDelete: () => void;
  slopes: boolean; onSlopes: (v: boolean) => void;
  showProfile: boolean; onShowProfile: (v: boolean) => void;
  cursor: number | null; onCursor: (d: number | null) => void;
  savedId: number | null; onSave: () => void; onDelete: () => void; onClose: () => void;
  /** Partager le fichier GPX de la trace (mail, WhatsApp…). */
  onShare: () => void;
  navigating: boolean; onNavigate: () => void; onStopNav: () => void;
  /** ⏸ Pause de la trace commencée (GPS coupé), ▶ reprise : seulement ici, pas sur la carte (demande de Seb). */
  paused: boolean; onPause: () => void; onResume: () => void;
  /** 📶 Cartes autour de la trace : état du téléchargement (null : pas fait). */
  offline: string | null; onOffline: () => void;
  /** 🚗 Y aller : Google Maps en voiture jusqu'au départ de la trace. */
  onGo: () => void;
  /** 🚵 Mode VTT : durée à vélo, pente en %, et case « type de chemin » (carte + bande sous le profil + légende). */
  vtt: boolean; /** Coche « Type de chemin » : en 🚵 et 🥾, pas en ⛷. */ ways: boolean; wayTypes: boolean; onWayTypes: (v: boolean) => void;
  runs: WayRun[] | 'loading' | 'error' | null;
}) {
  const el = elevated && typeof elevated === 'object' ? elevated : null;
  const wait = elevated === 'loading' ? '…' : '—';
  const sheet = useSheet('trace');
  return (
    <section className={`trace-menu${sheet.classe}`}>
      <div {...sheet.prise}><div className="handle" />
      <div className="head">
        <b><i className="swatch" style={{ background: trail.color }} />{trail.name}</b>
        <button className="close" onClick={onFilm} disabled={trail.segments.flat().length < 2} aria-label="Filmer un survol 3D de la trace"><CameraIcon /></button>
        <button className="close" onClick={onEdit} disabled={trail.segments.flat().length < 2} aria-label="Modifier la trace"><PencilIcon /></button>
        <button className={`close${pique ? ' on' : ''}`} onClick={onPique} aria-pressed={pique} aria-label="Piquer des points sur la carte"><PinIcon /></button>
        <button className="close" onClick={onShare} aria-label={`Partager ${trail.name}`}><ShareTraceIcon /></button>
        <button className="close" onClick={onClose} aria-label="Fermer le menu de la trace">✕</button>
      </div></div>
      {pin ? (
        <div className="pin-mot-ligne">
          <input value={pin.txt} maxLength={40} autoFocus={!pin.txt} placeholder="Petit mot : source, passage délicat…" onChange={(e) => onPinText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onPinDone(); }} aria-label="Mot du point" />
          <button className="close" onClick={onPinDelete} aria-label="Enlever ce point"><TrashIcon size={22} /></button>
          <button className="primary" onClick={onPinDone} aria-label="Valider le mot">✓</button>
        </div>
      ) : pique && <span className="hint">📍 Touche la carte pour piquer un point. Sur un point : un appui montre ou cache son mot, appui long pour le déplacer, très long pour l’enlever.</span>}
      <span className="hint">{formatKm(trail.distanceM)} · D+ {el ? `${Math.round(el.gainM)} m` : wait} · D− {el ? `${Math.round(el.lossM)} m` : wait}
        {el && (vtt ? ` · ${hours(bikeHours(trail.distanceM, el.gainM))} à VTT` : ` · ${hours(walkingHours(trail.distanceM, el.gainM, el.lossM))} de marche`)}</span>
      <div className="checks">
        <label><input type="checkbox" checked={slopes} onChange={(e) => onSlopes(e.target.checked)} /> Afficher la pente</label>
        <label><input type="checkbox" checked={showProfile} onChange={(e) => onShowProfile(e.target.checked)} /> Afficher le profil</label>
        {ways && <label><input type="checkbox" checked={wayTypes} onChange={(e) => onWayTypes(e.target.checked)} /> Type de chemin</label>}
      </div>
      {(slopes || showProfile) && elevated === 'error' && <p className="hint">Altitudes indisponibles (pas de réseau ?) : pente et profil ne peuvent pas être calculés.</p>}
      {showProfile && el && <Profile segments={el.segments} cursor={cursor} onCursor={onCursor} pctFirst={vtt}
        runs={ways && wayTypes && Array.isArray(runs) ? runs : null} />}
      {ways && wayTypes && (runs === 'loading' ? <p className="hint">Recherche des types de chemin…</p>
        : runs === 'error' ? <p className="hint">Types de chemin introuvables sans réseau. Fais 📶 Hors ligne avant de partir.</p>
        : runs && <WayLegend runs={runs} />)}
      <div className="row">
        <button className="primary" onClick={onGo}>🚗 Y aller</button>
        {navigating ? <>
            {paused ? <button onClick={onResume}>▶ Reprendre</button> : <button onClick={onPause}>⏸ Pause</button>}
            <button className="stop" onClick={onStopNav}>⏹ Arrêter</button>
          </> : <button onClick={onNavigate}>▶ Commencer la trace</button>}
      </div>
      {offline && <p className="hint">{offline}</p>}
      <div className="row">
        <button onClick={onOffline}>📶 Hors ligne</button>
        <button onClick={onSave} disabled={savedId != null}>{savedId != null ? '✓ Enregistrée' : '💾 Sauvegarder'}</button>
        <button className="danger" onClick={onDelete}><TrashIcon size={20} /> Supprimer</button>
      </div>
    </section>
  );
}

/** 📂 Charger des traces : 📥 un fichier du téléphone, ou une de Mes traces (toucher pour l'afficher, 🗑 pour l'effacer). */
export function TraceList({ traces, onPick, onDelete, onShare, onClose, onFile }: {
  traces: SavedTrace[]; onPick: (t: SavedTrace) => void; onDelete: (t: SavedTrace) => void; onClose: () => void;
  /** 📤 Partager le fichier GPX (mail, WhatsApp…). */
  onShare: (t: SavedTrace) => void;
  /** 📥 Ouvrir un fichier GPX, KML ou GeoJSON du téléphone. */
  onFile: () => void;
}) {
  const [showFolder, setShowFolder] = useState(false);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sheet = useSheet('traces');
  return (
    <section className={`trace-menu${sheet.classe}`}>
      <div {...sheet.prise}><div className="handle" />
      <div className="head">
        <b>📂 Charger des traces</b>
        <button className="close" onClick={onClose} aria-label="Fermer la liste des traces">✕</button>
      </div></div>
      <div className="row"><button onClick={onFile}>📥 Ouvrir un fichier (GPX, KML, GeoJSON)</button></div>
      {/* Appui long sur « Mes traces » : le dossier des fichiers GPX (demande de Seb : pas affiché en permanence). */}
      <b className="list-title" onContextMenu={(e) => e.preventDefault()}
        onPointerDown={() => { if (press.current) clearTimeout(press.current); press.current = setTimeout(() => setShowFolder((v) => !v), 550); }}
        onPointerUp={() => { if (press.current) clearTimeout(press.current); }}
        onPointerLeave={() => { if (press.current) clearTimeout(press.current); }}>Mes traces</b>
      {showFolder && <p className="hint">📁 Fichiers GPX dans {TRACE_FOLDER} (appli Fichiers du téléphone)</p>}
      {!traces.length && <p className="hint">Aucune trace enregistrée. Dessine une trace, touche-la puis « Sauvegarder ».</p>}
      <ul className="trail-list">
        {traces.map((t) => (
          <li key={t.id}>
            <button onClick={() => onPick(t)}>
              <i style={{ background: '#7b3fe4' }} />
              <span><b>{t.name}</b><small>{formatKm(traceLengthM(t))}{t.onPaths ? ' · recalée sur les chemins' : ''}</small></span>
            </button>
            <button className="del" onClick={() => onShare(t)} aria-label={`Partager ${t.name}`}><ShareTraceIcon /></button>
            <button className="del" onClick={() => onDelete(t)} aria-label={`Effacer ${t.name}`}><TrashIcon /></button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Partager : 3 ronds reliés par 2 traits (même dessin que ic_share_trace côté Kotlin). */
function ShareTraceIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path d="M8 12L17 6M8 12L17 18" stroke="#1565c0" strokeWidth="2.2" fill="none" />
      <circle cx="18" cy="5" r="3" fill="#1565c0" /><circle cx="6" cy="12" r="3" fill="#1565c0" /><circle cx="18" cy="19" r="3" fill="#1565c0" />
    </svg>
  );
}

/** Effacer : poubelle simple, couvercle, cuve, 2 rayures (même dessin que ic_delete_trace côté Kotlin). */
function TrashIcon({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="#c62828" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M9 6V4h6v2M5.5 6l1 14h11l1-14M10 10v6M14 10v6" />
    </svg>
  );
}
