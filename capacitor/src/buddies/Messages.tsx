import { Fragment, useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';
import { Capacitor } from '@capacitor/core';
import { EcoLocation } from '../gps/ecoLocation';
import { deposer, Image as PhotoImage } from './Album';
import { couleur, useBuddies, Visage } from './Buddies';
import { MicIcon, Onde, useDictee } from './Dictee';
import { iconeHebergement, prixHebergement } from './Hebergements';
import { apercu, cle, fil, heureMessage, jourMessage, longueurTrace, morceaux, resume, type Bulle, type Dest } from './messages';
import { agir, annuler, contexte, demander, pourBud } from './bud';
import { effacerNotif } from './notifs';
import { adresse, estImage, estVideo, ouvrir, preparer, taille } from './fichiers';
import {
  appliquer, autreDuDuo, contacts, DELAI_MODIFIER, presence, envoyerMessage, estAdmin, lire, marquerLu, modifierMessage, noterActionsBud, nonLus, proposerHebergement, reagir, retirerMessage, signalerEcrit, statut,
  synchroniser, transferer, voter, vue, type Buddy, type FichierMessage, type Groupe, type Hebergement, type Lecture, type MessageBuddy, type Sortie, type TraceBuddy,
  nomDiscussion, estBloque,
} from './store';
import { TrashIcon } from '../icones';
import { FlagIcon, Signaler } from './Moderation';
import { CartePlanning, ChoisirPlanning, PlanningIcon } from './Planning';
import { montrerMaCarte, reprendreMaCarte, suivreUneCarte } from './appel';
import { useAppel } from './Appel';
import { IconeSuisCarte } from './IconeSuisCarte';

/**
 * Messagerie (spec/buddies.md §5.6, écrans 6 et 24) : une conversation par groupe et par sortie.
 * Celle d'une sortie s'ouvre sur sa carte (bandeau du bas) ; celle d'un groupe dans le panneau.
 * Mêmes écrans côté Kotlin (Messages.kt, BuddiesPanel.kt, BandeauSortie.kt).
 */

/** Ma position du moment, pour « je suis ici ». */
export function maPosition(): Promise<{ lon: number; lat: number }> {
  return new Promise((ok, ko) => {
    // getCurrentPosition ne rend rien : sans test à part, `?? ko(...)` rejetait toujours tout de suite.
    const lire = () => (navigator.geolocation ? navigator.geolocation.getCurrentPosition((p) => ok({ lon: p.coords.longitude, lat: p.coords.latitude }), ko,
      { maximumAge: 60_000, timeout: 20_000, enableHighAccuracy: true }) : ko(new Error('gps')));
    if (Capacitor.isNativePlatform()) void EcoLocation.requestPermissions().then(lire, ko); else lire();
  });
}

export type Actions = {
  onPoint: (p: { lon: number; lat: number; nom: string }) => void;
  onTrace: (t: TraceBuddy) => void;
  onHebergement?: (h: Hebergement) => void;
  onPhoto?: () => void;
  /** 📅 Ouvrir un planning du fil (`remplir` : directement mes dispos), ou en créer un pour l'envoyer ici (Seb, 27/11). */
  onPlanning?: (id: string, remplir?: boolean) => void;
  onNouveauPlanning?: () => void;
};

// Comme la messagerie d'AppBase (Seb, 24 novembre) : réactions une par buddy, émojis du 🙂 (montagne au lieu de danse).
const RAPIDES = ['👍', '❤️', '😊', '😂', '😮', '🙏'];
const TOUTES = ['😊', '😍', '🤩', '😎', '👍', '❤️', '👏', '🙏', '😂', '😮', '😢', '🔥', '💪', '⛷️', '🌟', '🎉'];
const EMOJIS = [
  '😀', '😂', '🥰', '😍', '😉', '😎', '🙂', '😢', '😭', '😡', '😱', '🤔', '👍', '👎', '👏', '🙏',
  '💪', '🙌', '🤝', '👋', '❤️', '💔', '🎉', '✨', '🔥', '💯', '⛷️', '🏔️', '🥾', '🧗', '🚵', '☀️', '🌙', '⭐', '❄️', '🍻',
];
const ANNULER_MS = 10_000;
// Entrée envoie seulement à la souris ; sur un écran tactile elle va à la ligne, on envoie avec ➤ (comme AppBase).
const ENTREE_ENVOIE = typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches && !window.matchMedia('(any-pointer: coarse)').matches;

/**
 * Une conversation : le fil, puis [🙂] [📎] [Message] [🎤 / ➤] (📎 : 📷 photo ou vidéo, 📍 position, 📄 fichier, 📊 sondage). `court` : seulement les derniers mots (écran 24).
 * Appui long sur un message (§5.6, comme AppBase) : Répondre, Copier, Modifier (15 min), Supprimer, et les réactions.
 */
export function Conversation({ dest, membres, sortie, court, onToast, ...a }: Actions & {
  dest: Dest; membres: Buddy[]; sortie?: Sortie; court?: boolean; onToast: (m: string) => void;
}) {
  const e = useBuddies();
  const v = vue(e);
  const moi = e.moi ?? 'moi';
  const bulles = fil(dest, v.messages, v.traces, v.hebergements);
  const [texte, setTexte] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [reponse, setReponse] = useState<MessageBuddy | null>(null);
  const [edition, setEdition] = useState<MessageBuddy | null>(null);
  const [aSupprimer, setASupprimer] = useState<string[]>([]);
  const suppression = useRef<{ ids: string[]; t: ReturnType<typeof setTimeout> } | null>(null);
  const [emojis, setEmojis] = useState(false);
  const [bandeau, setBandeau] = useState('');
  const [clignote, setClignote] = useState<string | null>(null);
  const bas = useRef<HTMLDivElement>(null);
  const saisie = useRef<HTMLTextAreaElement>(null);
  const fichier = useRef<HTMLInputElement>(null);
  const media = useRef<HTMLInputElement>(null);
  const piece = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false);
  const [sondage, setSondage] = useState(false);
  const [transfert, setTransfert] = useState<MessageBuddy[] | null>(null);
  const [aSignaler, setASignaler] = useState<MessageBuddy | null>(null);
  const k = cle(dest);
  const dictee = useDictee((t) => setTexte((x) => `${x}${x && !x.endsWith(' ') ? ' ' : ''}${t}`), onToast);
  const nom = (id: string) => membres.find((b) => b.id === id)?.pseudo ?? '?';
  const autres = membres.map((b) => b.id).filter((id) => id !== moi && id !== 'moi');
  const groupe = appliquer(e).find((g) => g.id === (sortie?.groupe ?? dest.groupe));
  const admin = !!groupe && estAdmin(groupe, e);
  // 📅 Un planning appartient à un groupe : seulement dans la conversation d'un groupe ou de l'une de ses sorties.
  const plannings = groupe?.nature === 'bande' && a.onPlanning ? v.plannings.filter((p) => p.groupe === groupe.id) : null;
  const [choixPlanning, setChoixPlanning] = useState(false);
  // Ouverte : on regarde les nouveaux messages toutes les 5 s (« écrit… », « en ligne »), et on les marque lus (✓✓ bleues).
  useEffect(() => {
    const t = setInterval(() => { void synchroniser().catch(() => undefined); }, 5_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { if (!court) effacerNotif(k); }, [k, court, bulles.length]);
  const dernier = bulles.at(-1)?.quand;
  useEffect(() => {
    if (nonLus(e, k, v.messages)) {
      const recu = v.messages.filter((m) => (m.groupe === k || m.sortie === k) && m.par !== moi && !m.attente).at(-1);
      marquerLu(k, recu?.cree_le);
    }
    if (!selection.length) bas.current?.scrollIntoView({ block: 'end' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, dernier, bulles.length]);
  const montrer = (t: string) => { setBandeau(t); setTimeout(() => setBandeau((b) => (b === t ? '' : b)), 2500); };

  // 🐻 « Bud, … » : la question part comme un message, puis la réponse de Bud arrive dans sa bulle, vue de tous.
  const [budPense, setBudPense] = useState(false);
  const bud = async (question: string) => {
    setBudPense(true);
    try {
      const donnees = { nom: appliquer(e).find((g) => g.id === dest.groupe)?.nom ?? '', sortie, membres, moi, traces: v.traces,
        hebergements: v.hebergements, depenses: v.depenses, plannings: v.plannings, messages: v.messages, sorties: v.sorties };
      const r = await demander(question, contexte(dest, donnees));
      // Ce que je lui ai demandé de faire (dépense, sortie, ma dispo) : fait en mon nom, « Annuler » sous sa bulle.
      const { faites, refus } = agir(r.actions, dest, { ...donnees, groupe: appliquer(e).find((g) => g.id === (sortie?.groupe ?? dest.groupe)) });
      const id = envoyerMessage(dest, { texte: r.texte || 'C’est fait.', bud: true });
      if (faites.length && id) noterActionsBud(id, faites);
      if (refus.length) onToast(`Bud n’a pas pu : ${refus.join(' ; ')}`);
      if (r.point) envoyerMessage(dest, { nature: 'point', texte: r.point.nom, lon: r.point.lon, lat: r.point.lat, bud: true });
      if (sortie) for (const h of r.hebergements) proposerHebergement([sortie.id], { ...h, nature: h.type });
      void synchroniser().catch(() => undefined);
    } catch (err) { onToast((err as Error).message); }
    setBudPense(false);
  };
  const envoyer = () => {
    if (!texte.trim()) return;
    if (edition) {
      if (Date.now() - Date.parse(edition.cree_le) > DELAI_MODIFIER) onToast('Ce message ne peut plus être modifié.');
      else if (texte.trim() !== edition.texte) modifierMessage(edition.id, texte);
      setEdition(null);
    } else {
      envoyerMessage(dest, { texte, repond_a: reponse?.id });
      if (pourBud(texte)) void bud(texte);
      setReponse(null);
    }
    setTexte('');
    if (saisie.current) saisie.current.style.height = '';
    void synchroniser().catch(() => undefined);
  };
  const point = async () => {
    setOccupe(true);
    try { envoyerMessage(dest, { nature: 'point', ...await maPosition() }); } catch { onToast('Position introuvable : le GPS est-il allumé ?'); }
    setOccupe(false);
  };
  // 📎 et 📷 (hors sortie) : photos, vidéos, documents, gardés sur le téléphone puis envoyés au retour du réseau.
  const joindre = async (l: FileList | null) => {
    if (!l?.length) return;
    setOccupe(true);
    for (const f of Array.from(l)) {
      try { envoyerMessage(dest, { nature: 'fichier', fichier: await preparer(f), repond_a: reponse?.id }); } catch (err) { onToast((err as Error).message); }
    }
    setReponse(null); setOccupe(false);
    void synchroniser().catch(() => undefined);
  };
  const insererEmoji = (x: string) => {
    const el = saisie.current;
    const d = el?.selectionStart ?? texte.length, f = el?.selectionEnd ?? texte.length;
    setTexte(texte.slice(0, d) + x + texte.slice(f));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(d + x.length, d + x.length); });
  };

  // --- Sélection et barre d'actions (appui long), comme AppBase ---
  const choisis = v.messages.filter((m) => selection.includes(m.id));
  const seul = choisis.length === 1 ? choisis[0] : null;
  const peutModifier = !!seul && seul.par === moi && !seul.bud && seul.nature === 'texte' && Date.now() - Date.parse(seul.cree_le) < DELAI_MODIFIER;
  const aTransferer = choisis.filter((m) => !m.supprime && !m.sondage && m.nature !== 'photo' && m.nature !== 'planning' && !m.bud);
  const peutSupprimer = choisis.length > 0 && choisis.every((m) => m.par === moi || m.par === 'moi' || admin);
  const envoyerSuppressions = (ids: string[]) => { ids.forEach(retirerMessage); void synchroniser().catch(() => undefined); };
  const supprimer = () => {
    const ids = [...selection];
    setSelection([]);
    if (suppression.current) { clearTimeout(suppression.current.t); envoyerSuppressions(suppression.current.ids); }
    const t = setTimeout(() => { envoyerSuppressions(ids); suppression.current = null; setASupprimer([]); }, ANNULER_MS);
    suppression.current = { ids, t };
    setASupprimer(ids);
  };
  const annulerSuppression = () => { if (suppression.current) clearTimeout(suppression.current.t); suppression.current = null; setASupprimer([]); };
  // Quitter le fil pendant les 10 s : la suppression part quand même.
  useEffect(() => () => { if (suppression.current) { clearTimeout(suppression.current.t); envoyerSuppressions(suppression.current.ids); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const copier = () => {
    void navigator.clipboard?.writeText(choisis.map(resume).join('\n')).catch(() => undefined);
    setSelection([]); montrer('Copié');
  };
  const allerA = (id: string) => {
    document.getElementById(`m-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setClignote(id); setTimeout(() => setClignote((c) => (c === id ? null : c)), 1500);
  };
  const appui = useAppuiLong(selection, setSelection);

  const montrees = court ? bulles.slice(-2) : bulles;
  const lectures = e.lectures ?? [];
  const ctx: Contexte = { dest, moi, nom, photos: v.photos, plannings: v.plannings, messages: v.messages, autres, lectures, selection, aSupprimer, clignote,
    appui: court ? undefined : appui, toast: onToast, allerA, reagir: (m, x) => { reagir(m.id, x); setSelection([]); void synchroniser().catch(() => undefined); } };
  return <div className={`bd-conv${court ? ' court' : ''}`}>
    {selection.length > 0 && <div className="bd-selection">
      <button aria-label="Annuler la sélection" onClick={() => setSelection([])}>‹</button>
      <b>{selection.length}</b>
      {seul && !seul.supprime && <button onClick={() => { setEdition(null); setReponse(seul); setSelection([]); saisie.current?.focus(); }}>↩️<small>Répondre</small></button>}
      <button onClick={copier}>📋<small>Copier</small></button>
      {aTransferer.length > 0 && <button onClick={() => { setTransfert(aTransferer); setSelection([]); }}>↪️<small>Transférer</small></button>}
      {peutModifier && <button onClick={() => { setReponse(null); setEdition(seul); setTexte(seul!.texte); setSelection([]); requestAnimationFrame(() => saisie.current?.focus()); }}>✏️<small>Modifier</small></button>}
      {peutSupprimer && <button onClick={supprimer}><TrashIcon size={26} /><small>Supprimer</small></button>}
      {seul && !seul.supprime && (seul.bud || (seul.par !== moi && seul.par !== 'moi')) && <button onClick={() => { setASignaler(seul); setSelection([]); }}>
        <FlagIcon size={26} /><small>Signaler</small></button>}
    </div>}
    <div className="bd-fil">
      {!bulles.length && <p className="bd-vide">Pas encore de message. Écris, dicte avec le micro, ou joins une photo, un fichier, ta position ou un sondage avec 📎.</p>}
      {montrees.map((b, i) => {
        const jour = jourMessage(b.quand);
        const sep = !court && (i === 0 || jourMessage(montrees[i - 1].quand) !== jour);
        return <Fragment key={`${b.genre}${b.genre === 'message' ? b.m.id : b.genre === 'trace' ? b.t.id : b.h.id}`}>
          {sep && <small className="bd-jour">{jour}</small>}
          <UneBulle b={b} c={ctx} {...a} />
        </Fragment>;
      })}
      {budPense && <div className="bd-bulle bud"><b className="bd-qui-ecrit">🐻 Bud</b><span>…</span></div>}
      <div ref={bas} />
    </div>
    {aSupprimer.length > 0 && <div className="bd-bandeau">{aSupprimer.length > 1 ? `${aSupprimer.length} messages supprimés` : 'Message supprimé'}
      <button className="bd-lien" onClick={annulerSuppression}>Annuler</button></div>}
    {bandeau && <div className="bd-bandeau">{bandeau}</div>}
    {(reponse || edition) && <div className="bd-rappel-saisie">
      <span className="bd-texte"><b>{edition ? 'Modifier le message' : `Répondre à ${reponse!.par === moi ? 'toi' : reponse!.bud ? 'Bud' : nom(reponse!.par)}`}</b>
        <small>{resume((edition ?? reponse)!)}</small></span>
      <button aria-label="Renoncer" onClick={() => { if (edition) setTexte(''); setReponse(null); setEdition(null); }}>✕</button>
    </div>}
    {menu && <div className="bd-joindre">
      <button onClick={() => { setMenu(false); (sortie ? fichier : media).current?.click(); }}><span>📷</span>{sortie ? 'Photo' : 'Photo, vidéo'}</button>
      <button disabled={occupe} onClick={() => { setMenu(false); void point(); }}><span>📍</span>Ma position</button>
      <button onClick={() => { setMenu(false); piece.current?.click(); }}><span>📄</span>Fichier</button>
      <button onClick={() => { setMenu(false); setSondage(true); }}><span>📊</span>Sondage</button>
      {plannings && <button onClick={() => { setMenu(false); setChoixPlanning(true); }}><span><PlanningIcon /></span>Planning</button>}
    </div>}
    {choixPlanning && plannings && <ChoisirPlanning plannings={plannings} onFermer={() => setChoixPlanning(false)}
      onNouveau={a.onNouveauPlanning && (() => { setChoixPlanning(false); a.onNouveauPlanning!(); })}
      onChoisir={(p) => { envoyerMessage(dest, { nature: 'planning', planning: p.id, texte: p.nom }); setChoixPlanning(false); void synchroniser().catch(() => undefined); }} />}
    {sondage && <NouveauSondage onFermer={() => setSondage(false)} onEnvoyer={(x) => { envoyerMessage(dest, { nature: 'sondage', sondage: x }); setSondage(false); void synchroniser().catch(() => undefined); }} />}
    {aSignaler && <Signaler message={aSignaler.id} buddy={aSignaler.bud ? undefined : membres.find((x) => x.id === aSignaler.par) ?? { id: aSignaler.par, pseudo: nom(aSignaler.par), photo: null }}
      onFermer={() => setASignaler(null)} onFait={(t) => { setASignaler(null); montrer(t); }} />}
    {transfert && <Transferer ms={transfert} ici={k} onFermer={() => setTransfert(null)} onFait={(n) => { setTransfert(null); montrer(n > 1 ? `Envoyé à ${n} conversations` : 'Envoyé'); }} />}
    {emojis && <div className="bd-emojis">{EMOJIS.map((x) => <button key={x} onClick={() => insererEmoji(x)}>{x}</button>)}</div>}
    <div className="bd-saisie">
      {dictee.ecoute ? <Onde niveau={dictee.niveau} partiel={dictee.partiel} avant={texte} /> : <>
        <button aria-label="Insérer une émoji" className={emojis ? 'actif' : ''} onClick={() => { setEmojis(!emojis); setMenu(false); }}>🙂</button>
        {!edition && <button aria-label="Joindre" className={menu ? 'actif' : ''} disabled={occupe} onClick={() => { setMenu(!menu); setEmojis(false); }}>📎</button>}
        <textarea ref={saisie} rows={1} value={texte} placeholder="Message, ou « Bud, … »" enterKeyHint={ENTREE_ENVOIE ? 'send' : 'enter'} maxLength={2000}
          onChange={(ev) => { setTexte(ev.target.value); signalerEcrit(k); ev.target.style.height = 'auto'; ev.target.style.height = `${Math.min(ev.target.scrollHeight, 140)}px`; }}
          onFocus={() => { setEmojis(false); setMenu(false); }}
          onKeyDown={(ev) => { if (ENTREE_ENVOIE && ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); envoyer(); } }} />
      </>}
      {texte.trim() && !dictee.ecoute ? <button className="bd-envoyer" aria-label={edition ? 'Enregistrer' : 'Envoyer'} onClick={envoyer}>{edition ? '✓' : '➤'}</button>
        : <button className={dictee.ecoute ? 'bd-ecoute' : 'micro'} aria-label={dictee.ecoute ? 'Arrêter la dictée' : 'Dicter'} onClick={() => void dictee.basculer()}>{dictee.ecoute ? '■' : <MicIcon />}</button>}
      <input ref={media} type="file" accept="image/*,video/*" multiple hidden onChange={(ev) => void joindre(ev.target.files).finally(() => { ev.target.value = ''; })} />
      <input ref={piece} type="file" multiple hidden onChange={(ev) => void joindre(ev.target.files).finally(() => { ev.target.value = ''; })} />
      {sortie && <input ref={fichier} type="file" accept="image/*" multiple hidden onChange={(ev) => {
        const f = ev.target.files; if (!f?.length) return;
        setOccupe(true);
        void deposer(sortie, f, onToast).then((ids) => ids.forEach((photo) => envoyerMessage(dest, { nature: 'photo', photo })))
          .finally(() => { setOccupe(false); ev.target.value = ''; });
      }} />}
    </div>
  </div>;
}

/** Appui long (500 ms) ou clic droit : choisit le message ; ensuite, toucher d'autres bulles les ajoute ou les retire. */
function useAppuiLong(selection: string[], setSelection: (f: (s: string[]) => string[]) => void) {
  const r = useRef<{ t?: ReturnType<typeof setTimeout>; fait: boolean }>({ fait: false });
  return (id: string) => {
    const stop = () => clearTimeout(r.current.t);
    return {
      onPointerDown: (ev: React.PointerEvent) => {
        if (ev.pointerType === 'mouse') return;
        r.current.fait = false;
        r.current.t = setTimeout(() => { r.current.fait = true; setSelection((s) => (s.includes(id) ? s : [...s, id])); navigator.vibrate?.(30); }, 500);
      },
      onPointerUp: stop, onPointerCancel: stop, onPointerLeave: stop,
      onContextMenu: (ev: React.MouseEvent) => { ev.preventDefault(); setSelection((s) => (s.includes(id) ? s : [...s, id])); },
      onClickCapture: (ev: React.MouseEvent) => {
        if (r.current.fait) { r.current.fait = false; ev.stopPropagation(); ev.preventDefault(); return; }
        if (selection.length) { ev.stopPropagation(); ev.preventDefault(); setSelection((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])); }
      },
    };
  };
}

type Contexte = {
  dest: Dest; moi: string; nom: (id: string) => string; photos: ReturnType<typeof vue>['photos']; plannings: ReturnType<typeof vue>['plannings']; messages: MessageBuddy[]; autres: string[];
  lectures: Lecture[]; selection: string[]; aSupprimer: string[]; clignote: string | null;
  appui?: ReturnType<typeof useAppuiLong>; toast: (m: string) => void; allerA: (id: string) => void; reagir: (m: MessageBuddy, emoji: string | null) => void;
};

/** ✓ envoyé, ✓✓ reçu, ✓✓ bleues lu (par tous les autres). */
function Coches({ m, c }: { m: MessageBuddy; c: Contexte }) {
  const s = statut(m, c.autres, c.lectures);
  if (s === 'attente') return <span title="Partira au retour du réseau"> · 🕓</span>;
  return <span className={`bd-coches${s === 'lu' ? ' lu' : ''}`} aria-label={s === 'lu' ? 'Lu' : s === 'recu' ? 'Reçu' : 'Envoyé'}>{s === 'envoye' ? ' ✓' : ' ✓✓'}</span>;
}

/** Sous la bulle : les émojis donnés et leur nombre ; les toucher montre qui a réagi. */
function Reactions({ m, c, mien }: { m: MessageBuddy; c: Contexte; mien: boolean }) {
  const [qui, setQui] = useState(false);
  const l = m.reactions ?? [];
  if (!l.length || m.supprime) return null;
  return <>
    <button className={`bd-reactions${mien ? ' mien' : ''}`} aria-label="Qui a réagi" onClick={() => setQui(!qui)}>
      {[...new Set(l.map((r) => r.emoji))].join('')}{l.length > 1 && <small>{l.length}</small>}</button>
    {qui && <div className={`bd-qui-reagit${mien ? ' mien' : ''}`}>{l.map((r) => r.qui === c.moi
      ? <button key={r.qui} className="bd-lien" onClick={() => { setQui(false); c.reagir(m, null); }}>{r.emoji} Toi · toucher pour retirer</button>
      : <span key={r.qui}>{r.emoji} {c.nom(r.qui)}</span>)}</div>}
  </>;
}

/** Au-dessus du message choisi : les plus courantes, + pour les autres. */
function ReactionsRapides({ m, c, mien }: { m: MessageBuddy; c: Contexte; mien: boolean }) {
  const [toutes, setToutes] = useState(false);
  const mienne = m.reactions?.find((r) => r.qui === c.moi)?.emoji;
  return <div className={`bd-rapides${mien ? ' mien' : ''}`}>
    {(toutes ? TOUTES : RAPIDES).map((x) => <button key={x} className={x === mienne ? 'actif' : ''} onClick={() => c.reagir(m, x === mienne ? null : x)}>{x}</button>)}
    {!toutes && <button aria-label="Autres émojis" onClick={() => setToutes(true)}>+</button>}
  </div>;
}

function Texte({ t }: { t: string }) {
  return <span className="bd-msg">{morceaux(t).map((x, i) => x.lien
    ? <a key={i} href={x.lien} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}>{x.texte}</a> : x.texte)}</span>;
}

function UneBulle({ b, c, onPoint, onTrace, onHebergement, onPhoto, onPlanning }: Actions & { b: Bulle; c: Contexte }) {
  const { moi, nom } = c;
  const [voir, setVoir] = useState(false);
  if (b.genre === 'trace') {
    const t = b.t;
    return <button className="bd-bulle-carte" onClick={() => onTrace(t)}>
      <span className="bd-icone">〰</span>
      <span className="bd-texte"><b>{t.nom}</b><small>{t.par.pseudo} · {longueurTrace(t.ligne)} · voir sur la carte</small>{t.mot && <small>« {t.mot} »</small>}</span>
    </button>;
  }
  if (b.genre === 'hebergement') {
    const h = b.h;
    return <button className="bd-bulle-carte" onClick={() => onHebergement?.(h)}>
      <span className="bd-icone">{iconeHebergement(h.nature)}</span>
      <span className="bd-texte"><b>{h.nom}{h.retenu ? ' ✅' : ''}</b><small>{nom(h.par)} · {prixHebergement(h)} · {h.lon != null ? 'voir sur la carte' : 'voir'}</small></span>
    </button>;
  }
  const m = b.m;
  const mien = !m.bud && (m.par === moi || m.par === 'moi');
  const choisi = c.selection.includes(m.id);
  const supprime = m.supprime || c.aSupprimer.includes(m.id);
  const appui = !supprime && c.appui ? c.appui(m.id) : {};
  const classe = `${choisi ? ' choisi' : ''}${c.clignote === m.id ? ' clignote' : ''}`;
  const heure = <small className="bd-heure">{m.edite && !supprime ? 'modifié · ' : ''}{heureMessage(m.cree_le)}{mien && !supprime && <Coches m={m} c={c} />}</small>;
  const rapides = choisi && c.selection.length === 1 && !supprime && <ReactionsRapides m={m} c={c} mien={mien} />;
  const cible = m.repond_a ? c.messages.find((x) => x.id === m.repond_a) : undefined;
  const rappel = cible && !supprime && <button className="bd-rappel" onClick={(ev) => { ev.stopPropagation(); c.allerA(cible.id); }}>
    <b>{cible.bud ? '🐻 Bud' : cible.par === moi ? 'Toi' : nom(cible.par)}</b><small>{resume(cible)}</small></button>;
  const transfere = m.transfere && <small className="bd-transfere">↪️ Transféré</small>;
  const qui = !mien && !m.bud && <b className="bd-qui-ecrit" style={{ color: couleur(m.par) }}>{nom(m.par)}</b>;
  if (supprime) return <div id={`m-${m.id}`} className={`bd-bulle supprime${mien ? ' mien' : ''}`}>{qui}<i>🚫 Ce message a été supprimé</i>{heure}</div>;
  // 🚫 Quelqu'un que j'ai bloqué : son message est replié, on peut le rouvrir.
  if (!mien && !m.bud && !voir && estBloque(m.par)) return <div id={`m-${m.id}`} className="bd-bulle md-masque">
    <i>Message d'une personne bloquée</i> · <button className="bd-lien" onClick={() => setVoir(true)}>Afficher</button></div>;
  let corps: React.ReactNode;
  if (m.bud && m.nature === 'point') {
    // 🐻 Bud montre un endroit : il s'ouvre sur la carte.
    corps = <button className={`bd-bulle-carte${classe}`} {...appui} onClick={() => m.lon != null && m.lat != null && onPoint({ lon: m.lon, lat: m.lat, nom: m.texte || 'Bud montre ici' })}>
      <span className="bd-icone">📍</span><span className="bd-texte"><b>{m.texte || 'Bud montre ici'}</b><small>🐻 Bud · voir sur la carte</small></span>
    </button>;
  } else if (m.bud) {
    // Ce qu'il a fait à ma demande : la liste et « Annuler » (sur mon téléphone seulement : c'est fait en mon nom).
    const fait = lire().actionsBud?.[m.id];
    corps = <div className={`bd-bulle bud${classe}`} {...appui}><b className="bd-qui-ecrit">🐻 Bud</b>{rappel}<Texte t={m.texte} />
      {fait && <>{fait.faites.map((x, i) => <small key={i} className="bd-bud-fait">{fait.annule ? <s>{x.texte}</s> : `✓ ${x.texte}`}</small>)}
        {fait.annule ? <small className="bd-bud-fait">Annulé</small>
          : <button className="bd-lien bd-bud-annuler" onClick={() => { annuler(fait.faites); noterActionsBud(m.id, fait.faites, true); void synchroniser().catch(() => undefined); }}>Annuler</button>}</>}
      {heure}</div>;
  } else if (m.nature === 'point') {
    const n = mien ? 'Je suis ici' : `${nom(m.par)} est ici`;
    corps = <button className={`bd-bulle-carte${classe}`} {...appui} onClick={() => m.lon != null && m.lat != null && onPoint({ lon: m.lon, lat: m.lat, nom: n })}>
      <span className="bd-icone">📍</span><span className="bd-texte"><b>{n}</b><small>{heureMessage(m.cree_le)} · voir sur la carte{mien && <Coches m={m} c={c} />}</small></span>
    </button>;
  } else if (m.nature === 'photo') {
    const p = c.photos.find((x) => x.id === m.photo);
    corps = <div className={`bd-bulle${mien ? ' mien' : ''} photo${classe}`} {...appui}>
      {qui}
      {p ? <button className="bd-bulle-photo" onClick={onPhoto}><PhotoImage p={p} className="bd-bulle-img" /></button> : <small>📷 photo retirée de l'album</small>}
      {heure}
    </div>;
  } else if (m.fichier) {
    corps = <div className={`bd-bulle${mien ? ' mien' : ''} fichier${classe}`} {...appui}>{qui}{transfere}{rappel}
      <Piece f={m.fichier} attente={!!m.attente || (mien && !m.fichier.envoye)} onErreur={c.toast} />{m.texte && <Texte t={m.texte} />}{heure}</div>;
  } else if (m.nature === 'carte_fin') {
    corps = <div className={`bd-bulle${mien ? ' mien' : ''} carte${classe}`} {...appui}><span className="bd-msg bd-mc-msg"><span className="bd-mc-ic"><IconeSuisCarte /></span>
      {mien ? 'Tu as arrêté de partager ta carte' : `${nom(m.par)} a arrêté de partager sa carte`}</span>{heure}</div>;
  } else if (m.nature === 'carte') {
    corps = <div className={`bd-bulle${mien ? ' mien' : ''} carte${classe}`} {...appui}><BulleCarte m={m} c={c} mien={mien} />{heure}</div>;
  } else if (m.nature === 'planning') {
    const p = c.plannings.find((x) => x.id === m.planning);
    corps = <div className={`bd-bulle${mien ? ' mien' : ''} planning${classe}`} {...appui}>{qui}{rappel}
      {p ? <CartePlanning p={p} onOuvrir={(remplir) => onPlanning?.(p.id, remplir)} />
        : <span className="bd-msg">📅 {m.texte || 'Planning'} · plus disponible</span>}{heure}</div>;
  } else if (m.sondage) {
    corps = <div className={`bd-bulle${mien ? ' mien' : ''} sondage${classe}`} {...appui}>{qui}<UnSondage m={m} c={c} />{heure}</div>;
  } else {
    corps = <div className={`bd-bulle${mien ? ' mien' : ''}${m.attente ? ' attente' : ''}${classe}`} {...appui}>{qui}{transfere}{rappel}<Texte t={m.texte} />{heure}</div>;
  }
  return <div id={`m-${m.id}`} className={`bd-bulle-de${mien ? ' mien' : ''}`}>{rapides}{corps}<Reactions m={m} c={c} mien={mien} /></div>;
}

/**
 * 🗺 « Seb partage sa carte » (spec/buddies.md §7.10) : on s'écrit, sans se parler. « Suivre » : la conversation
 * descend et ma carte suit la sienne ; « Non merci » cache les boutons. Au-delà de 4 h, la demande est passée.
 */
const cartesRefusees = new Set<string>();
function BulleCarte({ m, c, mien }: { m: MessageBuddy; c: Contexte; mien: boolean }) {
  const a = useAppel();
  const [, maj] = useState(0);
  const active = a?.muette && a.carte === m.id;
  const vieille = Date.now() - new Date(m.cree_le).getTime() > 4 * 3600e3 || c.messages.some((x) => x.nature === 'carte_fin' && x.texte === m.id);
  if (mien) return <span className="bd-msg bd-mc-msg"><span className="bd-mc-ic"><IconeSuisCarte /></span>
    {active ? <>Tu partages ta carte <button className="bd-lien" onClick={() => montrerMaCarte(false)}>Arrêter</button></> : 'Tu as partagé ta carte'}</span>;
  const qui = c.nom(m.par);
  if (active) return <span className="bd-msg bd-mc-msg"><span className="bd-mc-ic"><IconeSuisCarte /></span>
    Tu suis la carte de {qui} <button className="bd-lien" onClick={reprendreMaCarte}>Arrêter</button></span>;
  if (vieille || cartesRefusees.has(m.id)) return <span className="bd-msg bd-mc-msg"><span className="bd-mc-ic"><IconeSuisCarte /></span>{qui} a partagé sa carte</span>;
  return <div className="bd-mc-demande">
    <span className="bd-msg bd-mc-msg"><span className="bd-mc-ic"><IconeSuisCarte /></span><b>{qui} partage sa carte</b></span>
    <div className="bd-mc-choix">
      <button className="bd-mc-non" onClick={() => { cartesRefusees.add(m.id); maj((n) => n + 1); }}>Non merci</button>
      <button className="bd-mc-oui" onClick={() => void suivreUneCarte(m.id, c.dest, qui).catch((err: Error) => c.toast(err.message || 'Impossible de suivre sa carte'))}>Suivre</button>
    </div>
  </div>;
}

/** Une pièce jointe : photo (plein écran au toucher), vidéo (▶), document (s'ouvre avec l'appli du téléphone). */
function Piece({ f, attente, onErreur }: { f: FichierMessage; attente: boolean; onErreur: (m: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [grand, setGrand] = useState(false);
  const [joue, setJoue] = useState(false);
  const voir = estImage(f) || (estVideo(f) && joue);
  useEffect(() => { let ok = true; if (voir || estImage(f)) void adresse(f).then((u) => ok && setUrl(u)); return () => { ok = false; }; }, [f, f.envoye, voir]);
  const etat = attente ? ' · 🕓 part au retour du réseau' : '';
  if (estImage(f)) {
    return <>
      <button className="bd-piece-image" onClick={(ev) => { if (!url) return; ev.stopPropagation(); setGrand(true); }}>
        {url ? <img src={url} alt={f.nom} /> : <span>📷</span>}</button>
      {etat && <small>{etat.slice(3)}</small>}
      {grand && url && <div className="bd-visionneuse" onClick={() => setGrand(false)}>
        <div className="bd-vis-haut"><span className="bd-texte"><b>{f.nom}</b></span><button aria-label="Fermer">✕</button></div>
        <img className="bd-vis-image" src={url} alt={f.nom} />
      </div>}
    </>;
  }
  if (estVideo(f) && joue && url) return <video className="bd-piece-video" src={url} controls autoPlay playsInline />;
  return <button className="bd-piece" onClick={(ev) => {
    ev.stopPropagation();
    if (estVideo(f)) setJoue(true); else void ouvrir(f).catch((e) => onErreur((e as Error).message));
  }}>
    <span className="bd-icone">{estVideo(f) ? '▶' : '📄'}</span>
    <span className="bd-texte"><b>{f.nom}</b><small>{taille(f.taille)}{etat}{estVideo(f) && joue && !url ? ' · chargement…' : ''}</small></span>
  </button>;
}

/** 📊 Un sondage (comme AppBase) : toucher une réponse vote, la retoucher retire le vote ; « Voir les votes » dit qui. */
function UnSondage({ m, c }: { m: MessageBuddy; c: Contexte }) {
  const s = m.sondage!;
  const [qui, setQui] = useState(false);
  const mes = s.votes.filter((x) => x.qui === c.moi).map((x) => x.option);
  const votants = new Set(s.votes.map((x) => x.qui)).size;
  const toucher = (i: number) => {
    const l = mes.includes(i) ? mes.filter((x) => x !== i) : s.multiple ? [...mes, i] : [i];
    voter(m.id, l); void synchroniser().catch(() => undefined);
  };
  return <div className="bd-sondage">
    <b>📊 {s.question}</b>
    <small>{s.multiple ? 'Plusieurs réponses possibles' : 'Une seule réponse'}</small>
    {s.options.map((o, i) => {
      const n = s.votes.filter((x) => x.option === i).length;
      return <button key={i} className={mes.includes(i) ? 'choisi' : ''} disabled={!!m.attente} onClick={(ev) => { ev.stopPropagation(); toucher(i); }}>
        <span className="bd-sondage-barre" style={{ width: `${votants ? Math.round((100 * n) / votants) : 0}%` }} />
        <span>{mes.includes(i) ? '✅' : s.multiple ? '⬜' : '⚪'} {o}</span><b>{n}</b>
      </button>;
    })}
    <button className="bd-lien" onClick={(ev) => { ev.stopPropagation(); setQui(!qui); }}>{qui ? 'Masquer les votes' : `Voir les votes (${votants})`}</button>
    {qui && s.options.map((o, i) => <small key={i}><b>{o}</b> : {s.votes.filter((x) => x.option === i).map((x) => (x.qui === c.moi ? 'Toi' : c.nom(x.qui))).join(', ') || 'personne'}</small>)}
  </div>;
}

/** Créer un sondage : une question, de 2 à 10 réponses. */
function NouveauSondage({ onFermer, onEnvoyer }: { onFermer: () => void; onEnvoyer: (s: { question: string; multiple: boolean; options: string[] }) => void }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(true);
  const pleines = options.map((o) => o.trim()).filter(Boolean);
  return <div className="bd-voile" onClick={onFermer}><div className="bd-feuille" onClick={(ev) => ev.stopPropagation()}>
    <h3>📊 Sondage</h3>
    <label className="field">Question<input value={question} maxLength={300} onChange={(ev) => setQuestion(ev.target.value)} placeholder="On part quel jour ?" /></label>
    {options.map((o, i) => <label key={i} className="field">Réponse {i + 1}
      <input value={o} maxLength={100} onChange={(ev) => setOptions(options.map((x, j) => (j === i ? ev.target.value : x)))} /></label>)}
    {options.length < 10 && <button onClick={() => setOptions([...options, ''])}>＋ Ajouter une réponse</button>}
    <label className="bd-coche"><input type="checkbox" checked={multiple} onChange={(ev) => setMultiple(ev.target.checked)} /> Plusieurs réponses possibles</label>
    <button className="primary" disabled={!question.trim() || pleines.length < 2} onClick={() => onEnvoyer({ question: question.trim(), multiple, options: pleines })}>Envoyer</button>
    <button onClick={onFermer}>Annuler</button>
  </div></div>;
}

/** ↪️ Transférer : « Envoyer à… » une ou plusieurs de mes conversations. */
function Transferer({ ms, ici, onFermer, onFait }: { ms: MessageBuddy[]; ici: string; onFermer: () => void; onFait: (n: number) => void }) {
  const e = useBuddies();
  const v = vue(e);
  const [choix, setChoix] = useState<string[]>([]);
  const l = [
    ...appliquer(e).filter((g) => g.nature !== 'me_time' && g.id !== ici).map((g) => ({ id: g.id, nom: autreDuDuo(g, e)?.pseudo ?? g.nom, dest: { groupe: g.id } })),
    ...v.sorties.filter((x) => x.participants.length > 1 && x.id !== ici).map((x) => ({ id: x.id, nom: x.nom, dest: { sortie: x.id } })),
  ];
  return <div className="bd-voile" onClick={onFermer}><div className="bd-feuille" onClick={(ev) => ev.stopPropagation()}>
    <h3>Envoyer à…</h3>
    {!l.length && <p className="hint">Pas d'autre conversation.</p>}
    {l.map((c) => <label key={c.id} className="bd-coche"><input type="checkbox" checked={choix.includes(c.id)}
      onChange={() => setChoix(choix.includes(c.id) ? choix.filter((x) => x !== c.id) : [...choix, c.id])} /> {c.nom}</label>)}
    <button className="primary" disabled={!choix.length} onClick={() => {
      transferer(ms, l.filter((c) => choix.includes(c.id)).map((c) => c.dest)); void synchroniser().catch(() => undefined); onFait(choix.length);
    }}>Envoyer{choix.length ? ` (${choix.length})` : ''}</button>
    <button onClick={onFermer}>Annuler</button>
  </div></div>;
}

/** Le point montré sur la carte (« Julie est ici »), le temps de le regarder. */
export function PointSurCarte({ map, p }: { map: MlMap | null; p: { lon: number; lat: number; nom: string; cache?: number } | null }) {
  useEffect(() => {
    if (!map || !p) return;
    const el = document.createElement('div');
    el.className = 'bd-point-carte';
    el.textContent = `📍 ${p.nom}`;
    const mk = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lon, p.lat]).addTo(map);
    map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 14), duration: 600, offset: [0, -(p.cache ?? 0) / 2] });
    return () => { mk.remove(); };
  }, [map, p]);
  return null;
}

/**
 * 💬 Toutes mes conversations, comme la liste d'AppBase : la plus récente en haut (heure, « hier », date), non lus,
 * recherche (Discussions puis Contacts : toucher un buddy ouvre la discussion à deux), gros + pour une nouvelle discussion.
 */
export function Conversations({ groupes, sorties, onGroupe, onSortie, onContact, onNouvelle, onRetour, onClose }: {
  groupes: Groupe[]; sorties: Sortie[]; onGroupe: (g: Groupe) => void; onSortie: (x: Sortie) => void; onContact: (b: Buddy) => void;
  onNouvelle: () => void; onRetour: () => void; onClose: () => void;
}) {
  const e = useBuddies();
  const v = vue(e);
  const moi = e.moi ?? 'moi';
  const [cherche, setCherche] = useState('');
  const l = [
    ...groupes.filter((g) => g.nature !== 'me_time').map((g) => {
      const autre = autreDuDuo(g, e);
      return { id: g.id, nom: nomDiscussion(g, e), visage: autre ?? { id: g.id, nom: g.nom, photo: g.photo }, membres: g.membres, ouvrir: () => onGroupe(g),
        sous: autre ? '' : `${g.membres.length} buddies`, dest: { groupe: g.id }, cree: g.modifie_le, duo: !!autre };
    }),
    ...sorties.filter((x) => x.participants.length > 1).map((x) => ({ id: x.id, nom: x.nom, visage: { id: x.id, nom: x.nom, photo: x.photo }, membres: x.participants,
      ouvrir: () => onSortie(x), sous: `${x.participants.length} buddies`, dest: { sortie: x.id }, cree: x.modifie_le, duo: false })),
  ].map((c) => {
    const f = fil(c.dest, v.messages, v.traces, v.hebergements);
    const ecrit = (e.ecrivent ?? []).find((y) => y.cle === c.id);
    return { ...c, dernier: f.at(-1), n: nonLus(e, c.id, v.messages), ecrit: ecrit && (c.duo ? 'écrit…' : `${c.membres.find((b) => b.id === ecrit.qui)?.pseudo ?? '?'} écrit…`) };
  }).filter((c) => c.dernier || 'groupe' in c.dest)
    // Une discussion encore vide se classe à sa création (comme AppBase).
    .sort((a, b) => Date.parse(b.dernier?.quand ?? b.cree) - Date.parse(a.dernier?.quand ?? a.cree));
  const q = cherche.trim().toLowerCase();
  const trouvees = q ? l.filter((c) => c.nom.toLowerCase().includes(q)) : l;
  const deja = new Set(l.filter((c) => c.duo).map((c) => c.nom));
  const autres = q ? contacts(e).filter((c) => c.b.pseudo.toLowerCase().includes(q) && !deja.has(c.b.pseudo)) : [];
  return <div className="bd-corps bd-convs">
    <div className="xp-head"><button onClick={onRetour} aria-label="Retour">‹</button><h2>💬 Messages</h2><button onClick={onClose} aria-label="Fermer">✕</button></div>
    <input className="bd-cherche" type="search" value={cherche} onChange={(ev) => setCherche(ev.target.value)} placeholder="🔍 Rechercher" />
    {!l.length && <p className="bd-vide">Crée un groupe ou une sortie avec des copains : vous pourrez vous écrire ici.</p>}
    {q && trouvees.length > 0 && <h3 className="bd-section">Discussions</h3>}
    {trouvees.map((c) => <button key={c.id} className="bd-ligne" onClick={c.ouvrir}>
      <Visage b={c.visage} taille={48} />
      <span className="bd-texte"><b>{c.nom}</b>
        <small className={c.ecrit ? 'bd-ecrit' : ''}>{c.ecrit ?? (c.dernier ? apercu(c.dernier, (id) => c.membres.find((m) => m.id === id)?.pseudo ?? '?', moi) : c.sous)}</small></span>
      {c.dernier && <small className="bd-heure">{heureMessage(c.dernier.quand)}</small>}
      {c.n > 0 && <span className="bd-nonlu">{c.n}</span>}
    </button>)}
    {autres.length > 0 && <h3 className="bd-section">Contacts</h3>}
    {autres.map((c) => <button key={c.b.id} className="bd-ligne" onClick={() => onContact(c.b)}>
      <Visage b={c.b} taille={48} /><span className="bd-texte"><b>{c.b.pseudo}</b><small>{c.bandes.join(', ')}</small></span>
    </button>)}
    <button className="bd-fab" aria-label="Nouvelle discussion" onClick={onNouvelle}>＋</button>
  </div>;
}

/** Nouvelle discussion (comme AppBase) : « Nouveau groupe » en tête, puis mes buddies par ordre alphabétique. */
export function NouvelleDiscussion({ onContact, onNouveauGroupe, onRetour, onClose }: {
  onContact: (b: Buddy) => void; onNouveauGroupe: () => void; onRetour: () => void; onClose: () => void;
}) {
  const e = useBuddies();
  const [cherche, setCherche] = useState('');
  const q = cherche.trim().toLowerCase();
  const l = contacts(e).filter((c) => !q || c.b.pseudo.toLowerCase().includes(q));
  return <div className="bd-corps">
    <div className="xp-head"><button onClick={onRetour} aria-label="Retour">‹</button><h2>Nouvelle discussion</h2><button onClick={onClose} aria-label="Fermer">✕</button></div>
    <input className="bd-cherche" type="search" value={cherche} onChange={(ev) => setCherche(ev.target.value)} placeholder="🔍 Rechercher un buddy" />
    <button className="bd-ligne" onClick={onNouveauGroupe}><span className="bd-faces"><i /><i /><i /></span><span className="bd-texte"><b>Nouveau groupe</b></span></button>
    {!contacts(e).length && <p className="bd-vide">Invite des copains dans un groupe : tu pourras ensuite leur écrire à deux.</p>}
    {l.map((c) => <button key={c.b.id} className="bd-ligne" onClick={() => onContact(c.b)}>
      <Visage b={c.b} taille={48} /><span className="bd-texte"><b>{c.b.pseudo}</b><small>{c.bandes.join(', ')}</small></span>
    </button>)}
  </div>;
}

/** Sous le nom d'une conversation : « écrit… », « en ligne », « vu aujourd'hui à 10 h 42 », « Julie en ligne »… */
export function SousTitre({ g, e }: { g: Groupe; e: ReturnType<typeof useBuddies> }) {
  const lectures = e.lectures ?? [];
  const autre = autreDuDuo(g, e);
  const ecrit = (e.ecrivent ?? []).find((y) => y.cle === g.id);
  if (ecrit) return <small className="bd-ecrit">{autre ? 'écrit…' : `${g.membres.find((b) => b.id === ecrit.qui)?.pseudo ?? '?'} écrit…`}</small>;
  if (autre) return <small>{presence(autre.id, lectures) ?? 'Discussion à deux'}</small>;
  const la = g.membres.filter((b) => presence(b.id, lectures) === 'en ligne');
  return <small>{la.length === 1 ? `${la[0].pseudo} en ligne` : la.length > 1 ? `${la.length} en ligne` : `💬 ${g.membres.length} buddies`}</small>;
}
