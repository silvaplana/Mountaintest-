import { describe, expect, it } from 'vitest';
import { addToCache, CACHE_MAX, fromCache, type Outing } from '../src/ski/skitour';
import type { Bbox } from '../src/config';

const now = Date.UTC(2026, 10, 5) ;
const o = (id: number, lon: number, lat: number, daysAgo: number): Outing => ({
  id, titre: `s${id}`, date: now / 1000 - daysAgo * 86400, massif: '', sommet: '', altitude: null, lat, lon,
  denivele: null, dif_ski: null, orientation: '', conditions: '', auteur: '', url: '',
});
const ecrins: Bbox = [6.0, 44.8, 6.6, 45.1];

describe('skitour hors ligne', () => {
  it('remplace la même recherche et garde les 10 dernières', () => {
    let c = addToCache([], ecrins, 30, [o(1, 6.3, 45, 2)], now - 1000);
    c = addToCache(c, ecrins, 30, [o(2, 6.3, 45, 1)], now);
    expect(c).toHaveLength(1);
    expect(c[0].sorties[0].id).toBe(2);
    for (let i = 0; i < 15; i++) c = addToCache(c, [i, 0, i + 1, 1], 30, [], now);
    expect(c).toHaveLength(CACHE_MAX);
  });
  it('rend les sorties gardées dans une zone plus petite et une période plus courte', () => {
    const c = addToCache([], ecrins, 90, [o(1, 6.3, 45, 2), o(2, 6.5, 44.9, 40), o(3, 6.1, 44.85, 5)], now - 3600e3);
    const r = fromCache(c, [6.2, 44.9, 6.6, 45.1], 30, now);
    expect(r?.sorties.map((x) => x.id)).toEqual([1]);
    expect(r?.t).toBe(now - 3600e3);
  });
  it('ne rend rien pour une zone jamais cherchée', () => {
    const c = addToCache([], ecrins, 30, [o(1, 6.3, 45, 2)], now);
    expect(fromCache(c, [5.5, 43.1, 5.7, 43.2], 30, now)).toBeNull();
  });
});
