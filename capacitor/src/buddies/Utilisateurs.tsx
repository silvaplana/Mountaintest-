import { useEffect, useState } from 'react';
import { api } from '../compte/auth';
import { Visage } from './Buddies';

/** Ce que renvoie GET /super/utilisateurs (deploy/comptes/serveur.py). */
type Compte = {
  id: string; pseudo: string; email: string | null; photo: string | null; cree_le: string | null; vu_le: string | null;
  plateforme: 'apk' | 'play' | 'web' | null; version: string | null; jours: number; ouvertures: number; groupes: string[];
  par_jour: Record<string, number>;
};
type Ligne = { quand: string; qui: string; pseudo: string; quoi: 'inscription' | 'connexion' | 'ouverture' | 'rejoint' | 'deconnexion'; detail: string };
type Reponse = { telechargements: { total: number; semaine: number }; comptes: Compte[]; semaine: number; journal: Ligne[] };

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
/** Une ligne du journal, à la façon de Seb : « Toto s'est connecté ». */
function phrase(l: Ligne) {
  switch (l.quoi) {
    case 'inscription': return 'a créé son compte';
    case 'connexion': return `s'est connecté${l.detail ? ` (${l.detail})` : ''}`;
    case 'ouverture': return `a ouvert l'appli${l.detail ? ` (${l.detail})` : ''}`;
    case 'rejoint': return `a rejoint « ${l.detail} »`;
    case 'deconnexion': return "s'est déconnecté";
  }
}
const heure = (iso: string) => {
  const d = new Date(iso), auj = new Date();
  const h = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === auj.toDateString() ? h : `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} ${h}`;
};

/** Journal du Super User (Seb, 27/11), le plus récent en haut ; avec `avecNom`, le pseudo devant chaque ligne. */
function Journal({ lignes, avecNom }: { lignes: Ligne[]; avecNom: boolean }) {
  if (!lignes.length) return <p className="bd-vide">Rien pour l'instant</p>;
  return <ul className="su-journal">{lignes.map((l, i) => <li key={i}>
    <span>{avecNom && <b>{l.pseudo} </b>}{phrase(l)}</span><small>{heure(l.quand)}</small></li>)}</ul>;
}

const date = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

/** Onglet Utilisateurs de l'espace Super User (Seb, 27/11) : téléchargements, comptes, et l'usage de chacun. */
export function Utilisateurs() {
  const [r, setR] = useState<Reponse | null | 'erreur'>(null);
  const [choisi, setChoisi] = useState<Compte | null>(null);
  useEffect(() => { api<Reponse>('GET', '/super/utilisateurs').then(setR).catch(() => setR('erreur')); }, []);
  if (r === 'erreur') return <p className="bd-vide">Pas de réseau : la liste revient avec la connexion.</p>;
  if (!r) return <p className="bd-vide">Chargement…</p>;
  if (choisi) return <UnUtilisateur c={choisi} journal={r.journal.filter((l) => l.qui === choisi.id)} onRetour={() => setChoisi(null)} />;
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
    <h3 className="bd-section">Journal</h3>
    <Journal lignes={r.journal ?? []} avecNom />
    <JetonJournaux />
  </>;
}

/**
 * 📓 Le jeton qui permet à Claude de lire les journaux de diagnostic sur le serveur (Seb, 27/11). Tiré au hasard par le
 * serveur, jamais dans le dépôt ; le Super User le copie dans les réglages de l'environnement de Claude.
 */
function JetonJournaux() {
  const [j, setJ] = useState('');
  const [copie, setCopie] = useState(false);
  const voir = () => { void api<{ jeton: string }>('GET', '/super/jeton-journaux').then((r) => setJ(r.jeton)).catch(() => setJ('')); };
  const copier = () => { void navigator.clipboard?.writeText(j).then(() => setCopie(true)).catch(() => undefined); };
  return <>
    <h3 className="bd-section">Journaux pour Claude</h3>
    {!j ? <button className="bd-ligne" onClick={voir}><span className="bd-texte"><b>Voir le jeton des journaux</b>
      <small>Pour que Claude lise lui-même les journaux de diagnostic</small></span></button>
      : <div className="su-jeton"><code>{j}</code><button className="bd-bouton" onClick={copier}>{copie ? 'Copié' : 'Copier'}</button></div>}
  </>;
}

function UnUtilisateur({ c, journal, onRetour }: { c: Compte; journal: Ligne[]; onRetour: () => void }) {
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
    <h3 className="bd-section">Journal</h3>
    <Journal lignes={journal} avecNom={false} />
  </div>;
}
