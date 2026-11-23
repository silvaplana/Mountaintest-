import { useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import qrcode from 'qrcode-generator';
import { connecte, lire as lireCompte, nomAffiche, SCHEMA } from '../compte/auth';
import { useCompte } from '../Account';
import { ARemplir, MesDispos, NouveauPlanning, Plannings, UnPlanning } from './Planning';
import {
  annulerInvitation, appliquer, aujourdhui, creerGroupe, creerSortie, estAdmin, inviter, joursAvant, lien, lire, marquerVu, nommerAdmin,
  nouveauCode, partagerTrace, prochaine, quitter, rejoindre, rejointsEnAttente, retirer, suivre, synchroniser, vue as vueSorties,
  type Buddy, type Canal, type Etat, type Groupe, type NouvelleInvitation, type Planning, type Sortie, type TraceBuddy,
} from './store';

/**
 * Buddies (spec/buddies.md) : la liste façon WhatsApp (écran 2), un Buddy Group (3), nouveau Buddy Group et
 * invitations (20), nouveau Buddy Time (21), le bandeau d'un Buddy Time sur la carte (4) et le panneau de
 * partage (22). Mêmes écrans côté Kotlin (BuddiesPanel.kt, SharePanel.kt).
 */

const Natif = registerPlugin<{
  pickContact(): Promise<{ nom: string; telephone: string }>;
  sms(o: { numero: string; texte: string }): Promise<void>;
  mail(o: { adresse: string; sujet: string; texte: string }): Promise<void>;
}>('Buddies');

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
    onToast(connecte() ? 'Invitation reçue : tu entres dans le Buddy Group' : 'Connecte-toi (👤) pour entrer dans le Buddy Group');
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
const couleur = (id: string) => COULEURS[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % COULEURS.length];

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

function heure(ms?: number) {
  if (!ms) return 'pas encore synchronisé';
  const d = new Date(ms), h = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
  return d.toDateString() === new Date().toDateString() ? `à jour à ${h}` : `à jour le ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} ${h}`;
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

/** Colonne d'icônes à droite (spec §3.3). Ce qui n'est pas encore construit le dit simplement. */
function Colonne({ onToast, onExpenses, onLodging, onPlanning }: {
  onToast: (m: string) => void; onExpenses: () => void; onLodging: () => void; onPlanning?: () => void;
}) {
  const bientot = (m: string) => () => onToast(`Bientôt : ${m}`);
  return <div className="bd-colonne">
    <button aria-label="Appel" onClick={bientot('appeler toute la bande')}>📞</button>
    <button aria-label="Planning" onClick={onPlanning ?? (() => onToast('Connecte-toi (👤) pour les plannings de saison'))}>📅</button>
    <button aria-label="Messagerie" onClick={bientot('la messagerie de la bande')}>💬</button>
    <button aria-label="Album photo" onClick={bientot('l’album photo')}>📸</button>
    <button aria-label="Buddy count" onClick={onExpenses}>💶</button>
    <button aria-label="Hébergement" onClick={onLodging}>🏨</button>
  </div>;
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
 * Les quatre façons d'inviter (écran 20) : Contacts, Mail, Téléphone, QR code. On n'invite que des gens qu'on
 * connaît, jamais par recherche (spec §3.5). Le message part tout de suite, même sans réseau ; l'invitation
 * est enregistrée par `onInvite` (et envoyée au serveur au retour du réseau).
 */
function Inviter({ nomGroupe, qrExistant, onInvite, onToast, sortie = false }: {
  nomGroupe: string; qrExistant?: string; onInvite: (i: NouvelleInvitation) => void; onToast: (m: string) => void;
  /** Invitation à un Buddy Time (une sortie de Me Time) plutôt qu'à un Buddy Group. */
  sortie?: boolean;
}) {
  const [form, setForm] = useState<Formulaire | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const texte = (code: string) => `${nomAffiche()} t'invite ${sortie ? 'à' : 'dans'} « ${nomGroupe} » sur Mountain Buddies, pour nos sorties montagne : ${lien(code)}`;
  const pret = () => { if (!nomGroupe.trim()) { onToast(`Donne d’abord un nom au ${sortie ? 'Buddy Time' : 'Buddy Group'}`); return false; } return true; };

  const envoyer = async (canal: Canal, nom: string, contact: string) => {
    const code = nouveauCode();
    try {
      if (canal === 'mail') {
        const sujet = `${nomAffiche()} t'invite ${sortie ? 'à' : 'dans'} « ${nomGroupe} »`;
        if (Capacitor.isNativePlatform()) await Natif.mail({ adresse: contact, sujet, texte: texte(code) });
        else window.location.href = `mailto:${encodeURIComponent(contact)}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(texte(code))}`;
      } else if (Capacitor.isNativePlatform()) await Natif.sms({ numero: contact, texte: texte(code) });
      else window.location.href = `sms:${encodeURIComponent(contact)}?body=${encodeURIComponent(texte(code))}`;
    } catch (err) { onToast(String((err as Error).message)); return; }
    onInvite({ canal, nom: nom.trim() || contact, contact, code });
    setForm(null);
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
      <button onClick={() => { if (pret()) setForm({ canal: 'mail', nom: '', contact: '' }); }}><span>✉️</span>Mail</button>
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

// ------------------------------------------------------------------ Buddy Times

const MOIS = ['JANV', 'FÉVR', 'MARS', 'AVR', 'MAI', 'JUIN', 'JUIL', 'AOÛT', 'SEPT', 'OCT', 'NOV', 'DÉC'];
const jourMois = (d: string) => ({ j: String(+d.slice(8, 10)), m: MOIS[+d.slice(5, 7) - 1] ?? '' });
const dateCourte = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
export function dates(x: Sortie) { return x.fin === x.debut ? dateCourte(x.debut) : `${dateCourte(x.debut)} – ${dateCourte(x.fin)}`; }
export function quandSortie(x: Sortie) {
  const n = joursAvant(x);
  if (x.fin < aujourdhui()) return 'Souvenir';
  if (n <= 0) return 'En cours';
  return n === 1 ? 'Demain' : `Dans ${n} jours`;
}

/** Photo carrée datée (même code dans la liste, le groupe et le panneau de partage). */
function Carre({ x, taille = 56 }: { x: Sortie; taille?: number }) {
  const { j, m } = jourMois(x.debut);
  return <span className="bd-carre" style={{ width: taille, height: taille, background: x.photo ? `center/cover url("${x.photo}")` : couleur(x.id) }}>
    <span className="bd-date"><small>{m}</small><b>{j}</b></span></span>;
}

/** Grande image d'un Buddy Time (le prochain en haut de la liste, les cartes d'un groupe). */
function Affiche({ x, petite = false, onClick }: { x: Sortie; petite?: boolean; onClick: () => void }) {
  return <button className={`bd-affiche${petite ? ' petite' : ''}`} onClick={onClick}
    style={{ background: x.photo ? `linear-gradient(#0000 40%, #000a), center/cover url("${x.photo}")` : `linear-gradient(#0000 30%, #0008), ${couleur(x.id)}` }}>
    {!petite && <span className="bd-pastille">{quandSortie(x)}</span>}
    <b>{x.nom}</b>
    <small>{petite ? dateCourte(x.debut) : `${dates(x)} · ${x.participants.length} partant${x.participants.length > 1 ? 's' : ''}`}{x.attente ? ' · 🕓' : ''}</small>
  </button>;
}

type Vue = { ecran: 'liste' } | { ecran: 'groupe'; id: string } | { ecran: 'nouveau' } | { ecran: 'sortie'; groupe: string }
  | { ecran: 'plannings'; groupe?: string } | { ecran: 'planning'; id: string; groupe?: string } | { ecran: 'dispos'; id: string; groupe?: string }
  | { ecran: 'nvPlanning'; groupe?: string };

export function Buddies({ onClose, onToast, onAccount, onExpenses, onLodging, onCarte, depart }: {
  onClose: () => void; onToast: (m: string) => void; onAccount: () => void; onExpenses: () => void; onLodging: () => void;
  /** Ouvrir un Buddy Time sur la carte (écran 4), ou une trace partagée dans un groupe. */
  onCarte: (x: { sortie?: Sortie; traces: TraceBuddy[] }) => void;
  /** Revenir sur un Buddy Group (‹ depuis la carte d'un Buddy Time). */
  depart?: string;
}) {
  const e = useBuddies();
  const compte = useCompte();
  const [vue, setVue] = useState<Vue>(depart ? { ecran: 'groupe', id: depart } : { ecran: 'liste' });
  // Ouvert : on regarde les nouveautés toutes les minutes ; fermé, la pastille de 👥 repart de maintenant.
  useEffect(() => {
    const sync = () => { void synchroniser().then((r) => r.forEach(onToast)).catch(() => undefined); };
    sync();
    const t = setInterval(sync, 60_000);
    return () => { clearInterval(t); marquerVu(); };
  }, [onToast]);

  if (!connecte(compte)) {
    const colonne = <Colonne onToast={onToast} onExpenses={onExpenses} onLodging={onLodging} />;
    return <div className="buddies">{colonne}<div className="bd-corps">
      <div className="xp-head"><h2>Buddies</h2><button onClick={onClose} aria-label="Fermer">✕</button></div>
      <p className="bd-vide">Connecte-toi pour retrouver tes copains, créer tes Buddy Groups et partager vos sorties.</p>
      <button className="primary bd-grand" onClick={onAccount}>👤 Me connecter</button>
      {rejointsEnAttente(e).length > 0 && <p className="hint">🕓 Une invitation t'attend : elle s'ouvrira une fois connecté.</p>}
    </div></div>;
  }

  const groupes = appliquer(e);
  const { sorties, traces, plannings } = vueSorties(e);
  const ouvrir = (x: Sortie) => onCarte({ sortie: x, traces: traces.filter((t) => t.sortie === x.id) });
  const g = vue.ecran === 'groupe' ? groupes.find((x) => x.id === vue.id) : undefined;
  const meTime = groupes.find((x) => x.nature === 'me_time')!;
  // 📅 : les plannings du Buddy Group ouvert, sinon de toutes mes bandes (spec §5.5).
  const ici = 'groupe' in vue ? vue.groupe : vue.ecran === 'groupe' ? vue.id : undefined;
  const colonne = <Colonne onToast={onToast} onExpenses={onExpenses} onLodging={onLodging}
    onPlanning={() => setVue({ ecran: 'plannings', groupe: ici && ici !== meTime.id ? ici : undefined })} />;
  const retourPlannings = (gid?: string) => setVue({ ecran: 'plannings', groupe: gid });
  const pl = 'id' in vue && (vue.ecran === 'planning' || vue.ecran === 'dispos') ? plannings.find((x) => x.id === vue.id) : undefined;
  const remplir = (x: Planning) => setVue({ ecran: 'dispos', id: x.id, groupe: x.groupe });
  return <div className="buddies">
    {colonne}
    {vue.ecran === 'plannings' ? <Plannings plannings={plannings.filter((x) => !vue.groupe || x.groupe === vue.groupe)} groupes={groupes}
      onOuvrir={(id) => setVue({ ecran: 'planning', id, groupe: vue.groupe })} onRemplir={(id) => setVue({ ecran: 'dispos', id, groupe: vue.groupe })}
      onNouveau={() => setVue({ ecran: 'nvPlanning', groupe: vue.groupe })} onClose={onClose}
      onRetour={() => setVue(vue.groupe ? { ecran: 'groupe', id: vue.groupe } : { ecran: 'liste' })} />
      : vue.ecran === 'nvPlanning' ? <NouveauPlanning groupes={groupes} groupe={vue.groupe} onToast={onToast} onClose={onClose}
        onFini={(id) => setVue({ ecran: 'planning', id, groupe: vue.groupe })} onRetour={() => retourPlannings(vue.groupe)} />
      : vue.ecran === 'planning' && pl ? <UnPlanning p={pl} g={groupes.find((x) => x.id === pl.groupe)} sorties={sorties} onToast={onToast} onClose={onClose}
        onSortie={ouvrir} onRemplir={() => setVue({ ecran: 'dispos', id: pl.id, groupe: vue.groupe })} onRetour={() => retourPlannings(vue.groupe)} />
      : vue.ecran === 'dispos' && pl ? <MesDispos p={pl} onClose={onClose} onRetour={() => setVue({ ecran: 'planning', id: pl.id, groupe: vue.groupe })} />
      : vue.ecran === 'nouveau' ? <Nouveau onToast={onToast} onFini={(id) => setVue({ ecran: 'groupe', id })} onRetour={() => setVue({ ecran: 'liste' })} onClose={onClose} />
      : vue.ecran === 'sortie' ? <NouvelleSortie g={groupes.find((x) => x.id === vue.groupe) ?? meTime} onToast={onToast} onClose={onClose}
        onRetour={() => setVue(vue.groupe === meTime.id ? { ecran: 'liste' } : { ecran: 'groupe', id: vue.groupe })}
        onFini={(id) => { const x = vueSorties(lire()).sorties.find((y) => y.id === id); if (x) ouvrir(x); }} />
      : g ? <UnGroupe g={g} plannings={plannings.filter((x) => x.groupe === g.id)} onRemplir={remplir} sorties={sorties.filter((x) => x.groupe === g.id)} traces={traces.filter((t) => t.groupe === g.id)}
        onToast={onToast} onOuvrir={ouvrir} onTrace={(t) => onCarte({ traces: [t] })}
        onNouvelle={() => setVue({ ecran: 'sortie', groupe: g.id })} onRetour={() => setVue({ ecran: 'liste' })} onClose={onClose} />
        : <Liste e={e} groupes={groupes} sorties={sorties} plannings={plannings} onRemplir={remplir} onOuvrir={(id) => setVue({ ecran: 'groupe', id })} onSortie={ouvrir}
          onNouveau={() => setVue({ ecran: 'nouveau' })} onNouvelle={() => setVue({ ecran: 'sortie', groupe: meTime.id })} onClose={onClose} />}
  </div>;
}

function Liste({ e, groupes, sorties, plannings, onRemplir, onOuvrir, onSortie, onNouveau, onNouvelle, onClose }: {
  e: Etat; groupes: Groupe[]; sorties: Sortie[]; plannings: Planning[]; onRemplir: (p: Planning) => void; onOuvrir: (id: string) => void; onSortie: (x: Sortie) => void;
  onNouveau: () => void; onNouvelle: () => void; onClose: () => void;
}) {
  const enAttente = e.attente.length;
  const haut = prochaine(sorties);
  const nomGroupe = (x: Sortie) => groupes.find((g) => g.id === x.groupe)?.nom ?? '';
  return <div className="bd-corps">
    <div className="xp-head"><h2>Buddies</h2><button onClick={onClose} aria-label="Fermer">✕</button></div>
    <p className="hint">{enAttente ? `🕓 ${enAttente} changement${enAttente > 1 ? 's' : ''} partira au retour du réseau · ` : ''}{heure(e.synchro)}</p>
    {rejointsEnAttente(e).length > 0 && <div className="acc-bandeau orange"><span>🕓</span><span>Invitation reçue : tu entreras dans le groupe au retour du réseau.</span></div>}
    {plannings.map((p) => <ARemplir key={p.id} p={p} avecNom onRemplir={() => onRemplir(p)} />)}
    {haut && <Affiche x={haut} onClick={() => onSortie(haut)} />}
    <h3 className="bd-section">Buddy Groups</h3>
    {groupes.map((g) => <button key={g.id} className="bd-ligne" onClick={() => onOuvrir(g.id)}>
      {g.nature === 'me_time' ? <Visage b={{ id: g.id, pseudo: nomAffiche(), photo: lireCompte().profil?.photo ?? null }} taille={56} />
        : <Visage b={{ id: g.id, nom: g.nom, photo: g.photo }} taille={56} />}
      <span className="bd-texte"><b>{g.nom}</b>
        <small>{g.nature === 'me_time' ? 'Mes sorties à moi' : resume(g)}</small></span>
      <small className="bd-quand">{g.attente ? '🕓' : quand(g.modifie_le)}</small>
    </button>)}
    {sorties.length > 0 && <h3 className="bd-section">Buddy Times</h3>}
    {sorties.map((x) => <button key={x.id} className="bd-ligne" onClick={() => onSortie(x)}>
      <Carre x={x} />
      <span className="bd-texte"><b>{x.nom}</b>
        <small>{[nomGroupe(x), x.participants.length > 1 ? `${x.participants.length} partants` : '', x.fin < aujourdhui() ? 'souvenir' : ''].filter(Boolean).join(' · ')}</small></span>
      <small className="bd-quand">{x.attente ? '🕓' : quand(x.modifie_le)}</small>
    </button>)}
    <span style={{ flex: 1 }} />
    <div className="bd-plus">
      <button className="primary" onClick={onNouveau}><span className="bd-faces"><i /><i /><i /></span>
        <span className="bd-plus-texte"><b>＋ Buddy Group</b><small>une bande</small></span></button>
      <button className="primary" onClick={onNouvelle}><span className="bd-mini-carre">{jourMois(aujourdhui()).j}</span>
        <span className="bd-plus-texte"><b>＋ Buddy Time</b><small>une sortie</small></span></button>
    </div>
  </div>;
}

function UnGroupe({ g, plannings, onRemplir, sorties, traces, onToast, onOuvrir, onTrace, onNouvelle, onRetour, onClose }: {
  g: Groupe; plannings: Planning[]; onRemplir: (p: Planning) => void; sorties: Sortie[]; traces: TraceBuddy[];
  onToast: (m: string) => void; onOuvrir: (x: Sortie) => void; onTrace: (t: TraceBuddy) => void; onNouvelle: () => void; onRetour: () => void; onClose: () => void;
}) {
  const [membres, setMembres] = useState(false);
  const me = g.nature === 'me_time';
  const qr = g.invitations.find((i) => i.canal === 'qr')?.code;
  const auj = aujourdhui();
  const avenir = sorties.filter((x) => x.fin >= auj).sort((a, b) => a.debut.localeCompare(b.debut));
  const souvenirs = sorties.filter((x) => x.fin < auj).sort((a, b) => b.debut.localeCompare(a.debut));
  return <div className="bd-corps">
    <div className="xp-head">
      <button onClick={onRetour} aria-label="Retour">‹</button>
      <span className="bd-titre"><b>{g.nom}</b><small>{me ? 'Mes sorties à moi' : `Buddy Group · ${g.membres.length} buddies`}{g.attente ? ' · 🕓 en attente du réseau' : ''}</small></span>
      <button onClick={onClose} aria-label="Fermer">✕</button>
    </div>
    {!me && <button className="bd-visages" onClick={() => setMembres(true)} aria-label="Les buddies">
      {g.membres.map((m) => <Visage key={m.id} b={m} taille={34} />)}
      {g.invitations.filter((i) => i.canal !== 'qr').map((i) => <span key={i.id} className="bd-invite-visage"><Visage b={{ id: i.id, nom: i.nom, photo: null }} taille={34} /></span>)}
      <span className="bd-ajout">＋</span>
    </button>}
    {plannings.map((p) => <ARemplir key={p.id} p={p} avecNom onRemplir={() => onRemplir(p)} />)}
    <h3 className="bd-section">À venir</h3>
    {avenir.length ? avenir.map((x) => <Affiche key={x.id} x={x} onClick={() => onOuvrir(x)} />)
      : <p className="bd-vide">{me ? 'Tes sorties à toi, seul ou avec un ou deux copains invités.' : 'Rien de prévu pour l’instant : ＋ Buddy Time quand vous êtes sûrs de partir.'}</p>}
    {souvenirs.length > 0 && <><h3 className="bd-section">Souvenirs</h3>
      <div className="bd-grille">{souvenirs.map((x) => <Affiche key={x.id} x={x} petite onClick={() => onOuvrir(x)} />)}</div></>}
    {traces.length > 0 && <><h3 className="bd-section">Traces partagées</h3>
      {traces.map((t) => <button key={t.id} className="bd-ligne petite" onClick={() => onTrace(t)}>
        <Visage b={t.par} /><span className="bd-texte"><b>〰 {t.nom}</b><small>{t.par.pseudo}{t.mot ? ` : ${t.mot}` : ''}</small></span>
        <small className="bd-quand">{t.attente ? '🕓' : quand(t.cree_le)}</small></button>)}</>}
    <span style={{ flex: 1 }} />
    <div className="bd-plus">
      <button className="primary" onClick={onNouvelle}><span className="bd-mini-carre">{jourMois(aujourdhui()).j}</span>
        <span className="bd-plus-texte"><b>＋ Buddy Time</b><small>une sortie</small></span></button>
    </div>
    {membres && <Membres g={g} qr={qr} onToast={onToast} onFermer={() => setMembres(false)} onParti={onRetour} />}
  </div>;
}

/** Les buddies d'un groupe (toucher les visages) : inviter, nommer admin, retirer, quitter (spec §5.3). */
function Membres({ g, qr, onToast, onFermer, onParti }: { g: Groupe; qr?: string; onToast: (m: string) => void; onFermer: () => void; onParti: () => void }) {
  const e = lire();
  const admin = estAdmin(g, e);
  const [choisi, setChoisi] = useState<Buddy | null>(null);
  const moi = (b: Buddy) => b.id === e.moi || b.id === 'moi';
  return <div className="bd-voile" onClick={onFermer}><div className="bd-feuille" onClick={(ev) => ev.stopPropagation()}>
    <h3>Inviter mes copains</h3>
    <Inviter nomGroupe={g.nom} qrExistant={qr} onToast={onToast} onInvite={(i) => { inviter(g.id, i); if (i.canal !== 'qr') onToast(`Invitation envoyée à ${i.nom}`); }} />
    <h3>Dans la bande</h3>
    {g.membres.map((m) => <button key={m.id} className="bd-ligne petite" disabled={!admin || moi(m)} onClick={() => setChoisi(m)}>
      <Visage b={m} /><span className="bd-texte"><b>{m.pseudo}{moi(m) ? ' (toi)' : ''}</b>{m.role === 'admin' && <small>admin</small>}</span>
    </button>)}
    {g.invitations.filter((i) => i.canal !== 'qr').map((i) => <div key={i.id} className="bd-ligne petite bd-invite">
      <Visage b={{ id: i.id, nom: i.nom, photo: null }} /><span className="bd-texte"><b>{i.nom}</b><small>{i.contact}</small></span>
      <small className="bd-etat">{i.attente ? '🕓 ' : ''}{CANAL[i.canal]}</small>
      <button aria-label="Annuler l'invitation" onClick={() => annulerInvitation(i.id)}>✕</button>
    </div>)}
    {choisi && <div className="bd-actions">
      <b>{choisi.pseudo}</b>
      {choisi.role !== 'admin' && <button onClick={() => { nommerAdmin(g.id, choisi.id); setChoisi(null); }}>Nommer admin</button>}
      <button className="danger" onClick={() => { retirer(g.id, choisi.id); setChoisi(null); }}>Retirer de la bande</button>
      <button onClick={() => setChoisi(null)}>Annuler</button>
    </div>}
    <button className="acc-deco" onClick={() => {
      if (!confirm(`Quitter « ${g.nom} » ?`)) return;
      quitter(g.id); onToast(`Tu as quitté « ${g.nom} »`); onParti();
    }}>Quitter le Buddy Group</button>
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

/** Nouveau Buddy Group (écran 20) : photo, nom, invitations, puis « Créer le Buddy Group ». */
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
      <button onClick={onRetour} aria-label="Retour">‹</button><h2>Nouveau Buddy Group</h2>
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
    <button className="primary bd-grand" disabled={!nom.trim()} onClick={creer}>Créer le Buddy Group</button>
  </div>;
}

/**
 * Nouveau Buddy Time (écran 21) : il naît quand on est sûr de partir. Dans un Buddy Group, tout le monde est
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
      <button onClick={onRetour} aria-label="Retour">‹</button><h2>Nouveau Buddy Time</h2>
      <button onClick={onClose} aria-label="Fermer">✕</button>
    </div>
    <ChoixPhoto grand photo={photo} onPhoto={setPhoto} onToast={onToast} />
    <input className="bd-nom" value={nom} maxLength={80} placeholder="Week-end Queyras" onChange={(ev) => setNom(ev.target.value)} />
    <h3 className="bd-section">Quand</h3>
    <div className="bd-dates">
      <label>du<input type="date" value={debut} onChange={(ev) => { setDebut(ev.target.value); if (fin < ev.target.value) setFin(ev.target.value); }} /></label>
      <label>au<input type="date" value={fin} min={debut} onChange={(ev) => setFin(ev.target.value)} /></label>
    </div>
    <h3 className="bd-section">Avec qui <small>{me ? 'Me Time' : `${g.nom} · ${qui.size} sur ${g.membres.length}`}</small></h3>
    {me ? <>
      <Inviter sortie nomGroupe={nom} qrExistant={invites.find((i) => i.canal === 'qr')?.code} onToast={onToast} onInvite={(i) => setInvites((l) => [...l, i])} />
      {invites.filter((i) => i.canal !== 'qr').map((i) => <div key={i.code} className="bd-ligne petite bd-invite">
        <Visage b={{ id: i.code, nom: i.nom, photo: null }} /><span className="bd-texte"><b>{i.nom}</b><small>{i.contact}</small></span>
        <small className="bd-etat">{CANAL[i.canal]}</small></div>)}
      {!invites.length && <p className="hint">Seul, ou invite un ou deux copains à cette sortie, sans créer de Buddy Group.</p>}
    </> : <div className="bd-qui">
      {g.membres.map((m) => <button key={m.id} className={qui.has(m.id) ? 'oui' : ''} disabled={m.id === moiId}
        onClick={() => setQui((q) => { const n = new Set(q); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })}>
        <Visage b={m} taille={48} /><small>{qui.has(m.id) ? '✓' : '—'}</small></button>)}
    </div>}
    <h3 className="bd-section">Où <small>facultatif</small></h3>
    <input value={lieu} maxLength={120} placeholder="📍 Ceillac, Queyras" onChange={(ev) => setLieu(ev.target.value)} />
    <span style={{ flex: 1 }} />
    <button className="primary bd-grand" disabled={!nom.trim()} onClick={creer}>Créer le Buddy Time</button>
  </div>;
}

// ------------------------------------------------------------------ sur la carte (écran 4)

/** Haut et bas de la carte d'un Buddy Time : ‹ nom et dates en haut, bandeau rabattable en bas. */
export function BandeauSortie({ x, traces, onRetour }: { x: Sortie; traces: TraceBuddy[]; onRetour: () => void }) {
  const [replie, setReplie] = useState(false);
  const km = traces.reduce((n, t) => n + longueur(t.ligne), 0) / 1000;
  const venir = x.fin >= aujourdhui();
  return <>
    <div className="bd-carte-haut">
      <button onClick={onRetour} aria-label="Retour aux Buddies">‹</button>
      <span className="bd-texte"><b>{x.nom}</b><small>{dates(x)}{x.lieu ? ` · ${x.lieu}` : ''}</small></span>
    </div>
    <div className={`bd-carte-bas${replie ? ' replie' : ''}`}>
      <button className="handle" aria-label={replie ? 'Déplier' : 'Replier'} onClick={() => setReplie(!replie)} />
      {!replie && <>
        <b className="bd-carte-quand">{quandSortie(x)}</b>
        <div className="bd-carte-qui">
          {x.participants.map((p) => <Visage key={p.id} b={p} taille={30} />)}
          <small>{x.participants.length} partant{x.participants.length > 1 ? 's' : ''}{x.invitations.length ? ` · ${x.invitations.filter((i) => i.canal !== 'qr').map((i) => `${i.nom} ?`).join(' · ')}` : ''}</small>
        </div>
        <div className="bd-chiffres">
          <span><b>{traces.length ? `${km.toFixed(km < 10 ? 1 : 0)} km` : '—'}</b><small>{traces.length > 1 ? `${traces.length} traces` : 'parcours'}</small></span>
          <span><b>{venir ? Math.max(0, joursAvant(x)) : '✓'}</b><small>{venir ? 'jours avant' : 'souvenir'}</small></span>
        </div>
        {!traces.length && <p className="hint">Partage une trace dans ce Buddy Time depuis Mes traces (icône de partage) : elle apparaîtra ici chez tout le monde.</p>}
      </>}
    </div>
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
 * Le même panneau partout : « Dans un Buddy Time » (les plus actifs), « Ou à mes buddies » (mes Buddy Groups),
 * un petit mot, un seul bouton Partager, puis « Ou ailleurs » (les autres applis du téléphone).
 * Les copains un par un arriveront avec la messagerie : aujourd'hui une trace se range dans un Buddy Time ou un groupe.
 */
export function PartagePanel({ nom, ligne, onAilleurs, onFermer, onToast }: {
  nom: string; ligne: [number, number][]; onAilleurs: () => void; onFermer: () => void; onToast: (m: string) => void;
}) {
  const e = useBuddies();
  const compte = useCompte();
  const [choix, setChoix] = useState<Set<string>>(new Set());
  const [tous, setTous] = useState(false);
  const [mot, setMot] = useState('');
  const auj = aujourdhui();
  const { sorties } = vueSorties(e);
  // À venir ou en cours d'abord, puis les plus récemment actives.
  const actives = [...sorties].sort((a, b) => Number(b.fin >= auj) - Number(a.fin >= auj) || b.modifie_le.localeCompare(a.modifie_le)).slice(0, 6);
  const groupes = appliquer(e).filter((g) => g.nature === 'bande');
  const basculer = (id: string) => setChoix((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const partager = () => {
    const ids = [...choix];
    partagerTrace(nom, ligne, mot.trim(), { sorties: ids.filter((id) => sorties.some((x) => x.id === id)), groupes: ids.filter((id) => groupes.some((g) => g.id === id)) });
    onToast(navigator.onLine ? `« ${nom} » partagée` : `« ${nom} » partira au retour du réseau 🕓`);
    onFermer();
  };
  return <div className="bd-voile" onClick={onFermer}><div className="bd-feuille bd-partage" onClick={(ev) => ev.stopPropagation()}>
    <div className="xp-head"><h3>Partager « {nom} »</h3><small className="bd-quand">{(longueur(ligne) / 1000).toFixed(1)} km</small></div>
    {connecte(compte) ? <>
      {actives.length > 0 && <><h3 className="bd-section">Dans un Buddy Time <small>les plus actifs</small></h3>
        <div className="bd-defile">{actives.map((x) => <button key={x.id} className={`bd-tuile${choix.has(x.id) ? ' oui' : ''}`} onClick={() => basculer(x.id)}>
          <Carre x={x} taille={88} /><small>{x.nom}</small></button>)}</div></>}
      {groupes.length > 0 && <><h3 className="bd-section">Ou à mes buddies</h3>
        <div className="bd-defile">{(tous ? groupes : groupes.slice(0, 5)).map((g) => <button key={g.id} className={`bd-tuile rond${choix.has(g.id) ? ' oui' : ''}`} onClick={() => basculer(g.id)}>
          <Visage b={{ id: g.id, nom: g.nom, photo: g.photo }} taille={56} /><small>{g.nom}</small></button>)}
          {!tous && groupes.length > 5 && <button className="bd-tuile rond" onClick={() => setTous(true)}><span className="bd-ajout">⋯</span><small>Tous</small></button>}</div></>}
      {!actives.length && !groupes.length && <p className="hint">Crée un Buddy Group ou un Buddy Time (👥) pour y partager tes traces.</p>}
      <input value={mot} maxLength={300} placeholder="Un petit mot (facultatif)…" onChange={(ev) => setMot(ev.target.value)} />
      <button className="primary bd-grand" disabled={!choix.size} onClick={partager}>Partager</button>
    </> : <p className="hint">Connecte-toi (👤) pour partager tes traces avec tes buddies.</p>}
    <h3 className="bd-section">Ou ailleurs</h3>
    <button className="bd-ligne petite" onClick={() => { onFermer(); onAilleurs(); }}><span className="bd-ajout">⋯</span>
      <span className="bd-texte"><b>WhatsApp, mail, fichier GPX…</b><small>les autres applis du téléphone</small></span></button>
  </div></div>;
}
