import { describe, expect, it } from 'vitest';
import { duree, enLigne, type EtatAppel } from '../src/buddies/appel';

const e = (parle: string[]): EtatAppel => ({
  id: 'a', nom: 'Week-end Queyras', dest: { sortie: 's' }, phase: 'en_ligne', voix: [{ id: 'j', pseudo: 'Julie' }, { id: 'l', pseudo: 'Luc' }], parle, muet: false,
});

describe('appel', () => {
  it('durée en minutes et secondes', () => {
    expect(duree(192_400)).toBe('3:12');
    expect(duree(5_000)).toBe('0:05');
    expect(duree(-1)).toBe('0:00');
  });
  it('qui parle d’abord, puis les autres', () => {
    expect(enLigne(e(['j']))).toBe('Julie parle… · Luc');
    expect(enLigne(e([]))).toBe('Julie, Luc');
    expect(enLigne(e(['j', 'l']))).toBe('Julie, Luc parlent…');
    expect(enLigne({ ...e([]), voix: [] })).toBe('personne encore');
  });
});
