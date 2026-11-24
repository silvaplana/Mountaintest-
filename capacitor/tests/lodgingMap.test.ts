import { describe, expect, it } from 'vitest';
import { placeLodgings, type Lodging } from '../src/Lodging';

const l = (nom: string, adresse: string): Lodging => ({ nom, type: 'gîte', prix_nuit: 20, adresse, url: '', resume: '' });
const place = (lon: number) => ({ label: '', detail: '', lon, lat: 44, zoom: 14 });

describe('placeLodgings', () => {
  it('uses the address, then the name, and drops what is not found', async () => {
    const asked: string[] = [];
    const find = async (q: string) => { asked.push(q); return q === '05350 Ceillac' ? [place(6.78)] : q === 'Refuge du Viso' ? [place(7.05)] : []; };
    const r = await placeLodgings([l('Gîte A', '05350 Ceillac'), l('Refuge du Viso', 'Ristolas'), l('Nulle part', '')], find);
    expect(r.map((x) => [x.nom, x.lon])).toEqual([['Gîte A', 6.78], ['Refuge du Viso', 7.05]]);
    expect(asked.sort()).toEqual(['05350 Ceillac', 'Nulle part', 'Refuge du Viso', 'Ristolas']);
  });
  it('a failing lookup falls back to the name', async () => {
    const find = async (q: string) => { if (q === 'x rue') throw new Error('réseau'); return [place(6)]; };
    expect((await placeLodgings([l('Gîte B', 'x rue')], find)).length).toBe(1);
  });
});
