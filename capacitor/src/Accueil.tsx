import { useState } from 'react';
import { iconesAGauche } from './doigt';

const CLE = 'accueilVu';
const TOUJOURS = 'accueilToujours';

/** Case du profil « Afficher l'aide à l'ouverture » (Seb, 26/11) : le panneau revient à chaque ouverture. */
export const aideAOuverture = () => { try { return localStorage.getItem(TOUJOURS) === '1'; } catch { return false; } };
export const choisirAideAOuverture = (oui: boolean) => { try { localStorage.setItem(TOUJOURS, oui ? '1' : '0'); } catch { /* ignoré */ } };

/**
 * Panneau d'accueil (Seb, 26/11) : une seule fois, à la première ouverture de l'appli. Le but en deux phrases (texte de
 * Seb), puis comment avoir l'aide : appui long sur la flèche, sur la carte comme dans l'écran des « buddies ».
 */
/** Le panneau va s'ouvrir (première ouverture, ou aide à chaque ouverture). */
export const accueilAOuvrir = () => { try { return localStorage.getItem(CLE) !== '1' || aideAOuverture(); } catch { return false; } };

export default function Accueil({ onPremiereFois, onFerme }: { onPremiereFois?: () => void; onFerme?: () => void }) {
  const [vu, setVu] = useState(() => !accueilAOuvrir());
  if (vu) return null;
  const fermer = () => {
    let premiere = false;
    try { premiere = localStorage.getItem(CLE) !== '1'; localStorage.setItem(CLE, '1'); } catch { /* ignoré */ }
    setVu(true);
    onFerme?.();
    if (premiere) onPremiereFois?.();
  };
  const cote = iconesAGauche() ? 'gauche' : 'droite';
  return <div className="accueil-voile">
    <div className="accueil" role="dialog" aria-label="Bienvenue">
      <img src="logo.svg" alt="" />
      <h2>Bienvenue !</h2>
      <p>Mountain Buddies, c'est la carte magique dans ta poche, même sans réseau, pour préparer, vivre et revivre tes sorties outdoor.</p>
      <p>Et c'est collaboratif : traces, topos, photos, vidéos, vidéos 3D, dépenses communes, positions et messagerie, partagées avec ta bande.</p>
      <div className="accueil-aide">
        <span className="accueil-fleche">{iconesAGauche() ? '▶' : '◀'}</span>
        <span><b>Besoin d'aide ?</b><br />Appuie longtemps sur la flèche en haut à {cote}, sur la carte comme dans le second écran (👥), celui de tes «&nbsp;buddies&nbsp;»&nbsp;: chaque bouton dit ce qu'il fait.</span>
      </div>
      <button className="primary" onClick={fermer}>C'est parti</button>
    </div>
  </div>;
}
