import { describe, expect, it } from 'vitest';
import { placeLabels } from '../src/ski/labels';

describe('placement des étiquettes', () => {
  it('à droite du point quand la place est libre', () => {
    expect(placeLabels([{ x: 100, y: 100, w: 80, h: 30 }], [{ x: 100, y: 100 }])).toEqual([[13, -15]]);
  });
  it('près du bord droit : à gauche du point', () => {
    expect(placeLabels([{ x: 300, y: 100, w: 80, h: 30 }], [{ x: 300, y: 100 }], { w: 320, h: 600 })).toEqual([[-93, -15]]);
  });
  it('deux points proches : la deuxième étiquette va ailleurs, sans chevauchement', () => {
    const items = [{ x: 100, y: 100, w: 120, h: 40 }, { x: 110, y: 105, w: 120, h: 40 }];
    const [a, b] = placeLabels(items, items);
    const ra = [100 + a[0], 100 + a[1], 220 + a[0], 140 + a[1]];
    const rb = [110 + b[0], 105 + b[1], 230 + b[0], 145 + b[1]];
    const inter = Math.max(0, Math.min(ra[2], rb[2]) - Math.max(ra[0], rb[0])) * Math.max(0, Math.min(ra[3], rb[3]) - Math.max(ra[1], rb[1]));
    expect(inter).toBe(0);
  });
});
