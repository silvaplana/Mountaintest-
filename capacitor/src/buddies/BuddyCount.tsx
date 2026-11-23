import { useState } from 'react';
import { aujourdhui, enregistrerDepense, lire, retirerDepense, type Depense, type Sortie } from './store';
import { compte, euros, icone, lireEuros } from './count';
import { Visage } from './Buddies';

/**
 * Buddy count (spec/buddies.md §5.10, écran 8) : le partage des frais d'un Buddy Time, partagé entre téléphones.
 * Équilibres en barres, « qui doit à qui », dépenses, « ＋ Dépense ». Mêmes écrans côté Kotlin (BuddiesPanel.kt).
 */

/** Tous les Buddy counts : un par Buddy Time (le plus récent en haut), et l'ancien partage des frais. */
export function Comptes({ sorties, depenses, onOuvrir, onAnciens, onRetour, onClose }: {
  sorties: Sortie[]; depenses: Depense[]; onOuvrir: (x: Sortie) => void; onAnciens: () => void; onRetour: () => void; onClose: () => void;
}) {
  const l = [...sorties].sort((a, b) => b.debut.localeCompare(a.debut));
  return <div className="bd-corps">
    <div className="xp-head">
      <button onClick={onRetour} aria-label="Retour">‹</button><h2>Buddy count</h2>
      <button onClick={onClose} aria-label="Fermer">✕</button>
    </div>
    {l.map((x) => {
      const t = depenses.filter((d) => d.sortie === x.id).reduce((n, d) => n + d.montant, 0);
      return <button key={x.id} className="bd-ligne" onClick={() => onOuvrir(x)}>
        <span className="bd-album-mini">💶</span>
        <span className="bd-texte"><b>{x.nom}</b><small>{t ? `${euros(t)} à ${x.participants.length}` : 'pas encore de dépense'}</small></span>
      </button>;
    })}
    {!l.length && <p className="bd-vide">Chaque Buddy Time a son Buddy count : les dépenses de la sortie, partagées entre vous.</p>}
    <span style={{ flex: 1 }} />
    <button className="bd-grand" onClick={onAnciens}>💰 Mes partages de frais hors Buddy Time</button>
  </div>;
}

/** Un Buddy count (écran 8). */
export function BuddyCount({ x, depenses, onDepense, onRetour, onClose }: {
  x: Sortie; depenses: Depense[]; onDepense: (id?: string) => void; onRetour: () => void; onClose: () => void;
}) {
  const moi = lire().moi ?? 'moi';
  const ds = depenses.filter((d) => d.sortie === x.id);
  const c = compte(x, ds, moi);
  const max = Math.max(1, ...Object.values(c.soldes).map((v) => Math.abs(v)));
  const qui = (id: string) => x.participants.find((p) => p.id === id) ?? { id, pseudo: '?', photo: null };
  return <div className="bd-corps bd-count">
    <div className="xp-head">
      <button onClick={onRetour} aria-label="Retour">‹</button>
      <span className="bd-titre"><b>{x.nom}</b><small>💶 {euros(c.total)} à {x.participants.length}</small></span>
      <button onClick={onClose} aria-label="Fermer">✕</button>
    </div>
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
    <h3 className="bd-section">Dépenses</h3>
    {ds.map((d) => <button key={d.id} className="bd-ligne bd-depense" onClick={() => onDepense(d.id)}>
      <span className="bd-icone">{icone(d.titre)}</span>
      <span className="bd-texte"><b>{d.titre}</b><small>payé par {qui(d.paye_par).pseudo}{d.pour.length < x.participants.length ? ` · pour ${d.pour.length}` : ''}{d.attente ? ' · 🕓' : ''}</small></span>
      <b>{euros(d.montant)}</b>
    </button>)}
    {!ds.length && <p className="bd-vide">Pas encore de dépense : le gîte, l'essence, les courses… chacun ajoute ce qu'il a payé.</p>}
    <span style={{ flex: 1 }} />
    <button className="primary bd-grand" onClick={() => onDepense()}>＋ Dépense</button>
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
    {d && <button className="bd-grand" onClick={() => { retirerDepense(d.id); onToast(`« ${d.titre} » retirée`); onFini(); }}>Retirer la dépense</button>}
  </div>;
}
