/**
 * Buddy count d'une sortie (spec/buddies.md §5.10) : le partage des frais existant (expenses/expenses.ts),
 * partagé entre téléphones. Mêmes calculs (équilibres, « qui doit à qui ») ; côté Kotlin : BuddyCount.kt.
 */
import { balances, settlements, type Group } from '../expenses/expenses';
import type { Depense, Sortie } from './store';

/** Les dépenses d'une sortie vues comme un groupe du partage des frais (montants en euros). */
export function groupeDe(x: Sortie, depenses: Depense[], moi: string): Group {
  return {
    id: x.id, name: x.nom, emoji: '', me: moi,
    members: x.participants.map((p) => ({ id: p.id, name: p.pseudo })),
    // « J'ai payé » pas encore confirmé : ne compte pas dans les équilibres (Seb, 26/11).
    expenses: depenses.filter((d) => d.sortie === x.id && d.remb !== 'annonce').map((d) => ({ id: d.id, title: d.titre, amount: d.montant / 100, paidBy: d.paye_par, forIds: d.pour, date: d.jour })),
  };
}

export type Compte = { total: number; chacun: number; soldes: Record<string, number>; virements: { from: string; to: string; amount: number }[] };
/** Total (centimes), part moyenne, solde de chacun (euros, + : on lui doit) et remboursements. */
export function compte(x: Sortie, depenses: Depense[], moi: string): Compte {
  const g = groupeDe(x, depenses, moi);
  const total = depenses.filter((d) => d.sortie === x.id && !d.remb).reduce((n, d) => n + d.montant, 0);
  return { total, chacun: x.participants.length ? Math.round(total / x.participants.length) : 0, soldes: balances(g), virements: settlements(g) };
}

/** Équilibré (Seb, 26/11) : il y a des dépenses et plus personne ne doit rien à personne. */
export const equilibre = (c: Compte) => c.total > 0 && !c.virements.length;

/** « 106 € », « 12,50 € » (centimes). */
export function euros(c: number) {
  const v = Math.abs(c) / 100;
  const t = Number.isInteger(v) ? v.toLocaleString('fr-FR') : v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${c < 0 ? '−' : ''}${t} €`;
}
/** « 12,5 » ou « 12,50 € » tapé → centimes ; null si illisible. */
export function lireEuros(s: string): number | null {
  const t = s.replace(/[\s €]/g, '').replace(',', '.');
  return /^\d+(\.\d{1,2})?$/.test(t) && +t > 0 ? Math.round(+t * 100) : null;
}

const ICONES: [RegExp, string][] = [
  [/forfait|remont[ée]e|location (de )?ski|skis?\b/i, '🎿'],
  [/g[iî]te|refuge|h[oô]tel|chambre|nuit|camping|location|appart/i, '🏨'],
  [/essence|gasoil|carburant|p[ée]age|parking|voiture|autoroute/i, '⛽'],
  [/train|bus|navette|t[ée]l[ée]ph[ée]rique|avion/i, '🚆'],
  [/resto|restaurant|repas|pizza|caf[ée]|bi[eè]re|bar\b|ap[ée]ro/i, '🍽'],
  [/courses|fromage|pain|march[ée]|supermarch|pique/i, '🧀'],
];
/** Une icône devinée depuis le titre (gîte 🏨, essence ⛽, courses 🧀…), sinon 💶. */
export const icone = (titre: string) => ICONES.find(([r]) => r.test(titre))?.[1] ?? '💶';
