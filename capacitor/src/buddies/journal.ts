/**
 * 📓 Journal de diagnostic des appels et de « Suis ma carte » (Seb, 27/11 : « écris des logs » ; « il ne faudrait pas
 * qu'il soit trop lourd, qu'il s'active seulement si on le demande »).
 * - Toujours : seulement les événements marquants (début et fin de partage, blocages, reconnexions, échecs), en
 *   mémoire, 1 000 lignes au plus ; rien sur le téléphone, rien au serveur.
 * - Mode diagnostic, allumé une heure par le Super User pour tous les téléphones : chaque message envoyé ou reçu
 *   (taille, délai), la route réseau toutes les 15 s, gardé sur le téléphone, et envoyé au serveur toutes les
 *   2 minutes et à la fin de chaque salle, où Claude le lit.
 * « Envoyer le journal » l'envoie à tout moment.
 */
import { api, connecte } from '../compte/auth';

const CLE = 'journal-carte';
const lignes: string[] = (() => { try { return JSON.parse(localStorage.getItem(CLE) ?? '[]') as string[]; } catch { return []; } })();
let garde: ReturnType<typeof setTimeout> | undefined;
/** Fin du mode diagnostic (secondes, horloge du serveur ; 0 : éteint). */
let diagJusqua = 0;
export const enDiagnostic = () => diagJusqua * 1000 > Date.now();
/** Nombre de lignes écrites depuis le démarrage, pour n'envoyer que les nouvelles. */
let ecrites = 0, envoyees = 0;

/** Une ligne marquante : heure (ms) puis ce qu'on veut, séparé par des espaces. */
export function noter(...x: (string | number | undefined | null)[]) {
  const d = new Date();
  lignes.push(`${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')} ${x.filter((v) => v !== undefined && v !== null && v !== '').join(' ')}`);
  ecrites++;
  const max = enDiagnostic() ? 4000 : 1000;
  if (lignes.length > max) lignes.splice(0, lignes.length - max);
  if (enDiagnostic() && !garde) garde = setTimeout(() => { garde = undefined; try { localStorage.setItem(CLE, JSON.stringify(lignes)); } catch { /* plein */ } }, 10_000);
}
/** Une ligne de détail (chaque message, la route réseau) : seulement en mode diagnostic. */
export function noterDetail(...x: (string | number | undefined | null)[]) { if (enDiagnostic()) noter(...x); }

export function journal(): string { return lignes.join('\n'); }
export function _viderJournal() { lignes.length = 0; }
export function _diagnostic(jusqua: number) { diagJusqua = jusqua; }

/** Le mode diagnostic est-il allumé ? (à l'entrée d'une salle, puis chaque minute pendant). */
export async function verifierDiagnostic() {
  if (!connecte()) return;
  const avant = enDiagnostic();
  diagJusqua = (await api<{ diagnostic_jusqua: number }>('GET', '/journaux/mode')).diagnostic_jusqua;
  if (enDiagnostic() !== avant) noter(enDiagnostic() ? 'mode diagnostic allumé' : 'mode diagnostic éteint');
}

/** Au serveur : les lignes nouvelles (ou tout, pour le bouton). Automatique seulement en mode diagnostic. */
export async function envoyerAuServeur(raison: string, tout = false) {
  if (!connecte() || (!tout && !enDiagnostic())) return;
  const n = Math.min(lignes.length, tout ? lignes.length : ecrites - envoyees);
  if (!n) return;
  const avant = ecrites;
  await api('POST', '/journaux', { texte: lignes.slice(-n).join('\n').slice(-390_000), raison });
  envoyees = avant;
}
