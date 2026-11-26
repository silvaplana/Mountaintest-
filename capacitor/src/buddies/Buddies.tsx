import { useEffect, useId, useRef, useState } from 'react';
import { nouvellesIcones } from '../doigt';
import type { Map as MlMap } from 'maplibre-gl';
import { App as CapApp } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { useSheet } from '../useSheet';
import { PencilIcon, TrashIcon } from '../icones';
import { noterOuvert } from './recents';
import { TracesAssociees } from './Associer';
import qrcode from 'qrcode-generator';
import { connecte, lire as lireCompte, nomAffiche, SCHEMA } from '../compte/auth';
import { useCompte } from '../Account';
import type { ConversationNotif } from './notifs';
import { Albums, BoutonDeposer, Image as PhotoImage, PhotosSurCarte, UnAlbum } from './Album';
import { BuddyCount, Comptes, NouveauCount, NouveauCountSortie, sortieDuCount, sortiesAvecCount, UneDepense } from './BuddyCount';
import { EcrireCarnet, UnCarnet } from './Carnet';
import { euros } from './count';
import { HebergementsSurCarte, OuOnDort, prixHebergement, proposer } from './Hebergements';
import type { Lodging } from '../Lodging';
import { BandePositions, MaPosition, nombreVisibles, PositionIcon, basculerPosition, basculerVoiture, ciblesIci, PositionsSurCarte, useReperes } from './Positions';
import { Conversation, Conversations, NouvelleDiscussion, PointSurCarte, SousTitre } from './Messages';
import { apercu, fil } from './messages';
import { appelEnCours, appeler, type Dest, type Sonnerie } from './appel';
import { pendant } from './positions';
import { ARemplir, MesDispos, NouveauPlanning, Plannings, UnPlanning } from './Planning';
import {
  aDeux, annulerInvitation, appliquer, aujourdhui, autreDuDuo, demandesSupport, nomDiscussion, superUser, changerCount, creerCount, maVoiture, mesCounts, monEpingle, creerGroupe, creerSortie, estAdmin, estAdminPrincipal, inviter, joursAvant, lien, lire, marquerVu, nommerAdmin, retirerAdmin, transmettre, nonLus,
  inviterSortie, supprimerGroupe, nouveauCode, ouvrirDuo, partagerTrace, prochaine, quitter, rejoindre, rejointsEnAttente, remettreSortie, renommerGroupe, renommerSortie, retirer, supprimerSortie, suivre, synchroniser, envoyerAttente, vue as vueSorties,
  type Buddy, type Canal, type Etat, type Groupe, type NouvelleInvitation, type Planning, type Sortie, type TraceBuddy,
} from './store';

/**
 * Buddies (spec/buddies.md) : la liste façon WhatsApp (écran 2), un groupe (3), nouveau groupe et
 * invitations (20), nouvelle sortie (21), le bandeau d'une sortie sur la carte (4) et le panneau de
 * partage (22). Mêmes écrans côté Kotlin (BuddiesPanel.kt, SharePanel.kt).
 */

export const Natif = registerPlugin<{
  pickContact(): Promise<{ nom: string; telephone: string }>;
  /** 🎤 Dictée dans l'appli (SpeechRecognizer d'Android, sans sa fenêtre) : phrases en cours et finies, niveau du son. */
  ecouter(): Promise<void>;
  arreterEcoute(): Promise<void>;
  /** Ouvre un fichier du cache de l'appli avec l'appli du téléphone (PDF…). */
  ouvrirFichier(o: { chemin: string; mime: string }): Promise<void>;
  addListener(e: 'dictee', f: (x: { texte: string; fini: boolean }) => void): Promise<{ remove: () => Promise<void> }>;
  addListener(e: 'dicteeNiveau', f: (x: { niveau: number }) => void): Promise<{ remove: () => Promise<void> }>;
  addListener(e: 'dicteeFin', f: (x: { erreur?: number }) => void): Promise<{ remove: () => Promise<void> }>;
  partager(o: { titre: string; texte: string }): Promise<void>;
  /** Partage un fichier du cache de l'appli (film du survol 3D) : WhatsApp, mail… */
  partagerFichier(o: { chemin: string; mime: string; titre: string }): Promise<void>;
  /** ⬇ Copie un film du cache dans la galerie (Movies/Mountain Buddies) ; rend le dossier à montrer. */
  enregistrerFilm(o: { chemin: string; nom: string; mime: string }): Promise<{ dossier: string }>;
  sms(o: { numero: string; texte: string }): Promise<void>;
  mail(o: { adresse: string; sujet: string; texte: string }): Promise<void>;
  /** 📍 Service de position (EpingleService.java) : une position toutes les 5 minutes jusqu'à `jusqu` (ms). */
  epingler(o: { jusqu: number }): Promise<void>;
  relever(): Promise<void>;
  derniere(): Promise<{ position?: PositionNative }>;
  addListener(e: 'position', f: (p: PositionNative) => void): Promise<{ remove: () => Promise<void> }>;
  /** 📞 Sonnerie appli fermée (AppelService.java, Firebase) : le jeton de ce téléphone, l'appel qui a ouvert l'appli. */
  jetonPush(): Promise<{ jeton: string }>;
  arreterSonnerie(): Promise<void>;
  appelEnAttente(): Promise<{ appel?: Sonnerie & { action?: string } }>;
  addListener(e: 'appel', f: (s: Sonnerie & { action?: string }) => void): Promise<{ remove: () => Promise<void> }>;
  addListener(e: 'finAppel', f: (x: { appel: string }) => void): Promise<{ remove: () => Promise<void> }>;
  /** 🔔 Nouveaux messages (MessagesNotif.java) : la conversation dont la notification a ouvert l'appli ; l'effacer. */
  conversationEnAttente(): Promise<{ conversation?: ConversationNotif }>;
  /** Ce qui est arrivé appli fermée (MessagesNotif.java), pour la fenêtre d'explication ; la liste se vide. */
  notifsAExpliquer(): Promise<{ liste: { titre: string; ligne: string }[] }>;
  effacerNotif(o: { cle: string }): Promise<void>;
  addListener(e: 'ouvrirConversation', f: (c: ConversationNotif) => void): Promise<{ remove: () => Promise<void> }>;
  addListener(e: 'message', f: (x: { cle: string }) => void): Promise<{ remove: () => Promise<void> }>;
}>('Buddies');
export type PositionNative = { lat: number; lon: number; alt?: number; t: number };

export function useBuddies(): Etat {
  const [e, setE] = useState<Etat>(lire);
  useEffect(() => suivre(setE), []);
  return e;
}

/**
 * Liens d'invitation (fr.assomoutain.rando://rejoindre?c=…) et synchro : au démarrage, au retour du réseau,
 * quand l'appli revient au premier plan. À brancher une fois.
 */
