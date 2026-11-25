import { describe, expect, it } from 'vitest';
import { aMontrer, changements } from '../src/buddies/budPhotos';
import type { PhotoBuddy } from '../src/buddies/store';

const photo = (id: string, plus: Partial<PhotoBuddy> = {}): PhotoBuddy => ({
  id, sortie: 's', par: { id: 'moi', pseudo: 'Moi', photo: '' } as PhotoBuddy['par'], prise_le: `2026-05-01T10:${id.padStart(2, '0')}:00`, lon: null, lat: null,
  etoile: false, envoyee: true, modifie_le: '', ...plus,
});

describe('Bud choisit les photos du carnet', () => {
  it('ne montre pas les films, et répartit sur toute la sortie au-delà de la limite', () => {
    const l = [photo('1'), photo('2', { video: true }), photo('3')];
    expect(aMontrer(l).map((p) => p.id)).toEqual(['1', '3']);
    const beaucoup = Array.from({ length: 30 }, (_, i) => photo(String(i)));
    const m = aMontrer(beaucoup, 10);
    expect(m).toHaveLength(10);
    expect(m[0].id).toBe('0');
    expect(m[9].id).toBe('27');
  });

  it('le choix remplace les ⭐ d’avant, sans toucher aux films', () => {
    const l = [photo('1', { etoile: true }), photo('2'), photo('3', { etoile: true }), photo('4', { video: true, etoile: true })];
    expect(changements(l, ['2', '3'])).toEqual([{ id: '1', etoile: false }, { id: '2', etoile: true }]);
  });
});
