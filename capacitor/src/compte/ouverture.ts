import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { api, connecte, plateformeAppli, suivre } from './auth';

/** Une absence plus longue que ça compte comme une nouvelle ouverture au retour à l'écran. */
const PAUSE = 30 * 60_000;

/**
 * Onglet Utilisateurs du Super User (Seb, 27/11) : l'appli dit au serveur qu'elle vient d'être ouverte
 * (au lancement, puis au retour après 30 min ailleurs), avec sa plateforme et sa version. Sans réseau : rien.
 * Une connexion est dite aussi (journal du Super User) ; la déconnexion, par deconnecter().
 */
export function suivreOuvertures() {
  const dire = async (evenement: 'ouverture' | 'connexion' = 'ouverture') => {
    if (!connecte()) return;
    const version = Capacitor.isNativePlatform() ? (await CapApp.getInfo().catch(() => null))?.version ?? null : null;
    await api('POST', '/ouverture', { plateforme: plateformeAppli(), version, evenement }).catch(() => undefined);
  };
  void dire();
  let etaitConnecte = connecte();
  const fin = suivre(() => {
    if (connecte() && !etaitConnecte) void dire('connexion');
    etaitConnecte = connecte();
  });
  let parti = 0;
  const h = CapApp.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) parti = Date.now();
    else if (parti && Date.now() - parti > PAUSE) void dire();
  });
  return () => { fin(); void h.then((x) => x.remove()); };
}
