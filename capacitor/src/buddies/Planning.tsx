import { useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  appliquer, aRemplir, aujourdhui, creerPlanning, creerSortie, datesPlanning, envoyerAttente, envoyerMessage, lire, repondre, sortieDeLigne, synchroniser,
  type Buddy, type Etat3, type Groupe, type Planning, type Sortie,
} from './store';
import { couleur, lienReutilisable, Natif, PartagerIcon, Visage } from './Buddies';
import { initialesDe, nomAffiche } from '../compte/auth';

/**
 * Planning de saison (spec/buddies.md §5.5, écrans 16 à 19) : une bande propose des dates sur quelques mois,
 * chacun dit ✓ ? ✗, puis on s'arrange de vive voix et une ligne devient une sortie.
 * Mêmes écrans côté Kotlin (BuddiesPanel.kt, partie « planning de saison »).
 */

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MOIS_LONG = ['JANVIER', 'FÉVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN', 'JUILLET', 'AOÛT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DÉCEMBRE'];
const mois = (d: string) => +d.slice(5, 7) - 1;
const jourN = (d: string) => +d.slice(8, 10);
const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const jourSemaine = (d: string) => JOURS[new Date(`${d}T12:00:00`).getDay()];
/** « 5–6 déc. » ou « sam. 5 déc. ». */
export function ligneCourte([d, f]: [string, string]) {
  return d === f ? `${jourSemaine(d)} ${jourN(d)} ${MOIS[mois(d)]}` : `${jourN(d)}–${jourN(f)} ${MOIS[mois(f)]}`;
}
const SIGNE: Record<Etat3, string> = { oui: '✓', peut: '?', non: '✗' };
const PHRASES = ['Samedi seulement', 'Dimanche seulement', 'À confirmer', 'Avec les enfants', 'Je peux conduire'];
const suivant: Record<string, Etat3 | ''> = { '': 'oui', oui: 'peut', peut: 'non', non: '' };

function moiId() { return lire().moi ?? 'moi'; }
/** Les buddies du planning : moi d'abord, puis la bande. */
function colonnes(p: Planning, g?: Groupe): Buddy[] {
  const moi = moiId();
  const l = g?.membres ?? [p.par];
  return [...l.filter((m) => m.id === moi), ...l.filter((m) => m.id !== moi)];
}

/** Bandeau « Il te reste 3 week-ends à remplir · Remplir › » (liste, groupe, planning). */
export function ARemplir({ p, onRemplir, avecNom = false }: { p: Planning; onRemplir: () => void; avecNom?: boolean }) {
  const n = aRemplir(p, moiId());
  if (!n) return null;
  const we = p.dates.every(([d, f]) => d !== f);
  return <button className="bd-remplir" onClick={onRemplir}>
    <span>🔔 {avecNom ? `${p.nom} : ` : 'Il te reste '}<b>{n} {we ? `week-end${n > 1 ? 's' : ''}` : `date${n > 1 ? 's' : ''}`}</b> à remplir</span>
    <b>Remplir ›</b>
  </button>;
}

