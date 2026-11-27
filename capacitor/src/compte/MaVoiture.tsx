import { useState } from 'react';
import { changerVoiture, type Profil } from './auth';
import { chercherModeles, COULEURS, dessinVoiture, FORMES, formeDuModele, nomForme, type Couleur, type Forme } from '../buddies/voitureDessin';

/** Une voiture dessinée, en ligne dans un écran React. */
export function DessinVoiture({ forme, couleur, largeur, contour = false }: { forme: Forme; couleur: Couleur; largeur: number; contour?: boolean }) {
  return <span className="mv-dessin" dangerouslySetInnerHTML={{ __html: dessinVoiture(forme, couleur, largeur, contour) }} />;
}

/** Profil › Ma voiture : la ligne du profil (aperçu, marque et modèle) qui ouvre la feuille. */
export function LigneMaVoiture({ p }: { p: Profil | null | undefined }) {
  const [ouvert, setOuvert] = useState(false);
  const forme = FORMES.includes(p?.voiture_forme as Forme) ? p!.voiture_forme as Forme : null;
  return <>
    <button className="acc-support mv-ligne" onClick={() => setOuvert(true)}>
      {forme ? <DessinVoiture forme={forme} couleur={(p?.voiture_couleur ?? 'rouge') as Couleur} largeur={64} /> : <span className="mv-vide">🚗</span>}
      <span><b>{p?.voiture_modele || (forme ? nomForme(forme) : 'Ma voiture')}</b><small>{forme ? 'vue par mes buddies quand je la gare' : 'marque, modèle et couleur, pour que tes buddies la reconnaissent'}</small></span>
      <span aria-hidden="true">›</span>
    </button>
    {ouvert && <FeuilleMaVoiture p={p} onFermer={() => setOuvert(false)} />}
  </>;
}

/** La feuille « Ma voiture » (Seb, 27/11, maquette voiture-modele) : marque et modèle avec la liste des modèles connus,
 * la silhouette proposée d'après le modèle (modifiable), la couleur, l'aperçu, Enregistrer. */
function FeuilleMaVoiture({ p, onFermer }: { p: Profil | null | undefined; onFermer: () => void }) {
  const [modele, setModele] = useState(p?.voiture_modele ?? '');
  const [forme, setForme] = useState<Forme | null>(FORMES.includes(p?.voiture_forme as Forme) ? p!.voiture_forme as Forme : null);
  const [couleur, setCouleur] = useState<Couleur>((p?.voiture_couleur as Couleur) || 'rouge');
  const [liste, setListe] = useState(false);
  const proposes = liste ? chercherModeles(modele) : [];
  const taper = (t: string) => {
    setModele(t);
    setListe(true);
    const f = formeDuModele(t);
    if (f) setForme(f);
  };
  const enregistrer = () => {
    void changerVoiture({ voiture_modele: modele, voiture_forme: forme ?? '', voiture_couleur: forme ? couleur : '' });
    onFermer();
  };
  return <div className="bd-voile" onClick={onFermer}><div className="bd-feuille mv-feuille" onClick={(ev) => ev.stopPropagation()}>
    <h3>Ma voiture</h3>
    <label className="field">Marque et modèle
      <input value={modele} maxLength={60} placeholder="ex. Dacia Duster" onChange={(ev) => taper(ev.target.value)} onBlur={() => setTimeout(() => setListe(false), 200)} />
    </label>
    {proposes.length > 0 && <div className="mv-liste">
      {proposes.map((m) => <button key={m.nom} onClick={() => { setModele(m.nom); setForme(m.forme); setListe(false); }}>
        <DessinVoiture forme={m.forme} couleur="gris" largeur={54} /><b>{m.nom}</b><small>{nomForme(m.forme)}</small>
      </button>)}
    </div>}
    <div className="mv-titre">Silhouette{forme && formeDuModele(modele) === forme ? <small> · proposée d'après le modèle</small> : null}</div>
    <div className="mv-formes">
      {FORMES.map((f) => <button key={f} className={f === forme ? 'on' : ''} onClick={() => setForme(f)} aria-pressed={f === forme}>
        <DessinVoiture forme={f} couleur={f === forme ? couleur : 'gris'} largeur={56} />{nomForme(f)}
      </button>)}
    </div>
    <div className="mv-titre">Couleur</div>
    <div className="mv-couleurs">
      {(Object.keys(COULEURS) as Couleur[]).map((c) => <button key={c} className={c === couleur ? 'on' : ''} style={{ background: COULEURS[c] }}
        aria-label={c} aria-pressed={c === couleur} onClick={() => setCouleur(c)} />)}
    </div>
    {forme && <div className="mv-apercu"><DessinVoiture forme={forme} couleur={couleur} largeur={120} contour />
      <span><b>{modele || nomForme(forme)}</b><small>vue par mes buddies</small></span></div>}
    <button className="primary" onClick={enregistrer}>Enregistrer</button>
    <button onClick={onFermer}>Annuler</button>
  </div></div>;
}
