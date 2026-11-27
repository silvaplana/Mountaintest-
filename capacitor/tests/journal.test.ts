import { describe, expect, it } from 'vitest';
import { _viderJournal, journal, noter } from '../src/buddies/journal';

describe('📓 journal de diagnostic', () => {
  it('une ligne horodatée par événement, 4 000 au plus', () => {
    _viderJournal();
    noter('→', 'trait', 'sûr', '5403o', undefined, '');
    expect(journal()).toMatch(/^\d\d:\d\d:\d\d\.\d{3} → trait sûr 5403o$/);
    for (let i = 0; i < 4100; i++) noter('x', i);
    const l = journal().split('\n');
    expect(l).toHaveLength(4000);
    expect(l[l.length - 1]).toMatch(/x 4099$/);
  });
});
