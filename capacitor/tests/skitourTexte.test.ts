import { describe, expect, it } from 'vitest';
import { filterRows, groupMassifs, type OutingRow } from '../src/ski/skitour';

const row = (id: number, titre: string, massif: string, auteurs: string): OutingRow => ({
  id, titre, date: 0, massif, sommet: '', altitude: null, lat: null, lon: null, denivele: null, dif_ski: null, orientation: '', auteurs, url: '',
});
const rows = [row(1, 'Monte Bellino, versant NE', 'Ubaye - Parpaillon', 'shams'), row(2, 'Première de la saison - La Clusaz', 'Aravis', 'beluga.gechar, Totox74')];

describe('skitour en texte', () => {
  it('filtre sans tenir compte des accents ni de la casse', () => {
    expect(filterRows(rows, 'premiere').map((o) => o.id)).toEqual([2]);
    expect(filterRows(rows, 'ubaye bellino').map((o) => o.id)).toEqual([1]);
    expect(filterRows(rows, 'totox74').map((o) => o.id)).toEqual([2]);
    expect(filterRows(rows, '  ')).toHaveLength(2);
  });
  it('groupe les massifs dans l\'ordre de l\'API', () => {
    expect(groupMassifs([{ id: 1, nom: 'Vercors', groupe: 'Isère' }, { id: 2, nom: 'Bauges', groupe: 'Savoie' }, { id: 3, nom: 'Belledonne', groupe: 'Isère' }]))
      .toEqual([['Isère', ['Belledonne', 'Vercors']], ['Savoie', ['Bauges']]]);
  });
});
