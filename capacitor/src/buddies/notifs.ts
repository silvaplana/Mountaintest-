import { useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { useCompte } from '../Account';
import { connecte } from '../compte/auth';
import { Natif } from './Buddies';
import { synchroniser } from './store';

/**
 * 🔔 Notifications des nouveaux messages (spec/buddies.md §7.13, étape 4), Android : le serveur prévient par Firebase,
 * comme la sonnerie des appels. Appli fermée : une notification par conversation (MessagesNotif.java), la toucher
 * ouvre la conversation. Appli ouverte : pas de notification, on va chercher le message tout de suite.
 */
/** `carte` : « Suivre » touché sur la notification d'une carte partagée (le message « carte » à suivre). */
export type ConversationNotif = { cle: string; groupe?: string; sortie?: string; carte?: string; carteDe?: string };

const Permissions = registerPlugin<{ requestPermissions(o: { permissions: string[] }): Promise<{ notifications: string }> }>('EcoLocation');

export function useNotifMessages(ouvrir: (c: ConversationNotif) => void) {
  const compte = useCompte();
  const ok = connecte(compte);
  const rappel = useRef(ouvrir);
  rappel.current = ouvrir;
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !ok) return;
    let fini = false;
    const hs: { remove: () => Promise<void> }[] = [];
    const aller = (c: ConversationNotif) => { void synchroniser().catch(() => undefined).finally(() => rappel.current(c)); };
    void (async () => {
      // Android 13 et plus : demander une fois le droit de montrer des notifications.
      try {
        if (!localStorage.getItem('notifsDemandees')) { localStorage.setItem('notifsDemandees', '1'); await Permissions.requestPermissions({ permissions: ['notifications'] }); }
      } catch { /* refusé ou indisponible */ }
      const att = await Natif.conversationEnAttente().catch(() => ({}) as { conversation?: ConversationNotif });
      if (att.conversation) aller(att.conversation);
      const a = await Natif.addListener('ouvrirConversation', aller);
      const b = await Natif.addListener('message', () => { void synchroniser().catch(() => undefined); });
      if (fini) { void a.remove(); void b.remove(); } else hs.push(a, b);
    })().catch(() => undefined);
    return () => { fini = true; hs.forEach((h) => void h.remove()); };
  }, [ok]);
}

/** La conversation est à l'écran : sa notification s'efface. */
export function effacerNotif(cle: string) {
  if (Capacitor.isNativePlatform()) void Natif.effacerNotif({ cle }).catch(() => undefined);
}

/**
 * À l'ouverture qui suit des notifications (Seb, 26/11) : une fenêtre explique ce qui est arrivé (qui a écrit, payé
 * ou partagé quoi). Cherché au démarrage et à chaque retour dans l'appli ; vu une fois, la liste se vide.
 */
export function useNotifsAExpliquer(): [{ titre: string; ligne: string }[], () => void] {
  const [liste, setListe] = useState<{ titre: string; ligne: string }[]>([]);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const lire = () => { void Natif.notifsAExpliquer().then((r) => { if (r.liste?.length) setListe((l) => [...l, ...r.liste]); }).catch(() => undefined); };
    lire();
    const h = CapApp.addListener('appStateChange', ({ isActive }) => { if (isActive) lire(); });
    return () => { void h.then((x) => x.remove()); };
  }, []);
  return [liste, () => setListe([])];
}