export function ecouterBuddies(onToast: (m: string) => void, onOuvrir: () => void) {
  const sync = () => { if (connecte()) void synchroniser().then((r) => r.forEach(onToast)).catch(() => undefined); };
  const traiter = (url: string) => {
    if (!url.startsWith(`${SCHEMA}://rejoindre`)) return;
    const code = new URL(url.replace(/^[a-z.]+:\/\//, 'https://x/')).searchParams.get('c') ?? '';
    rejoindre(code);
    onOuvrir();
    onToast(connecte() ? 'Invitation reçue : tu entres dans le groupe' : 'Connecte-toi (👤) pour entrer dans le groupe');
  };
  const subs: Promise<{ remove: () => Promise<void> }>[] = [];
  if (Capacitor.isNativePlatform()) {
    subs.push(CapApp.addListener('appUrlOpen', ({ url }) => traiter(url)));
    void CapApp.getLaunchUrl().then((r) => { if (r?.url) traiter(r.url); }).catch(() => undefined);
  }
  const visible = () => { if (document.visibilityState === 'visible') sync(); };
  sync();
  window.addEventListener('online', sync);
  document.addEventListener('visibilitychange', visible);
  return () => {
    window.removeEventListener('online', sync); document.removeEventListener('visibilitychange', visible);
    subs.forEach((s) => void s.then((x) => x.remove()));
  };
}

// ------------------------------------------------------------------ petits morceaux

const COULEURS = ['#2f6f4f', '#3f6fb5', '#8a4fb0', '#c9862b', '#2c8c8c', '#b5534a'];
export const couleur = (id: string) => COULEURS[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % COULEURS.length];

export function Visage({ b, taille = 34 }: { b: { id: string; pseudo?: string; nom?: string; photo: string | null }; taille?: number }) {
  const nom = b.pseudo ?? b.nom ?? '?';
  return <span className="bd-visage" style={{ width: taille, height: taille, fontSize: taille * 0.45, background: couleur(b.id) }}>
    {b.photo ? <img src={b.photo} alt="" /> : nom.slice(0, 1).toUpperCase()}</span>;
}

function quand(iso: string) {
  const d = new Date(iso), auj = new Date();
  if (!d.getTime()) return '';
  if (d.toDateString() === auj.toDateString()) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const hier = new Date(auj); hier.setDate(auj.getDate() - 1);
  if (d.toDateString() === hier.toDateString()) return 'hier';
  if (auj.getTime() - d.getTime() < 6 * 86400e3) return d.toLocaleDateString('fr-FR', { weekday: 'short' });
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function resume(g: Groupe) {
  const n = g.invitations.filter((i) => i.canal !== 'qr').length;
  return `${g.membres.length} ${g.membres.length > 1 ? 'buddies' : 'buddy'}${n ? ` · ${n} invitation${n > 1 ? 's' : ''} envoyée${n > 1 ? 's' : ''}` : ''}`;
}

const CANAL: Record<Canal, string> = { sms: 'SMS envoyé', contacts: 'SMS envoyé', mail: 'mail envoyé', qr: 'QR code', lien: 'lien envoyé' };

/** Photo choisie dans la galerie, réduite à 256 px (JPEG en data: URL, comme la photo du profil). */
function reduire(f: File): Promise<string> {
  return new Promise((ok, ko) => {
    const img = new Image();
    img.onload = () => {
      const t = 256, s = Math.min(img.width, img.height);
      const c = document.createElement('canvas'); c.width = t; c.height = t;
      c.getContext('2d')!.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, t, t);
      URL.revokeObjectURL(img.src);
      ok(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = ko;
    img.src = URL.createObjectURL(f);
  });
}

/** 📞 Appeler toute la bande (ou rejoindre l'appel déjà en cours) ; la barre d'appel s'affiche sur la carte. */
function appelerBande(dest: Dest, nom: string, onToast: (m: string) => void) {
  if (appelEnCours()) { onToast('Tu es déjà en appel'); return; }
  void appeler(dest, nom).catch((e: Error) => onToast(e.message || 'Appel impossible'));
}

/** « Appel en cours » : rejoindre un appel de la bande (sur iPhone et sans sonnerie, c'est par là qu'on entre). */
function LigneAppel({ dest, nom, onToast }: { dest: Dest; nom: string; onToast: (m: string) => void }) {
  const e = useBuddies();
  const a = (e.appels ?? []).find((x) => !x.fini && (dest.sortie ? x.sortie === dest.sortie : x.groupe === dest.groupe));
  if (!a || appelEnCours() || a.en_ligne.includes(e.moi ?? '')) return null;
  return <button className="bd-ligne bd-pos-acces ap-rejoindre" onClick={() => appelerBande(dest, nom, onToast)}>
    <span className="bd-icone">📞</span>
    <span className="bd-texte"><b>Appel en cours · rejoindre</b><small>{a.en_ligne.length} en ligne</small></span>
    <span className="bd-fleche">›</span>
  </button>;
}

/**
 * Colonne d'icônes à droite (spec §3.3). Ce qui n'est pas encore construit le dit simplement.
 * Rétractable (Seb, 26/11) : ✕ toujours en haut, dessous une flèche horizontale qui fait sortir les icônes du bord (droit, ou gauche si les icônes sont à gauche) puis les range.
 */
/** ✕ et retour du téléphone (Seb, 26/11) : l'écran d'avant (le ‹ caché de l'écran ouvert ; le dernier de la page, pour
 * qu'une visionneuse ouverte par-dessus passe avant), et depuis la liste, la carte. */
function retourOuFermer(fermer: () => void) {
  const retour = [...document.querySelectorAll<HTMLButtonElement>('.buddies [aria-label="Retour"]')].pop();
  if (retour) retour.click(); else fermer();
}

function Colonne({ onClose, onToast, onExpenses, onLodging, onTravel, onAccount, onPlanning, onAlbum, onMessages, onAppel, onPosition, onPositionLong, onSuperUser }: {
  onSuperUser?: () => void; onClose: () => void; onToast: (m: string) => void; onExpenses: () => void; onLodging: () => void; onTravel: () => void; onAccount: () => void; onPlanning?: () => void; onAlbum?: () => void; onMessages?: () => void;
  onAppel?: () => void; onPosition?: () => void; onPositionLong?: () => void;
}) {
  const e = useBuddies();
  const visible = !!monEpingle(e);
  const garee = !!maVoiture(e);
  // Nouvelles icônes (au trait) ou anciennes (émojis), au choix dans 👤 Mon compte ; anciennes par défaut (Seb, 26/11).
  const [neuves, setNeuves] = useState(nouvellesIcones);
  useEffect(() => { const f = () => setNeuves(nouvellesIcones()); window.addEventListener('nouvellesIcones', f); return () => window.removeEventListener('nouvellesIcones', f); }, []);
  const ic = (d: string, emoji: string) => (neuves ? trait(d) : emoji);
  // Nouvelles : pastilles de couleur, dessin blanc (Seb, 26/11, version D de la maquette colonne-chaleureuse).
  const c = (couleur: string) => (neuves ? { style: { '--c': couleur } as React.CSSProperties } : {});
  // Dépliée par défaut ; repliée, l'appli s'en souvient pour la prochaine fois (Seb, 26/11).
  const [ouverte, setOuverteEtat] = useState(() => { try { return localStorage.getItem('buddiesIcones') !== '0'; } catch { return true; } });
  const setOuverte = (o: boolean) => { setOuverteEtat(o); try { localStorage.setItem('buddiesIcones', o ? '1' : '0'); } catch { /* ignoré */ } };
  // Appui long sur Ma position : l'écran des buddies visibles et du choix des groupes.
  const appui = useRef<{ t?: number; long?: boolean }>({});
  /** Appui long (550 ms) : `long` est lancé, et le toucher qui suit ne fait rien d'autre. */
  const appuiLong = (long: () => void) => ({
    onPointerDown: () => { appui.current.long = false; clearTimeout(appui.current.t); appui.current.t = window.setTimeout(() => { appui.current.long = true; long(); }, 550); },
    onPointerUp: () => clearTimeout(appui.current.t), onPointerLeave: () => clearTimeout(appui.current.t),
    onContextMenu: (ev: React.MouseEvent) => ev.preventDefault(),
  });
  // Rangée : ✕ et la flèche en haut, l’un au-dessus de l’autre, et l'écran prend toute la largeur ; ouverte, la colonne
  // glisse et l'écran se resserre à côté d'elle (Seb, 26/11).
  return <div className={`bd-colonne${ouverte ? '' : ' rangee'}`}>
    <div className="bd-col-haut">
    {/* ✕ et flèche toujours en haut à droite, sur tous les écrans (Seb, 26/11). */}
    <button onClick={() => retourOuFermer(onClose)} aria-label="Fermer">✕</button>
    <button className={`bd-col-fleche${ouverte ? ' ouverte' : ''}`} onClick={() => setOuverte(!ouverte)}
      aria-label={ouverte ? 'Ranger les icônes' : 'Montrer les icônes'} aria-expanded={ouverte}><ChevronIcon /></button>
    </div>
    <div className={`bd-col-icones${ouverte ? ' ouverte' : ''}${neuves ? ' pastilles' : ''}`} inert={!ouverte}>
    <button aria-label="Appel" {...c('#2e9a5b')} onClick={onAppel ?? (() => onToast('Connecte-toi (👤) pour appeler tes buddies'))}>{ic(TEL, '📞')}</button>
    {/* Ma position, un interrupteur sous le téléphone (Seb, 26/11) : un appui allume ou éteint, un appui long ouvre l'écran. */}
    <button aria-label={visible ? 'Arrêter de partager ma position' : 'Partager ma position'} aria-pressed={visible}
      className={`bd-col-pin${visible ? ' actif' : ''}`} {...c('#2f7de1')}
      onPointerDown={() => { appui.current.long = false; clearTimeout(appui.current.t);
        if (onPositionLong) appui.current.t = window.setTimeout(() => { appui.current.long = true; onPositionLong(); }, 550); }}
      onPointerUp={() => clearTimeout(appui.current.t)} onPointerLeave={() => clearTimeout(appui.current.t)}
      onContextMenu={(ev) => ev.preventDefault()}
      onClick={() => { if (appui.current.long) return; (onPosition ?? (() => onToast('Connecte-toi (👤) pour partager ta position')))(); }}>
      <PositionIcon on={visible} /></button>
    <button aria-label="Messagerie" {...c('#3a78c9')} onClick={onMessages ?? (() => onToast('Connecte-toi (👤) pour écrire à tes buddies'))}>{ic(BULLE, '💬')}</button>
    <button aria-label="Planning" {...c('#d2473f')} onClick={onPlanning ?? (() => onToast('Connecte-toi (👤) pour les plannings de saison'))}>{ic(CALENDRIER, '📅')}</button>
    <button aria-label="Album photo" {...c('#e0892b')} onClick={onAlbum ?? (() => onToast('Connecte-toi (👤) pour les albums'))}>{ic(PHOTO, '📸')}</button>
    <button aria-label="Buddy count" {...c('#c9862b')} onClick={onExpenses}><BuddyCountIcon /></button>
    <button aria-label="Hébergement" {...c('#9b5e34')} onClick={onLodging}><LitMaisonIcon /></button>
    {/* 🚗 : le voyage en voiture (km, coût, péages), venu de la barre de la carte (Seb, 24/11) ; appui long : garer ma
        voiture ici, ou l'enlever (Seb, 26/11). */}
    <button aria-label={garee ? 'Voyage en voiture · appui long : enlever ma voiture' : 'Voyage en voiture · appui long : garer ma voiture ici'}
      className={garee ? 'bd-col-voiture actif' : undefined} {...c('#c94141')} {...appuiLong(() => void basculerVoiture(onToast))}
      onClick={() => { if (!appui.current.long) onTravel(); }}>{neuves ? <VoitureIcon garee={garee} /> : <span className="bd-col-auto">🚗{garee && <i>📍</i>}</span>}</button>
    {/* 👤 Moi, en dernier : venu de la barre de la carte (Seb, 24/11). */}
    <button aria-label="Moi : mon compte" {...c('#7a5bc4')} onClick={onAccount}>{ic(MOI, '👤')}</button>
    {/* 🔑 Le Super User seul (Seb, 26/11 : « comme je suis modeste, mettons la clé ») : ses demandes de support. */}
    {onSuperUser && superUser() && <button aria-label="Super User" className="bd-col-cle" onClick={onSuperUser}><CleIcon />
      {supportNonLus(e) > 0 && <i className="bd-col-n">{supportNonLus(e)}</i>}</button>}
    </div>
  </div>;
}

/** 🔑 Clé d'or du Super User (Seb, 26/11). */
function CleIcon() {
  return <svg width="34" height="34" viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="15" cy="24" r="9" fill="#f2c230" stroke="#b8860b" strokeWidth="2.2" />
    <circle cx="15" cy="24" r="3.5" fill="#f4f6f8" stroke="#b8860b" strokeWidth="1.6" />
    <path d="M24 24h18M36 24v6M41 24v5" stroke="#b8860b" strokeWidth="4" strokeLinecap="round" />
  </svg>;
}
/** Messages de support pas encore lus (pastille de la clé). */
const supportNonLus = (e: Etat) => { const v = vueSorties(e); return demandesSupport(e).reduce((n, g) => n + nonLus(e, g.id, v.messages), 0); };

/** Espace du Super User (Seb, 26/11) : les demandes de support ; plus tard la place serveur, les comptes… */
function EspaceSuperUser({ e, onOuvrir, onRetour, onClose }: { e: Etat; onOuvrir: (id: string) => void; onRetour: () => void; onClose: () => void }) {
  const v = vueSorties(e);
  const l = demandesSupport(e).map((g) => {
    const f = v.messages.filter((m) => m.groupe === g.id && !m.supprime);
    return { g, dernier: f.at(-1), n: nonLus(e, g.id, v.messages) };
  }).sort((a, b) => (b.dernier?.cree_le ?? b.g.modifie_le).localeCompare(a.dernier?.cree_le ?? a.g.modifie_le));
  const moi = e.moi ?? 'moi';
  return <div className="bd-corps">
    <div className="xp-head"><button onClick={onRetour} aria-label="Retour">‹</button><h2>Super User</h2><button onClick={onClose} aria-label="Fermer">✕</button></div>
    <h3 className="bd-section">Support</h3>
    {l.length ? l.map(({ g, dernier, n }) => {
      const qui = autreDuDuo(g, e);
      return <button key={g.id} className="bd-ligne" onClick={() => onOuvrir(g.id)}>
        <Visage b={qui ?? { id: g.id, nom: '?', photo: null }} />
        <span className="bd-texte"><b>{qui?.pseudo ?? '?'}</b>
          <small>{dernier ? `${dernier.par === moi ? 'Toi : ' : ''}${dernier.texte || '📎'}` : g.nom}</small></span>
        {n > 0 && <span className="bd-nonlu">{n}</span>}
      </button>;
    }) : <p className="bd-vide">Pas encore de demande</p>}
    <h3 className="bd-section">Plus tard</h3>
    <p className="hint">La place sur le serveur de chacun, les comptes, les chiffres d'usage…</p>
  </div>;
}

/** Icônes au trait de la colonne (règle de Seb : pas d'émojis), même style que Buddy count et le lit dans la maison. */
const TEL = 'M16 9h-5a3 3 0 0 0-3 3c0 15 13 28 28 28a3 3 0 0 0 3-3v-5l-8-3-3 4a20 20 0 0 1-12-12l4-3z';
const BULLE = 'M8 12a4 4 0 0 1 4-4h24a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H20l-9 7v-7h1a4 4 0 0 1-4-4z';
const CALENDRIER = 'M7 14a4 4 0 0 1 4-4h26a4 4 0 0 1 4 4v22a4 4 0 0 1-4 4H11a4 4 0 0 1-4-4zM7 19h34M16 6v8M32 6v8M15 27h4M22 27h4M29 27h4M15 33h4M22 33h4';
const PHOTO = 'M6 17a3 3 0 0 1 3-3h6l3-5h12l3 5h6a3 3 0 0 1 3 3v18a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3zM24 19a7 7 0 1 0 0 14a7 7 0 1 0 0-14';
/** Moi : une silhouette dans un rond (le rond la distingue du buddy de « Ma position »). */
const MOI = 'M24 5a19 19 0 1 0 0 38a19 19 0 1 0 0-38M24 13a6 6 0 1 0 0 12a6 6 0 1 0 0-12M12 37a13 13 0 0 1 24 0';
const trait = (d: string) => <svg width="28" height="28" viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor"
  strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;

/** Voiture au trait ; garée, une épingle posée dessus (choix de Seb, 26/11). */
function VoitureIcon({ garee = false }: { garee?: boolean }) {
  return <svg width="30" height="30" viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <g transform={garee ? 'translate(0 8)' : 'translate(0 3)'}>
      <path d="M8 33v-7l4-9a4 4 0 0 1 3.7-2.5h16.6A4 4 0 0 1 36 17l4 9v7a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-1H14v1a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2zM11 26h26" />
      <circle cx="15" cy="29.5" r="1.4" fill="currentColor" /><circle cx="33" cy="29.5" r="1.4" fill="currentColor" />
    </g>
    {garee && <path d="M24 22s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10zM24 10.2a1.8 1.8 0 1 0 0 3.6a1.8 1.8 0 1 0 0-3.6" fill="currentColor" fillRule="evenodd" stroke="none" />}
  </svg>;
}

/** Flèche au trait (règle icônes de Seb) ; la colonne la retourne quand les icônes sont sorties. */
function ChevronIcon() {
  return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9l6 6 6-6" /></svg>;
}

/** Buddy count : B et C entrelacés avec les deux barres du $ (B1), frappés sur une pièce dorée à tranche crénelée,
 * avec un reflet et une petite ombre, partout où il apparaît (Seb, 26/11 : pièce A). */
const CRANS = Array.from({ length: 60 }, (_, i) => {
  const a = (i / 60) * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a);
  return `M${(24 + 18.6 * c).toFixed(2)} ${(24 + 18.6 * s).toFixed(2)}L${(24 + 21 * c).toFixed(2)} ${(24 + 21 * s).toFixed(2)}`;
}).join('');
export function BuddyCountIcon({ taille = 38 }: { taille?: number }) {
  const id = useId().replace(/:/g, '');
  const t = { fontFamily: 'Inter, Roboto, Arial, sans-serif', fontWeight: 800, fontSize: 28, textAnchor: 'middle' as const, fill: '#6b4700', stroke: 'none' };
  return <svg width={taille} height={taille} viewBox="0 0 48 48" aria-hidden="true">
    <defs>
      <radialGradient id={`or${id}`} cx="35%" cy="30%" r="75%"><stop offset="0" stopColor="#fff3b0" /><stop offset=".45" stopColor="#f2c230" /><stop offset="1" stopColor="#b8860b" /></radialGradient>
      <filter id={`om${id}`}><feDropShadow dx="0" dy="1.2" stdDeviation="1" floodOpacity=".35" /></filter>
    </defs>
    <g filter={`url(#om${id})`}>
      <circle cx="24" cy="24" r="21" fill="#b8860b" />
      <path d={CRANS} stroke="#7a5200" strokeWidth="1.1" />
      <circle cx="24" cy="24" r="18.2" fill={`url(#or${id})`} stroke="#9a6e00" strokeWidth="1.2" />
      <circle cx="24" cy="24" r="15" fill="none" stroke="#fff6c8" strokeWidth="1" opacity=".8" />
      <circle cx="24" cy="24" r="14.3" fill="none" stroke="#a87a00" strokeWidth="1" />
    </g>
    <g transform="translate(24 24) scale(.62) translate(-24 -24)" fill="none" stroke="#6b4700" strokeWidth="2.6" strokeLinecap="round">
      <text x="17" y="34" {...t}>B</text><text x="31" y="34" {...t}>C</text>
      <path d="M21 4v8M27 4v8M21 34v9M27 34v9" />
    </g>
  </svg>;
}

/** Hébergement : une maison en couleur, toit rouge, sol, et un lit à couverture bleue (Seb, 26/11, maison 2). */
function LitMaisonIcon() {
  return <svg width="34" height="34" viewBox="0 0 48 48" aria-hidden="true">
    <path d="M10 20h28v22H10z" fill="#f5e6c8" stroke="#8a5a2b" strokeWidth="2" />
    <path d="M4 23L24 6l20 17" fill="none" stroke="#c94141" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 42h32" stroke="#8a5a2b" strokeWidth="2.6" strokeLinecap="round" />
    <rect x="14" y="30" width="20" height="7" rx="2" fill="#3a78c9" />
    <rect x="14" y="28" width="6" height="4" rx="1.5" fill="#fff" stroke="#8a5a2b" strokeWidth="1" />
    <path d="M14 27v12M34 33v6" stroke="#5a3a1a" strokeWidth="2.2" strokeLinecap="round" />
  </svg>;
}

function Qr({ texte }: { texte: string }) {
  const q = qrcode(0, 'M'); q.addData(texte); q.make();
  const n = q.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + 2},${r + 2}h1v1h-1z`;
  return <svg className="bd-qr" viewBox={`0 0 ${n + 4} ${n + 4}`} shapeRendering="crispEdges"><rect width="100%" height="100%" fill="#fff" /><path d={d} fill="#000" /></svg>;
}

// ------------------------------------------------------------------ inviter

type Formulaire = { canal: 'mail' | 'sms'; nom: string; contact: string };

/**
 * Les quatre façons d'inviter (écran 20) : Contacts, Partager, Téléphone, QR code. On n'invite que des gens qu'on
 * connaît, jamais par recherche (spec §3.5). Le message part tout de suite, même sans réseau ; l'invitation
 * est enregistrée par `onInvite` (et envoyée au serveur au retour du réseau).
 */
function Inviter({ nomGroupe, qrExistant, onInvite, onToast, sortie = false }: {
  nomGroupe: string; qrExistant?: string; onInvite: (i: NouvelleInvitation) => void; onToast: (m: string) => void;
  /** Invitation à une sortie (une sortie de Me Time) plutôt qu'à un groupe. */
  sortie?: boolean;
}) {
  const [form, setForm] = useState<Formulaire | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const texte = (code: string) => `${nomAffiche()} t'invite ${sortie ? 'à' : 'dans'} « ${nomGroupe} » sur Mountain Buddies, pour nos sorties montagne : ${lien(code)}`;
  const pret = () => { if (!nomGroupe.trim()) { onToast(`Donne d’abord un nom ${sortie ? 'à la sortie' : 'au groupe'}`); return false; } return true; };

  const envoyer = async (canal: Canal, nom: string, contact: string) => {
    const code = nouveauCode();
    // L'invitation part au serveur avant le SMS : le copain peut ouvrir le lien tout de suite.
    onInvite({ canal, nom: nom.trim() || contact, contact, code });
    setForm(null);
    try {
      if (Capacitor.isNativePlatform()) await Natif.sms({ numero: contact, texte: texte(code) });
      else window.location.href = `sms:${encodeURIComponent(contact)}?body=${encodeURIComponent(texte(code))}`;
    } catch (err) { onToast(String((err as Error).message)); }
  };
  /** Par la feuille de partage du téléphone (WhatsApp, mail, SMS…) avec le lien réutilisable, comme le QR code.
   * Remplace « Mail » (Seb, 26/11) : l'appli n'envoie pas de mail elle-même. */
  const partager = async () => {
    if (!pret()) return;
    let code = qrExistant;
    if (!code) { code = nouveauCode(); onInvite({ canal: 'qr', nom: '', contact: '', code }); }
    await Promise.race([envoyerAttente(), new Promise((r) => setTimeout(r, 4000))]);
    try {
      if (Capacitor.isNativePlatform()) await Natif.partager({ titre: nomGroupe, texte: texte(code) });
      else if (navigator.share) await navigator.share({ title: nomGroupe, text: texte(code) });
      else { await navigator.clipboard.writeText(texte(code)); onToast('Copié : colle-le dans un message'); }
    } catch { /* annulé */ }
  };

  const contacts = async () => {
    if (!pret()) return;
    if (!Capacitor.isNativePlatform()) { setForm({ canal: 'sms', nom: '', contact: '' }); return; }
    try {
      const c = await Natif.pickContact();
      await envoyer('contacts', c.nom, c.telephone);
    } catch { /* choix annulé */ }
  };
  const montrerQr = () => {
    if (!pret()) return;
    if (qrExistant) { setQr(qrExistant); return; }
    const code = nouveauCode();
    onInvite({ canal: 'qr', nom: '', contact: '', code });
    setQr(code);
  };

  return <>
    <div className="bd-inviter">
      <button onClick={() => void contacts()}><span>📇</span>Contacts</button>
      <button onClick={() => void partager()}><span>📤</span>Partager</button>
      <button onClick={() => { if (pret()) setForm({ canal: 'sms', nom: '', contact: '' }); }}><span>📱</span>Téléphone</button>
      <button onClick={montrerQr}><span>🔳</span>QR code</button>
    </div>
    {form && <div className="bd-voile" onClick={() => setForm(null)}><div className="bd-feuille" onClick={(ev) => ev.stopPropagation()}>
      <h3>{form.canal === 'mail' ? 'Inviter par mail' : 'Inviter par SMS'}</h3>
      <label className="field">Son prénom<input value={form.nom} onChange={(ev) => setForm({ ...form, nom: ev.target.value })} placeholder="Julie" /></label>
      <label className="field">{form.canal === 'mail' ? 'Son adresse e-mail' : 'Son numéro de téléphone'}
        <input type={form.canal === 'mail' ? 'email' : 'tel'} inputMode={form.canal === 'mail' ? 'email' : 'tel'} value={form.contact}
          onChange={(ev) => setForm({ ...form, contact: ev.target.value })} placeholder={form.canal === 'mail' ? 'julie@exemple.fr' : '06 12 34 56 78'} /></label>
      <button className="primary" disabled={!form.contact.trim()} onClick={() => void envoyer(form.canal, form.nom, form.contact.trim())}>
        {form.canal === 'mail' ? 'Écrire le mail' : 'Écrire le SMS'}</button>
      <button onClick={() => setForm(null)}>Annuler</button>
    </div></div>}
    {qr && <div className="bd-voile" onClick={() => setQr(null)}><div className="bd-feuille bd-centre" onClick={(ev) => ev.stopPropagation()}>
      <h3>{nomGroupe}</h3>
      <Qr texte={lien(qr)} />
      <p className="hint">Tes copains visent ce code avec l'appareil photo de leur téléphone : il installe l'appli et les fait entrer {sortie ? 'dans la sortie' : 'dans la bande'}.</p>
      <button onClick={() => setQr(null)}>Fermer</button>
    </div></div>}
  </>;
}

// ------------------------------------------------------------------ Sorties

const MOIS = ['JANV', 'FÉVR', 'MARS', 'AVR', 'MAI', 'JUIN', 'JUIL', 'AOÛT', 'SEPT', 'OCT', 'NOV', 'DÉC'];
const jourMois = (d: string) => ({ j: String(+d.slice(8, 10)), m: MOIS[+d.slice(5, 7) - 1] ?? '' });
const dateCourte = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
export function dates(x: Sortie) { return x.fin === x.debut ? dateCourte(x.debut) : `${dateCourte(x.debut)} – ${dateCourte(x.fin)}`; }
export function quandSortie(x: Sortie) {
  const n = joursAvant(x);
  if (x.fin < aujourdhui()) return 'Sortie passée';
  if (n <= 0) return 'En cours';
  return n === 1 ? 'Demain' : `Dans ${n} jours`;
}

/** Photo carrée datée (même code dans la liste, le groupe et le panneau de partage). */
export function Carre({ x, taille = 56 }: { x: Sortie; taille?: number }) {
  const { j, m } = jourMois(x.debut);
  return <span className="bd-carre" style={{ width: taille, height: taille, background: x.photo ? `center/cover url("${x.photo}")` : couleur(x.id) }}>
    <span className="bd-date"><small>{m}</small><b>{j}</b></span></span>;
}

/** Grande image d'une sortie (le prochain en haut de la liste, les cartes d'un groupe). */
/** « 1 buddy · 1 invité » sous le nom du groupe (Seb, 26/11 : « Groupe » en trop ; les invitations à part). */
function nbBuddies(g: Groupe) {
  const n = g.membres.length, i = g.invitations.filter((x) => x.canal !== 'qr').length;
  return `${n} ${n > 1 ? 'buddies' : 'buddy'}${i ? ` · ${i} invité${i > 1 ? 's' : ''}` : ''}`;
}

/** Les initiales des partants, petites et empilées : 3 au plus, puis « +2 » (Seb, 26/11, version B). */
function Partants({ x }: { x: Sortie }) {
  const n = x.participants.length;
  if (!n) return null;
  return <span className="bd-partants">{x.participants.slice(0, 3).map((b) => <Visage key={b.id} b={b} taille={22} />)}
    {n > 3 && <i>+{n - 3}</i>}</span>;
}

export function LigneSortie({ x, onClick }: { x: Sortie; onClick: () => void }) {
  return <button className="bd-sortie-ligne" onClick={onClick}>
    <span className="bd-bande" style={{ background: couleur(x.id) }} />
    <span className="bd-texte"><b>{x.nom}</b>
      <small>{dateCourte(x.debut)}{x.attente ? ' · 🕓' : ''}<Partants x={x} /></small></span>
  </button>;
}

function Affiche({ x, petite = false, onClick }: { x: Sortie; petite?: boolean; onClick: () => void }) {
  // Sortie passée sans photo : une ligne compacte, couleur en bande à gauche, partants sous le titre (Seb, 26/11).
  if (petite && !x.photo) return <LigneSortie x={x} onClick={onClick} />;
  return <button className={`bd-affiche${petite ? ' petite' : ''}`} onClick={onClick}
    style={{ background: x.photo ? `linear-gradient(#0000 40%, #000a), center/cover url("${x.photo}")` : `linear-gradient(#0000 30%, #0008), ${couleur(x.id)}` }}>
    {!petite && <span className="bd-pastille">{quandSortie(x)}</span>}
    <b>{x.nom}</b>
    <small>{petite ? dateCourte(x.debut) : `${dates(x)} · ${x.participants.length} partant${x.participants.length > 1 ? 's' : ''}`}{x.attente ? ' · 🕓' : ''}{petite && <Partants x={x} />}</small>
  </button>;
}

/** Celui qui a créé la sortie (ou pas encore synchronisé : c'est moi) ou un admin de son groupe peut le supprimer. */
export const peutSupprimer = (x: Sortie, e: Etat) => !x.par || x.par === e.moi || appliquer(e).some((g) => g.id === x.groupe && estAdmin(g, e));

/** Poubelle (Seb, 25 novembre) : supprimé tout de suite, « Annuler » 10 secondes ; le serveur garde tout. */
function useSuppression() {
  const [copie, setCopie] = useState<Sortie | null>(null);
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (minuteur.current) clearTimeout(minuteur.current); }, []);
  const supprimer = (x: Sortie) => {
    if (minuteur.current) clearTimeout(minuteur.current);
    supprimerSortie(x.id);
    setCopie(x);
    minuteur.current = setTimeout(() => setCopie(null), 10000);
  };
  const annuler = () => { if (minuteur.current) clearTimeout(minuteur.current); if (copie) remettreSortie(copie); setCopie(null); };
  const bandeau = copie && <div className="bd-bandeau bd-bandeau-bas">« {copie.nom} » supprimé<button className="bd-lien" onClick={annuler}>Annuler</button></div>;
  return { supprimer, bandeau };
}

