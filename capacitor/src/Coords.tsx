import { useState } from 'react';

export interface Fix { lat: number; lon: number; alt: number | null; accuracy: number | null; time: number }

/** Coordonnées en degrés décimaux, le format demandé par les secours (112) et lu par toutes les applis de carte. */
export function formatCoords(f: Fix) {
  const lat = `${Math.abs(f.lat).toFixed(5).replace('.', ',')}° ${f.lat >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(f.lon).toFixed(5).replace('.', ',')}° ${f.lon >= 0 ? 'E' : 'O'}`;
  return `${lat}, ${lon}`;
}

/** Encadré « ma position » : coordonnées, altitude, précision ; un appui copie le texte (même chose côté Kotlin). */
export function Coords({ fix, onClose, className }: { fix: Fix; onClose: () => void; className?: string }) {
  const [copied, setCopied] = useState(false);
  const extra = [
    fix.alt != null ? `alt. ${Math.round(fix.alt)} m` : null,
    fix.accuracy != null ? `± ${Math.round(fix.accuracy)} m` : null,
  ].filter(Boolean).join(' · ');
  const text = `${fix.lat.toFixed(6)}, ${fix.lon.toFixed(6)}`;
  return (
    <div className={`coords ${className ?? ''}`}>
      <button className="coords-text" onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
      }}>
        <b>📍 {formatCoords(fix)}</b>
        <span>{copied ? 'Copié !' : `${extra}${extra ? ' · ' : ''}appuie pour copier`}</span>
      </button>
      <button onClick={onClose} aria-label="Masquer les coordonnées">✕</button>
    </div>
  );
}
