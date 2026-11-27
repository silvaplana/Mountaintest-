import { useState } from 'react';
import { bloquer, debloquer, estBloque, signaler, synchroniser, traiterSignalement, type Buddy, type Etat, type Motif } from './store';

/**
 * 🚩 Signaler et 🚫 bloquer (exigés par le Play Store pour une appli avec messagerie ; maquettes
 * maquettes/play-store-compte-signaler, validées par Seb le 27/11).
 */

const trait = (d: string, size = 24) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor"
  strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
/** Drapeau au trait : signaler. */
export const FlagIcon = ({ size = 24 }: { size?: number }) => trait('M5 21V4M5 4h11l-2 4 2 4H5', size);
/** Rond barré au trait : bloquer. */
export const BlockIcon = ({ size = 24 }: { size?: number }) => trait('M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16M6.5 6.5l11 11', size);

export const MOTIFS: [Motif, string][] = [['insulte', 'Insultant ou harcèlement'], ['choquant', 'Choquant (image, propos)'], ['pub', 'Pub ou arnaque'], ['autre', 'Autre']];

/** Écran 5 : un motif, un mot si on veut, et « Bloquer aussi » coché d'office (pas pour Bud). */
export function Signaler({ message, buddy, onFermer, onFait }: {
  message?: string; buddy?: Buddy; onFermer: () => void; onFait: (texte: string) => void;
}) {
  const [motif, setMotif] = useState<Motif>('insulte');
  const [mot, setMot] = useState('');
  const [aussi, setAussi] = useState(!!buddy && !estBloque(buddy.id));
  const envoyer = () => {
    signaler({ message, buddy: message ? undefined : buddy?.id, motif, mot });
    if (aussi && buddy) bloquer(buddy);
    void synchroniser().catch(() => undefined);
    onFait(aussi && buddy ? `Signalement envoyé, ${buddy.pseudo} est bloqué` : 'Signalement envoyé');
  };
  const quoi = message ? (buddy ? `le message de ${buddy.pseudo}` : 'la réponse de Bud') : buddy?.pseudo ?? '';
  return <div className="bd-voile" onClick={onFermer}><div className="bd-feuille" onClick={(ev) => ev.stopPropagation()}>
    <h3>Signaler {quoi}</h3>
    {MOTIFS.map(([m, l]) => <label key={m} className="md-choix"><input type="radio" name="motif" checked={motif === m} onChange={() => setMotif(m)} />{l}</label>)}
    <textarea className="field" rows={2} maxLength={300} placeholder="Un mot pour expliquer (facultatif)" value={mot} onChange={(ev) => setMot(ev.target.value)} />
    {buddy && !estBloque(buddy.id) && <label className="md-choix"><input type="checkbox" checked={aussi} onChange={(ev) => setAussi(ev.target.checked)} />Bloquer {buddy.pseudo} aussi</label>}
    <button onClick={onFermer}>Annuler</button>
    <button className="md-rouge" onClick={envoyer}>Envoyer le signalement</button>
  </div></div>;
}

/** Profil › Personnes bloquées : la liste, et « Débloquer ». */
export function PersonnesBloquees({ e, onFermer }: { e: Etat; onFermer: () => void }) {
  const l = e.bloques ?? [];
  return <div className="bd-voile" onClick={onFermer}><div className="bd-feuille" onClick={(ev) => ev.stopPropagation()}>
    <h3>Personnes bloquées</h3>
    {l.length ? l.map((b) => <div key={b.id} className="md-ligne"><b>{b.pseudo}</b>
      <button onClick={() => { debloquer(b.id); void synchroniser().catch(() => undefined); }}>Débloquer</button></div>)
      : <p className="hint">Personne. Pour bloquer quelqu'un : appui long sur un de ses messages, puis « Signaler », ou depuis la liste des membres d'un groupe.</p>}
    <p className="hint">Bloqué, il reste dans les groupes, mais tu ne vois plus ses messages ni sa position, et il ne voit plus la tienne. Il n'est pas prévenu.</p>
    <button onClick={onFermer}>Fermer</button>
  </div></div>;
}

const NOM_MOTIF: Record<Motif, string> = Object.fromEntries(MOTIFS) as Record<Motif, string>;
const NOM_SUITE = { ignore: 'ignoré', efface: 'message effacé', retire: 'retiré du groupe' };

/** Écran 8 : les signalements, dans l'espace du Super User (clé dorée). */
export function Signalements({ e }: { e: Etat }) {
  const l = e.signalements ?? [];
  const traiter = (id: string, suite: 'ignore' | 'efface' | 'retire') => { traiterSignalement(id, suite); void synchroniser().catch(() => undefined); };
  if (!l.length) return <p className="bd-vide">Pas de signalement</p>;
  return <>{l.map((x) => <div key={x.id} className={`md-carte${x.suite ? ' traite' : ''}`}>
    <small>{x.par} signale {x.cible} · {new Date(x.le).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
    <b>{NOM_MOTIF[x.motif] ?? x.motif}</b>
    {x.extrait && <q>{x.extrait}</q>}
    <small>{[x.lieu, x.mot && `« ${x.mot} »`].filter(Boolean).join(' · ')}</small>
    {x.suite ? <small>Traité · {NOM_SUITE[x.suite]}</small> : <div className="md-boutons">
      <button onClick={() => traiter(x.id, 'ignore')}>Ignorer</button>
      {x.message && <button className="md-danger" onClick={() => traiter(x.id, 'efface')}>Effacer le message</button>}
      {x.message && x.cible_id && <button className="md-danger" onClick={() => traiter(x.id, 'retire')}>Retirer {x.cible}</button>}
    </div>}
  </div>)}</>;
}
