import { describe, expect, it } from 'vitest';
import { splitSpace } from '../src/offline/phoneSpace';

describe('place sur le téléphone', () => {
  it('données = ce qui reste une fois les cartes et les photos comptées', () => {
    expect(splitSpace(1300, 940, 310, 21000)).toEqual({ cartes: 940, photos: 310, donnees: 50, total: 1300, libre: 21000 });
  });
  it('jamais négatif si la mesure globale est plus petite que les parts', () => {
    const s = splitSpace(100, 940, 310, null);
    expect(s.donnees).toBe(0);
    expect(s.total).toBe(1250);
  });
});
