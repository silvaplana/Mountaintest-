import { describe, expect, it } from 'vitest';
import { dansLeCercle, type Lodging, type PlacedLodging } from '../src/Lodging';

const l = (nom: string): Lodging => ({ nom, type: 'gîte', prix_nuit: 20, adresse: '', url: '', resume: '' });
const at = (nom: string, lat: number): PlacedLodging => ({ ...l(nom), lon: 6.78, lat });

describe('dansLeCercle', () => {
  it('drops placed lodgings beyond the radius, keeps unplaced ones in the list', () => {
    const centre = { lon: 6.78, lat: 44.67 };
    const tous = [l('Près'), l('Bord'), l('Loin'), l('Inconnu')];
    // 0.1° de latitude ≈ 11 km : dans 10 km + 25 % ; 0.2° ≈ 22 km : dehors.
    const places = [at('Près', 44.68), at('Bord', 44.77), at('Loin', 44.87)];
    const r = dansLeCercle(centre, 10, tous, places);
    expect(r.liste.map((h) => h.nom)).toEqual(['Près', 'Bord', 'Inconnu']);
    expect(r.carte.map((h) => h.nom)).toEqual(['Près', 'Bord']);
  });
});
