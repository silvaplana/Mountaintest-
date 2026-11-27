import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { PLAY } from '../config';
import { api, connecte } from './auth';

/** Une absence plus longue que ça compte comme une nouvelle ouverture au retour à l'écran. */
const PAUSE = 30 * 60_000;

/**
 * Onglet Utilisateurs du Super User (Seb, 27/11) : l'appli dit au serveur qu'elle vient d'être ouverte
 * (au lancement, puis au retour après 30 min ailleurs), avec sa plateforme et sa version. Sans réseau : rien.
 */
export function suivreOuvertures() {
  const plateforme = PLAY ? 'play' : Capacitor.isNativePlatform() ? 'apk' : 'web';
  const dire = async () => {
    if (!connecte()) return;
    const version = Capacitor.isNativePlatform() ? (await CapApp.getInfo().catch(() => null))?.version ?? null : null;
    await api('POST', '/ouverture', { plateforme, version }).catch(() => undefined);
  };
  void dire();
  let parti = 0;
  const h = CapApp.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) parti = Date.now();
    else if (parti && Date.now() - parti > PAUSE) void dire();
  });
  return () => { void h.then((x) => x.remove()); };
}
