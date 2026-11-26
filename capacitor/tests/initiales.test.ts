import { describe, expect, it } from 'vitest';
import { initialesDe } from '../src/compte/auth';

describe('initiales', () => {
  it('une lettre par mot, chiffres et séparateurs ignorés (Seb, 26/11)', () => {
    expect(initialesDe('sebastien.richard54')).toBe('SR');
    expect(initialesDe('sebastien.richard54@gmail.com')).toBe('SR');
    expect(initialesDe('Marc Dupont')).toBe('MD');
    expect(initialesDe('jean-luc_martin')).toBe('JL');
    expect(initialesDe('élise')).toBe('É');
    expect(initialesDe('luc')).toBe('L');
    expect(initialesDe('54')).toBe('5');
  });
});
