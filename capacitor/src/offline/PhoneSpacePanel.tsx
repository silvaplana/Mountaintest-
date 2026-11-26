// Panneau remontable en bas quand le calque « Hors ligne » est allumé (Seb, 26/11) : la place prise sur le téléphone,
// le nombre de tuiles gardées et leur poids moyen. La poignée le remonte, la croix à droite le ferme.
import { useEffect, useState } from 'react';
import { formatBytes } from '../Usage';
import { useSheet } from '../useSheet';
import { measurePhoneSpace, type PhoneSpace } from './phoneSpace';

const PARTS: { key: 'cartes' | 'photos' | 'donnees'; label: string; color: string }[] = [
  { key: 'cartes', label: 'Cartes', color: '#0f7a45' },
  { key: 'photos', label: 'Photos et vidéos', color: '#3e5368' },
  { key: 'donnees', label: 'Données (traces, groupes…)', color: '#9fb1c2' },
];

/** squares : tuiles (carrés) gardées ; squaresBytes : leur poids, pour la moyenne. */
export function PhoneSpacePanel({ cartes, squares, squaresBytes, onClose }: { cartes: number; squares: number; squaresBytes: number; onClose: () => void }) {
  const [space, setSpace] = useState<PhoneSpace | null>(null);
  const sheet = useSheet('placeTelephone', { defaut: 0, masque: false });
  useEffect(() => { void measurePhoneSpace(cartes).then(setSpace).catch(() => {}); }, [cartes]);

  return (
    <div className={`travel phone-space${sheet.classe}`}>
      <div {...sheet.prise}><div className="handle" />
        <div className="travel-head"><span><b>{space ? formatBytes(space.total) : '…'}</b> sur le téléphone</span>
          <span className="head-btns"><button onClick={onClose} aria-label="Fermer">✕</button></span></div>
      </div>
      {sheet.cran > 0 && space && <>
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
        <p className="phone-space-tiles"><b>{squares} tuile{squares > 1 ? 's' : ''} gardée{squares > 1 ? 's' : ''}</b>
          {squares > 0 && <> · <b>≈ {formatBytes(squaresBytes / squares)}</b> par tuile en moyenne</>}</p>
        <p className="phone-space-legend"><span className="leg vert" /> SCAN 25 (tout) <span className="leg bleu" /> Plan IGN seul</p>
        <p className="phone-space-free">Appui long sur la carte : le rectangle prend des tuiles et des traces, pour les supprimer ou télécharger les tuiles.</p>
        {space.libre != null && <p className="phone-space-free">Encore {formatBytes(space.libre)} libres sur le téléphone.</p>}
      </>}
    </div>
  );
}
