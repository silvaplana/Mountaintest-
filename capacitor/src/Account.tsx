import { useEffect, useState } from 'react';
import { choisirIcones, choisirMain, choisirNouvellesIcones, iconesAGauche, main, nouvellesIcones, type Main } from './doigt';
import { aideAOuverture, choisirAideAOuverture } from './Accueil';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import {
  api, changerInfos, changerPseudo, changerWero, chargerConfig, connecte, debutConnexion, deconnecter, finConnexion, HorsLigne, lire,
  initiales, nomAffiche, nomComplet, retourWeb, retourWebEnAttente, SCHEMA, suivre, synchroniser, type Etat, type Fournisseur, type Infos,
} from './compte/auth';
import { lire as lireBuddies, oublierTout, suivre as suivreBuddies } from './buddies/store';
import { BlockIcon, PersonnesBloquees } from './buddies/Moderation';
import { TrashIcon } from './icones';

/** Pages publiques exigées par le Play Store (dans deploy/site, servies par le VPS). */
const PAGES = 'https://mountainbuddies.silvaplana.cloud/app/';
const ouvrirPage = (page: string) => void Browser.open({ url: PAGES + page });

/**
 * compte.html (page web de suppression, Play Store) renvoie sur …/?compte=supprimer : on s'en souvient le temps de la
 * connexion (qui passe par Logto et recharge la page), puis le profil s'ouvre sur « Supprimer mon compte ».
 */
export function suppressionDemandee(): boolean {
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.get('compte') === 'supprimer') {
      sessionStorage.setItem('supprimer-compte', '1');
      u.searchParams.delete('compte');
      window.history.replaceState(null, '', u.toString());
    }
    return sessionStorage.getItem('supprimer-compte') === '1';
  } catch { return false; }
}
const oublierDemande = () => { try { sessionStorage.removeItem('supprimer-compte'); } catch { /* bloqué */ } };

/** Logos officiels (couleurs imposées par Google et Apple pour leurs boutons). */
const GoogleLogo = () => (
  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.6 17.7 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z" />
    <path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.3.8-4.7l-7.8-6C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.8 6C6.6 42.6 14.6 48 24 48z" />
  </svg>
);
const AppleLogo = () => (
  <svg width="18" height="20" viewBox="0 0 17 20" aria-hidden="true"><path fill="currentColor" d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2.1-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8s2 .8 3.4.8c1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4.1zM11.6 3c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5z" /></svg>
);

/** Icône 👥 de la seconde barre : rond vert = connecté (même hors ligne), orange = à reconnecter. */
export function useCompte(): Etat {
  const [e, setE] = useState<Etat>(lire);
  useEffect(() => suivre(setE), []);
  return e;
}

/**
 * Retour de la page de connexion Logto (fr.assomoutain.rando://callback) : à brancher une fois au démarrage.
 * Synchronise aussi au démarrage et au retour du réseau, sans jamais bloquer l'appli.
 */
export function ecouterCompte(onToast: (m: string) => void, onOuvrir: () => void) {
  const traiter = async (url: string) => {
    if (!url.startsWith(`${SCHEMA}://callback`)) return;
    void Browser.close().catch(() => undefined);
    onOuvrir();
    try {
      await finConnexion(url);
      onToast(`Connecté : ${nomAffiche()}`);
    } catch (err) {
      onToast(err instanceof HorsLigne ? 'Pas de réseau pour finir la connexion : réessaie' : String((err as Error).message));
    }
  };
  const subs: Promise<{ remove: () => Promise<void> }>[] = [];
  // Version web (iPhone en PWA) : la page revient de Logto avec ?code=… ; on finit puis on nettoie l'adresse.
  if (!Capacitor.isNativePlatform() && retourWebEnAttente()) {
    const href = location.href;
    history.replaceState(null, '', retourWeb());
    onOuvrir();
    void finConnexion(href)
      .then(() => onToast(`Connecté : ${nomAffiche()}`))
      .catch((err) => onToast(err instanceof HorsLigne ? 'Pas de réseau pour finir la connexion : réessaie' : String((err as Error).message)));
  }
  if (Capacitor.isNativePlatform()) {
    subs.push(CapApp.addListener('appUrlOpen', ({ url }) => { void traiter(url); }));
    void CapApp.getLaunchUrl().then((r) => { if (r?.url) void traiter(r.url); }).catch(() => undefined);
  }
  const sync = () => { if (connecte()) void synchroniser().catch(() => undefined); };
  sync();
  window.addEventListener('online', sync);
  return () => { window.removeEventListener('online', sync); subs.forEach((s) => void s.then((x) => x.remove())); };
}

