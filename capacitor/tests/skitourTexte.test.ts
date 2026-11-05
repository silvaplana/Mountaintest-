import { describe, expect, it } from 'vitest';
import { filterRows, groupMassifs, outingLabel, parkingText, type Outing, type OutingRow } from '../src/ski/skitour';

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
  it('étiquette du parking : nom et altitude', () => {
    expect(parkingText({ nom: 'Chiazale', altitude: 1650, lat: 44.5, lon: 7 })).toBe('Chiazale (1650 m)');
    expect(parkingText({ nom: '', altitude: null, lat: 44.5, lon: 7 })).toBe('');
  });
  it('étiquette du point : sommet, altitude, versant, ski, D+, étoiles, skiabilité, jours', () => {
    const now = Date.UTC(2026, 10, 5, 19);
    const o = { titre: 'Monte Bellino, versant NE', sommet: 'Monte Bellino', altitude: 2942, orientation: 'NE', dif_ski: '2.3', denivele: 200,
      etoiles: 2, skiabilite: '🤢 Mauvaise', date: Date.UTC(2026, 9, 28, 10) / 1000 } as Outing;
    expect(outingLabel(o, now)).toBe('Monte Bellino (2942 m), NE\nski 2.3, D+200 m, ★★\nskiabilité 🤢 Mauvaise, il y a 8 j');
    expect(outingLabel({ ...o, sommet: '', altitude: null, orientation: '', dif_ski: null, denivele: null, etoiles: 0, skiabilite: '', date: now / 1000 }, now))
      .toBe("Monte Bellino, versant NE\naujourd'hui");
  });
});
