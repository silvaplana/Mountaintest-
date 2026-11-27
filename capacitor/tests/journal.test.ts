import { describe, expect, it } from 'vitest';
import { _diagnostic, _viderJournal, journal, noter, noterDetail } from '../src/buddies/journal';

describe('📓 journal de diagnostic', () => {
  it('hors mode diagnostic : pas de détail, 1 000 lignes au plus', () => {
    _diagnostic(0); _viderJournal();
    noterDetail('→', 'trait');
    expect(journal()).toBe('');
    for (let i = 0; i < 1100; i++) noter('x', i);
    expect(journal().split('\n')).toHaveLength(1000);
  });
  it('mode diagnostic : une ligne horodatée par événement, 4 000 au plus', () => {
    _diagnostic(Date.now() / 1000 + 3600); _viderJournal();
    noterDetail('→', 'trait', 'sûr', '5403o', undefined, '');
    expect(journal()).toMatch(/^\d\d:\d\d:\d\d\.\d{3} → trait sûr 5403o$/);
    for (let i = 0; i < 4100; i++) noter('x', i);
    const l = journal().split('\n');
    expect(l).toHaveLength(4000);
    expect(l[l.length - 1]).toMatch(/x 4099$/);
    _diagnostic(0);
  });
});
