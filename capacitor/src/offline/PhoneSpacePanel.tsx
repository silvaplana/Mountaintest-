// Panneau remontable en bas quand le calque « Hors ligne » est allumé (Seb, 26/11) : la place prise sur le téléphone,
// le nombre de tuiles gardées et leur poids moyen. La poignée le remonte, la croix à droite le ferme.
import { useEffect, useState } from 'react';
import { formatBytes } from '../Usage';
import { useSheet } from '../useSheet';
import { measurePhoneSpace, serverSpace, type PhoneSpace, type ServerSpace } from './phoneSpace';

const PARTS: { key: 'cartes' | 'photos' | 'donnees'; label: string; color: string }[] = [
  { key: 'cartes', label: 'Cartes', color: '#0f7a45' },
  { key: 'photos', label: 'Photos et vidéos', color: '#3e5368' },
  { key: 'donnees', label: 'Données (traces, groupes…)', color: '#9fb1c2' },
];

const SRV_PARTS: { key: 'photos' | 'fichiers' | 'donnees'; label: string; color: string }[] = [
  { key: 'photos', label: 'Mes photos et films', color: '#3e5368' },
  { key: 'fichiers', label: 'Mes fichiers joints', color: '#7a8ea3' },
  { key: 'donnees', label: 'Mes traces et messages', color: '#9fb1c2' },
];

/** squares : tuiles téléchargées ; squaresBytes : leur poids, pour la moyenne. */
export function PhoneSpacePanel({ cartes, squares, squaresBytes, onClose }: { cartes: number; squares: number; squaresBytes: number; onClose: () => void }) {
  const [space, setSpace] = useState<PhoneSpace | null>(null);
  const sheet = useSheet('placeTelephone', { defaut: 0, masque: false });
  const [srv, setSrv] = useState<ServerSpace | null>(null);
  useEffect(() => {
    void measurePhoneSpace(cartes).then((sp) => { setSpace(sp); return serverSpace(sp.total).then(setSrv); }).catch(() => {});
  }, [cartes]);
  const total = (x: { photos: number; fichiers: number; donnees: number }) => x.photos + x.fichiers + x.donnees;

  return (
    <div className={`travel phone-space${sheet.classe}`}>
      <div {...sheet.prise}><div className="handle" />
        <div className="travel-head"><span><b>{space ? formatBytes(space.total) : '…'}</b> sur le téléphone</span>
          <span className="head-btns"><button onClick={onClose} aria-label="Fermer">✕</button></span></div>
      </div>
      {/* Toujours visible, même panneau réduit (Seb, 26/11) : comment choisir les tuiles. */}
      <p className="phone-space-free">Appui long sur la carte, puis étire le rectangle : il prend les tuiles et les traces à supprimer ou à télécharger.</p>
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
        <p className="phone-space-tiles"><b>{squares} tuile{squares > 1 ? 's' : ''} téléchargée{squares > 1 ? 's' : ''}</b>
          {squares > 0 && <> · <b>≈ {formatBytes(squaresBytes / squares)}</b> par tuile en moyenne</>}</p>
        <p className="phone-space-legend"><span className="leg vert" /> SCAN 25 (tout) <span className="leg bleu" /> Plan IGN seul</p>
        {space.libre != null && <p className="phone-space-free">Encore {formatBytes(space.libre)} libres sur le téléphone.</p>}
        {/* Sur le serveur (Seb, 26/11) : chacun voit la sienne ; le Super User voit celle de tout le monde. */}
        {srv && <>
          <p className="phone-space-tiles"><b>{formatBytes(total(srv.moi))}</b> à moi sur le serveur</p>
          {SRV_PARTS.map((p) => (
            <div key={p.key} className="phone-space-row">
              <span className="phone-space-dot" style={{ background: p.color }} />
              <span>{p.label}</span><b>{formatBytes(srv.moi[p.key])}</b>
            </div>
          ))}
        </>}
        {srv?.tous && <>
          <p className="phone-space-tiles"><b>Tout le monde</b> · serveur / téléphone</p>
          {srv.tous.map((x, i) => (
            <div key={i} className="phone-space-row">
              <span style={{ flex: 1 }}>{x.pseudo || '—'}</span>
              <b style={{ whiteSpace: 'nowrap' }}>{formatBytes(total(x))}</b>
              <b className="phone-space-tel">{x.telephone != null ? formatBytes(x.telephone) : '—'}</b>
            </div>
          ))}
          <p className="phone-space-free">Total sur le serveur : {formatBytes(srv.tous.reduce((n, x) => n + total(x), 0))}.
            Téléphone : envoyé par chaque appli une fois par jour.</p>
        </>}
      </>}
    </div>
  );
}
