import { useState } from 'react';
import { aujourdhui, enregistrerDepense, lire, peutRetirer, retirerDepense, type BuddyCountEtat, type Depense, type Groupe, type Sortie } from './store';
import { compte, euros, icone, lireEuros } from './count';
import { BuddyCountIcon, FeuilleNom, Visage } from './Buddies';
import { PencilIcon, TrashIcon } from '../icones';

/**
 * Buddy count (spec/buddies.md §5.10, écran 8) : le partage des frais d'une sortie, partagé entre téléphones.
 * Équilibres en barres, « qui doit à qui », dépenses, « ＋ Dépense ». Mêmes écrans côté Kotlin (BuddiesPanel.kt).
 */

/** Une sortie vue comme un Buddy count de groupe, pour réutiliser les écrans : ses membres partagent les frais. */
export function sortieDuCount(c: BuddyCountEtat, g: Groupe): Sortie {
  return { id: c.id, groupe: g.id, nom: c.nom, photo: null, debut: '0000-01-01', fin: '9999-12-31', lieu: '', modifie_le: c.modifie_le,
    par: c.par, participants: g.membres, invitations: [] };
}

/**
 * Tous les Buddy counts (Seb, 26/11, §7.20) : ceux de groupe d'abord, puis ceux de sortie ; dans chaque partie, les
 * ouverts en tête. « ＋ Buddy count » dans un groupe en crée un de groupe.
 */
export function Comptes({ groupes, sorties, counts, depenses, ici, onOuvrir, onNouveau, onRetour, onClose }: {
  groupes: Groupe[]; sorties: Sortie[]; counts: BuddyCountEtat[]; depenses: Depense[]; ici?: Groupe;
  onOuvrir: (x: Sortie, deGroupe: boolean) => void; onNouveau?: () => void; onRetour: () => void; onClose: () => void;
}) {
  const total = (id: string) => depenses.filter((d) => d.sortie === id).reduce((n, d) => n + d.montant, 0);
  const etat = (id: string) => counts.find((c) => c.id === id || c.sortie === id);
  const deGroupe = counts.filter((c) => c.groupe && !c.supprime && groupes.some((g) => g.id === c.groupe))
    .sort((a, b) => b.cree_le.localeCompare(a.cree_le))
    .map((c) => sortieDuCount(c, groupes.find((g) => g.id === c.groupe)!));
  const deSortie = sorties.filter((x) => !etat(x.id)?.supprime)
    .sort((a, b) => b.debut.localeCompare(a.debut));
  const ligne = (x: Sortie, g: boolean, sous: string) => {
    const t = total(x.id);
    return <button key={x.id} className="bd-ligne bd-count-ligne" onClick={() => onOuvrir(x, g)}>
      <span className="bd-album-mini"><BuddyCountIcon /></span>
      <span className="bd-texte"><b>{x.nom}</b><small>{t ? `${euros(t)} à ${x.participants.length}` : 'pas encore de dépense'}{sous}</small></span>
    </button>;
  };
  return <div className="bd-corps">
    <div className="xp-head">
      <button onClick={onRetour} aria-label="Retour">‹</button>
      <span className="bd-titre"><b>Buddy count</b>{ici && <small>{ici.nom}</small>}</span>
      <button onClick={onClose} aria-label="Fermer">✕</button>
    </div>
    {/* Deux parties, comme ailleurs : Groupe puis Sortie (Seb, 26/11). */}
    <h3 className="bd-section">Groupe</h3>
    {deGroupe.length ? deGroupe.map((x) => ligne(x, true, ici ? '' : ` · ${groupes.find((g) => g.id === x.groupe)?.nom ?? ''}`))
      : <p className="bd-vide">Pas encore de Buddy count de groupe</p>}
    <h3 className="bd-section">Sortie</h3>
    {deSortie.length ? deSortie.map((x) => ligne(x, false, '')) : <p className="bd-vide">Pas encore de sortie</p>}
    <span style={{ flex: 1 }} />
    {onNouveau && <div className="bd-plus"><button className="primary" onClick={onNouveau}><span className="bd-plus-texte"><b>＋ Buddy count</b></span></button></div>}
  </div>;
}

/** ＋ Buddy count dans un groupe : son nom, puis « Créer » (Seb, 26/11). */
export function NouveauCount({ g, onCreer, onRetour, onClose }: { g: Groupe; onCreer: (nom: string) => void; onRetour: () => void; onClose: () => void }) {
  const [nom, setNom] = useState('');
  return <div className="bd-corps bd-count">
    <div className="xp-head">
      <button onClick={onRetour} aria-label="Retour">‹</button>
      <span className="bd-titre"><b>Nouveau Buddy count</b></span>
      <button onClick={onClose} aria-label="Fermer">✕</button>
    </div>
    <label className="bd-champ"><small>Nom</small>
      <input value={nom} maxLength={80} autoFocus onChange={(e) => setNom(e.target.value)} placeholder="Cagnotte de la saison, abonnement…" /></label>
    <p className="hint">Buddy count de groupe · {g.nom}. Pour les dépenses de tout le groupe, hors sortie.</p>
    <span style={{ flex: 1 }} />
    <div className="bd-plus"><button className="primary" onClick={() => onCreer(nom)}><span className="bd-plus-texte"><b>Créer</b></span></button></div>
  </div>;
}