/** Les plannings d'une bande (ou de toutes mes bandes), avec « ＋ Planning ». */
export function Plannings({ plannings, groupes, ici, onOuvrir, onRemplir, onNouveau, onRetour, onClose }: {
  plannings: Planning[]; groupes: Groupe[]; ici?: Groupe; onOuvrir: (id: string) => void; onRemplir: (id: string) => void;
  onNouveau: () => void; onRetour: () => void; onClose: () => void;
}) {
  const auj = aujourdhui();
  return <div className="bd-corps">
    <div className="xp-head">
      <button onClick={onRetour} aria-label="Retour">‹</button><h2>{ici ? `Plannings de ${ici.nom}` : 'Plannings'}</h2>
      <button onClick={onClose} aria-label="Fermer">✕</button>
    </div>
    {plannings.map((p) => <div key={p.id} className="bd-planning-carte">
      <button className="bd-ligne" onClick={() => onOuvrir(p.id)}>
        <span className="bd-icone">📅</span>
        <span className="bd-texte"><b>{p.nom}</b>
          <small>{groupes.find((g) => g.id === p.groupe)?.nom ?? ''} · {ligneCourte(p.dates[0])} → {ligneCourte(p.dates[p.dates.length - 1])}
            {p.dates[p.dates.length - 1][1] < auj ? ' · terminé' : ''}{p.attente ? ' · 🕓' : ''}</small></span>
      </button>
      <ARemplir p={p} onRemplir={() => onRemplir(p.id)} />
    </div>)}
    {!plannings.length && <p className="bd-vide">Une saison à organiser ? Propose des dates à ta bande : chacun coche ses dispos, vous voyez d'un coup d'œil les bons week-ends.</p>}
    <span style={{ flex: 1 }} />
    <div className="bd-plus"><button className="primary" onClick={onNouveau}>
      <span className="bd-plus-texte"><b>＋ Planning</b></span></button></div>
  </div>;
}

/** Un planning (écran 16) : une ligne par date, une colonne par buddy, le nombre de dispos au bout. */
export function UnPlanning({ p, g, sorties, onRemplir, onSortie, onRetour, onClose, onToast }: {
  p: Planning; g?: Groupe; sorties: Sortie[]; onRemplir: () => void; onSortie: (x: Sortie) => void;
  onRetour: () => void; onClose: () => void; onToast: (m: string) => void;
}) {
  const [ligne, setLigne] = useState<[string, string] | null>(null);
  const [partage, setPartage] = useState(false);
  const qui = colonnes(p, g);
  const moi = moiId();
  const dispo = (b: string, d: string) => p.dispos.find((x) => x.qui === b && x.debut === d);
  let moisAvant = -1;
  return <div className="bd-corps">
    <div className="xp-head">
      <button onClick={onRetour} aria-label="Retour">‹</button>
      <span className="bd-titre"><b>{p.nom}</b><small>{g?.nom ?? ''} · lancé par {p.par.pseudo}{p.attente ? ' · 🕓' : ''}</small></span>
      {g && <button onClick={() => setPartage(true)} aria-label="Partager"><PartagerIcon /></button>}
      <button onClick={onClose} aria-label="Fermer">✕</button>
    </div>
    <ARemplir p={p} onRemplir={onRemplir} />
    <div className="bd-grille-planning" style={{ ['--n' as string]: qui.length }}>
      <span />{qui.map((b) => <Visage key={b.id} b={b} taille={32} />)}<span />
      {p.dates.map((dt) => {
        const [d] = dt;
        const titre = mois(d) !== moisAvant ? MOIS_LONG[mois(d)] : null;
        moisAvant = mois(d);
        const x = sortieDeLigne(sorties, p, d);
        const n = p.dispos.filter((y) => y.debut === d && y.etat === 'oui').length;
        return [
          titre && <b key={`m${d}`} className="bd-mois">{titre}</b>,
          <button key={`l${d}`} className="bd-jour" onClick={() => setLigne(dt)}>
            <b>{dt[0] === dt[1] ? jourN(d) : `${jourN(d)}–${jourN(dt[1])}`}</b><small>{dt[0] === dt[1] ? jourSemaine(d) : MOIS[mois(dt[1])]}</small></button>,
          x ? <button key={`s${d}`} className="bd-lien-sortie" onClick={() => onSortie(x)}>⛷ {x.nom} ›</button>
            : qui.map((b) => {
              const r = dispo(b.id, d);
              const c = `bd-case ${r?.etat ?? ''}${b.id === moi ? ' moi' : ''}`;
              return b.id === moi
                ? <button key={`${b.id}${d}`} className={c} aria-label="Ma réponse" onClick={() => repondre(p.id, d, suivant[r?.etat ?? ''], r?.mot)}>
                  {r ? SIGNE[r.etat] : '·'}{r?.mot && <i>💬</i>}</button>
                : <span key={`${b.id}${d}`} className={c} title={r?.mot} onClick={() => { if (r?.mot) onToast(`${b.pseudo} : ${r.mot}`); else setLigne(dt); }}>
                  {r ? SIGNE[r.etat] : '·'}{r?.mot && <i>💬</i>}</span>;
            }),
          !x && <b key={`n${d}`} className={`bd-compte${n >= Math.max(2, qui.length - 1) ? ' fort' : ''}`}>{n}</b>,
        ];
      })}
    </div>
    <p className="hint">Touche ta colonne pour répondre (✓ dispo, ? peut-être, ✗ non). Touche une date pour voir qui est dispo et créer la sortie.</p>
    {ligne && <Valider p={p} g={g} dt={ligne} qui={qui} onFermer={() => setLigne(null)} onToast={onToast} />}
    {partage && g && <PartagerPlanning p={p} g={g} sorties={sorties} onFermer={() => setPartage(false)} onToast={onToast} />}
  </div>;
}

