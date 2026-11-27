import { describe, expect, it } from 'vitest';
import { _recevoirDoigt, suivreDoigts, type Doigt } from '../src/buddies/appel';

describe('📍 Montrer du doigt : un repère par buddy, état écrasable', () => {
  it('garde la position la plus récente, jette une plus vieille arrivée en retard, enlève sur null', () => {
    const vus: Doigt[] = [];
    const stop = suivreDoigts((d) => vus.push(d));
    const julie = { id: 'julie', pseudo: 'Julie' };
    _recevoirDoigt([5.6, 43.2], 10, julie);
    _recevoirDoigt([5.7, 43.2], 12, julie);
    _recevoirDoigt([5.65, 43.2], 11, julie); // glissé « rapide » arrivé après : ignoré
    _recevoirDoigt(null, 13, julie);
    stop();
    expect(vus.map((d) => d.pos)).toEqual([[5.6, 43.2], [5.7, 43.2], null]);
    expect(vus[0].qui).toBe('Julie');
  });
});
