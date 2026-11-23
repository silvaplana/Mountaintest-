import { useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import qrcode from 'qrcode-generator';
import { connecte, lire as lireCompte, nomAffiche, SCHEMA } from '../compte/auth';
import { useCompte } from '../Account';
import {
  annulerInvitation, appliquer, creerGroupe, estAdmin, inviter, lien, lire, marquerVu, nommerAdmin, nouveauCode, quitter,
  rejoindre, rejointsEnAttente, retirer, suivre, synchroniser, type Buddy, type Canal, type Etat, type Groupe, type NouvelleInvitation,
} from './store';

/**
 * Buddies, bloc 1 (spec/buddies.md, écrans 2, 3 et 20) : la liste façon WhatsApp, un Buddy Group,
 * nouveau Buddy Group et invitations. Même écran côté Kotlin (BuddiesPanel.kt).
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

function Visage({ b, taille = 34 }: { b: { id: string; pseudo?: string; nom?: string; photo: string | null }; taille?: number }) {
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
function Colonne({ onToast, onExpenses, onLodging }: { onToast: (m: string) => void; onExpenses: () => void; onLodging: () => void }) {
  const bientot = (m: string) => () => onToast(`Bientôt : ${m}`);
  return <div className="bd-colonne">
    <button aria-label="Appel" onClick={bientot('appeler toute la bande')}>📞</button>
    <button aria-label="Planning" onClick={bientot('le planning de saison')}>📅</button>
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
function Inviter({ nomGroupe, qrExistant, onInvite, onToast }: {
  nomGroupe: string; qrExistant?: string; onInvite: (i: NouvelleInvitation) => void; onToast: (m: string) => void;
}) {
  const [form, setForm] = useState<Formulaire | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const texte = (code: string) => `${nomAffiche()} t'invite dans « ${nomGroupe} » sur Mountain Buddies, pour nos sorties montagne : ${lien(code)}`;
  const pret = () => { if (!nomGroupe.trim()) { onToast('Donne d’abord un nom au Buddy Group'); return false; } return true; };

  const envoyer = async (canal: Canal, nom: string, contact: string) => {
    const code = nouveauCode();
    try {
      if (canal === 'mail') {
        const sujet = `${nomAffiche()} t'invite dans « ${nomGroupe} »`;
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
      <p className="hint">Tes copains visent ce code avec l'appareil photo de leur téléphone : il installe l'appli et les fait entrer dans la bande.</p>
      <button onClick={() => setQr(null)}>Fermer</button>
    </div></div>}
  </>;
}

// ------------------------------------------------------------------ écrans

type Vue = { ecran: 'liste' } | { ecran: 'groupe'; id: string } | { ecran: 'nouveau' };

export function Buddies({ onClose, onToast, onAccount, onExpenses, onLodging }: {
  onClose: () => void; onToast: (m: string) => void; onAccount: () => void; onExpenses: () => void; onLodging: () => void;
}) {
  const e = useBuddies();
  const compte = useCompte();
  const [vue, setVue] = useState<Vue>({ ecran: 'liste' });
  // Ouvert : on regarde les nouveautés toutes les minutes ; fermé, la pastille de 👥 repart de maintenant.
  useEffect(() => {
    const sync = () => { void synchroniser().then((r) => r.forEach(onToast)).catch(() => undefined); };
    sync();
    const t = setInterval(sync, 60_000);
    return () => { clearInterval(t); marquerVu(); };
  }, [onToast]);

  const colonne = <Colonne onToast={onToast} onExpenses={onExpenses} onLodging={onLodging} />;
  if (!connecte(compte)) {
    return <div className="buddies">{colonne}<div className="bd-corps">
      <div className="xp-head"><h2>Buddies</h2><button onClick={onClose} aria-label="Fermer">✕</button></div>
      <p className="bd-vide">Connecte-toi pour retrouver tes copains, créer tes Buddy Groups et partager vos sorties.</p>
      <button className="primary bd-grand" onClick={onAccount}>👤 Me connecter</button>
      {rejointsEnAttente(e).length > 0 && <p className="hint">🕓 Une invitation t'attend : elle s'ouvrira une fois connecté.</p>}
    </div></div>;
  }

  const groupes = appliquer(e);
  const g = vue.ecran === 'groupe' ? groupes.find((x) => x.id === vue.id) : undefined;
  return <div className="buddies">
    {colonne}
    {vue.ecran === 'nouveau' ? <Nouveau onToast={onToast} onFini={(id) => setVue({ ecran: 'groupe', id })} onRetour={() => setVue({ ecran: 'liste' })} onClose={onClose} />
      : g ? <UnGroupe g={g} onToast={onToast} onRetour={() => setVue({ ecran: 'liste' })} onClose={onClose} />
        : <Liste e={e} groupes={groupes} onOuvrir={(id) => setVue({ ecran: 'groupe', id })} onNouveau={() => setVue({ ecran: 'nouveau' })} onClose={onClose} />}
  </div>;
}

function Liste({ e, groupes, onOuvrir, onNouveau, onClose }: {
  e: Etat; groupes: Groupe[]; onOuvrir: (id: string) => void; onNouveau: () => void; onClose: () => void;
}) {
  const enAttente = e.attente.length;
  return <div className="bd-corps">
    <div className="xp-head"><h2>Buddies</h2><button onClick={onClose} aria-label="Fermer">✕</button></div>
    <p className="hint">{enAttente ? `🕓 ${enAttente} changement${enAttente > 1 ? 's' : ''} partira au retour du réseau · ` : ''}{heure(e.synchro)}</p>
    {rejointsEnAttente(e).length > 0 && <div className="acc-bandeau orange"><span>🕓</span><span>Invitation reçue : tu entreras dans le Buddy Group au retour du réseau.</span></div>}
    <h3 className="bd-section">Buddy Groups</h3>
    {groupes.map((g) => <button key={g.id} className="bd-ligne" onClick={() => onOuvrir(g.id)}>
      {g.nature === 'me_time' ? <Visage b={{ id: g.id, pseudo: nomAffiche(), photo: lireCompte().profil?.photo ?? null }} taille={56} />
        : <Visage b={{ id: g.id, nom: g.nom, photo: g.photo }} taille={56} />}
      <span className="bd-texte"><b>{g.nom}</b>
        <small>{g.nature === 'me_time' ? 'Mes sorties à moi' : resume(g)}</small></span>
      <small className="bd-quand">{g.attente ? '🕓' : quand(g.modifie_le)}</small>
    </button>)}
    <span style={{ flex: 1 }} />
    <div className="bd-plus">
      <button className="primary" onClick={onNouveau}>＋ <span className="bd-faces"><i /><i /><i /></span>
        <span className="bd-plus-texte"><b>Buddy Group</b><small>une bande</small></span></button>
    </div>
  </div>;
}

function UnGroupe({ g, onToast, onRetour, onClose }: { g: Groupe; onToast: (m: string) => void; onRetour: () => void; onClose: () => void }) {
  const [membres, setMembres] = useState(false);
  const me = g.nature === 'me_time';
  const qr = g.invitations.find((i) => i.canal === 'qr')?.code;
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
    <h3 className="bd-section">À venir</h3>
    <p className="bd-vide">{me ? 'Tes sorties à toi, seul ou avec un ou deux copains invités, viendront ici.' : 'Les Buddy Times de la bande viendront ici : à venir d’abord, puis les souvenirs en images.'}</p>
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

/** Nouveau Buddy Group (écran 20) : photo, nom, invitations, puis « Créer le Buddy Group ». */
function Nouveau({ onToast, onFini, onRetour, onClose }: { onToast: (m: string) => void; onFini: (id: string) => void; onRetour: () => void; onClose: () => void }) {
  const [nom, setNom] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [invites, setInvites] = useState<NouvelleInvitation[]>([]);
  const fichier = useRef<HTMLInputElement>(null);
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
    <button className="bd-photo" onClick={() => fichier.current?.click()} aria-label="Photo du Buddy Group">
      {photo ? <img src={photo} alt="" /> : '📷'}</button>
    <input ref={fichier} type="file" accept="image/*" hidden onChange={(ev) => {
      const f = ev.target.files?.[0]; if (f) void reduire(f).then(setPhoto).catch(() => onToast('Photo illisible'));
    }} />
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

