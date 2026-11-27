import { useState, type ReactNode } from 'react';
import { appeler, appelEnCours, type Dest } from './appel';
import { useBuddies, Visage } from './Buddies';
import { aujourdhui, appliquer, contacts, ouvrirDuo, presence, vue, type Buddy } from './store';

/**
 * 📞 « Appeler qui ? » (Seb, 27/11, maquette `maquettes/appeler-qui/`) : le 📞 sans groupe ni sortie ouverts.
 * La recherche en haut, puis les groupes et sorties (derniers appelés d'abord), puis les buddies un par un.
 */
const CLE = 'appels-recents';
function recents(memoire = CLE): string[] {
  try { return JSON.parse(localStorage.getItem(memoire) ?? '[]') as string[]; } catch { return []; }
}
/** Retenir qui j'appelle, pour le mettre en tête la prochaine fois. */
export function noterAppel(cle: string, memoire = CLE) {
  try { localStorage.setItem(memoire, JSON.stringify([cle, ...recents(memoire).filter((x) => x !== cle)].slice(0, 20))); } catch { /* sans mémoire */ }
}
/** « Éric » trouve « eric » : sans accents ni majuscules. */
export const simple = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

type Ligne = { cle: string; nom: string; sous: string; visage: { id: string; nom: string; photo: string | null }; carre?: boolean; appeler: () => void };

/**
 * La même feuille sert à « Partager ma carte avec qui ? » (Seb, 27/11) : `choix` remplace l'appel, `memoire` garde
 * ses propres derniers choix, `icone` remplace le téléphone au bout des lignes.
 */
export function AppelerQui({ onClose, onToast, titre = 'Appeler qui ?', verbe = 'Appeler', choix, memoire = CLE, icone, pied }: {
  onClose: () => void; onToast: (m: string) => void;
  titre?: string; verbe?: string; choix?: (dest: Dest, nom: string) => void; memoire?: string; icone?: ReactNode;
  /** Sous la liste (le partage de carte : « Envoyer le journal »). */
  pied?: ReactNode;
}) {
  const e = useBuddies();
  const [q, setQ] = useState('');
  const v = vue(e);
  const r = recents(memoire);
  const rang = (cle: string, quand = '') => { const i = r.indexOf(cle); return i >= 0 ? `0${String(i).padStart(3, '0')}` : `1${quand ? String(9e15 - Date.parse(quand)) : 'z'}`; };
  const dernier = (k: 'groupe' | 'sortie', id: string) => v.messages.filter((m) => m[k] === id).reduce((a, m) => (m.cree_le > a ? m.cree_le : a), '');
  const lancer = (cle: string, dest: Dest, nom: string) => {
    if (choix) { noterAppel(cle, memoire); onClose(); choix(dest, nom); return; }
    if (appelEnCours() && !appelEnCours()!.muette) { onToast('Tu es déjà en appel'); return; }
    noterAppel(cle);
    onClose();
    void appeler(dest, nom).catch((err: Error) => onToast(err.message || 'Appel impossible'));
  };
  const groupes: (Ligne & { tri: string })[] = [
    ...appliquer(e).filter((g) => g.nature === 'bande').map((g) => ({
      cle: `g:${g.id}`, nom: g.nom, sous: `${g.membres.length} buddies`, visage: { id: g.id, nom: g.nom, photo: null },
      tri: rang(`g:${g.id}`, dernier('groupe', g.id)), appeler: () => lancer(`g:${g.id}`, { groupe: g.id }, g.nom) })),
    ...v.sorties.filter((s) => s.fin >= aujourdhui()).map((s) => ({
      cle: `s:${s.id}`, nom: s.nom, sous: `sortie · ${s.participants.length} partants`, visage: { id: s.id, nom: s.nom, photo: null }, carre: true,
      tri: rang(`s:${s.id}`, dernier('sortie', s.id)), appeler: () => lancer(`s:${s.id}`, { sortie: s.id }, s.nom) })),
  ].sort((a, b) => a.tri.localeCompare(b.tri) || a.nom.localeCompare(b.nom, 'fr'));
  const buddies: (Ligne & { tri: string })[] = contacts(e).map(({ b, bandes }) => ({
    cle: `b:${b.id}`, nom: b.pseudo, sous: presence(b.id, e.lectures ?? []) ?? bandes.join(', '), visage: { id: b.id, nom: b.pseudo, photo: b.photo },
    tri: rang(`b:${b.id}`), appeler: () => {
      // À un buddy seul : l'appel passe par notre discussion à deux (créée au besoin).
      void ouvrirDuo(b as Buddy).then((id) => lancer(`b:${b.id}`, { groupe: id }, b.pseudo)).catch((err: Error) => onToast(err.message));
    } })).sort((a, b) => a.tri.localeCompare(b.tri) || a.nom.localeCompare(b.nom, 'fr'));
  const garde = (l: Ligne) => !q.trim() || simple(l.nom).includes(simple(q.trim()));
  const ligne = (l: Ligne) => <button key={l.cle} className="aq-ligne" onClick={l.appeler} aria-label={`${verbe} ${l.nom}`}>
    <span className={l.carre ? 'aq-carre' : undefined}><Visage b={l.visage} taille={48} /></span>
    <span className="aq-nom"><b>{l.nom}</b><small>{l.sous}</small></span>
    <span className="aq-tel" aria-hidden>{icone ?? <svg viewBox="0 0 24 24"><path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" /></svg>}</span>
  </button>;
  const gs = groupes.filter(garde), bs = buddies.filter(garde);
  return <div className="aq-voile" onClick={onClose}>
    <div className="aq-feuille" onClick={(x) => x.stopPropagation()}>
      <div className="aq-tete"><b>{titre}</b><button className="aq-x" aria-label="Fermer" onClick={onClose}>✕</button></div>
      <label className="aq-cherche">🔍<input value={q} onChange={(x) => setQ(x.target.value)} placeholder="Chercher un nom" /></label>
      <div className="aq-liste">
        {gs.length > 0 && <div className="aq-titre">GROUPES ET SORTIES</div>}
        {gs.map(ligne)}
        {bs.length > 0 && <div className="aq-titre">BUDDIES</div>}
        {bs.map(ligne)}
        {pied}
        {!gs.length && !bs.length && <div className="aq-vide">{q.trim() ? `Personne ne s'appelle « ${q.trim()} »` : `Pas encore de buddies${choix ? '' : ' à appeler'}`}</div>}
      </div>
    </div>
  </div>;
}
