/**
 * Flux d'événements du serveur (SSE), repris de la messagerie d'AppBase (contretemps :
 * frontend/src/api/messages.js, `ouvrirFluxEvenements` ; Seb, 27/11 : « exactement comme AppBase »).
 * Serveur : deploy/comptes/evenements.py et GET /buddies/evenements.
 *
 * Un flux par appareil, ouvert tant que l'appli est à l'écran. Chaque événement dit « quelque chose a changé pour
 * toi » : on lance la synchro habituelle, qui ramène la donnée. Comme AppBase : le jeton voyage dans l'adresse
 * (EventSource n'envoie pas d'en-tête), on resynchronise à chaque (re)connexion (un événement parti pendant une
 * coupure est perdu, pas retardé), et on force la reconnexion au retour du réseau et au retour à l'écran (les
 * téléphones tardent à le faire seuls).
 *
 * Deux écarts, voulus :
 * - le jeton d'accès Logto ne vit qu'une heure (celui d'AppBase, 30 jours). EventSource se reconnecte seul avec la
 *   même adresse ; jeton périmé, le serveur répond 401 et EventSource abandonne pour de bon. On recrée alors le
 *   flux avec un jeton neuf, en espaçant les essais ;
 * - appli en arrière-plan, le flux est fermé : un ping toutes les 20 s garderait la radio du téléphone éveillée
 *   toute la rando. Le retour à l'écran le rouvre et resynchronise.
 */
import { API_URL, connecte, jetonAcces, suivre as suivreCompte } from '../compte/auth';
import { APPAREIL } from './store';

/** Ouvre le flux ; `synchro` est appelé à chaque événement et à chaque (re)connexion. Rend de quoi le fermer. */
export function ouvrirFluxEvenements(synchro: () => void): () => void {
  let source: EventSource | null = null;
  let essai: ReturnType<typeof setTimeout> | undefined;
  let delai = 5000, tour = 0, fini = false;

  const creer = async () => {
    clearTimeout(essai);
    source?.close(); source = null;
    const moi = ++tour;
    if (fini || typeof EventSource === 'undefined' || !connecte() || document.visibilityState !== 'visible') return;
    const plusTard = () => { essai = setTimeout(() => void creer(), delai); delai = Math.min(delai * 2, 60_000); };
    let jeton: string;
    try { jeton = await jetonAcces(); } catch { plusTard(); return; }
    if (fini || moi !== tour) return;
    const s = new EventSource(`${API_URL}/buddies/evenements?jeton=${encodeURIComponent(jeton)}`);
    source = s;
    // À chaque ouverture, la première aussi : ce qui a changé entre la dernière synchro et l'abonnement n'a pas
    // fait d'événement pour nous.
    s.onopen = () => { delai = 5000; synchro(); };
    s.onmessage = (e) => {
      try {
        const ev = JSON.parse(String(e.data)) as { type?: string; sauf?: string | null };
        if (ev.type === 'synchro' && ev.sauf !== APPAREIL) synchro();
      } catch { /* événement inconnu : ignoré */ }
    };
    s.onerror = () => { if (source === s && s.readyState === 2 /* CLOSED : il ne réessaiera plus */) plusTard(); };
  };
  const forcer = () => { void creer(); };

  forcer();
  window.addEventListener('online', forcer);
  document.addEventListener('visibilitychange', forcer);
  const finCompte = suivreCompte(() => { if (connecte() !== !!source) forcer(); });
  return () => {
    fini = true; clearTimeout(essai); source?.close(); source = null; finCompte();
    window.removeEventListener('online', forcer); document.removeEventListener('visibilitychange', forcer);
  };
}
