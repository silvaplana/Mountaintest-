import { useEffect, useState } from 'react';
import { choisirMain, main, type Main } from './doigt';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import {
  changerPseudo, chargerConfig, connecte, debutConnexion, deconnecter, finConnexion, HorsLigne, lire,
  nomAffiche, retourWeb, retourWebEnAttente, SCHEMA, suivre, synchroniser, type Etat, type Fournisseur,
} from './compte/auth';

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
/** Main pour tracer (Seb, 25/11) : le point se pose au-dessus du doigt, du côté opposé à la main. */
function ChoixMain() {
  const [m, setM] = useState<Main>(main);
  const pose = (v: Main) => { choisirMain(v); setM(v); };
  return (
    <div className="acc-main">
      <p className="acc-main-titre">Pour tracer, je suis…</p>
      <div className="acc-main-choix">
        <button className={m === 'gaucher' ? 'on' : ''} onClick={() => pose('gaucher')}>Gaucher</button>
        <button className={m === 'droitier' ? 'on' : ''} onClick={() => pose('droitier')}>Droitier</button>
      </div>
      <p className="hint">Pour les traces : le point se pose un peu au-dessus de ton doigt, {m === 'gaucher' ? 'à droite' : 'à gauche'}, pour que tu le voies.</p>
    </div>
  );
}

export function Account({ onClose, onToast }: { onClose: () => void; onToast: (m: string) => void }) {
  const e = useCompte();
  const [email, setEmail] = useState(e.email ?? '');
  const [pseudo, setPseudo] = useState(nomAffiche(e));
  const [occupe, setOccupe] = useState(false);
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
        await Browser.open({ url, toolbarColor: '#2f6f4f' });
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

  const attente = e.attente?.pseudo != null;
  return (
    <div className="expenses account">
      <div className="xp-head"><h2>Mon compte</h2><button onClick={onClose} aria-label="Fermer">✕</button></div>
      <div className="acc-avatar">{e.profil?.photo ? <img src={e.profil.photo} alt="" /> : nomAffiche(e).slice(0, 1).toUpperCase()}
        <span className={`acc-pastille ${e.aReconnecter ? 'orange' : 'vert'}`} /></div>
      <label className="field">Pseudo (vu par tes amis)
        <input value={pseudo} maxLength={40} onChange={(ev) => setPseudo(ev.target.value)}
          onBlur={() => { if (pseudo.trim() && pseudo.trim() !== nomAffiche(e)) void changerPseudo(pseudo); }} />
      </label>
      <label className="field">E-mail
        <input value={e.profil?.email ?? e.email ?? ''} readOnly className="acc-lecture" />
      </label>
      {e.aReconnecter
        ? <div className="acc-bandeau orange"><span>⚠</span><span><b>Session expirée.</b> Tes données restent sur le téléphone ; reconnecte-toi quand tu as du réseau pour les synchroniser.</span></div>
        : !enLigne
          ? <div className="acc-bandeau orange"><span>📵</span><span><b>Hors ligne, toujours connecté.</b>{attente ? ' Ton pseudo partira au retour du réseau.' : ''}</span></div>
          : attente
            ? <div className="acc-bandeau orange"><span>🕓</span><span>Ton pseudo attend d'être envoyé.</span></div>
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
      <button className="acc-deco" onClick={() => { if (confirm('Se déconnecter ? Tes traces restent sur le téléphone.')) { void deconnecter(); onToast('Déconnecté'); } }}>Se déconnecter</button>
      <p className="hint acc-centre">Se déconnecter garde tes traces sur le téléphone.</p>
    </div>
  );
}
