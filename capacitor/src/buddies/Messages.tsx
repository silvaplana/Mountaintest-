import { Fragment, useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';
import { Capacitor } from '@capacitor/core';
import { EcoLocation } from '../gps/ecoLocation';
import { deposer, Image as PhotoImage } from './Album';
import { couleur, useBuddies, Visage } from './Buddies';
import { Onde, useDictee } from './Dictee';
import { iconeHebergement, prixHebergement } from './Hebergements';
import { apercu, cle, fil, heureMessage, jourMessage, longueurTrace, morceaux, resume, type Bulle, type Dest } from './messages';
import { agir, annuler, contexte, demander, pourBud } from './bud';
import {
  appliquer, DELAI_MODIFIER, envoyerMessage, estAdmin, lire, marquerLu, modifierMessage, noterActionsBud, nonLus, proposerHebergement, reagir, retirerMessage, statut,
  synchroniser, vue, type Buddy, type Groupe, type Hebergement, type Lecture, type MessageBuddy, type Sortie, type TraceBuddy,
} from './store';

/**
 * Messagerie (spec/buddies.md §5.6, écrans 6 et 24) : une conversation par Buddy Group et par Buddy Time.
 * Celle d'un Buddy Time s'ouvre sur sa carte (bandeau du bas) ; celle d'un Buddy Group dans le panneau.
 * Mêmes écrans côté Kotlin (Messages.kt, BuddiesPanel.kt, BandeauSortie.kt).
 */

/** Ma position du moment, pour « je suis ici ». */
function maPosition(): Promise<{ lon: number; lat: number }> {
  return new Promise((ok, ko) => {
    const lire = () => navigator.geolocation?.getCurrentPosition((p) => ok({ lon: p.coords.longitude, lat: p.coords.latitude }), ko,
      { maximumAge: 60_000, timeout: 20_000, enableHighAccuracy: true }) ?? ko(new Error('gps'));
    if (Capacitor.isNativePlatform()) void EcoLocation.requestPermissions().then(lire, ko); else lire();
  });
}

export type Actions = {
  onPoint: (p: { lon: number; lat: number; nom: string }) => void;
  onTrace: (t: TraceBuddy) => void;
  onHebergement?: (h: Hebergement) => void;
  onPhoto?: () => void;
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
 * Une conversation : le fil, puis [🙂] [📷] [📍] [Message] [🎤 / ➤]. `court` : seulement les derniers mots (écran 24).
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
  const k = cle(dest);
  const dictee = useDictee((t) => setTexte((x) => `${x}${x && !x.endsWith(' ') ? ' ' : ''}${t}`), onToast);
  const nom = (id: string) => membres.find((b) => b.id === id)?.pseudo ?? '?';
  const autres = membres.map((b) => b.id).filter((id) => id !== moi && id !== 'moi');
  const groupe = appliquer(e).find((g) => g.id === (sortie?.groupe ?? dest.groupe));
  const admin = !!groupe && estAdmin(groupe, e);
  // Ouverte : on regarde les nouveaux messages toutes les 10 s, et on les marque lus (✓✓ bleues chez les autres).
  useEffect(() => {
    const t = setInterval(() => { void synchroniser().catch(() => undefined); }, 10_000);
    return () => clearInterval(t);
  }, []);
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
        hebergements: v.hebergements, depenses: v.depenses, plannings: v.plannings, messages: v.messages };
      const r = await demander(question, contexte(dest, donnees));
      // Ce que je lui ai demandé de faire (dépense, Buddy Time, ma dispo) : fait en mon nom, « Annuler » sous sa bulle.
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
  const ctx: Contexte = { moi, nom, photos: v.photos, messages: v.messages, autres, lectures, selection, aSupprimer, clignote,
    appui: court ? undefined : appui, allerA, reagir: (m, x) => { reagir(m.id, x); setSelection([]); void synchroniser().catch(() => undefined); } };
  return <div className={`bd-conv${court ? ' court' : ''}`}>
    {selection.length > 0 && <div className="bd-selection">
      <button aria-label="Annuler la sélection" onClick={() => setSelection([])}>‹</button>
      <b>{selection.length}</b>
      {seul && !seul.supprime && <button onClick={() => { setEdition(null); setReponse(seul); setSelection([]); saisie.current?.focus(); }}>↩️<small>Répondre</small></button>}
      <button onClick={copier}>📋<small>Copier</small></button>
      {peutModifier && <button onClick={() => { setReponse(null); setEdition(seul); setTexte(seul!.texte); setSelection([]); requestAnimationFrame(() => saisie.current?.focus()); }}>✏️<small>Modifier</small></button>}
      {peutSupprimer && <button onClick={supprimer}>🗑️<small>Supprimer</small></button>}
    </div>}
    <div className="bd-fil">
      {!bulles.length && <p className="bd-vide">Pas encore de message. Écris, dicte avec 🎤, ou montre où tu es avec 📍.</p>}
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
    {emojis && <div className="bd-emojis">{EMOJIS.map((x) => <button key={x} onClick={() => insererEmoji(x)}>{x}</button>)}</div>}
    <div className="bd-saisie">
      {dictee.ecoute ? <Onde niveau={dictee.niveau} partiel={dictee.partiel} avant={texte} /> : <>
        <button aria-label="Insérer une émoji" className={emojis ? 'actif' : ''} onClick={() => setEmojis(!emojis)}>🙂</button>
        {sortie && !edition && <button aria-label="Envoyer une photo" disabled={occupe} onClick={() => fichier.current?.click()}>📷</button>}
        {!edition && <button aria-label="Montrer où je suis" disabled={occupe} onClick={() => void point()}>📍</button>}
        <textarea ref={saisie} rows={1} value={texte} placeholder="Message, ou « Bud, … »" enterKeyHint={ENTREE_ENVOIE ? 'send' : 'enter'} maxLength={2000}
          onChange={(ev) => { setTexte(ev.target.value); ev.target.style.height = 'auto'; ev.target.style.height = `${Math.min(ev.target.scrollHeight, 140)}px`; }}
          onFocus={() => setEmojis(false)}
          onKeyDown={(ev) => { if (ENTREE_ENVOIE && ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); envoyer(); } }} />
      </>}
      {texte.trim() && !dictee.ecoute ? <button className="bd-envoyer" aria-label={edition ? 'Enregistrer' : 'Envoyer'} onClick={envoyer}>{edition ? '✓' : '➤'}</button>
        : <button className={dictee.ecoute ? 'bd-ecoute' : ''} aria-label={dictee.ecoute ? 'Arrêter la dictée' : 'Dicter'} onClick={() => void dictee.basculer()}>{dictee.ecoute ? '■' : '🎤'}</button>}
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
  moi: string; nom: (id: string) => string; photos: ReturnType<typeof vue>['photos']; messages: MessageBuddy[]; autres: string[];
  lectures: Lecture[]; selection: string[]; aSupprimer: string[]; clignote: string | null;
  appui?: ReturnType<typeof useAppuiLong>; allerA: (id: string) => void; reagir: (m: MessageBuddy, emoji: string | null) => void;
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

