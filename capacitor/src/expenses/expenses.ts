// Partage des frais façon Tricount : groupes, participants (nom, e-mail facultatif), dépenses, équilibres.
// Stocké dans le téléphone (localStorage), même modèle côté Kotlin (Expenses.kt).

export interface Member { id: string; name: string; email?: string }
export interface Expense { id: string; title: string; amount: number; paidBy: string; forIds: string[]; date: string }
export interface Group { id: string; name: string; emoji: string; members: Member[]; me: string; expenses: Expense[] }

const KEY = 'depenses';
export const EMOJIS = ['💰', '⛰', '🎿', '🏕', '🚗', '🏖', '🍽', '🏠'];

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function loadGroups(): Group[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function saveGroups(g: Group[]) {
  try { localStorage.setItem(KEY, JSON.stringify(g)); } catch { /* stockage plein ou indisponible */ }
}

/** Centimes, pour éviter les erreurs d'arrondi. */
const c = (v: number) => Math.round(v * 100);

/** Solde de chacun en euros : payé − sa part (positif : on lui doit ; négatif : il doit). */
export function balances(g: Group): Record<string, number> {
  const b: Record<string, number> = Object.fromEntries(g.members.map((m) => [m.id, 0]));
  for (const e of g.expenses) {
    const who = e.forIds.filter((id) => id in b);
    if (!who.length || !(e.paidBy in b)) continue;
    const total = c(e.amount);
    const share = Math.floor(total / who.length);
    let rest = total - share * who.length; // les centimes restants vont aux premiers
    b[e.paidBy] += total;
    for (const id of who) { b[id] -= share + (rest > 0 ? 1 : 0); rest--; }
  }
  return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v / 100]));
}

/** Remboursements pour tout équilibrer, en peu de virements (le plus gros débiteur paie le plus gros créancier). */
export function settlements(g: Group): { from: string; to: string; amount: number }[] {
  const b = Object.entries(balances(g)).map(([id, v]) => ({ id, v: c(v) }));
  const out: { from: string; to: string; amount: number }[] = [];
  for (;;) {
    const debt = b.filter((x) => x.v < 0).sort((x, y) => x.v - y.v)[0];
    const cred = b.filter((x) => x.v > 0).sort((x, y) => y.v - x.v)[0];
    if (!debt || !cred) break;
    const a = Math.min(-debt.v, cred.v);
    out.push({ from: debt.id, to: cred.id, amount: a / 100 });
    debt.v += a; cred.v -= a;
  }
  return out;
}

export const total = (g: Group) => g.expenses.reduce((s, e) => s + c(e.amount), 0) / 100;

/** Ce que « moi » a payé. */
export const paidBy = (g: Group, id: string) => g.expenses.filter((e) => e.paidBy === id).reduce((s, e) => s + c(e.amount), 0) / 100;

export const money = (v: number) => `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export const memberName = (g: Group, id: string) => g.members.find((m) => m.id === id)?.name ?? '?';
