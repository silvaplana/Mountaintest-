// Encart « Je récupère tes affaires » (Seb, 27/11, maquette maquettes/restauration/ variante B ; spec buddies.md §7.27) :
// après une installation, à la première connexion, l'appli reprend sur le serveur Mes traces, les groupes, sorties,
// albums et conversations. L'encart le dit en haut de la carte, chaque ligne se coche quand elle arrive, puis il s'efface.
import { useEffect, useState, type ReactElement } from 'react';

type Ligne = 'traces' | 'groupes' | 'sorties' | 'albums' | 'conversations';
type Etat = { nombres: Partial<Record<Ligne, number>>; attente: boolean };

const EVENEMENT = 'mb-restauration';
let etat: Etat = { nombres: {}, attente: false };
const changer = (e: Etat) => { etat = e; window.dispatchEvent(new Event(EVENEMENT)); };

/** La première synchro des groupes commence : leurs lignes attendent (roue). */
export function debutRestauration() { changer({ ...etat, attente: true }); }
/** Ce qui est revenu ; `fin` : la synchro des groupes est finie (réussie ou non). */
export function annoncerRestauration(nombres: Partial<Record<Ligne, number>>, fin = false) {
  changer({ nombres: { ...etat.nombres, ...nombres }, attente: fin ? false : etat.attente });
}

const svg = (d: ReactElement) => <svg className="resto-icone" viewBox="0 0 24 24" aria-hidden="true">{d}</svg>;
const ICONES: Record<Ligne | 'nuage' | 'ok', ReactElement> = {
  nuage: svg(<><path d="M7 18.5h10.5a3.8 3.8 0 0 0 .4-7.6A5.5 5.5 0 0 0 7.3 9.6 4.5 4.5 0 0 0 7 18.5z" /><path d="M12 11v6M9.6 14.6l2.4 2.4 2.4-2.4" /></>),
  traces: svg(<><circle cx="4.5" cy="18.5" r="2" /><path d="M6.3 17.6c3-1.4 3.6-5.6 7-5.6s3.6-4.2 6.2-5.6" /><path d="M19.5 3v5M19.5 3h3l-1 1.3 1 1.2h-3" /></>),
  groupes: svg(<><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.6 2.7-6 6-6s6 2.4 6 6" /><circle cx="16.5" cy="7" r="2.6" /><path d="M16.5 12.2c2.9 0 4.8 2.1 4.8 5.3" /></>),
  sorties: svg(<><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /><path d="M7 17.5l3-3.5 2 2 2.2-3 2.8 4.5" /></>),
  albums: svg(<><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><path d="M3.5 17l5.5-6 4 4.5 2.5-2.5 5 4.5" /><circle cx="16" cy="9" r="1.6" /></>),
  conversations: svg(<><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5z" /><path d="M8.5 9h7M8.5 12h4.5" /></>),
  ok: svg(<path d="M5 12.5l4.5 4.5L19 7.5" />),
};
const NOMS: [Ligne, string][] = [['traces', 'Traces'], ['groupes', 'Groupes'], ['sorties', 'Sorties'], ['albums', 'Albums'], ['conversations', 'Conversations']];
const DES_GROUPES: Ligne[] = ['groupes', 'sorties', 'albums', 'conversations'];

const fermer = () => changer({ nombres: {}, attente: false });

export function Restauration() {
  const [e, setE] = useState(etat);
  useEffect(() => {
    const ecoute = () => setE(etat);
    window.addEventListener(EVENEMENT, ecoute);
    return () => window.removeEventListener(EVENEMENT, ecoute);
  }, []);
  const visible = Object.values(e.nombres).some((n) => (n ?? 0) > 0);
  // Tout est arrivé : l'encart s'efface seul 5 s après la dernière ligne.
  useEffect(() => {
    if (!visible || e.attente) return;
    const t = setTimeout(fermer, 5000);
    return () => clearTimeout(t);
  }, [e, visible]);
  if (!visible) return null;

  const lignes = NOMS.filter(([l]) => (e.nombres[l] ?? 0) > 0 || (e.attente && e.nombres[l] === undefined && DES_GROUPES.includes(l)));
  const arrivees = lignes.filter(([l]) => e.nombres[l] !== undefined).length;
  return (
    <div className="resto" role="status" onClick={fermer}>
      <div className="resto-titre">{ICONES.nuage}{e.attente ? 'Je récupère tes affaires' : 'Tes affaires sont revenues'}</div>
      {lignes.map(([l, nom]) => (
        <div key={l} className={`resto-ligne${e.nombres[l] === undefined ? ' attente' : ''}`}>
          {ICONES[l]}<span>{nom}</span>
          <b>{e.nombres[l] === undefined ? <i className="resto-roue" /> : <>{e.nombres[l]}{ICONES.ok}</>}</b>
        </div>
      ))}
      <div className="resto-barre"><i style={{ width: `${Math.round((100 * arrivees) / Math.max(1, lignes.length))}%` }} /></div>
      <div className="resto-pied">Toucher pour fermer</div>
    </div>
  );
}
