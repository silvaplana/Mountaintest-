import { describe, expect, it } from 'vitest';
import { parDernierOuvert } from '../src/buddies/recents';
import { readLien } from '../src/trails/savedTraces';
import { nomLien } from '../src/buddies/recents';
import type { Sortie } from '../src/buddies/store';

describe('associer une trace à une sortie', () => {
  it('les derniers ouverts passent devant, les autres gardent leur ordre', () => {
    const l = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
    expect(parDernierOuvert(l, ['c', 'x', 'a']).map((x) => x.id)).toEqual(['c', 'a', 'b', 'd']);
  });
  it('lit un lien gardé, refuse un lien abîmé', () => {
    expect(readLien({ groupe: 'g', sortie: 's' })).toEqual({ groupe: 'g', sortie: 's' });
    expect(readLien({ groupe: 'g' })).toEqual({ groupe: 'g', sortie: null });
    expect(readLien({ sortie: 's' })).toBeNull();
    expect(readLien(undefined)).toBeNull();
  });
  it('nomme la sortie, ou le groupe seul', () => {
    const x = { id: 's', groupe: 'g', nom: 'Week-end Écrins' } as Sortie;
    const gs = [{ id: 'g', nom: 'Les Lyonnais', nature: 'bande' }, { id: 'm', nom: 'x', nature: 'me_time' }];
    expect(nomLien({ groupe: 'g', sortie: 's' }, [x], gs)).toMatchObject({ titre: 'Week-end Écrins', sous: 'Les Lyonnais' });
    expect(nomLien({ groupe: 'm', sortie: null }, [x], gs)).toMatchObject({ titre: 'Me Time', sous: 'tout le groupe' });
  });
});
