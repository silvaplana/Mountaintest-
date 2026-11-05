import { describe, expect, it } from 'vitest';
import { DETAILS_MAX, filterRows, groupMassifs, inView, mergeDetails, outingLabel, parkingText, uniqueParkings, withDetails, type Outing, type OutingRow } from '../src/ski/skitour';

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
  it('un seul parking quand deux sorties partent du même endroit', () => {
    const pk = { nom: '', altitude: null, lat: 45.3, lon: 6.58 };
    const os = [{ parking: pk }, { parking: { ...pk, nom: 'Val Thorens', altitude: 2300 } }, { parking: null }] as Outing[];
    expect(uniqueParkings(os, 1)).toEqual([{ i: 1, sel: true, p: { nom: 'Val Thorens', altitude: 2300, lat: 45.3, lon: 6.58 } }]);
    expect(uniqueParkings(os, null)).toEqual([{ i: 0, sel: false, p: { nom: 'Val Thorens', altitude: 2300, lat: 45.3, lon: 6.58 } }]);
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

describe('sorties de l\'écran', () => {
  it('garde les sorties dans l\'écran, dans l\'ordre reçu', () => {
    const os = [{ id: 1, lat: 45, lon: 6 }, { id: 2, lat: 46, lon: 8 }, { id: 3, lat: 45.5, lon: 6.5 }] as Outing[];
    expect(inView(os, [5.5, 44.5, 7, 46]).map((o) => o.id)).toEqual([1, 3]);
    expect(inView(os, [5.5, 44.5, 7, 46], 1).map((o) => o.id)).toEqual([1]);
  });
  it('détails gardés : les plus récents, DETAILS_MAX au plus', () => {
    const old = mergeDetails({}, Object.fromEntries(Array.from({ length: DETAILS_MAX }, (_, i) => [String(i), { etoiles: 1 }])));
    const m = mergeDetails(old, { 0: { etoiles: 3 }, 9999: { etoiles: 2 } });
    expect(Object.keys(m).length).toBe(DETAILS_MAX);
    expect(withDetails({ id: 1, etoiles: null } as Outing, m).etoiles).toBeNull();
    expect(withDetails({ id: 0, etoiles: null } as Outing, m).etoiles).toBe(3);
    expect(withDetails({ id: 9999, etoiles: null } as Outing, m).etoiles).toBe(2);
  });
});