function quand(ms?: number) {
  if (!ms) return 'jamais';
  const d = new Date(ms), auj = new Date();
  const h = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
  return d.toDateString() === auj.toDateString() ? `aujourd'hui ${h}` : `le ${d.toLocaleDateString('fr-FR')} ${h}`;
}

/** Écran « Mon compte » (maquettes 2 et 3, /mnt/project-files/maquettes/comptes). Même écran côté Kotlin (AccountPanel.kt). */
/** Main pour tracer (le point se pose au-dessus du doigt, du côté opposé) et côté des icônes : deux choix à part (Seb, 25/11). */
function ChoixMain() {
  const [m, setM] = useState<Main>(main);
  const pose = (v: Main) => { choisirMain(v); setM(v); };
  const [g, setG] = useState(iconesAGauche);
  const icones = (v: boolean) => { choisirIcones(v); setG(v); };
  const [n, setN] = useState(nouvellesIcones);
  const [aide, setAide] = useState(aideAOuverture);
  return (
    <div className="acc-main">
      <p className="acc-main-titre">Point décalé du doigt</p>
      <div className="acc-main-choix">
        {([['aucun', 'Non'], ['gaucher', 'Gaucher'], ['droitier', 'Droitier']] as [Main, string][]).map(([v, t]) => (
          <button key={v} className={m === v ? 'on' : ''} onClick={() => pose(v)}>{t}</button>))}
      </div>
      <p className="hint">{m === 'aucun' ? 'Pour les traces : le point se pose sous ton doigt.'
        : `Pour les traces : le point se pose un peu au-dessus de ton doigt, ${m === 'gaucher' ? 'à droite' : 'à gauche'}, pour que tu le voies.`}</p>
      <p className="acc-main-titre">Icônes de la carte</p>
      <div className="acc-main-choix">
        <button className={g ? 'on' : ''} onClick={() => icones(true)}>À gauche</button>
        <button className={!g ? 'on' : ''} onClick={() => icones(false)}>À droite</button>
      </div>
      <label className="acc-case"><input type="checkbox" checked={n} onChange={(ev) => { choisirNouvellesIcones(ev.target.checked); setN(ev.target.checked); }} />Nouvelles icônes dans Buddies</label>
      <label className="acc-case"><input type="checkbox" checked={aide} onChange={(ev) => { choisirAideAOuverture(ev.target.checked); setAide(ev.target.checked); }} />Afficher l'aide à l'ouverture</label>
    </div>
  );
}

/** Un champ de la fiche, envoyé quand on le quitte (hors ligne : il attend le réseau). */
function Champ({ titre, valeur, cle, type = 'text', onToast, ...autres }: {
  titre: string; valeur: string; cle: keyof Infos; type?: string; onToast: (m: string) => void; placeholder?: string; inputMode?: 'tel' | 'text';
}) {
  const [v, setV] = useState(valeur);
  useEffect(() => { setV(valeur); }, [valeur]);
  return <label className="field">{titre}
    <input type={type} value={v} maxLength={cle === 'iban' ? 42 : 100} {...autres}
      onChange={(ev) => setV(cle === 'iban' ? ev.target.value.toUpperCase() : ev.target.value)}
      onBlur={() => {
        if (v.trim() === valeur.trim()) return;
        changerInfos({ [cle]: v }).catch((err) => { onToast(String((err as Error).message)); setV(valeur); });
      }} />
  </label>;
}