function UneBulle({ b, c, onPoint, onTrace, onHebergement, onPhoto }: Actions & { b: Bulle; c: Contexte }) {
  const { moi, nom } = c;
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
  const qui = !mien && !m.bud && <b className="bd-qui-ecrit" style={{ color: couleur(m.par) }}>{nom(m.par)}</b>;
  if (supprime) return <div id={`m-${m.id}`} className={`bd-bulle supprime${mien ? ' mien' : ''}`}>{qui}<i>🚫 Ce message a été supprimé</i>{heure}</div>;
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
  } else {
    corps = <div className={`bd-bulle${mien ? ' mien' : ''}${m.attente ? ' attente' : ''}${classe}`} {...appui}>{qui}{rappel}<Texte t={m.texte} />{heure}</div>;
  }
  return <div id={`m-${m.id}`} className={`bd-bulle-de${mien ? ' mien' : ''}`}>{rapides}{corps}<Reactions m={m} c={c} mien={mien} /></div>;
}

/** Le point montré sur la carte (« Julie est ici »), le temps de le regarder. */
export function PointSurCarte({ map, p }: { map: MlMap | null; p: { lon: number; lat: number; nom: string } | null }) {
  useEffect(() => {
    if (!map || !p) return;
    const el = document.createElement('div');
    el.className = 'bd-point-carte';
    el.textContent = `📍 ${p.nom}`;
    const mk = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lon, p.lat]).addTo(map);
    map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 14), duration: 600 });
    return () => { mk.remove(); };
  }, [map, p]);
  return null;
}

/** Toutes mes conversations (💬 depuis la liste) : les plus récentes en haut, avec les non lus. */
export function Conversations({ groupes, sorties, onGroupe, onSortie, onRetour, onClose }: {
  groupes: Groupe[]; sorties: Sortie[]; onGroupe: (g: Groupe) => void; onSortie: (x: Sortie) => void; onRetour: () => void; onClose: () => void;
}) {
  const e = useBuddies();
  const v = vue(e);
  const moi = e.moi ?? 'moi';
  const l = [
    ...groupes.filter((g) => g.nature !== 'me_time').map((g) => ({ id: g.id, nom: g.nom, photo: g.photo, membres: g.membres, ouvrir: () => onGroupe(g),
      sous: `${g.membres.length} buddies`, dest: { groupe: g.id } })),
    ...sorties.filter((x) => x.participants.length > 1).map((x) => ({ id: x.id, nom: x.nom, photo: x.photo, membres: x.participants, ouvrir: () => onSortie(x),
      sous: `${x.participants.length} buddies`, dest: { sortie: x.id } })),
  ].map((c) => {
    const f = fil(c.dest, v.messages, v.traces, v.hebergements);
    return { ...c, dernier: f.at(-1), n: nonLus(e, c.id, v.messages) };
  }).filter((c) => c.dernier || 'groupe' in c.dest)
    .sort((a, b) => (b.dernier ? Date.parse(b.dernier.quand) : 0) - (a.dernier ? Date.parse(a.dernier.quand) : 0));
  return <div className="bd-corps">
    <div className="xp-head"><button onClick={onRetour} aria-label="Retour">‹</button><h2>💬 Messages</h2><button onClick={onClose} aria-label="Fermer">✕</button></div>
    {!l.length && <p className="bd-vide">Crée un Buddy Group ou un Buddy Time avec des copains : vous pourrez vous écrire ici.</p>}
    {l.map((c) => <button key={c.id} className="bd-ligne" onClick={c.ouvrir}>
      <Visage b={{ id: c.id, nom: c.nom, photo: c.photo }} taille={48} />
      <span className="bd-texte"><b>{c.nom}</b><small>{c.dernier ? apercu(c.dernier, (id) => c.membres.find((m) => m.id === id)?.pseudo ?? '?', moi) : c.sous}</small></span>
      {c.dernier && <small className="bd-heure">{heureMessage(c.dernier.quand)}</small>}
      {c.n > 0 && <span className="bd-nonlu">{c.n}</span>}
    </button>)}
  </div>;
}
