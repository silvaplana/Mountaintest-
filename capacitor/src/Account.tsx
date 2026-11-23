import { useEffect, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import {
  changerPseudo, chargerConfig, connecte, debutConnexion, deconnecter, finConnexion, HorsLigne, lire,
  nomAffiche, SCHEMA, suivre, synchroniser, type Etat,
} from './compte/auth';

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

  const seConnecter = async () => {
    if (!Capacitor.isNativePlatform()) { onToast('Connexion : seulement dans l’appli'); return; }
    setOccupe(true);
    try {
      const url = await debutConnexion(await chargerConfig('capacitor'), email.trim() || undefined);
      await Browser.open({ url, toolbarColor: '#2f6f4f' });
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
        <p className="hint acc-centre">Un compte pour créer des groupes d'amis, partager traces et sorties. Le reste de l'appli marche sans compte.</p>
        <label className="field">Adresse e-mail
          <input type="email" inputMode="email" autoComplete="email" placeholder="toi@exemple.fr" value={email} onChange={(ev) => setEmail(ev.target.value)} />
        </label>
        <button className="primary" disabled={occupe} onClick={() => void seConnecter()}>{occupe ? 'Ouverture…' : 'Recevoir un code'}</button>
        <p className="hint acc-centre">La page de connexion s'ouvre : tape le code reçu par mail. Pas de mot de passe.
          Ensuite tu restes connecté, même des semaines sans réseau.</p>
        <p className="hint acc-centre">Google et Apple arrivent bientôt.</p>
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
      <span style={{ flex: 1 }} />
      <button className="acc-deco" onClick={() => { if (confirm('Se déconnecter ? Tes traces restent sur le téléphone.')) { void deconnecter(); onToast('Déconnecté'); } }}>Se déconnecter</button>
      <p className="hint acc-centre">Se déconnecter garde tes traces sur le téléphone.</p>
    </div>
  );
}
