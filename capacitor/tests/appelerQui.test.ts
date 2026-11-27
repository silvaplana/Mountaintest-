// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/buddies/Buddies', () => ({ useBuddies: vi.fn(), Visage: vi.fn() }));
vi.mock('../src/buddies/appel', () => ({ appeler: vi.fn(), appelEnCours: vi.fn() }));
import { noterAppel, simple } from '../src/buddies/AppelerQui';

describe('« Appeler qui ? »', () => {
  it('cherche sans accents ni majuscules', () => {
    expect(simple('Éric du Jeudi').includes(simple('eric'))).toBe(true);
    expect(simple('Julie').includes(simple('JU'))).toBe(true);
  });
  it('met le dernier appelé en tête', () => {
    noterAppel('g:1'); noterAppel('b:2'); noterAppel('g:1');
    expect(JSON.parse(localStorage.getItem('appels-recents')!)).toEqual(['g:1', 'b:2']);
  });
});
