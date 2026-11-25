import { useEffect, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';

const Updater = registerPlugin<{ check(): Promise<{ current: number; build?: number }>; install(): Promise<void> }>('Updater');

const DIX_MINUTES = 10 * 60_000;

/**
 * Nouvelle version de l'appli (Seb 25/11) : cherchée au démarrage, à chaque retour à l'écran et toutes les
 * 10 minutes tant que l'appli est ouverte. Renvoie le numéro de la version à proposer (null : rien à proposer).
 * « Plus tard » la tait jusqu'au prochain démarrage de l'appli.
 */
export function useMiseAJour(visible: boolean) {
  const [build, setBuild] = useState<number | null>(null);
  const [tue, setTue] = useState(0);
  useEffect(() => {
    if (!visible || !Capacitor.isNativePlatform()) return;
    const chercher = () => {
      Updater.check().then((r) => { if (r.build && r.build > r.current) setBuild(r.build); }).catch(() => { /* pas de réseau */ });
    };
    chercher();
    const t = window.setInterval(chercher, DIX_MINUTES);
    return () => window.clearInterval(t);
  }, [visible]);
  return {
    build: build && build > tue ? build : null,
    installer: () => { void Updater.install().catch(() => { /* pas de réseau : le bandeau reste */ }); },
    plusTard: () => setTue(build ?? 0),
  };
}