// ------------------------------------------------------------------ dans la messagerie (Seb, 27/11, §7.28)

/** Icône du planning au trait : un calendrier coché. */
export function PlanningIcon({ size = 28 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4M9 15l2 2 4-4" /></svg>;
}

const jourMois = (d: string) => `${jourN(d)} ${MOIS[mois(d)]}`;
const resumePlanning = (p: Planning) => {
  const we = p.dates.every(([d, f]) => d !== f);
  return `${p.dates.length} ${we ? `week-end${p.dates.length > 1 ? 's' : ''}` : `date${p.dates.length > 1 ? 's' : ''}`} · avant le ${jourMois(p.limite)}`;
};

/** 📎 → Planning : un planning du groupe à poster dans le fil, ou « Nouveau planning ». */
export function ChoisirPlanning({ plannings, onChoisir, onNouveau, onFermer }: {
  plannings: Planning[]; onChoisir: (p: Planning) => void; onNouveau?: () => void; onFermer: () => void;
}) {
  const l = [...plannings].sort((a, b) => b.limite.localeCompare(a.limite));
  return <div className="bd-voile" onClick={onFermer}><div className="bd-feuille" onClick={(ev) => ev.stopPropagation()}>
    <h3>Quel planning partager ?</h3>
    {!l.length && <p className="hint">Pas encore de planning dans ce groupe.</p>}
    {l.map((p) => <button key={p.id} className="bd-ligne bd-choix-planning" onClick={() => onChoisir(p)}>
      <span className="bd-icone"><PlanningIcon /></span><span className="bd-texte"><b>{p.nom}</b><small>{resumePlanning(p)}</small></span></button>)}
    {onNouveau && <button className="bd-ligne bd-choix-planning plus" onClick={onNouveau}><span className="bd-icone">＋</span><span className="bd-texte"><b>Nouveau planning</b></span></button>}
    <button onClick={onFermer}>Annuler</button>
  </div></div>;
}

/** La carte d'un planning dans le fil : mes réponses en pastilles, « Remplir mes dispos », qui a répondu. Toucher = ouvrir. */
export function CartePlanning({ p, onOuvrir }: { p: Planning; onOuvrir: (remplir: boolean) => void }) {
  const moi = moiId();
  const auj = aujourdhui();
  const venir = p.dates.filter(([, f]) => f >= auj);
  const montrees = (venir.length ? venir : p.dates).slice(0, 4);
  const reste = (venir.length ? venir : p.dates).length - montrees.length;
  const n = aRemplir(p, moi);
  const g = appliquer(lire()).find((x) => x.id === p.groupe);
  const ont = new Set(p.dispos.map((x) => x.qui)).size;
  return <div className="bd-carte-planning" role="button" onClick={() => onOuvrir(false)}>
    <b className="bd-carte-planning-nom"><PlanningIcon /> {p.nom}</b>
    <small>{resumePlanning(p)}</small>
    <span className="bd-carte-planning-dates">
      {montrees.map((dt) => {
        const r = p.dispos.find((x) => x.qui === moi && x.debut === dt[0]);
        return <span key={dt[0]}><small>{dt[0] === dt[1] ? jourN(dt[0]) : `${jourN(dt[0])}–${jourN(dt[1])}`}<br />{MOIS[mois(dt[1])]}</small><b className={`bd-case ${r?.etat ?? ''}`}>{r ? SIGNE[r.etat] : '·'}</b></span>;
      })}
      {reste > 0 && <span><small>+{reste}<br />&nbsp;</small><b className="bd-case">…</b></span>}
    </span>
    <button className="primary" onClick={(ev) => { ev.stopPropagation(); onOuvrir(n > 0); }}>
      {n > 0 ? `Remplir mes dispos · ${n} restante${n > 1 ? 's' : ''}` : 'Voir le planning'}</button>
    <small>{ont} {ont > 1 ? 'buddies' : 'buddy'}{g ? ` sur ${g.membres.length}` : ''} {ont > 1 ? 'ont' : 'a'} répondu</small>
  </div>;
}

/** Partager depuis le planning : dans la messagerie (le groupe ou l'une de ses sorties), ou un lien (WhatsApp, SMS…)
 * qui ouvre le planning dans Mountain Buddies, en faisant d'abord entrer dans le groupe qui n'y est pas encore. */
function PartagerPlanning({ p, g, sorties, onFermer, onToast }: { p: Planning; g: Groupe; sorties: Sortie[]; onFermer: () => void; onToast: (m: string) => void }) {
  const [ou, setOu] = useState(false);
  const auj = aujourdhui();
  const convs = [{ id: g.id, nom: g.nom, sous: 'Le fil du groupe', dest: { groupe: g.id } },
    ...sorties.filter((x) => x.groupe === g.id && x.fin >= auj).map((x) => ({ id: x.id, nom: x.nom, sous: 'Sortie', dest: { sortie: x.id } }))];
  const lien = async () => {
    const texte = `${nomAffiche()} te propose le planning « ${p.nom} » de « ${g.nom} » sur Mountain Buddies : dis quand tu es dispo ! ${lienReutilisable({ groupe: g })}&p=${p.id}`;
    onFermer();
    await Promise.race([envoyerAttente(), new Promise((r) => setTimeout(r, 4000))]); // le lien est connu du serveur avant de partir
    try {
      if (Capacitor.isNativePlatform()) await Natif.partager({ titre: p.nom, texte });
      else if (navigator.share) await navigator.share({ title: p.nom, text: texte });
      else { await navigator.clipboard.writeText(texte); onToast('Copié : colle-le dans un message'); }
    } catch { /* annulé */ }
  };
  return <div className="bd-voile" onClick={onFermer}><div className="bd-feuille" onClick={(ev) => ev.stopPropagation()}>
    <h3>Partager « {p.nom} »</h3>
    {!ou ? <>
      <button className="bd-ligne bd-choix-planning" onClick={() => setOu(true)}><span className="bd-icone"><svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16v11H9l-5 4z" /></svg></span>
        <span className="bd-texte"><b>Dans la messagerie</b><small>Le fil du groupe, ou une sortie du groupe</small></span></button>
      <button className="bd-ligne bd-choix-planning" onClick={() => void lien()}><span className="bd-icone"><svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1" /></svg></span>
        <span className="bd-texte"><b>Envoyer un lien</b><small>WhatsApp, SMS… Le lien ouvre le planning dans Mountain Buddies</small></span></button>
    </> : convs.map((c) => <button key={c.id} className="bd-ligne bd-choix-planning" onClick={() => {
      envoyerMessage(c.dest, { nature: 'planning', planning: p.id, texte: p.nom });
      void synchroniser().catch(() => undefined);
      onToast(`Envoyé dans « ${c.nom} »`); onFermer();
    }}><span className="bd-texte"><b>{c.nom}</b><small>{c.sous}</small></span></button>)}
    <button onClick={ou ? () => setOu(false) : onFermer}>Annuler</button>
  </div></div>;
}

/** Une ligne du planning (écran 19) : qui est dispo, où, puis « Créer la sortie » ou « Pas encore ». */
function Valider({ p, g, dt, qui, onFermer, onToast }: {
  p: Planning; g?: Groupe; dt: [string, string]; qui: Buddy[]; onFermer: () => void; onToast: (m: string) => void;
}) {
  const [lieu, setLieu] = useState('');
  const avec = (e: Etat3) => qui.filter((b) => p.dispos.some((x) => x.qui === b.id && x.debut === dt[0] && x.etat === e));
  const oui = avec('oui'), peut = avec('peut'), non = avec('non');
  const sans = qui.filter((b) => !p.dispos.some((x) => x.qui === b.id && x.debut === dt[0]));
  const mot = (b: Buddy) => p.dispos.find((x) => x.qui === b.id && x.debut === dt[0])?.mot;
  const creer = () => {
    const nom = lieu.trim() || p.nom;
    creerSortie({ groupe: p.groupe, nom, photo: null, debut: dt[0], fin: dt[1], lieu: lieu.trim(), participants: oui.map((b) => b.id).filter((id) => id !== moiId()) });
    onToast(`« ${nom} » est créé`);
    onFermer();
  };
  const bloc = (l: Buddy[], titre: string) => l.length > 0 && <div className="bd-ligne petite">
    <span className="bd-pile">{l.map((b) => <Visage key={b.id} b={b} taille={40} />)}</span>
    <span className="bd-texte"><b>{titre}</b><small>{l.map((b) => b.pseudo + (mot(b) ? ` (${mot(b)})` : '')).join(', ')}</small></span>
  </div>;
  return <div className="bd-voile" onClick={onFermer}><div className="bd-feuille" onClick={(ev) => ev.stopPropagation()}>
    <h3>{ligneCourte(dt)}</h3>
    {bloc(oui, `${oui.length} dispo${oui.length > 1 ? 's' : ''}`)}
    {bloc(peut, 'peut-être')}
    {bloc(non, 'pas dispo')}
    {bloc(sans, 'pas encore répondu')}
    <h3 className="bd-section">Où ? <small>facultatif, on peut décider plus tard</small></h3>
    <input value={lieu} maxLength={120} placeholder="Dôme des Écrins" onChange={(ev) => setLieu(ev.target.value)} />
    <button className="primary bd-grand" disabled={!oui.length} onClick={creer}>Créer la sortie</button>
    <button onClick={onFermer}>Pas encore</button>
    {!g && <p className="hint">Tu ne fais plus partie de cette bande.</p>}
  </div></div>;
}

/** Remplir mes dispos (écran 17) : un toucher par date ; appui long pour un petit mot. */
/**
 * Mes dispos (écran 18) : à côté de chaque date, les réponses déjà données par les autres (initiale en couleur ✓ ? ✗),
 * et ma case unique qui tourne à chaque toucher : ✓ → ? → ✗ → vide (Seb, 27/11). Appui long : un petit mot.
 */
export function MesDispos({ p, g, onRetour, onClose }: { p: Planning; g?: Groupe; onRetour: () => void; onClose: () => void }) {
  const [mot, setMot] = useState<string | null>(null);
  const [texte, setTexte] = useState('');
  const appui = useRef<number>(0);
  const moi = moiId();
  const auj = aujourdhui();
  const dates = p.dates.filter(([, f]) => f >= auj);
  const faits = dates.filter(([d]) => p.dispos.some((x) => x.qui === moi && x.debut === d)).length;
  const ouvrirMot = (d: string) => { setMot(d); setTexte(p.dispos.find((x) => x.qui === moi && x.debut === d)?.mot ?? ''); };
  return <div className="bd-corps">
    <div className="xp-head">
      <button onClick={onRetour} aria-label="Retour">‹</button>
      <span className="bd-titre"><b>Mes dispos</b><small>{p.nom} · {faits} sur {dates.length} rempli{faits > 1 ? 's' : ''}</small></span>
      <button onClick={onClose} aria-label="Fermer">✕</button>
    </div>
    {dates.map((dt) => {
      const [d] = dt;
      const r = p.dispos.find((x) => x.qui === moi && x.debut === d);
      const toucher = () => {
        if (appui.current === -1) { appui.current = 0; return; }
        repondre(p.id, d, suivant[r?.etat ?? ''], r?.mot);
      };
      const autres = colonnes(p, g).filter((b) => b.id !== moi)
        .map((b) => ({ b, x: p.dispos.find((y) => y.qui === b.id && y.debut === d) })).filter((o) => o.x);
      const long = {
        onPointerDown: () => { appui.current = window.setTimeout(() => { appui.current = -1; ouvrirMot(d); }, 550); },
        onPointerUp: () => { if (appui.current > 0) clearTimeout(appui.current); },
        onPointerLeave: () => { if (appui.current > 0) clearTimeout(appui.current); },
        onContextMenu: (ev: React.MouseEvent) => ev.preventDefault(),
      };
      return <div key={d} className={`bd-dispo${mot === d ? ' ouvert' : ''}`}>
        <div className="bd-dispo-ligne">
          <span className="bd-texte"><b>{ligneCourte(dt)}</b><small>{dt[0] === dt[1] ? '' : `${jourSemaine(dt[0])} – ${jourSemaine(dt[1])}`}</small></span>
          <span className="bd-dispo-autres">{autres.map(({ b, x }) =>
            <span key={b.id} className={`bd-dispo-autre ${x!.etat}`} title={x!.mot || undefined}>
              <i style={{ background: couleur(b.id) }}>{b.initiales || initialesDe(b.pseudo || '?')}</i>{SIGNE[x!.etat]}{x!.mot ? ' 💬' : ''}</span>)}</span>
          <button {...long} className={`bd-case bd-case-seule ${r?.etat ?? ''}`} aria-label={r ? `Ma réponse : ${r.etat}` : 'Répondre'} onClick={toucher}>
            {r ? SIGNE[r.etat] : '·'}</button>
        </div>
        {r?.mot && mot !== d && <button className="bd-mot" onClick={() => ouvrirMot(d)}>💬 {r.mot}</button>}
        {mot === d && <div className="bd-mot-choix">
          {PHRASES.map((m) => <button key={m} className={texte === m ? 'oui' : ''} onClick={() => setTexte(texte === m ? '' : m)}>{m}</button>)}
          <input value={texte} maxLength={200} placeholder="ou un petit mot…" onChange={(ev) => setTexte(ev.target.value)} />
          <button className="primary" onClick={() => { repondre(p.id, d, r?.etat ?? 'peut', texte); setMot(null); }}>OK</button>
          <button onClick={() => setMot(null)}>Annuler</button>
        </div>}
      </div>;
    })}
    {!dates.length && <p className="bd-vide">Toutes les dates de ce planning sont passées.</p>}
    <p className="hint">Touche ta case : ✓ dispo, puis ? peut-être, puis ✗ non, puis vide. Appui long : un petit mot (« Samedi seulement »…).</p>
  </div>;
}

/** Nouveau planning (écran 18) : nom, bande, période, week-ends ou tous les jours, dates cochées, date limite. */
export function NouveauPlanning({ groupes, groupe, onFini, onRetour, onClose, onToast }: {
  groupes: Groupe[]; groupe?: string; onFini: (id: string) => void; onRetour: () => void; onClose: () => void; onToast: (m: string) => void;
}) {
  const bandes = groupes.filter((g) => g.nature === 'bande');
  const ici = new Date();
  const m = (n: number) => { const d = new Date(ici.getFullYear(), ici.getMonth() + n, 1); return aujourdhui(d).slice(0, 7); };
  const [nom, setNom] = useState('');
  const [pour, setPour] = useState(groupe && bandes.some((g) => g.id === groupe) ? groupe : bandes[0]?.id ?? '');
  const [de, setDe] = useState(m(1));
  const [a, setA] = useState(m(4));
  const [mode, setMode] = useState<'weekends' | 'jours' | 'carte'>('weekends');
  const [non, setNon] = useState<Set<string>>(new Set());
  const [oui, setOui] = useState<Set<string>>(new Set());
  const limite0 = new Date(ici); limite0.setDate(ici.getDate() + 7);
  const [limite, setLimite] = useState(aujourdhui(limite0));
  const toutes = de && a && a >= de ? datesPlanning(de, a, mode === 'weekends' ? 'weekends' : 'jours') : [];
  const coche = (d: string) => mode === 'carte' ? oui.has(d) : !non.has(d);
  const choisies = toutes.filter(([d]) => coche(d));
  const basculer = (d: string) => {
    const f = (s: Set<string>) => { const n = new Set(s); if (n.has(d)) n.delete(d); else n.add(d); return n; };
    if (mode === 'carte') setOui(f); else setNon(f);
  };
  const g = bandes.find((x) => x.id === pour);
  // Le nom grisé proposé sert de nom si on n'en tape pas (il ressemblait à un nom déjà rempli).
  const exemple = `Saison ski ${ici.getFullYear()}-${String(ici.getFullYear() + 1).slice(2)}`;
  const nomFinal = nom.trim() || exemple;
  // Ce qui manque pour publier, dit à l'écran plutôt qu'un bouton grisé sans raison.
  const manque = !g ? "Crée d'abord un groupe pour publier un planning." : !choisies.length ? 'Coche au moins une date.' : '';
  const publier = () => {
    try {
      const id = creerPlanning({ groupe: pour, nom: nomFinal, dates: choisies, limite });
      onToast(`« ${nomFinal} » est publié : ${g?.nom ?? 'la bande'} est prévenue`);
      onFini(id);
    } catch (err) { onToast(String((err as Error).message)); }
  };
  return <div className="bd-corps">
    <div className="xp-head">
      <button onClick={onRetour} aria-label="Retour">‹</button><h2>Nouveau planning</h2>
      <button onClick={onClose} aria-label="Fermer">✕</button>
    </div>
    <input className="bd-nom" value={nom} maxLength={80} placeholder={exemple} onChange={(ev) => setNom(ev.target.value)} />
    <h3 className="bd-section">Pour qui</h3>
    {bandes.length ? <label className="bd-pour">
      {g && <span className="bd-pile">{g.membres.slice(0, 4).map((b) => <Visage key={b.id} b={b} taille={30} />)}</span>}
      <select value={pour} onChange={(ev) => setPour(ev.target.value)}>{bandes.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}</select>
    </label> : <p className="hint">Crée d'abord un groupe : un planning se fait avec une bande.</p>}
    <h3 className="bd-section">Période</h3>
    <div className="bd-dates">
      <label>de<input type="month" value={de} onChange={(ev) => { setDe(ev.target.value); if (a < ev.target.value) setA(ev.target.value); }} /></label>
      <label>à<input type="month" value={a} min={de} onChange={(ev) => setA(ev.target.value)} /></label>
    </div>
    <div className="bd-segment">
      {([['weekends', 'Week-ends'], ['jours', 'Tous les jours'], ['carte', 'À la carte']] as const).map(([k, t]) =>
        <button key={k} className={mode === k ? 'oui' : ''} onClick={() => setMode(k)}>{t}</button>)}
    </div>
    <h3 className="bd-section">Dates proposées <small>{choisies.length} sur {toutes.length}</small></h3>
    <div className="bd-puces">{toutes.map((dt) => <button key={dt[0]} className={coche(dt[0]) ? 'oui' : 'barre'} onClick={() => basculer(dt[0])}>{ligneCourte(dt)}</button>)}</div>
    <label className="bd-limite">Répondre avant le<input type="date" value={limite} onChange={(ev) => setLimite(ev.target.value)} /></label>
    <span style={{ flex: 1 }} />
    {manque && <p className="hint">{manque}</p>}
    <button className="primary bd-grand" disabled={!!manque} onClick={publier}>Publier le planning</button>
  </div>;
}
