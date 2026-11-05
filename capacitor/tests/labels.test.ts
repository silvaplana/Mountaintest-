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

describe('placement serré (sorties et parking)', () => {
  it('quatre étiquettes autour du même endroit ne se chevauchent pas', () => {
    const items = [{ x: 150, y: 200, w: 150, h: 40 }, { x: 160, y: 210, w: 150, h: 40 }, { x: 155, y: 225, w: 120, h: 18 }, { x: 145, y: 190, w: 150, h: 40 }];
    const o = placeLabels(items, items, { w: 400, h: 600 });
    const r = items.map((it, i) => [it.x + o[i][0], it.y + o[i][1], it.x + o[i][0] + it.w, it.y + o[i][1] + it.h]);
    let inter = 0;
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++)
      inter += Math.max(0, Math.min(r[i][2], r[j][2]) - Math.max(r[i][0], r[j][0])) * Math.max(0, Math.min(r[i][3], r[j][3]) - Math.max(r[i][1], r[j][1]));
    expect(inter).toBe(0);
  });
});