/**
 * Un Buddy count (écran 8) : de sortie, ou de groupe (`deGroupe`, la sortie vue par sortieDuCount). Ouvert ou fermé
 * (fermé : plus de « ＋ Dépense ») ; crayon (de groupe), poubelle (admin du groupe) (Seb, 26/11).
 */
export function BuddyCount({ x, depenses, deGroupe = false, onRenommer, onSupprimer, onDepense, onRetour, onClose, onToast }: {
  x: Sortie; depenses: Depense[]; deGroupe?: boolean; onRenommer?: (nom: string) => void;
  onSupprimer?: () => void; onDepense: (id?: string) => void; onRetour: () => void; onClose: () => void; onToast: (m: string) => void;
}) {
  const [nommer, setNommer] = useState(false);
  const moi = lire().moi ?? 'moi';
  const ds = depenses.filter((d) => d.sortie === x.id);
  const c = compte(x, ds, moi);
  const max = Math.max(1, ...Object.values(c.soldes).map((v) => Math.abs(v)));
  const qui = (id: string) => x.participants.find((p) => p.id === id) ?? { id, pseudo: '?', photo: null };
  return <div className="bd-corps bd-count">
    <div className="xp-head">
      <button onClick={onRetour} aria-label="Retour">‹</button>
      <span className="bd-titre"><b>{x.nom}</b><small>{deGroupe ? 'Buddy count de groupe' : 'Buddy count de sortie'} · {euros(c.total)} à {x.participants.length}</small></span>
      <button onClick={onClose} aria-label="Fermer">✕</button>
    </div>
    <div className="bd-count-outils"><span style={{ flex: 1 }} />
      {onRenommer && <button className="bd-crayon" onClick={() => setNommer(true)} aria-label="Changer le nom"><PencilIcon size={18} /></button>}
      {onSupprimer && <button className="bd-crayon" onClick={onSupprimer} aria-label="Supprimer ce Buddy count"><TrashIcon size={18} /></button>}
    </div>
    {nommer && onRenommer && <FeuilleNom titre="Nom du Buddy count" nom={x.nom} onEnregistrer={onRenommer} onFermer={() => setNommer(false)} onToast={onToast} />}
    <div className="bd-entre"><b className="bd-gros">Équilibres</b><small>{euros(c.chacun)} chacun</small></div>
    {x.participants.map((p) => {
      const v = c.soldes[p.id] ?? 0, l = Math.abs(v) / max * 50;
      return <div key={p.id} className="bd-solde">
        <Visage b={p} taille={44} />
        <span className="bd-barre"><i className={v >= 0 ? 'plus' : 'moins'} style={v >= 0 ? { left: '50%', width: `${l}%` } : { right: '50%', width: `${l}%` }} /></span>
        <b className={v > 0.004 ? 'plus' : v < -0.004 ? 'moins' : ''}>{v > 0.004 ? '+' : ''}{euros(Math.round(v * 100))}</b>
      </div>;
    })}
    {c.virements.map((s, i) => <div key={i} className="bd-virement">
      <Visage b={qui(s.from)} taille={40} /><span>→</span><Visage b={qui(s.to)} taille={40} />
      <span className="bd-texte"><b>{qui(s.from).pseudo} doit à {qui(s.to).pseudo}</b></span>
      <b>{euros(Math.round(s.amount * 100))}</b>
    </div>)}
    {ds.length > 0 && !c.virements.length && <p className="hint">Tout est équilibré.</p>}
    {/* Ce que je dois : comment rembourser, seulement ce que la personne a renseigné (Seb, 26/11). */}
    {c.virements.filter((v) => v.from === moi).map((v) => <Rembourser key={v.to} nom={qui(v.to).pseudo}
      moyens={lire().paiements?.[x.id]?.[v.to]} onToast={onToast} />)}
    <h3 className="bd-section">Dépenses</h3>
    {ds.map((d) => <button key={d.id} className="bd-ligne bd-depense" onClick={() => onDepense(d.id)}>
      <span className="bd-icone">{icone(d.titre)}</span>
      <span className="bd-texte"><b>{d.titre}</b><small>payé par {qui(d.paye_par).pseudo}{d.pour.length < x.participants.length ? ` · pour ${d.pour.length}` : ''}{d.attente ? ' · 🕓' : ''}</small></span>
      <b>{euros(d.montant)}</b>
    </button>)}
    {!ds.length && <p className="bd-vide">Pas encore de dépense : le gîte, l'essence, les courses… chacun ajoute ce qu'il a payé.</p>}
    <span style={{ flex: 1 }} />
    <div className="bd-plus"><button className="primary" onClick={() => onDepense()}><span className="bd-plus-texte"><b>＋ Dépense</b></span></button></div>
  </div>;
}

