import { useState } from 'react';
import { iconesAGauche } from './doigt';

const CLE = 'accueilVu';

/**
 * Panneau d'accueil (Seb, 26/11) : une seule fois, à la première ouverture de l'appli. Le but en deux phrases (texte de
 * Seb), puis comment avoir l'aide : appui long sur la flèche, sur la carte comme dans l'écran des « buddies ».
 */
export default function Accueil() {
  const [vu, setVu] = useState(() => { try { return localStorage.getItem(CLE) === '1'; } catch { return true; } });
  if (vu) return null;
  const fermer = () => { try { localStorage.setItem(CLE, '1'); } catch { /* ignoré */ } setVu(true); };
  const cote = iconesAGauche() ? 'gauche' : 'droite';
  return <div className="accueil-voile">
    <div className="accueil" role="dialog" aria-label="Bienvenue">
      <img src="logo.svg" alt="" />
      <h2>Bienvenue !</h2>
      <p>Mountain Buddies, c'est la carte ergonomique dans ta poche, même sans réseau, pour préparer et suivre tes sorties.</p>
      <p>Et c'est collaboratif : traces, photos, vidéos 3D, dépenses communes et positions, partagées avec ta bande.</p>
      <div className="accueil-aide">
        <span className="accueil-fleche">{iconesAGauche() ? '▶' : '◀'}</span>
        <span><b>Besoin d'aide ?</b><br />Appuie longtemps sur la flèche en haut à {cote}, sur la carte comme dans l'écran de tes «&nbsp;buddies&nbsp;» (les deux bonhommes)&nbsp;: chaque bouton dit ce qu'il fait.</span>
      </div>
      <button className="primary" onClick={fermer}>C'est parti</button>
    </div>
  </div>;
}