/** Feuille « Nom du … » : changer le nom d'une sortie, d'un groupe ou du Me Time. */
export function FeuilleNom({ titre, nom, onEnregistrer, onFermer, onToast }: {
  titre: string; nom: string; onEnregistrer: (nom: string) => void; onFermer: () => void; onToast: (m: string) => void;
}) {
  const [texte, setTexte] = useState(nom);
  const valider = () => {
    try { if (texte.trim() !== nom) onEnregistrer(texte); onFermer(); } catch (err) { onToast((err as Error).message); }
  };
  return <div className="bd-voile" onClick={onFermer}><div className="bd-feuille" onClick={(ev) => ev.stopPropagation()}>
    <h3>{titre}</h3>
    <input className="bd-titre-champ" value={texte} maxLength={80} autoFocus aria-label={titre}
      onChange={(ev) => setTexte(ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Enter') valider(); }} />
    <button className="primary" onClick={valider}>Enregistrer</button>
    <button onClick={onFermer}>Annuler</button>
  </div></div>;
}

/** Le lien d'invitation réutilisable (comme le QR code) d'un groupe ou d'une sortie ; créé la première fois. */
function lienReutilisable(c: { groupe: Groupe } | { sortie: Sortie }): string {
  const l = 'groupe' in c ? c.groupe.invitations : c.sortie.invitations;
  const deja = l.find((i) => i.canal === 'qr')?.code;
  if (deja) return lien(deja);
  const code = nouveauCode();
  const i = { canal: 'qr' as Canal, nom: '', contact: '', code };
  if ('groupe' in c) inviter(c.groupe.id, i); else inviterSortie(c.sortie.id, i);
  return lien(code);
}

/** « Partager » de la barre d'appui long (Seb, 26/11) : une sortie, son résumé et un lien pour la rejoindre ; un groupe,
 * son lien d'invitation. Par la feuille de partage du téléphone (WhatsApp, SMS, mail…), sinon copié. */
async function partagerChoix(c: { groupe: Groupe } | { sortie: Sortie }, nomGroupe: string, onToast: (m: string) => void) {
  let titre: string, texte: string;
  if ('groupe' in c) {
    titre = c.groupe.nom;
    texte = `${nomAffiche()} t'invite dans « ${c.groupe.nom} » sur Mountain Buddies, pour nos sorties montagne : ${lienReutilisable(c)}`;
  } else {
    const x = c.sortie;
    titre = x.nom;
    texte = [x.nom, [dates(x), x.lieu, nomGroupe].filter(Boolean).join(' · '),
      x.participants.length > 1 ? `${x.participants.length} partants` : '',
      `Rejoins la sortie sur Mountain Buddies : ${lienReutilisable(c)}`].filter(Boolean).join('\n');
  }
  await Promise.race([envoyerAttente(), new Promise((r) => setTimeout(r, 4000))]); // le lien est connu du serveur avant de partir
  try {
    if (Capacitor.isNativePlatform()) await Natif.partager({ titre, texte });
    else if (navigator.share) await navigator.share({ title: titre, text: texte });
    else { await navigator.clipboard.writeText(texte); onToast('Copié : colle-le dans un message'); }
  } catch { /* annulé */ }
}

/** Icône Partager au trait (trois points reliés). */
function PartagerIcon() {
  return <svg width="24" height="24" viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="36" cy="10" r="5" /><circle cx="12" cy="24" r="5" /><circle cx="36" cy="38" r="5" /><path d="M16.5 21.5l15-8.5M16.5 26.5l15 8.5" /></svg>;
}

/**
 * Appui long sur un groupe ou une sortie, comme WhatsApp (Seb, 26/11) : la ligne est choisie et une barre ardoise
 * prend le haut : ✕, Modifier (le nom), Partager, Supprimer (une sortie : son créateur ou un admin, avec « Annuler »).
 * Un appui normal ouvre toujours.
 */
type Choix = { groupe: Groupe } | { sortie: Sortie };
function useChoix(e: Etat, groupes: Groupe[], onToast: (m: string) => void, supprimer: (x: Sortie) => void) {
  const [choix, setChoix] = useState<Choix | null>(null);
  const [nommer, setNommer] = useState(false);
  const [confirmer, setConfirmer] = useState<Groupe | null>(null);
  const t = useRef<number | undefined>(undefined);
  const long = useRef(false);
  const arreter = () => clearTimeout(t.current);
  const appui = (c: Choix) => ({
    onPointerDown: () => { long.current = false; arreter(); t.current = window.setTimeout(() => { long.current = true; setChoix(c); navigator.vibrate?.(20); }, 550); },
    onPointerUp: arreter, onPointerLeave: arreter, onPointerCancel: arreter,
    onContextMenu: (ev: React.MouseEvent) => ev.preventDefault(),
    // Le toucher qui suit un appui long ne rouvre pas la ligne.
    onClickCapture: (ev: React.MouseEvent) => { if (long.current) { ev.stopPropagation(); ev.preventDefault(); long.current = false; } },
  });
  const choisi = (c: Choix) => !!choix && ('groupe' in c ? 'groupe' in choix && choix.groupe.id === c.groupe.id : 'sortie' in choix && choix.sortie.id === c.sortie.id);
  const nom = choix ? ('groupe' in choix ? choix.groupe.nom : choix.sortie.nom) : '';
  const nomGroupe = choix && 'sortie' in choix ? groupes.find((g) => g.id === choix.sortie.groupe)?.nom ?? '' : '';
  const barre = choix && <div className="bd-barre-choix">
    <button onClick={() => setChoix(null)} aria-label="Annuler le choix">✕</button>
    <b>{nom}</b><span style={{ flex: 1 }} />
    <button onClick={() => setNommer(true)} aria-label={`Changer le nom de ${nom}`}><PencilIcon size={22} /></button>
    <button onClick={() => { void partagerChoix(choix, nomGroupe, onToast); setChoix(null); }} aria-label={`Partager ${nom}`}><PartagerIcon /></button>
    {'sortie' in choix && peutSupprimer(choix.sortie, e) && <button onClick={() => { supprimer(choix.sortie); setChoix(null); }} aria-label={`Supprimer ${nom}`}><TrashIcon size={22} /></button>}
    {'groupe' in choix && estAdmin(choix.groupe, e) && <button onClick={() => { setConfirmer(choix.groupe); setChoix(null); }} aria-label={`Supprimer ${nom}`}><TrashIcon size={22} /></button>}
    {nommer && <FeuilleNom titre={'groupe' in choix ? 'Nom du groupe' : 'Nom de la sortie'} nom={nom} onToast={onToast}
      onEnregistrer={(n) => ('groupe' in choix ? renommerGroupe(choix.groupe.id, n) : renommerSortie(choix.sortie.id, n))}
      onFermer={() => { setNommer(false); setChoix(null); }} />}
  </div>;
  // Un groupe emporte ses sorties : on demande d'abord (Seb, 26/11).
  const confirmation = confirmer && <div className="bd-voile" onClick={() => setConfirmer(null)}>
    <div className="bd-feuille" onClick={(ev) => ev.stopPropagation()}>
      <h3>Supprimer « {confirmer.nom} » ?</h3>
      <p>Le groupe et ses sorties disparaissent pour tous ses buddies.</p>
      <button className="stop" onClick={() => { supprimerGroupe(confirmer.id); onToast(`« ${confirmer.nom} » supprimé`); setConfirmer(null); }}>Supprimer le groupe</button>
      <button onClick={() => setConfirmer(null)}>Annuler</button>
    </div></div>;
  return { appui, choisi, barre: <>{barre}{confirmation}</> };
}

type Vue = { ecran: 'liste' } | { ecran: 'groupe'; id: string } | { ecran: 'nouveau' } | { ecran: 'sortie'; groupe: string }
  | { ecran: 'plannings'; groupe?: string } | { ecran: 'planning'; id: string; groupe?: string } | { ecran: 'dispos'; id: string; groupe?: string }
  | { ecran: 'nvPlanning'; groupe?: string } | { ecran: 'albums'; groupe?: string } | { ecran: 'album'; id: string; groupe?: string; carnet?: boolean }
  | { ecran: 'carnet'; id: string; groupe?: string } | { ecran: 'ecrire'; id: string; groupe?: string }
  | { ecran: 'comptes'; groupe?: string } | { ecran: 'count'; id: string; groupe?: string } | { ecran: 'depense'; id: string; depense?: string; groupe?: string }
  | { ecran: 'dodo'; id: string; groupe?: string } | { ecran: 'messages'; groupe?: string } | { ecran: 'conv'; id: string; retour?: 'superUser' } | { ecran: 'nouvelleConv' } | { ecran: 'superUser' }
  | { ecran: 'position'; groupe?: string; sortie?: string } | { ecran: 'nvCount'; groupe: string } | { ecran: 'nvCountSortie'; groupe: string };
/** Ouvrir Buddies ailleurs que sur la liste : un groupe (‹ depuis la carte), l'album ou le carnet d'une sortie. */
export type DepartBuddies = string | { ecran: 'album' | 'carnet' | 'count' | 'dodo'; sortie: string; groupe: string } | { ecran: 'conv'; id: string };

/** Ce qu'on montre sur la carte : une sortie (sa conversation ouverte si `parler`), des traces, un point d'un message,
 * ou les buddies visibles (📍 de la colonne) centrés sur l'un d'eux (`positions` = son identifiant). */
export type CarteBuddies = { sortie?: Sortie; traces: TraceBuddy[]; parler?: boolean; point?: { lon: number; lat: number; nom: string }; positions?: string };

export function Buddies({ onClose, onToast, onAccount, onExpenses, onLodging, onTravel, onCarte, depart }: {
  onClose: () => void; onToast: (m: string, ms?: number) => void; onAccount: () => void; onExpenses: () => void; onLodging: () => void; onTravel: () => void;
  /** Ouvrir une sortie sur la carte (écran 4), ou une trace partagée dans un groupe. */
  onCarte: (x: CarteBuddies) => void;
  depart?: DepartBuddies;
}) {
  const e = useBuddies();
  const compte = useCompte();
  const [vue, setVue] = useState<Vue>(typeof depart === 'string' ? { ecran: 'groupe', id: depart }
    : depart?.ecran === 'conv' ? depart : depart ? { ecran: depart.ecran, id: depart.sortie, groupe: depart.groupe } : { ecran: 'liste' });
  // Plus de ‹ à l'écran (Seb, 26/11) : le retour du téléphone, comme ✕, revient à l'écran d'avant.
  const fermer = useRef(onClose);
  fermer.current = onClose;
  useEffect(() => {
    let sub: { remove: () => Promise<void> } | null = null, vivant = true;
    void CapApp.addListener('backButton', () => retourOuFermer(fermer.current)).then((h) => { if (vivant) sub = h; else void h.remove(); }).catch(() => { /* web */ });
    return () => { vivant = false; void sub?.remove(); };
  }, []);
  // Derniers ouverts (proposés en premier pour associer une trace) : le groupe, la sortie de l'album, du carnet…
  useEffect(() => {
    if (vue.ecran === 'groupe') noterOuvert('groupes', vue.id);
    else if ('id' in vue && ['album', 'carnet', 'ecrire', 'count', 'depense', 'dodo'].includes(vue.ecran)) noterOuvert('sorties', vue.id);
    if ('groupe' in vue && vue.groupe) noterOuvert('groupes', vue.groupe);
  }, [vue]);
  // Ouvert : on regarde les nouveautés toutes les minutes ; fermé, la pastille de 👥 repart de maintenant.
  useEffect(() => {
    const sync = () => { void synchroniser().then((r) => r.forEach(onToast)).catch(() => undefined); };
    sync();
    const t = setInterval(sync, 60_000);
    return () => { clearInterval(t); marquerVu(); };
  }, [onToast]);

  if (!connecte(compte)) {
    const colonne = <Colonne onClose={onClose} onToast={onToast} onExpenses={onExpenses} onLodging={onLodging} onTravel={onTravel} onAccount={onAccount} />;
    return <div className="buddies">{colonne}<div className="bd-corps">
      <p className="bd-vide">Connecte-toi pour retrouver tes copains, créer tes groupes et partager vos sorties.</p>
      <button className="primary bd-grand" onClick={onAccount}>👤 Me connecter</button>
      {rejointsEnAttente(e).length > 0 && <p className="hint">🕓 Une invitation t'attend : elle s'ouvrira une fois connecté.</p>}
    </div></div>;
  }

  const groupes = appliquer(e);
  // Discussion à deux avec un buddy (toujours la même) : elle s'ouvre, créée au besoin.
  const parlerA = (b: Buddy) => void ouvrirDuo(b).then((id) => setVue({ ecran: 'conv', id })).catch((err: Error) => onToast(err.message));
  const { sorties, traces, plannings, photos, depenses, hebergements } = vueSorties(e);
  const ouvrir = (x: Sortie, parler = false) => onCarte({ sortie: x, traces: traces.filter((t) => t.sortie === x.id), parler });
  // Une sortie terminé s'ouvre sur son carnet (spec §5.4) ; la carte reste à un toucher.
  const voir = (x: Sortie) => (x.fin < aujourdhui() ? setVue({ ecran: 'carnet', id: x.id, groupe: vue.ecran === 'groupe' ? vue.id : undefined }) : ouvrir(x));
  const g = vue.ecran === 'groupe' ? groupes.find((x) => x.id === vue.id) : undefined;
  // Groupe perso, sans nom (« Seul », Seb 26 novembre) : il naît à la première sortie seul.
  const meTime = groupes.find((x) => x.nature === 'me_time');
  // 📅 : les plannings du groupe ouvert, sinon de toutes mes bandes (spec §5.5).
  const ici = 'groupe' in vue ? vue.groupe : vue.ecran === 'groupe' || vue.ecran === 'conv' ? vue.id : undefined;
  // 💶 : le Buddy count de la sortie ouverte, sinon tous ceux du groupe ouvert (ou de tous).
  const sortieIci = 'id' in vue && ['carnet', 'ecrire', 'album', 'count', 'depense', 'dodo'].includes(vue.ecran) && sorties.some((x) => x.id === vue.id) ? vue.id : undefined;
  // Buddy counts (Seb, 26/11, §7.20) : celui de groupe ouvert est montré comme une sortie dont les membres partagent les frais.
  const counts = mesCounts(e);
  const cg = 'id' in vue && (vue.ecran === 'count' || vue.ecran === 'depense') ? counts.find((c) => c.id === vue.id && c.groupe && !c.supprime) : undefined;
  const gcg = cg && groupes.find((x) => x.id === cg.groupe);
  const gDe = (x: Sortie) => groupes.find((y) => y.id === x.groupe);
  // 🏨 : « Où on dort ? » de la sortie ouverte, sinon la recherche d'hébergement.
  const colonne = <Colonne onClose={onClose} onToast={onToast} onTravel={onTravel} onAccount={onAccount} onLodging={() => (sortieIci ? setVue({ ecran: 'dodo', id: sortieIci, groupe: ici }) : onLodging())}
    onExpenses={() => setVue(sortieIci ? { ecran: 'count', id: sortieIci, groupe: ici } : { ecran: 'comptes', groupe: ici })}
    onPlanning={() => setVue({ ecran: 'plannings', groupe: ici && ici !== meTime?.id ? ici : undefined })}
    onAlbum={() => setVue({ ecran: 'albums', groupe: ici })}
    onSuperUser={() => setVue({ ecran: 'superUser' })}
    onPositionLong={() => setVue({ ecran: 'position', groupe: ici && ici !== meTime?.id ? ici : undefined, sortie: sortieIci })}
    // Un appui : la sortie ouverte, sinon le groupe ouvert, sinon tous mes groupes (Seb, 26/11).
    onPosition={() => void basculerPosition(e, ciblesIci(e, groupes, sorties, sortieIci, ici), onToast)}
    onMessages={() => {
      // 💬 : la conversation de la sortie ouverte (sur sa carte), sinon celle du groupe ouvert, sinon toutes.
      const x = sortieIci ? sorties.find((y) => y.id === sortieIci) : undefined;
      if (x) ouvrir(x, true);
      else if (vue.ecran === 'groupe' && vue.id !== meTime?.id) setVue({ ecran: 'conv', id: vue.id });
      else setVue({ ecran: 'messages', groupe: ici });
    }}
    onAppel={() => {
      // 📞 : toute la bande de la sortie ouverte, sinon du groupe ouvert (spec §5.7).
      const x = sortieIci ? sorties.find((y) => y.id === sortieIci) : undefined;
      const gr = vue.ecran === 'groupe' || vue.ecran === 'conv' ? groupes.find((y) => y.id === vue.id) : undefined;
      if (x) appelerBande({ sortie: x.id }, x.nom, onToast);
      else if (gr && gr.nature !== 'me_time') appelerBande({ groupe: gr.id }, gr.nom, onToast);
      else onToast('Ouvre un groupe ou une sortie pour appeler toute la bande');
    }} />;
  const album = sortieIci ? sorties.find((x) => x.id === sortieIci) : undefined;
  const caisse = album ?? (cg && gcg ? sortieDuCount(cg, gcg) : undefined);
  const retourPlannings = (gid?: string) => setVue({ ecran: 'plannings', groupe: gid });
  const pl = 'id' in vue && (vue.ecran === 'planning' || vue.ecran === 'dispos') ? plannings.find((x) => x.id === vue.id) : undefined;
  const remplir = (x: Planning) => setVue({ ecran: 'dispos', id: x.id, groupe: x.groupe });
  return <div className="buddies">
    {colonne}
    {vue.ecran === 'position' ? <MaPosition onToast={onToast} onClose={onClose} ici={ciblesIci(e, groupes, sorties, vue.sortie, vue.groupe)}
      onVoir={(r) => onCarte({ traces: [], positions: r.b.id })}
      onRetour={() => setVue(vue.groupe ? { ecran: 'groupe', id: vue.groupe } : { ecran: 'liste' })} />
      : vue.ecran === 'albums' ? <Albums sorties={sorties.filter((x) => !vue.groupe || x.groupe === vue.groupe)} photos={photos} onClose={onClose}
      onOuvrir={(x) => setVue({ ecran: 'album', id: x.id, groupe: vue.groupe })}
      onRetour={() => setVue(vue.groupe ? { ecran: 'groupe', id: vue.groupe } : { ecran: 'liste' })} />
      : vue.ecran === 'comptes' ? (() => {
        const gi = groupes.find((x) => x.id === vue.groupe && x.nature !== 'me_time' && !aDeux(x));
        return <Comptes groupes={groupes.filter((x) => !vue.groupe || x.id === vue.groupe)} sorties={sorties.filter((x) => !vue.groupe || x.groupe === vue.groupe)}
          counts={counts} depenses={depenses} ici={gi} onClose={onClose}
          onOuvrir={(x) => setVue({ ecran: 'count', id: x.id, groupe: vue.groupe })}
          // ＋ Buddy count partout (Seb, 26/11) : dans un groupe, créé tout de suite au nom du groupe (« 2 », « 3 »… s'il
          // y en a déjà, renommable) ; hors d'un groupe, on choisit le groupe sur l'écran suivant.
          onNouveau={gi?.nature === 'bande' ? () => { setVue({ ecran: 'count', id: creerCount(gi.id, nomDeCount(gi, counts)), groupe: gi.id }); onToast('Buddy count de groupe créé', 2000); }
            : groupes.some((x) => x.nature === 'bande') ? () => setVue({ ecran: 'nvCount', groupe: '' }) : undefined}
          onNouveauSortie={sorties.some((x) => !vue.groupe || x.groupe === vue.groupe) ? () => setVue({ ecran: 'nvCountSortie', groupe: vue.groupe ?? '' }) : undefined}
          onRetour={() => setVue(vue.groupe ? { ecran: 'groupe', id: vue.groupe } : { ecran: 'liste' })} />;
      })()
      : vue.ecran === 'nvCount' ? <NouveauCount groupes={groupes.filter((x) => x.nature === 'bande')} depart={vue.groupe} onClose={onClose}
        onRetour={() => setVue({ ecran: 'comptes', groupe: vue.groupe || undefined })}
        onCreer={(gid, nom) => { setVue({ ecran: 'count', id: creerCount(gid, nom), groupe: gid }); onToast('Buddy count de groupe créé', 2000); }} />
      : vue.ecran === 'nvCountSortie' ? (() => {
        const ici = sorties.filter((x) => !vue.groupe || x.groupe === vue.groupe);
        const avec = new Set(sortiesAvecCount(ici, counts, depenses).map((x) => x.id));
        return <NouveauCountSortie sorties={ici.filter((x) => !avec.has(x.id)).sort((a, b) => b.debut.localeCompare(a.debut))} onClose={onClose}
          onRetour={() => setVue({ ecran: 'comptes', groupe: vue.groupe || undefined })}
          onChoix={(x) => { changerCount(x.id, counts.some((c) => c.sortie === x.id && c.supprime) ? { supprime: false } : {}); onToast('Buddy count de sortie créé', 2000); setVue({ ecran: 'count', id: x.id, groupe: vue.groupe || undefined }); }} />;
      })()
      : vue.ecran === 'superUser' ? <EspaceSuperUser e={e} onClose={onClose} onRetour={() => setVue({ ecran: 'liste' })}
        onOuvrir={(id) => setVue({ ecran: 'conv', id, retour: 'superUser' })} />
      : vue.ecran === 'messages' ? <Conversations groupes={groupes} sorties={sorties} onClose={onClose}
        onGroupe={(x) => setVue({ ecran: 'conv', id: x.id })} onSortie={(x) => ouvrir(x, true)} onContact={parlerA}
        onNouvelle={() => setVue({ ecran: 'nouvelleConv' })}
        onRetour={() => setVue(vue.groupe ? { ecran: 'groupe', id: vue.groupe } : { ecran: 'liste' })} />
      : vue.ecran === 'nouvelleConv' ? <NouvelleDiscussion onContact={parlerA} onNouveauGroupe={() => setVue({ ecran: 'nouveau' })} onClose={onClose}
        onRetour={() => setVue({ ecran: 'messages' })} />
      : vue.ecran === 'conv' && groupes.some((x) => x.id === vue.id) ? (() => {
        const gc = groupes.find((x) => x.id === vue.id)!;
        return <div className="bd-corps bd-corps-conv">
          <div className="xp-head"><button onClick={() => setVue(aDeux(gc) ? { ecran: vue.retour ?? 'messages' } : { ecran: 'groupe', id: gc.id })} aria-label="Retour">‹</button>
            {aDeux(gc) && <Visage b={gc.nature === 'support' && !superUser() ? { id: gc.id, nom: 'Support', photo: null } : autreDuDuo(gc, e) ?? { id: gc.id, nom: '?', photo: null }} taille={40} />}
            <span className="bd-titre"><b>{nomDiscussion(gc, e)}</b>{gc.nature === 'support' ? <small>{superUser() ? gc.nom : 'Le support te répond ici'}</small> : <SousTitre g={gc} e={e} />}</span>
            <button onClick={onClose} aria-label="Fermer">✕</button></div>
          <Conversation dest={{ groupe: gc.id }} membres={gc.membres} onToast={onToast}
            onPoint={(p) => onCarte({ traces: [], point: p })} onTrace={(t) => onCarte({ traces: [t] })} />
        </div>;
      })()
      : vue.ecran === 'dodo' && album ? <OuOnDort x={album} hebergements={hebergements} onToast={onToast} onClose={onClose} onChercher={onLodging}
        onRetour={() => (album.fin < aujourdhui() ? setVue({ ecran: 'carnet', id: album.id, groupe: vue.groupe }) : ouvrir(album))} />
      : vue.ecran === 'count' && caisse ? (() => {
        const g = gDe(caisse);
        return <BuddyCount x={caisse} depenses={depenses} onClose={onClose} onToast={onToast} deGroupe={!!cg}
          onRenommer={cg ? (nom) => changerCount(caisse.id, { nom }) : undefined}
          onSupprimer={g && estAdmin(g, e) ? () => { changerCount(caisse.id, { supprime: true }); onToast(`Buddy count « ${caisse.nom} » supprimé`);
            setVue({ ecran: 'comptes', groupe: vue.groupe }); } : undefined}
          onDepense={(d) => setVue({ ecran: 'depense', id: caisse.id, depense: d, groupe: vue.groupe })}
          onRetour={() => setVue({ ecran: 'comptes', groupe: vue.groupe })} />;
      })()
      : vue.ecran === 'depense' && caisse ? <UneDepense key={vue.depense ?? 'nouvelle'} x={caisse} d={depenses.find((y) => y.id === vue.depense)}
        onToast={onToast} onClose={onClose} onFini={() => setVue({ ecran: 'count', id: caisse.id, groupe: vue.groupe })} />
      : vue.ecran === 'carnet' && album ? <UnCarnet x={album} depenses={depenses.filter((d) => d.sortie === album.id)}
        onCount={() => setVue({ ecran: 'count', id: album.id, groupe: vue.groupe })} photos={photos.filter((p) => p.sortie === album.id)}
        traces={traces.filter((t) => t.sortie === album.id)} onToast={onToast} onClose={onClose} onCarte={() => ouvrir(album)}
        onEcrire={() => setVue({ ecran: 'ecrire', id: album.id, groupe: vue.groupe })}
        onChanger={() => setVue({ ecran: 'album', id: album.id, groupe: vue.groupe, carnet: true })}
        onRetour={() => setVue(vue.groupe ? { ecran: 'groupe', id: vue.groupe } : { ecran: 'liste' })} />
      : vue.ecran === 'ecrire' && album ? <EcrireCarnet key={album.id} x={album} traces={traces.filter((t) => t.sortie === album.id)} onToast={onToast}
        onClose={onClose} onRetour={() => setVue({ ecran: 'carnet', id: album.id, groupe: vue.groupe })} />
      : vue.ecran === 'album' && album ? <UnAlbum x={album} carnet={vue.carnet} photos={photos.filter((p) => p.sortie === album.id)} onToast={onToast} onClose={onClose}
        onCarte={() => ouvrir(album)} onRetour={() => setVue(vue.carnet ? { ecran: 'carnet', id: album.id, groupe: vue.groupe } : { ecran: 'albums', groupe: vue.groupe })} />
      : vue.ecran === 'plannings' ? <Plannings plannings={plannings.filter((x) => !vue.groupe || x.groupe === vue.groupe)} groupes={groupes}
      ici={groupes.find((x) => x.id === vue.groupe && x.nature === 'bande')}
      onOuvrir={(id) => setVue({ ecran: 'planning', id, groupe: vue.groupe })} onRemplir={(id) => setVue({ ecran: 'dispos', id, groupe: vue.groupe })}
      onNouveau={() => setVue({ ecran: 'nvPlanning', groupe: vue.groupe })} onClose={onClose}
      onRetour={() => setVue(vue.groupe ? { ecran: 'groupe', id: vue.groupe } : { ecran: 'liste' })} />
      : vue.ecran === 'nvPlanning' ? <NouveauPlanning groupes={groupes} groupe={vue.groupe} onToast={onToast} onClose={onClose}
        onFini={(id) => setVue({ ecran: 'planning', id, groupe: vue.groupe })} onRetour={() => retourPlannings(vue.groupe)} />
      : vue.ecran === 'planning' && pl ? <UnPlanning p={pl} g={groupes.find((x) => x.id === pl.groupe)} sorties={sorties} onToast={onToast} onClose={onClose}
        onSortie={ouvrir} onRemplir={() => setVue({ ecran: 'dispos', id: pl.id, groupe: vue.groupe })} onRetour={() => retourPlannings(vue.groupe)} />
      : vue.ecran === 'dispos' && pl ? <MesDispos p={pl} onClose={onClose} onRetour={() => setVue({ ecran: 'planning', id: pl.id, groupe: vue.groupe })} />
      : vue.ecran === 'nouveau' ? <Nouveau onToast={onToast} onFini={(id) => setVue({ ecran: 'groupe', id })} onRetour={() => setVue({ ecran: 'liste' })} onClose={onClose} />
      : vue.ecran === 'sortie' && vue.groupe !== SEUL && !groupes.some((x) => x.id === vue.groupe)
        ? <ChoixGroupe groupes={groupes.filter((x) => x.nature === 'bande')} onChoix={(id) => setVue({ ecran: 'sortie', groupe: id })}
          onSeul={() => setVue({ ecran: 'sortie', groupe: meTime?.id ?? SEUL })}
          onNouveau={() => setVue({ ecran: 'nouveau' })} onRetour={() => setVue({ ecran: 'liste' })} onClose={onClose} />
      : vue.ecran === 'sortie' ? <NouvelleSortie g={groupes.find((x) => x.id === vue.groupe) ?? groupeSeul()} onToast={onToast} onClose={onClose}
        onRetour={() => setVue(vue.groupe === SEUL ? { ecran: 'liste' } : { ecran: 'groupe', id: vue.groupe })}
        onFini={(id) => { const x = vueSorties(lire()).sorties.find((y) => y.id === id); if (x) ouvrir(x); }} />
      : g ? <UnGroupe g={g} plannings={plannings.filter((x) => x.groupe === g.id)} onRemplir={remplir} sorties={sorties.filter((x) => x.groupe === g.id)} traces={traces.filter((t) => t.groupe === g.id)}
        onToast={onToast} onOuvrir={voir} onTrace={(t) => onCarte({ traces: [t] })}
        onNouvelle={() => setVue({ ecran: 'sortie', groupe: g.id })} onRetour={() => setVue({ ecran: 'liste' })} onClose={onClose} />
        : <Liste e={e} groupes={groupes.filter((x) => !aDeux(x))} sorties={sorties} plannings={plannings} onRemplir={remplir} onOuvrir={(id) => setVue({ ecran: 'groupe', id })} onSortie={voir}
          onNouveau={() => setVue({ ecran: 'nouveau' })} onNouvelle={() => setVue({ ecran: 'sortie', groupe: '' })} onClose={onClose} onToast={onToast} />}
  </div>;
}

/** Sortie seul avant que le Groupe perso existe : le serveur le crée, sans nom, à la première (Seb, 26 novembre). */
const SEUL = 'seul';
const groupeSeul = (): Groupe => ({ id: SEUL, nom: '', nature: 'me_time', photo: null, modifie_le: '', membres: [], invitations: [] });

/** ＋ Sortie depuis la liste : seul, ou dans quel groupe ? */
/** Nom d'un nouveau Buddy count de groupe : le nom du groupe, puis « 2 », « 3 »… */
export function nomDeCount(g: Groupe, counts: { groupe?: string | null; supprime?: boolean }[]): string {
  const n = counts.filter((c) => c.groupe === g.id && !c.supprime).length;
  return n ? `${g.nom} ${n + 1}` : g.nom;
}

function ChoixGroupe({ groupes, onChoix, onSeul, onNouveau, onRetour, onClose }: {
  groupes: Groupe[]; onChoix: (id: string) => void; onSeul: () => void; onNouveau: () => void; onRetour: () => void; onClose: () => void;
}) {
  return <div className="bd-corps">
    <div className="xp-head">
      <button onClick={onRetour} aria-label="Retour">‹</button><h2>Nouvelle sortie</h2>
      <button onClick={onClose} aria-label="Fermer">✕</button>
    </div>
    <button className="bd-ligne" onClick={onSeul}>
      <Visage b={{ id: SEUL, pseudo: nomAffiche(), photo: lireCompte().profil?.photo ?? null }} taille={56} />
      <span className="bd-texte"><b>Seul</b><small>Mes sorties à moi</small></span>
    </button>
    <h3 className="bd-section">Dans quel groupe ?</h3>
    {groupes.map((g) => <button key={g.id} className="bd-ligne" onClick={() => onChoix(g.id)}>
      <Visage b={{ id: g.id, nom: g.nom, photo: g.photo }} taille={56} />
      <span className="bd-texte"><b>{g.nom}</b><small>{resume(g)}</small></span>
    </button>)}
    {!groupes.length && <p className="bd-vide">Pas encore de groupe : crée-le pour partir avec ta bande de copains.</p>}
    <span style={{ flex: 1 }} />
    <button className={groupes.length ? 'bd-grand' : 'primary bd-grand'} onClick={onNouveau}>＋ Groupe</button>
  </div>;
}

function Liste({ e, groupes, sorties, plannings, onRemplir, onOuvrir, onSortie, onNouveau, onNouvelle, onToast }: {
  e: Etat; groupes: Groupe[]; sorties: Sortie[]; plannings: Planning[]; onRemplir: (p: Planning) => void; onOuvrir: (id: string) => void; onSortie: (x: Sortie) => void;
  onNouveau: () => void; onNouvelle: () => void; onClose: () => void; onToast: (m: string) => void;
}) {
  const enAttente = e.attente.length;
  const haut = prochaine(sorties);
  const suppression = useSuppression();
  const nomGroupe = (x: Sortie) => groupes.find((g) => g.id === x.groupe)?.nom ?? '';
  const ch = useChoix(e, groupes, onToast, suppression.supprimer);
  return <div className="bd-corps">
    {ch.barre}
    {/* Pas de « à jour à … » (Seb, 26 novembre) : seulement ce qui attend le réseau. */}
    {enAttente > 0 && <p className="hint">🕓 {enAttente} changement{enAttente > 1 ? 's' : ''} partira au retour du réseau</p>}
    {rejointsEnAttente(e).length > 0 && <div className="acc-bandeau orange"><span>🕓</span><span>Invitation reçue : tu entreras dans le groupe au retour du réseau.</span></div>}
    {plannings.map((p) => <ARemplir key={p.id} p={p} avecNom onRemplir={() => onRemplir(p)} />)}
    {haut && <Affiche x={haut} onClick={() => onSortie(haut)} />}
    <h3 className="bd-section">Groupes</h3>
    {groupes.map((g) => <button key={g.id} className={`bd-ligne${ch.choisi({ groupe: g }) ? ' choisi' : ''}`} onClick={() => onOuvrir(g.id)}
      {...(g.nature === 'bande' ? ch.appui({ groupe: g }) : {})}>
      {g.nature === 'me_time' ? <Visage b={{ id: g.id, pseudo: nomAffiche(), photo: lireCompte().profil?.photo ?? null }} taille={56} />
        : <Visage b={{ id: g.id, nom: g.nom, photo: g.photo }} taille={56} />}
      {/* Plus de « 1 buddy · 1 invitation envoyée » sous le nom (Seb, 26/11) : juste le nom. */}
      <span className="bd-texte"><b>{g.nature === 'me_time' ? 'Seul' : g.nom}</b></span>
      <small className="bd-quand">{g.attente ? '🕓' : quand(g.modifie_le)}</small>
    </button>)}
    {sorties.length > 0 && <h3 className="bd-section">Sorties</h3>}
    {sorties.map((x) => <div key={x.id} className="bd-ligne-outils"><button className={`bd-ligne${ch.choisi({ sortie: x }) ? ' choisi' : ''}`}
      onClick={() => onSortie(x)} {...ch.appui({ sortie: x })}>
      <Carre x={x} />
      <span className="bd-texte"><b>{x.nom}</b>
        <small>{[nomGroupe(x), x.participants.length > 1 ? `${x.participants.length} partants` : '', x.fin < aujourdhui() ? 'sortie passée' : ''].filter(Boolean).join(' · ')}</small></span>
      {x.attente && <small className="bd-quand">🕓</small>}
    </button></div>)}
    {suppression.bandeau}
    <span style={{ flex: 1 }} />
    <div className="bd-plus">
      <button className="primary" onClick={onNouveau}>
        <span className="bd-plus-texte"><b>＋ Groupe</b></span></button>
      <button className="primary" onClick={onNouvelle}>
        <span className="bd-plus-texte"><b>＋ Sortie</b></span></button>
    </div>
  </div>;
}

function UnGroupe({ g, plannings, onRemplir, sorties, traces, onToast, onOuvrir, onTrace, onNouvelle, onRetour, onClose }: {
  g: Groupe; plannings: Planning[]; onRemplir: (p: Planning) => void; sorties: Sortie[]; traces: TraceBuddy[];
  onToast: (m: string) => void; onOuvrir: (x: Sortie) => void; onTrace: (t: TraceBuddy) => void; onNouvelle: () => void; onRetour: () => void; onClose: () => void;
}) {
  const [membres, setMembres] = useState(false);
  const [nommer, setNommer] = useState(false);
  const me = g.nature === 'me_time';
  const qr = g.invitations.find((i) => i.canal === 'qr')?.code;
  const auj = aujourdhui();
  const avenir = sorties.filter((x) => x.fin >= auj).sort((a, b) => a.debut.localeCompare(b.debut));
  const souvenirs = sorties.filter((x) => x.fin < auj).sort((a, b) => b.debut.localeCompare(a.debut));
  const suppression = useSuppression();
  const e = useBuddies();
  const ch = useChoix(e, [g], onToast, suppression.supprimer);
  return <div className="bd-corps">
    {ch.barre}
    <div className="xp-head">
      <button onClick={onRetour} aria-label="Retour">‹</button>
      <span className="bd-titre" onClick={() => setNommer(!me)}><b>{me ? 'Seul' : g.nom}</b><small>{me ? 'Mes sorties à moi' : nbBuddies(g)}{g.attente ? ' · 🕓 en attente du réseau' : ''}</small></span>
      {!me && <button className="bd-crayon" onClick={() => setNommer(true)} aria-label={`Changer le nom de ${g.nom}`}><PencilIcon size={18} /></button>}
      <button onClick={onClose} aria-label="Fermer">✕</button>
    </div>
    {nommer && <FeuilleNom titre="Nom du groupe" nom={g.nom}
      onEnregistrer={(n) => renommerGroupe(g.id, n)} onFermer={() => setNommer(false)} onToast={onToast} />}
    {!me && <button className="bd-visages" onClick={() => setMembres(true)} aria-label="Les buddies">
      {g.membres.map((m) => <Visage key={m.id} b={m} taille={34} />)}
      {g.invitations.filter((i) => i.canal !== 'qr').map((i) => <span key={i.id} className="bd-invite-visage"><Visage b={{ id: i.id, nom: i.nom, photo: null }} taille={34} /></span>)}
      <span className="bd-ajout">＋</span>
    </button>}
    {!me && <LigneAppel dest={{ groupe: g.id }} nom={g.nom} onToast={onToast} />}
    {plannings.map((p) => <ARemplir key={p.id} p={p} avecNom onRemplir={() => onRemplir(p)} />)}
    <h3 className="bd-section">À venir</h3>
    {avenir.length ? avenir.map((x) => <div key={x.id} className={`bd-affiche-outils${ch.choisi({ sortie: x }) ? ' choisi' : ''}`} {...ch.appui({ sortie: x })}>
      <Affiche x={x} onClick={() => onOuvrir(x)} /></div>)
      : <p className="bd-vide">Rien de prévu pour l’instant</p>}
    {/* Sorties passées, chacune sur toute la largeur (Seb, 26/11). */}
    {souvenirs.length > 0 && <><h3 className="bd-section">Sorties passées</h3>
      <div className="bd-passees">{souvenirs.map((x) => <div key={x.id} className={`bd-affiche-outils${ch.choisi({ sortie: x }) ? ' choisi' : ''}`} {...ch.appui({ sortie: x })}>
        <Affiche x={x} petite onClick={() => onOuvrir(x)} /></div>)}</div></>}
    {suppression.bandeau}
    {/* Plus de « Traces partagées » ici : les traces se partagent dans le chat pour l’instant (Seb, 26/11). */}
    <span style={{ flex: 1 }} />
    <div className="bd-plus">
      <button className="primary" onClick={onNouvelle}>
        <span className="bd-plus-texte"><b>＋ Sortie</b></span></button>
    </div>
    {membres && <Membres g={g} qr={qr} onToast={onToast} onFermer={() => setMembres(false)} onParti={onRetour} />}
  </div>;
}

/** Les buddies d'un groupe (toucher les visages) : inviter, nommer admin, retirer, quitter (spec §5.3, rôles §7.17). */
function Membres({ g, qr, onToast, onFermer, onParti }: { g: Groupe; qr?: string; onToast: (m: string) => void; onFermer: () => void; onParti: () => void }) {
  const e = lire();
  const admin = estAdmin(g, e);
  const principal = estAdminPrincipal(g, e);
  // Un admin retire un membre ; un admin, seul l'admin principal le retire ; l'admin principal, personne.
  const retirable = (b: Buddy) => b.role === 'admin_principal' ? false : b.role === 'admin' ? principal : admin;
  const [choisi, setChoisi] = useState<Buddy | null>(null);
  const moi = (b: Buddy) => b.id === e.moi || b.id === 'moi';
  return <div className="bd-voile" onClick={onFermer}><div className="bd-feuille" onClick={(ev) => ev.stopPropagation()}>
    <h3>Inviter mes copains</h3>
    <Inviter nomGroupe={g.nom} qrExistant={qr} onToast={onToast} onInvite={(i) => { inviter(g.id, i); if (i.canal !== 'qr') onToast(`Invitation envoyée à ${i.nom}`); }} />
    <h3>Dans la bande</h3>
    {g.membres.map((m) => <button key={m.id} className="bd-ligne petite" disabled={moi(m) || !(principal || retirable(m))} onClick={() => setChoisi(m)}>
      <Visage b={m} /><span className="bd-texte"><b>{m.pseudo}{moi(m) ? ' (toi)' : ''}</b>{m.role === 'admin_principal' ? <small>admin principal</small> : m.role === 'admin' && <small>admin</small>}</span>
    </button>)}
    {g.invitations.filter((i) => i.canal !== 'qr').map((i) => <div key={i.id} className="bd-ligne petite bd-invite">
      <Visage b={{ id: i.id, nom: i.nom, photo: null }} /><span className="bd-texte"><b>{i.nom}</b><small>{i.contact}</small></span>
      <small className="bd-etat">{i.attente ? '🕓 ' : ''}{CANAL[i.canal]}</small>
      <button aria-label="Annuler l'invitation" onClick={() => annulerInvitation(i.id)}>✕</button>
    </div>)}
    {choisi && <div className="bd-actions">
      <b>{choisi.pseudo}</b>
      {principal && choisi.role === 'membre' && <button onClick={() => { nommerAdmin(g.id, choisi.id); setChoisi(null); }}>Nommer admin</button>}
      {principal && choisi.role === 'admin' && <button onClick={() => { retirerAdmin(g.id, choisi.id); setChoisi(null); }}>N'est plus admin</button>}
      {principal && <button onClick={() => { transmettre(g.id, choisi.id); setChoisi(null); onToast(`${choisi.pseudo} devient admin principal`); }}>
        Lui passer mon rôle d'admin principal</button>}
      {retirable(choisi) && <button className="danger" onClick={() => { retirer(g.id, choisi.id); setChoisi(null); }}>Retirer de la bande</button>}
      <button onClick={() => setChoisi(null)}>Annuler</button>
    </div>}
    <button className="acc-deco" onClick={() => {
      if (!confirm(`Quitter « ${g.nom} » ?`)) return;
      quitter(g.id); onToast(`Tu as quitté « ${g.nom} »`); onParti();
    }}>Quitter le groupe</button>
    <button onClick={onFermer}>Fermer</button>
  </div></div>;
}

function ChoixPhoto({ photo, onPhoto, onToast, grand = false }: { photo: string | null; onPhoto: (p: string) => void; onToast: (m: string) => void; grand?: boolean }) {
  const fichier = useRef<HTMLInputElement>(null);
  return <>
    {grand
      ? <button className="bd-bandeau-photo" onClick={() => fichier.current?.click()} style={photo ? { background: `center/cover url("${photo}")` } : undefined}>
        <span>📷 {photo ? 'Changer' : 'Une photo'}</span></button>
      : <button className="bd-photo" onClick={() => fichier.current?.click()} aria-label="Photo">{photo ? <img src={photo} alt="" /> : '📷'}</button>}
    <input ref={fichier} type="file" accept="image/*" hidden onChange={(ev) => {
      const f = ev.target.files?.[0]; if (f) void reduire(f).then(onPhoto).catch(() => onToast('Photo illisible'));
    }} />
  </>;
}

/** Nouveau groupe (écran 20) : photo, nom, invitations, puis « Créer le groupe ». */
function Nouveau({ onToast, onFini, onRetour, onClose }: { onToast: (m: string) => void; onFini: (id: string) => void; onRetour: () => void; onClose: () => void }) {
  const [nom, setNom] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [invites, setInvites] = useState<NouvelleInvitation[]>([]);
  const compte = lireCompte();
  const creer = () => {
    try {
      const id = creerGroupe(nom, photo, invites);
      onToast(navigator.onLine ? `« ${nom.trim()} » est créé` : `« ${nom.trim()} » est créé sur ton téléphone ; il partira au retour du réseau`);
      onFini(id);
    } catch (err) { onToast(String((err as Error).message)); }
  };
  return <div className="bd-corps">
    <div className="xp-head">
      <button onClick={onRetour} aria-label="Retour">‹</button><h2>Nouveau groupe</h2>
      <button onClick={onClose} aria-label="Fermer">✕</button>
    </div>
    <ChoixPhoto photo={photo} onPhoto={setPhoto} onToast={onToast} />
    <input className="bd-nom" value={nom} maxLength={80} placeholder="Nom de la bande" onChange={(ev) => setNom(ev.target.value)} />
    <h3 className="bd-section">Inviter mes copains</h3>
    <Inviter nomGroupe={nom} qrExistant={invites.find((i) => i.canal === 'qr')?.code} onToast={onToast}
      onInvite={(i) => setInvites((l) => [...l, i])} />
    <h3 className="bd-section">Dans la bande <small>{1 + invites.filter((i) => i.canal !== 'qr').length} buddies</small></h3>
    <div className="bd-ligne petite"><Visage b={{ id: 'moi', pseudo: nomAffiche(compte), photo: compte.profil?.photo ?? null }} />
      <span className="bd-texte"><b>{nomAffiche(compte)} (toi)</b><small>crée le groupe</small></span></div>
    {invites.filter((i) => i.canal !== 'qr').map((i) => <div key={i.code} className="bd-ligne petite bd-invite">
      <Visage b={{ id: i.code, nom: i.nom, photo: null }} /><span className="bd-texte"><b>{i.nom}</b><small>{i.contact}</small></span>
      <small className="bd-etat">{CANAL[i.canal]}</small></div>)}
    <p className="hint">Ils reçoivent un lien : il installe l'appli et les fait entrer dans le groupe.</p>
    <span style={{ flex: 1 }} />
    <button className="primary bd-grand" disabled={!nom.trim()} onClick={creer}>Créer le groupe</button>
  </div>;
}

/**
 * Nouvelle sortie (écran 21) : elle naît quand on est sûr de partir. Dans un groupe, tout le monde est
 * coché, on décoche ceux qui ne viennent pas ; dans Me Time, on invite un ou deux copains à l'unité.
 */
function NouvelleSortie({ g, onToast, onFini, onRetour, onClose }: {
  g: Groupe; onToast: (m: string) => void; onFini: (id: string) => void; onRetour: () => void; onClose: () => void;
}) {
  const me = g.nature === 'me_time';
  const [nom, setNom] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [debut, setDebut] = useState(aujourdhui());
  const [fin, setFin] = useState(aujourdhui());
  const [lieu, setLieu] = useState('');
  const [qui, setQui] = useState<Set<string>>(() => new Set(g.membres.map((m) => m.id)));
  const [invites, setInvites] = useState<NouvelleInvitation[]>([]);
  const moiId = lire().moi ?? 'moi';
  const creer = () => {
    try {
      const id = creerSortie({ groupe: g.id, nom, photo, debut, fin, lieu, participants: [...qui].filter((x) => x !== moiId) }, invites);
      onToast(navigator.onLine ? `« ${nom.trim()} » est créé` : `« ${nom.trim()} » est créé sur ton téléphone ; il partira au retour du réseau`);
      onFini(id);
    } catch (err) { onToast(String((err as Error).message)); }
  };
  return <div className="bd-corps">
    <div className="xp-head">
      <button onClick={onRetour} aria-label="Retour">‹</button><h2>Nouvelle sortie</h2>
      <button onClick={onClose} aria-label="Fermer">✕</button>
    </div>
    <ChoixPhoto grand photo={photo} onPhoto={setPhoto} onToast={onToast} />
    <input className="bd-nom" value={nom} maxLength={80} placeholder="Week-end Queyras" onChange={(ev) => setNom(ev.target.value)} />
    <h3 className="bd-section">Quand</h3>
    <div className="bd-dates">
      <label>du<input type="date" value={debut} onChange={(ev) => { setDebut(ev.target.value); if (fin < ev.target.value) setFin(ev.target.value); }} /></label>
      <label>au<input type="date" value={fin} min={debut} onChange={(ev) => setFin(ev.target.value)} /></label>
    </div>
    <h3 className="bd-section">Avec qui <small>{me ? 'Seul' : `${g.nom} · ${qui.size} sur ${g.membres.length}`}</small></h3>
    {me ? <>
      <Inviter sortie nomGroupe={nom} qrExistant={invites.find((i) => i.canal === 'qr')?.code} onToast={onToast} onInvite={(i) => setInvites((l) => [...l, i])} />
      {invites.filter((i) => i.canal !== 'qr').map((i) => <div key={i.code} className="bd-ligne petite bd-invite">
        <Visage b={{ id: i.code, nom: i.nom, photo: null }} /><span className="bd-texte"><b>{i.nom}</b><small>{i.contact}</small></span>
        <small className="bd-etat">{CANAL[i.canal]}</small></div>)}
      {!invites.length && <p className="hint">Seul, ou invite un ou deux copains à cette sortie, sans créer de groupe.</p>}
    </> : <div className="bd-qui">
      {g.membres.map((m) => <button key={m.id} className={qui.has(m.id) ? 'oui' : ''} disabled={m.id === moiId}
        onClick={() => setQui((q) => { const n = new Set(q); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })}>
        <Visage b={m} taille={48} /><small>{qui.has(m.id) ? '✓' : '—'}</small></button>)}
    </div>}
    <h3 className="bd-section">Où <small>facultatif</small></h3>
    <input value={lieu} maxLength={120} placeholder="📍 Ceillac, Queyras" onChange={(ev) => setLieu(ev.target.value)} />
    <span style={{ flex: 1 }} />
    <button className="primary bd-grand" disabled={!nom.trim()} onClick={creer}>Créer la sortie</button>
  </div>;
}

// ------------------------------------------------------------------ sur la carte (écran 4)

/** Haut et bas de la carte d'une sortie : ‹ nom et dates en haut, bandeau rabattable en bas. */
export function BandeauSortie({ x, traces, parler, onRetour, onAlbum, onCarnet, onCount, onDodo, onToast, map }: {
  x: Sortie; traces: TraceBuddy[]; parler?: boolean; onRetour: () => void; onAlbum: () => void; onCarnet: () => void; onCount: () => void; onDodo: () => void;
  onToast: (m: string) => void; map: MlMap | null;
}) {
  // Bandeau réglé par la poignée (useSheet) : replié = cran réduit.
  const sheet = useSheet('buddyTime', { masque: false });
  const replie = sheet.cran === 0;
  const setReplie = (v: boolean) => sheet.setCran(v ? 0 : 1);
  // 💬 Écrans 6 et 24 : la conversation de la sortie, carte au-dessus ; repliée, seulement les derniers mots.
  const [msg, setMsg] = useState(!!parler);
  const [point, setPoint] = useState<{ lon: number; lat: number; nom: string } | null>(null);
  // 📍 Écran 15 : la position des buddies, à la place du bandeau (pendant la sortie).
  const [pos, setPos] = useState(false);
  const rs = useReperes(x);
  const visibles = nombreVisibles(rs);
  const eb = useBuddies();
  const v = vueSorties(eb);
  const photos = v.photos.filter((p) => p.sortie === x.id);
  const dernier = fil({ sortie: x.id }, v.messages, v.traces, v.hebergements).at(-1);
  const nouveaux = nonLus(eb, x.id, v.messages);
  const nomDe = (id: string) => x.participants.find((p) => p.id === id)?.pseudo ?? '?';
  const voirTrace = (t: TraceBuddy) => {
    setReplie(true);
    const lons = t.ligne.map((p) => p[0]), lats = t.ligne.map((p) => p[1]);
    map?.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 70, maxZoom: 15, duration: 600 });
  };
  const depense = v.depenses.filter((d) => d.sortie === x.id && !d.remb).reduce((n, d) => n + d.montant, 0);
  const hebergements = v.hebergements.filter((h) => h.sortie === x.id);
  const retenu = hebergements.find((h) => h.retenu);
  const auteurs = new Set(photos.map((p) => p.par.id)).size;
  const km = traces.reduce((n, t) => n + longueur(t.ligne), 0) / 1000;
  const venir = x.fin >= aujourdhui();
  // ✏ Toucher le nom pour le changer (Seb, 25 novembre) : le nom à jour vient du stockage, pas de la copie ouverte.
  const nom = v.sorties.find((y) => y.id === x.id)?.nom ?? x.nom;
  const [titre, setTitre] = useState<string | null>(null);
  const valider = () => {
    try { if (titre !== null && titre.trim() !== nom) renommerSortie(x.id, titre); setTitre(null); } catch (err) { onToast((err as Error).message); }
  };
  // Poubelle (Seb, 25 novembre) : pour celui qui l'a créé ou un admin du groupe. Supprimé tout de suite,
  // « Annuler » 10 secondes (le serveur garde tout), puis retour aux Buddies.
  const [supprime, setSupprime] = useState<Sortie | null>(null);
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (minuteur.current) clearTimeout(minuteur.current); }, []);
  const supprimer = () => {
    setSupprime(v.sorties.find((y) => y.id === x.id) ?? x);
    supprimerSortie(x.id);
    minuteur.current = setTimeout(onRetour, 10000);
  };
  const annulerSuppression = () => {
    if (minuteur.current) clearTimeout(minuteur.current);
    if (supprime) remettreSortie(supprime);
    setSupprime(null);
  };
  if (supprime) return <>
    <div className="bd-carte-haut">
      <span className="bd-texte"><b>{nom}</b><small>Sortie supprimé</small></span>
    </div>
    <div className="bd-carte-bas"><div className="bd-bandeau">Sortie supprimé
      <button className="bd-lien" onClick={annulerSuppression}>Annuler</button></div></div>
  </>;
  if (titre !== null) return <>
    <div className="bd-carte-haut">
      <button onClick={() => setTitre(null)} aria-label="Annuler">✕</button>
      <input className="bd-titre" value={titre} maxLength={80} autoFocus aria-label="Nom de la sortie"
        onChange={(ev) => setTitre(ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Enter') valider(); }} />
      <button className="primary" onClick={valider} aria-label="Valider le nom">✓</button>
    </div>
  </>;
  return <>
    <div className="bd-carte-haut">
      <span className="bd-texte" onClick={() => setTitre(nom)}><b>{nom}</b><small>{pos ? `📍 ${visibles || 'aucun'} ${visibles > 1 ? 'buddies visibles' : 'buddy visible'}`
        : msg ? `💬 ${x.participants.length} ${x.participants.length > 1 ? 'buddies' : 'buddy'} + Bud` : `${dates(x)}${x.lieu ? ` · ${x.lieu}` : ''}`}</small></span>
      <button onClick={() => setTitre(nom)} aria-label="Changer le nom"><PencilIcon size={18} /></button>
      {peutSupprimer(x, eb) && <button onClick={supprimer} aria-label="Supprimer la sortie"><TrashIcon size={18} /></button>}
    </div>
    <div className={`bd-carte-bas${replie && !msg ? ' replie' : ''}${msg ? ' bd-carte-msg' : ''}${sheet.classe}`}>
      <div {...sheet.prise} aria-label="Régler la hauteur du bandeau"><div className="handle" /></div>
      {msg && <>
        {!replie && <div className="bd-entre"><b className="bd-gros">💬 Messagerie</b><button className="bd-lien" onClick={() => { setMsg(false); setPoint(null); }}>Retour</button></div>}
        <Conversation dest={{ sortie: x.id }} membres={x.participants} sortie={x} court={replie} onToast={onToast}
          onPoint={(p) => { setPoint(p); setReplie(true); }} onTrace={voirTrace} onPhoto={onAlbum}
          onHebergement={(h) => (h.lon != null && h.lat != null ? (setPoint({ lon: h.lon, lat: h.lat, nom: h.nom }), setReplie(true)) : onDodo())} />
      </>}
      {!replie && pos && !msg && <>
        <div className="bd-entre"><b className="bd-gros">📍 Position des buddies</b><button className="bd-lien" onClick={() => setPos(false)}>Retour</button></div>
        <BandePositions x={x} onToast={onToast} />
      </>}
      {!replie && !pos && !msg && <>
        <b className="bd-carte-quand">{quandSortie(x)}</b>
        <div className="bd-carte-qui">
          {x.participants.map((p) => <Visage key={p.id} b={p} taille={30} />)}
          <small>{x.participants.length} partant{x.participants.length > 1 ? 's' : ''}{x.invitations.length ? ` · ${x.invitations.filter((i) => i.canal !== 'qr').map((i) => `${i.nom} ?`).join(' · ')}` : ''}</small>
        </div>
        <div className="bd-chiffres">
          <span><b>{traces.length ? `${km.toFixed(km < 10 ? 1 : 0)} km` : '—'}</b><small>{traces.length > 1 ? `${traces.length} traces` : 'parcours'}</small></span>
          <span><b>{venir ? Math.max(0, joursAvant(x)) : '✓'}</b><small>{venir ? 'jours avant' : 'sortie passée'}</small></span>
          <button className="bd-chiffre-count" onClick={onCount}><b>💶 {depense ? euros(depense) : '＋'}</b><small>{depense ? `à ${x.participants.length}` : 'Buddy count'}</small></button>
        </div>
        {x.participants.length > 1 && <button className="bd-ligne bd-pos-acces" onClick={() => setMsg(true)}>
          <span className="bd-icone">💬</span>
          <span className="bd-texte"><b>Messagerie{nouveaux ? ` · ${nouveaux} nouveau${nouveaux > 1 ? 'x' : ''}` : ''}</b>
            <small>{dernier ? apercu(dernier, nomDe, eb.moi ?? 'moi') : 'écrire aux buddies'}</small></span>
          <span className="bd-fleche">›</span>
        </button>}
        {x.participants.length > 1 && <LigneAppel dest={{ sortie: x.id }} nom={x.nom} onToast={onToast} />}
        {venir && <button className="bd-ligne bd-pos-acces" onClick={onDodo}>
          <span className="bd-icone">🏨</span>
          <span className="bd-texte"><b>{retenu ? `${retenu.nom} ✅` : 'Où on dort ?'}</b>
            <small>{retenu ? prixHebergement(retenu) : hebergements.length ? `${hebergements.length} idée${hebergements.length > 1 ? 's' : ''} · mettez vos ♥` : 'proposer un hébergement'}</small></span>
          <span className="bd-fleche">›</span>
        </button>}
        {pendant(x, aujourdhui()) && <button className="bd-ligne bd-pos-acces" onClick={() => setPos(true)}>
          <span className="bd-icone">📍</span>
          <span className="bd-texte"><b>Position des buddies</b><small>{visibles ? `${visibles} visible${visibles > 1 ? 's' : ''}` : 'qui veut se montrer enfonce son épingle'}
            {rs.some((r) => r.moi && r.actif) ? ' · tu es visible' : ''}</small></span>
          <span className="bd-fleche">›</span>
        </button>}
        {/* 👥 Traces associées, et en associer une de 📂 Mes traces (Seb, 25/11). */}
        <TracesAssociees x={x} traces={v.traces.filter((t) => t.sortie === x.id)} onVoir={voirTrace} onToast={onToast} />
        {photos.length > 0 && <button className="bd-bande-photos" onClick={onAlbum}>
          <span className="bd-section"><b>📸 {photos.length} photo{photos.length > 1 ? 's' : ''}</b><small>de {auteurs} {auteurs > 1 ? 'buddies' : 'buddy'}</small></span>
          <span className="bd-bande-images">{photos.slice(0, 4).map((p, i) => <span key={p.id} className="bd-bande-image"><PhotoImage p={p} />
            {i === 3 && photos.length > 4 && <b>+{photos.length - 3}</b>}</span>)}</span>
        </button>}
        {x.debut <= aujourdhui() && <div className="bd-plus">
          <BoutonDeposer x={x} onToast={onToast} texte="📷 Ajouter" className="primary" />
          <button onClick={onAlbum}>📸 Album</button>
          <button onClick={onCarnet}>📖 Carnet</button>
        </div>}
      </>}
    </div>
    <PhotosSurCarte map={map} photos={photos} />
    <PositionsSurCarte map={map} x={x} />
    <HebergementsSurCarte map={map} hebergements={hebergements} />
    <PointSurCarte map={map} p={point} />
  </>;
}

function longueur(l: [number, number][]) {
  let m = 0;
  for (let i = 1; i < l.length; i++) {
    const [a, b] = [l[i - 1], l[i]];
    const k = Math.PI / 180, x = (b[0] - a[0]) * k * Math.cos(((a[1] + b[1]) / 2) * k), y = (b[1] - a[1]) * k;
    m += Math.sqrt(x * x + y * y) * 6371e3;
  }
  return m;
}

// ------------------------------------------------------------------ panneau de partage (écran 22, spec §3.4)

/**
 * Le même panneau partout : « Dans une sortie » (les plus actifs), « Ou à mes buddies » (mes groupes),
 * un petit mot, un seul bouton Partager, puis « Ou ailleurs » (les autres applis du téléphone).
 * Les copains un par un arriveront avec la messagerie : aujourd'hui une trace se range dans une sortie ou un groupe.
 */
export function PartagePanel({ nom, ligne, hebergement, onAilleurs, onFermer, onToast }: {
  nom: string; ligne: [number, number][]; onAilleurs: () => void; onFermer: () => void; onToast: (m: string) => void;
  /** Un hébergement trouvé (écran 23) : il se range dans les sorties choisies, où je pars. */
  hebergement?: Lodging;
}) {
  const e = useBuddies();
  const compte = useCompte();
  const [choix, setChoix] = useState<Set<string>>(new Set());
  const [tous, setTous] = useState(false);
  const [mot, setMot] = useState('');
  const auj = aujourdhui();
  const { sorties } = vueSorties(e);
  // À venir ou en cours d'abord, puis les plus récemment actives.
  const moi = e.moi ?? 'moi';
  const actives = [...sorties].filter((x) => !hebergement || (x.fin >= auj && x.participants.some((p) => p.id === moi || p.id === 'moi')))
    .sort((a, b) => Number(b.fin >= auj) - Number(a.fin >= auj) || b.modifie_le.localeCompare(a.modifie_le)).slice(0, 6);
  const groupes = hebergement ? [] : appliquer(e).filter((g) => g.nature === 'bande');
  const basculer = (id: string) => setChoix((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const partager = () => {
    const ids = [...choix];
    if (hebergement) {
      void proposer(ids, hebergement);
      onToast(navigator.onLine ? `« ${nom} » proposé à tes buddies` : `« ${nom} » partira au retour du réseau 🕓`);
      onFermer();
      return;
    }
    partagerTrace(nom, ligne, mot.trim(), { sorties: ids.filter((id) => sorties.some((x) => x.id === id)), groupes: ids.filter((id) => groupes.some((g) => g.id === id)) });
    onToast(navigator.onLine ? `« ${nom} » partagée` : `« ${nom} » partira au retour du réseau 🕓`);
    onFermer();
  };
  return <div className="bd-voile" onClick={onFermer}><div className="bd-feuille bd-partage" onClick={(ev) => ev.stopPropagation()}>
    <div className="xp-head"><h3>Partager « {nom} »</h3><small className="bd-quand">{hebergement ? prixHebergement(hebergement)
      : `${(longueur(ligne) / 1000).toFixed(1)} km`}</small></div>
    {connecte(compte) ? <>
      {actives.length > 0 && <><h3 className="bd-section">Dans une sortie <small>les plus actives</small></h3>
        <div className="bd-defile">{actives.map((x) => <button key={x.id} className={`bd-tuile${choix.has(x.id) ? ' oui' : ''}`} onClick={() => basculer(x.id)}>
          <Carre x={x} taille={88} /><small>{x.nom}</small></button>)}</div></>}
      {groupes.length > 0 && <><h3 className="bd-section">Ou à mes buddies</h3>
        <div className="bd-defile">{(tous ? groupes : groupes.slice(0, 5)).map((g) => <button key={g.id} className={`bd-tuile rond${choix.has(g.id) ? ' oui' : ''}`} onClick={() => basculer(g.id)}>
          <Visage b={{ id: g.id, nom: g.nom, photo: g.photo }} taille={56} /><small>{g.nom}</small></button>)}
          {!tous && groupes.length > 5 && <button className="bd-tuile rond" onClick={() => setTous(true)}><span className="bd-ajout">⋯</span><small>Tous</small></button>}</div></>}
      {!actives.length && !groupes.length && <p className="hint">{hebergement ? 'Crée une sortie (👥) pour y proposer un hébergement à tes buddies.'
        : 'Crée un groupe ou une sortie (👥) pour y partager tes traces.'}</p>}
      <input value={mot} maxLength={300} placeholder="Un petit mot (facultatif)…" onChange={(ev) => setMot(ev.target.value)} />
      <button className="primary bd-grand" disabled={!choix.size} onClick={partager}>Partager</button>
    </> : <p className="hint">Connecte-toi (👤) pour partager tes traces avec tes buddies.</p>}
    <h3 className="bd-section">Ou ailleurs</h3>
    <button className="bd-ligne petite" onClick={() => { onFermer(); onAilleurs(); }}><span className="bd-ajout">⋯</span>
      <span className="bd-texte"><b>{hebergement ? 'WhatsApp, mail, SMS…' : 'WhatsApp, mail, fichier GPX…'}</b><small>les autres applis du téléphone</small></span></button>
  </div></div>;
}