/** Profil › Inviter un ami : prénom et adresse, le serveur envoie le mail avec le lien de téléchargement. */
function InviterAmi({ enLigne, onToast }: { enLigne: boolean; onToast: (m: string) => void }) {
  const [form, setForm] = useState<{ nom: string; email: string } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const envoyer = async () => {
    if (!form) return;
    setOccupe(true);
    try {
      await api('POST', '/inviter-appli', { nom: form.nom.trim(), email: form.email.trim() });
      onToast(`Invitation envoyée à ${form.nom.trim() || form.email.trim()}`);
      setForm(null);
    } catch (err) { onToast(err instanceof HorsLigne ? 'Pas de réseau' : String((err as Error).message)); }
    finally { setOccupe(false); }
  };
  return <>
    <h3 className="acc-rubrique">Inviter</h3>
    <button className="acc-support" disabled={!enLigne} onClick={() => setForm({ nom: '', email: '' })}><span className="acc-support-rond">✉️</span>
      <span><b>Inviter un ami</b><small>{enLigne ? 'il reçoit un mail pour installer Mountain Buddies' : 'pas de réseau'}</small></span><span aria-hidden="true">›</span></button>
    {form && <div className="bd-voile" onClick={() => setForm(null)}><div className="bd-feuille" onClick={(ev) => ev.stopPropagation()}>
      <h3>Inviter un ami</h3>
      <label className="field">Son prénom<input value={form.nom} onChange={(ev) => setForm({ ...form, nom: ev.target.value })} placeholder="Paul" /></label>
      <label className="field">Son adresse e-mail<input type="email" inputMode="email" value={form.email}
        onChange={(ev) => setForm({ ...form, email: ev.target.value })} placeholder="paul@exemple.fr" /></label>
      <p className="hint">Mountain Buddies lui envoie un mail avec le lien pour installer l'appli.</p>
      <button className="primary" disabled={occupe || !form.email.trim()} onClick={() => void envoyer()}>Envoyer l’invitation</button>
      <button onClick={() => setForm(null)}>Annuler</button>
    </div></div>}
  </>;
}

const icone = (d: string) => <svg viewBox="0 0 24 24" width={24} height={24} aria-hidden="true" fill="none" stroke="currentColor"
  strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
const DocIcon = () => icone('M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5');
const CadenasIcon = () => icone('M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM8 11V8a4 4 0 0 1 8 0v3');

/**
 * Supprimer mon compte (exigé par le Play Store ; maquette validée par Seb le 27/11) : ce qui est effacé, ce qui
 * reste pour les buddies, un seul bouton rouge. Le serveur efface (DELETE /moi), puis le téléphone oublie le compte.
 */
function SupprimerCompte({ enLigne, onAnnuler, onToast }: { enLigne: boolean; onAnnuler: () => void; onToast: (m: string) => void }) {
  const [occupe, setOccupe] = useState(false);
  const effacer = async () => {
    setOccupe(true);
    try {
      await api('DELETE', '/moi');
      oublierTout();
      await deconnecter();
      onToast('Ton compte est supprimé');
      onAnnuler();
    } catch (err) {
      onToast(err instanceof HorsLigne ? 'Pas de réseau : réessaie plus tard' : String((err as Error).message));
    } finally { setOccupe(false); }
  };
  return <div className="bd-voile" onClick={onAnnuler}><div className="bd-feuille" onClick={(ev) => ev.stopPropagation()}>
    <h3>Supprimer mon compte</h3>
    <b>Ton compte et tes données seront effacés du serveur.</b>
    <h3 className="acc-rubrique">Effacé</h3>
    <ul className="acc-efface"><li>ton profil, ta photo, ton e-mail</li><li>tes photos partagées et tes positions</li><li>ta place dans tes groupes et sorties</li></ul>
    <h3 className="acc-rubrique">Gardé pour tes buddies</h3>
    <ul className="acc-efface"><li>tes messages, signés « Ancien buddy »</li><li>les dépenses des Buddy counts, pour que les comptes restent justes</li></ul>
    <h3 className="acc-rubrique">Sur ce téléphone</h3>
    <p className="hint">Tes traces et tes cartes hors ligne restent sur le téléphone.</p>
    <button onClick={onAnnuler}>Annuler</button>
    <button className="md-rouge" disabled={occupe || !enLigne} onClick={() => void effacer()}>{enLigne ? 'Supprimer définitivement' : 'Pas de réseau'}</button>
  </div></div>;
}

