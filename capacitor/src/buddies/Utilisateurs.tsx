import { useEffect, useState } from 'react';
import { api } from '../compte/auth';
import { Visage } from './Buddies';

/** Ce que renvoie GET /super/utilisateurs (deploy/comptes/serveur.py). */
type Compte = {
  id: string; pseudo: string; email: string | null; photo: string | null; cree_le: string | null; vu_le: string | null;
  plateforme: 'apk' | 'play' | 'web' | null; version: string | null; jours: number; ouvertures: number; groupes: string[];
  par_jour: Record<string, number>;
};
type Reponse = { telechargements: { total: number; semaine: number }; comptes: Compte[]; semaine: number };

const PLATEFORME = { apk: 'Android', play: 'Play Store', web: 'navigateur' };
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

/** « à l'instant », « il y a 2 h », « hier », « il y a 9 jours ». */
function ilYa(iso: string | null) {
  if (!iso) return '';
  const min = (Date.now() - new Date(iso).getTime()) / 60_000;
  if (min < 10) return "à l'instant";
  if (min < 60) return `il y a ${Math.round(min)} min`;
  const auj = new Date(); auj.setHours(0, 0, 0, 0);
  const d = new Date(iso); d.setHours(0, 0, 0, 0);
  const jours = Math.round((auj.getTime() - d.getTime()) / 86_400_000);
  if (jours === 0) return `il y a ${Math.round(min / 60)} h`;
  return jours === 1 ? 'hier' : `il y a ${jours} jours`;
}
const date = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

/** Onglet Utilisateurs de l'espace Super User (Seb, 27/11) : téléchargements, comptes, et l'usage de chacun. */
export function Utilisateurs() {
  const [r, setR] = useState<Reponse | null | 'erreur'>(null);
  const [choisi, setChoisi] = useState<Compte | null>(null);
  useEffect(() => { api<Reponse>('GET', '/super/utilisateurs').then(setR).catch(() => setR('erreur')); }, []);
  if (r === 'erreur') return <p className="bd-vide">Pas de réseau : la liste revient avec la connexion.</p>;
  if (!r) return <p className="bd-vide">Chargement…</p>;
  if (choisi) return <UnUtilisateur c={choisi} onRetour={() => setChoisi(null)} />;
  return <>
    <div className="su-cases">
      <div className="su-case"><b>{r.telechargements.total}</b><small>{r.telechargements.total > 1 ? 'téléchargements' : 'téléchargement'}<br />dont {r.telechargements.semaine} cette semaine</small></div>
      <div className="su-case"><b>{r.comptes.length}</b><small>{r.comptes.length > 1 ? 'comptes' : 'compte'}<br />{r.semaine} venus cette semaine</small></div>
    </div>
    <h3 className="bd-section">Les plus récents</h3>
    {r.comptes.map((c) => <button key={c.id} className="bd-ligne" onClick={() => setChoisi(c)}>
      <Visage b={c} />
      <span className="bd-texte"><b>{c.pseudo || c.email || '?'}</b>
        <small>{ilYa(c.vu_le)}{c.plateforme ? ` · ${PLATEFORME[c.plateforme]}` : ''}</small></span>
      <span className="su-jours"><b>{c.jours}</b>{c.jours > 1 ? 'jours' : 'jour'}</span>
    </button>)}
  </>;
}

function UnUtilisateur({ c, onRetour }: { c: Compte; onRetour: () => void }) {
  const jours = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - 29 + i);
    return c.par_jour[d.toISOString().slice(0, 10)] ?? 0;
  });
  const max = Math.max(1, ...jours);
  return <div className="su-fiche">
    <button className="su-retour" onClick={onRetour}>‹ Tous les utilisateurs</button>
    <div className="su-tete"><Visage b={c} taille={72} /><b>{c.pseudo || '?'}</b><small>{c.email}</small></div>
    <div className="su-ligne"><span>Inscrit le</span><b>{date(c.cree_le)}</b></div>
    <div className="su-ligne"><span>Dernière fois</span><b>{ilYa(c.vu_le)}</b></div>
    <div className="su-ligne"><span>Jours d'utilisation</span><b>{c.jours}</b></div>
    <div className="su-ligne"><span>Ouvertures</span><b>{c.ouvertures}</b></div>
    <div className="su-ligne"><span>Téléphone</span><b>{c.plateforme ? PLATEFORME[c.plateforme] : '?'}{c.version ? ` · version ${c.version}` : ''}</b></div>
    <div className="su-ligne"><span>Groupes</span><b>{c.groupes.join(', ') || 'aucun'}</b></div>
    <small className="su-legende">Ouvertures des 30 derniers jours ({pluriel(jours.reduce((a, b) => a + b, 0), 'ouverture')})</small>
    <div className="su-barres" aria-hidden="true">{jours.map((n, i) => <i key={i} style={{ height: `${(n / max) * 100}%` }} />)}</div>
  </div>;
}
