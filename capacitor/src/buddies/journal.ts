/**
 * 📓 Journal de diagnostic des appels et de « Suis ma carte » (Seb, 27/11 : « écris des logs, je te dirai quand ça
 * merde »). Léger : une ligne courte par événement, en mémoire, 4 000 lignes au plus (les plus vieilles sautent),
 * gardée sur le téléphone toutes les 10 s pour survivre à un redémarrage de l'appli. « Envoyer le journal » le
 * partage en fichier texte.
 */
import { api, connecte } from '../compte/auth';

const CLE = 'journal-carte';
const MAX = 4000;
const lignes: string[] = (() => { try { return JSON.parse(localStorage.getItem(CLE) ?? '[]') as string[]; } catch { return []; } })();
let garde: ReturnType<typeof setTimeout> | undefined;

/** Une ligne : heure (ms) puis ce qu'on veut, séparé par des espaces. */
export function noter(...x: (string | number | undefined | null)[]) {
  const d = new Date();
  lignes.push(`${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')} ${x.filter((v) => v !== undefined && v !== null && v !== '').join(' ')}`);
  ecrites++;
  if (lignes.length > MAX) lignes.splice(0, lignes.length - MAX);
  if (!garde) garde = setTimeout(() => { garde = undefined; try { localStorage.setItem(CLE, JSON.stringify(lignes)); } catch { /* plein */ } }, 10_000);
}

export function journal(): string { return lignes.join('\n'); }

/** Nombre de lignes écrites depuis le démarrage, pour n'envoyer que les nouvelles. */
let ecrites = 0, envoyees = 0;
/**
 * 📓 Le journal part au serveur (Seb, 27/11 : « que tu puisses toi-même voir les logs ») : tout seul à la fin d'une
 * salle (appel ou carte partagée), seulement les lignes nouvelles ; tout entier sur « Envoyer le journal ».
 */
export async function envoyerAuServeur(raison: string, tout = false) {
  if (!connecte()) return;
  const n = Math.min(lignes.length, tout ? lignes.length : ecrites - envoyees);
  if (!n) return;
  const avant = ecrites;
  await api('POST', '/journaux', { texte: lignes.slice(-n).join('\n').slice(-390_000), raison });
  envoyees = avant;
}
export function _viderJournal() { lignes.length = 0; }