/** IBAN lisible : par groupes de 4. */
const ibanLisible = (iban: string) => iban.replace(/(.{4})/g, '$1 ').trim();

/** « Rembourser Julie » : par Wero et/ou par virement, chacun avec Copier ; sinon une petite phrase. */
function Rembourser({ nom, moyens, onToast }: { nom: string; moyens?: { iban?: string; wero?: string }; onToast: (m: string) => void }) {
  const copier = (t: string, quoi: string) => {
    navigator.clipboard?.writeText(t).then(() => onToast(`${quoi} copié`)).catch(() => onToast(t));
  };
  if (!moyens?.wero && !moyens?.iban) return <p className="hint bd-rembourser">{nom} n'a pas renseigné son Wero ni son IBAN.</p>;
  return <div className="bd-rembourser">
    <b>Rembourser {nom}</b>
    {moyens.wero && <div className="bd-moyen"><span className="bd-texte"><small>par Wero</small><b>{moyens.wero}</b></span>
      <button onClick={() => copier(moyens.wero!, 'Numéro Wero')}>Copier</button></div>}
    {moyens.iban && <div className="bd-moyen"><span className="bd-texte"><small>par virement</small><b>{ibanLisible(moyens.iban)}</b></span>
      <button onClick={() => copier(moyens.iban!, 'IBAN')}>Copier</button></div>}
  </div>;
}

/** Ajouter ou corriger une dépense : titre, montant, qui a payé, pour qui, le jour. */
export function UneDepense({ x, d, onFini, onToast, onClose }: {
  x: Sortie; d?: Depense; onFini: () => void; onToast: (m: string) => void; onClose: () => void;
}) {
  const moi = lire().moi ?? 'moi';
  const [titre, setTitre] = useState(d?.titre ?? '');
  const [montant, setMontant] = useState(d ? (d.montant / 100).toFixed(2).replace('.', ',').replace(',00', '') : '');
  const [paye, setPaye] = useState(d?.paye_par ?? (x.participants.some((p) => p.id === moi) ? moi : x.participants[0]?.id ?? moi));
  const [pour, setPour] = useState<string[]>(d?.pour ?? x.participants.map((p) => p.id));
  const [jour, setJour] = useState(d?.jour ?? (aujourdhui() < x.debut ? x.debut : aujourdhui() > x.fin ? x.fin : aujourdhui()));
  const c = lireEuros(montant);
  const enregistrer = () => {
    if (c == null) { onToast('Indique le montant, par exemple 24,50'); return; }
    try {
      enregistrerDepense({ depense: d?.id, sortie: x.id, titre, montant: c, paye_par: paye, pour, jour });
      onFini();
    } catch (e) { onToast((e as Error).message); }
  };
  return <div className="bd-corps bd-count">
    <div className="xp-head">
      <button onClick={onFini} aria-label="Retour">‹</button>
      <span className="bd-titre"><b>{d ? 'La dépense' : 'Nouvelle dépense'}</b><small>{x.nom}</small></span>
      <button onClick={onClose} aria-label="Fermer">✕</button>
    </div>
    <label className="bd-champ"><small>Quoi</small>
      <span className="bd-avec-icone"><span>{icone(titre)}</span><input value={titre} maxLength={80} onChange={(e) => setTitre(e.target.value)} placeholder="Gîte, essence, courses…" /></span></label>
    <label className="bd-champ"><small>Combien (€)</small>
      <input className="bd-montant" inputMode="decimal" value={montant} onChange={(e) => setMontant(e.target.value)} placeholder="0" /></label>
    <h3 className="bd-section">Payé par</h3>
    <div className="bd-choix-visages">{x.participants.map((p) => <button key={p.id} className={paye === p.id ? 'oui' : ''} onClick={() => setPaye(p.id)}>
      <Visage b={p} taille={48} /><small>{p.pseudo}</small></button>)}</div>
    <h3 className="bd-section">Pour qui<small>{c != null && pour.length ? ` · ${euros(Math.round(c / pour.length))} chacun` : ''}</small></h3>
    <div className="bd-choix-visages">{x.participants.map((p) => {
      const oui = pour.includes(p.id);
      return <button key={p.id} className={oui ? 'oui' : 'non'} onClick={() => setPour(oui ? pour.filter((y) => y !== p.id) : [...pour, p.id])}>
        <Visage b={p} taille={48} /><small>{oui ? '✓ ' : ''}{p.pseudo}</small></button>;
    })}</div>
    <label className="bd-champ"><small>Le jour</small><input type="date" value={jour} onChange={(e) => setJour(e.target.value)} /></label>
    <span style={{ flex: 1 }} />
    <button className="primary bd-grand" onClick={enregistrer}>Enregistrer</button>
    {d && peutRetirer(d.par, d.sortie) && <button className="bd-grand" onClick={() => { retirerDepense(d.id); onToast(`« ${d.titre} » retirée`); onFini(); }}>Retirer la dépense</button>}
  </div>;
}
