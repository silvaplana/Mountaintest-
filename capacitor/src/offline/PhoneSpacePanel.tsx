// Petite fenêtre en bas quand le calque « Hors ligne » est allumé : la place prise sur le téléphone (Seb, 26/11).
// Repliée = une ligne ; la flèche la déplie ; la croix, toujours à droite, la ferme.
import { useEffect, useState } from 'react';
import { formatBytes } from '../Usage';
import { measurePhoneSpace, type PhoneSpace } from './phoneSpace';

const Svg = ({ d }: { d: string }) => (
  <svg viewBox="0 0 48 48" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

const PARTS: { key: 'cartes' | 'photos' | 'donnees'; label: string; color: string }[] = [
  { key: 'cartes', label: 'Cartes (tuiles)', color: '#0f7a45' },
  { key: 'photos', label: 'Photos et vidéos', color: '#3e5368' },
  { key: 'donnees', label: 'Données (traces, groupes…)', color: '#9fb1c2' },
];

export function PhoneSpacePanel({ cartes, onClose }: { cartes: number; onClose: () => void }) {
  const [space, setSpace] = useState<PhoneSpace | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { void measurePhoneSpace(cartes).then(setSpace).catch(() => {}); }, [cartes]);

  return (
    <div className="phone-space">
      <div className="phone-space-head">
        <Svg d="M16 5h16a4 4 0 0 1 4 4v30a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4ZM21 37h6" />
        <span className="phone-space-title" onClick={() => setOpen(!open)}>
          <b>{space ? formatBytes(space.total) : '…'}</b> sur le téléphone
        </span>
        <button className="phone-space-btn" aria-label={open ? 'Replier' : 'Déplier'} onClick={() => setOpen(!open)}>
          <Svg d={open ? 'M14 18l10 10 10-10' : 'M14 30l10-10 10 10'} />
        </button>
        <button className="phone-space-btn" aria-label="Fermer" onClick={onClose}><Svg d="M14 14l20 20M34 14 14 34" /></button>
      </div>
      {open && space && (
        <div className="phone-space-body">
          <div className="phone-space-bar">
            {PARTS.map((p) => space[p.key] > 0 && (
              <div key={p.key} style={{ flexGrow: Math.max(space[p.key], space.total * 0.02), background: p.color }} />
            ))}
          </div>
          {PARTS.map((p) => (
            <div key={p.key} className="phone-space-row">
              <span className="phone-space-dot" style={{ background: p.color }} />
              <span>{p.label}</span><b>{formatBytes(space[p.key])}</b>
            </div>
          ))}
          {space.libre != null && <p className="phone-space-free">Encore {formatBytes(space.libre)} libres sur le téléphone.</p>}
        </div>
      )}
    </div>
  );
}
