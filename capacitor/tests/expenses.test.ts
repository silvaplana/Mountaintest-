import { describe, expect, it } from 'vitest';
import { balances, settlements, total, type Group } from '../src/expenses/expenses';

const g: Group = {
  id: 'g', name: 'Ski', emoji: '🎿', me: 'a',
  members: [{ id: 'a', name: 'Seb' }, { id: 'b', name: 'Ben' }, { id: 'c', name: 'Jac' }],
  expenses: [
    { id: '1', title: 'Forfaits', amount: 90, paidBy: 'a', forIds: ['a', 'b', 'c'], date: '2026-11-03' },
    { id: '2', title: 'Courses', amount: 10, paidBy: 'b', forIds: ['a', 'b', 'c'], date: '2026-11-03' },
  ],
};

describe('partage des frais', () => {
  it('soldes et total', () => {
    expect(total(g)).toBe(100);
    const b = balances(g);
    expect(b.a + b.b + b.c).toBeCloseTo(0);
    expect(b.a).toBeCloseTo(56.66, 1);
  });
  it('remboursements', () => {
    const s = settlements(g);
    expect(s.every((x) => x.to === 'a')).toBe(true);
    expect(s.reduce((t, x) => t + x.amount, 0)).toBeCloseTo(56.66, 1);
  });
});
