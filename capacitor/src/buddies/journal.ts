/**
 * 📓 Journal de diagnostic des appels et de « Suis ma carte » (Seb, 27/11 : « écris des logs, je te dirai quand ça
 * merde »). Léger : une ligne courte par événement, en mémoire, 4 000 lignes au plus (les plus vieilles sautent),
 * gardée sur le téléphone toutes les 10 s pour survivre à un redémarrage de l'appli. « Envoyer le journal » le
 * partage en fichier texte.
 */
const CLE = 'journal-carte';
const MAX = 4000;
const lignes: string[] = (() => { try { return JSON.parse(localStorage.getItem(CLE) ?? '[]') as string[]; } catch { return []; } })();
let garde: ReturnType<typeof setTimeout> | undefined;

/** Une ligne : heure (ms) puis ce qu'on veut, séparé par des espaces. */
export function noter(...x: (string | number | undefined | null)[]) {
  const d = new Date();
  lignes.push(`${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')} ${x.filter((v) => v !== undefined && v !== null && v !== '').join(' ')}`);
  if (lignes.length > MAX) lignes.splice(0, lignes.length - MAX);
  if (!garde) garde = setTimeout(() => { garde = undefined; try { localStorage.setItem(CLE, JSON.stringify(lignes)); } catch { /* plein */ } }, 10_000);
}

export function journal(): string { return lignes.join('\n'); }
export function _viderJournal() { lignes.length = 0; }