export function Account({ onClose, onToast, onSupport }: { onClose: () => void; onToast: (m: string) => void; onSupport?: () => void }) {
  const e = useCompte();
  const [email, setEmail] = useState(e.email ?? '');
  const [pseudo, setPseudo] = useState(nomAffiche(e));
  const [occupe, setOccupe] = useState(false);
  const [bloques, setBloques] = useState(false);
  const [supprimer, setSupprimer] = useState(suppressionDemandee);
  const [buddies, setBuddies] = useState(lireBuddies);
  useEffect(() => suivreBuddies(setBuddies), []);
  const [enLigne, setEnLigne] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setEnLigne(true), off = () => setEnLigne(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  useEffect(() => { setPseudo(nomAffiche(e)); }, [e.profil?.pseudo]); // eslint-disable-line react-hooks/exhaustive-deps

  const seConnecter = async (fournisseur?: Fournisseur) => {
    setOccupe(true);
    try {
      if (Capacitor.isNativePlatform()) {
        const url = await debutConnexion(await chargerConfig('capacitor'), email.trim() || undefined, fournisseur);
        await Browser.open({ url, toolbarColor: '#3e5368' });
      } else {
        // Version web (iPhone) : toute la page part chez Logto puis revient ici (ecouterCompte finit la connexion).
        location.assign(await debutConnexion(await chargerConfig('web'), email.trim() || undefined, fournisseur, retourWeb()));
      }
    } catch (err) {
      onToast(err instanceof HorsLigne ? 'Il faut du réseau pour la première connexion' : String((err as Error).message));
    } finally { setOccupe(false); }
  };

  if (!connecte(e)) {
    return (
      <div className="expenses account">
        <div className="xp-head"><h2>Mon compte</h2><button onClick={onClose} aria-label="Fermer">✕</button></div>
        <img className="acc-logo" src="logo.svg" alt="" />
        <p className="acc-titre">Mountain Buddies</p>
        <p className="hint acc-centre">Connecte-toi pour retrouver tes Buddies, partager traces et sorties. Le reste de l'appli marche sans compte.</p>
        <button className="acc-social" disabled={occupe} onClick={() => void seConnecter('google')}><GoogleLogo />Continuer avec Google</button>
        <button className="acc-social apple" disabled title="Bientôt" onClick={() => void seConnecter('apple')}><AppleLogo />Continuer avec Apple <small>(bientôt)</small></button>
        <div className="acc-ou">ou par e-mail</div>
        <label className="field">Adresse e-mail
          <input type="email" inputMode="email" autoComplete="email" placeholder="toi@exemple.fr" value={email} onChange={(ev) => setEmail(ev.target.value)} />
        </label>
        <button className="primary" disabled={occupe} onClick={() => void seConnecter()}>{occupe ? 'Ouverture…' : 'Recevoir un code'}</button>
        <p className="hint acc-centre">Une seule fois : ensuite tu restes connecté, même des semaines sans réseau.</p>
        <ChoixMain />
        <button className="acc-plus-tard" onClick={onClose}>Plus tard</button>
      </div>
    );
  }

  const attente = Object.keys(e.attente ?? {}).length > 0;
  const p = e.profil;
  // Profil comme AppBase (Seb, 26 novembre) : pastille, nom, e-mail, rôle, puis les rubriques.
  return (
    <div className="expenses account">
      <div className="xp-head"><h2>Profil</h2><button onClick={onClose} aria-label="Fermer">✕</button></div>
      <div className="acc-avatar acc-grand">{p?.photo ? <img src={p.photo} alt="" /> : initiales(e)}
        {/* Plus de point vert « connecté » : on le sait (Seb, 26/11) ; l'orange reste quand il faut se reconnecter. */}
        {e.aReconnecter && <span className="acc-pastille orange" />}</div>
      <p className="acc-nom">{nomComplet(e)}</p>
      <p className="acc-mail">{p?.email ?? e.email ?? ''}</p>
      <span className="acc-role">{p?.super_user ? 'Super User' : 'Membre'}</span>
      <h3 className="acc-rubrique">Mes infos</h3>
      <Champ titre="Prénom" valeur={p?.prenom ?? ''} cle="prenom" onToast={onToast} />
      <Champ titre="Nom" valeur={p?.nom ?? ''} cle="nom" onToast={onToast} />
      <label className="field">Pseudo (vu par tes amis)
        <input value={pseudo} maxLength={40} onChange={(ev) => setPseudo(ev.target.value)}
          onBlur={() => { if (pseudo.trim() && pseudo.trim() !== nomAffiche(e)) void changerPseudo(pseudo); }} />
      </label>
      <Champ titre="Téléphone (facultatif)" valeur={p?.telephone ?? ''} cle="telephone" type="tel" inputMode="tel" placeholder="06 12 34 56 78" onToast={onToast} />
      <h3 className="acc-rubrique">Remboursements</h3>
      <Champ titre="Mon IBAN (facultatif, pour les remboursements)" valeur={p?.iban ?? ''} cle="iban" placeholder="FR76 …" onToast={onToast} />
      {/* Wero (Seb 26/11) : par défaut le portable ci-dessus ; un autre numéro ou un mail seulement s'il diffère. */}
      <label className="acc-case"><input type="checkbox" checked={!!p?.wero} onChange={(ev) => { void changerWero(ev.target.checked); }} />J'ai Wero</label>
      {p?.wero && <Champ titre="Numéro Wero, si différent" valeur={p?.wero_numero ?? ''} cle="wero_numero" inputMode="tel" placeholder={p?.telephone || '06 12 34 56 78 ou mail'} onToast={onToast} />}
      <p className="hint">Seuls les buddies d'une sortie qui te doivent de l'argent les voient, pour te rembourser.</p>
      <h3 className="acc-rubrique">Paramètres</h3>
      {e.aReconnecter
        ? <div className="acc-bandeau orange"><span>⚠</span><span><b>Session expirée.</b> Tes données restent sur le téléphone ; reconnecte-toi quand tu as du réseau pour les synchroniser.</span></div>
        : !enLigne
          ? <div className="acc-bandeau orange"><span>📵</span><span><b>Hors ligne, toujours connecté.</b>{attente ? ' Tes changements partiront au retour du réseau.' : ''}</span></div>
          : attente
            ? <div className="acc-bandeau orange"><span>🕓</span><span>Tes changements attendent d'être envoyés.</span></div>
            : null}
      <div className="acc-bandeau vert"><span>✓</span><span>Dernière synchro : {quand(e.synchro)}</span></div>
      {e.aReconnecter && <button className="primary" disabled={occupe} onClick={() => void seConnecter()}>Me reconnecter</button>}
      <button disabled={occupe || !enLigne} onClick={async () => {
        setOccupe(true);
        try { await synchroniser(); onToast('Synchronisé'); } catch (err) { onToast(err instanceof HorsLigne ? 'Pas de réseau' : String((err as Error).message)); }
        finally { setOccupe(false); }
      }}>🔄 Synchroniser</button>
      <ChoixMain />
      <span style={{ flex: 1 }} />
      <h3 className="acc-rubrique">Mon compte</h3>
      <div className="acc-liens">
        <button onClick={() => ouvrirPage('conditions.html')}><DocIcon />Conditions d'utilisation<span>›</span></button>
        <button onClick={() => ouvrirPage('confidentialite.html')}><CadenasIcon />Confidentialité<span>›</span></button>
        <button onClick={() => setBloques(true)}><BlockIcon />Personnes bloquées<span>{(buddies.bloques ?? []).length || ''} ›</span></button>
      </div>
      <button className="acc-deco" onClick={() => { if (confirm('Se déconnecter ? Tes traces restent sur le téléphone.')) { void deconnecter(); onToast('Déconnecté'); } }}>Se déconnecter</button>
      <p className="hint acc-centre">Se déconnecter garde tes traces sur le téléphone.</p>
      <button className="acc-supprimer" onClick={() => setSupprimer(true)}><TrashIcon />Supprimer mon compte</button>
      {bloques && <PersonnesBloquees e={buddies} onFermer={() => setBloques(false)} />}
      {supprimer && <SupprimerCompte enLigne={enLigne} onAnnuler={() => { oublierDemande(); setSupprimer(false); }} onToast={onToast} />}
      {/* Inviter un ami à installer l'appli, sans groupe (Seb, 26/11) : mail envoyé par le serveur (Brevo). */}
      {connecte() && <InviterAmi enLigne={enLigne} onToast={onToast} />}
      {/* Écrire au support (Seb, 26/11) : une discussion à deux avec le Super User, tout en bas du profil (Seb, 26/11). */}
      {onSupport && !p?.super_user && <>
        <h3 className="acc-rubrique">Aide</h3>
        <button className="acc-support" onClick={onSupport}><span className="acc-support-rond">?</span>
          <span><b>Écrire au support</b><small>une question, un souci, une idée</small></span><span aria-hidden="true">›</span></button>
      </>}
    </div>
  );
}
