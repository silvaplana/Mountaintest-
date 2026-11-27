// 💾 Mes traces gardées aussi sur le serveur des comptes (Seb, 27/11 : une réinstallation avait tout effacé).
// À chaque changement (et au démarrage, et à la connexion), le téléphone envoie ses traces ; s'il lui en manque
// (appli réinstallée, nouveau téléphone), il reprend celles du serveur. Sans compte ou sans réseau : rien, on réessaie plus tard.
import { api, connecte, suivre } from '../compte/auth';
import { annoncerRestauration } from '../compte/Restauration';
import { deletedIds, forgetDeleted, listTraces, restoreTraces, TRACES_CHANGED, type SavedTrace } from './savedTraces';

let enCours: Promise<void> | null = null;
let encore = false;

async function synchro() {
  if (!connecte()) return;
  const r = await api<{ traces: unknown[] }>('GET', '/mes-traces');
  const avant = (await listTraces()).length;
  const revenues = await restoreTraces(r.traces ?? []);
  // Mes traces vides (appli installée) et des traces reviennent : l'encart le dit (compte/Restauration.tsx).
  if (!avant && revenues > 0) annoncerRestauration({ traces: revenues });
  const effacees = await deletedIds();
  // « fichier » ne vaut que pour ce téléphone : pas envoyé.
  const traces = (await listTraces()).map(({ fichier: _f, ...t }: SavedTrace) => t);
  await api('PUT', '/mes-traces', { traces, supprimees: effacees });
  await forgetDeleted(effacees);
}

/** Lance une synchro (une seule à la fois ; une demande pendant qu'elle tourne en relance une après). */
export function sauvegarderTraces(): Promise<void> {
  if (enCours) { encore = true; return enCours; }
  enCours = synchro().catch(() => {}).finally(() => {
    enCours = null;
    if (encore) { encore = false; void sauvegarderTraces(); }
  });
  return enCours;
}

/** Au démarrage, à chaque connexion et après chaque changement de Mes traces (3 s après le dernier). */
export function suivreSauvegardeTraces(): () => void {
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  const bientot = (ms = 3000) => { clearTimeout(minuteur); minuteur = setTimeout(() => void sauvegarderTraces(), ms); };
  const change = () => bientot();
  window.addEventListener(TRACES_CHANGED, change);
  let etait = connecte();
  const stop = suivre((e) => { const est = connecte(e); if (est && !etait) bientot(0); etait = est; });
  bientot(5000);
  return () => { clearTimeout(minuteur); window.removeEventListener(TRACES_CHANGED, change); stop(); };
}
