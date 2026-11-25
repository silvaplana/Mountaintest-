import { describe, expect, it } from 'vitest';
import { cutSpurs, moveNode, piecesOf, nearestIndex, replaceSlice, snapToWays, splineNodes, splineNodesEvery, wayRunsOf } from '../src/trails/edit';
import { readPins } from '../src/trails/savedTraces';
import { distanceM } from '../src/gps/adaptive';
import type { LonLat } from '../src/trails/osmTrails';

// Un pas de 0,001° de longitude ≈ 81 m à 43° de latitude, 0,0001° de latitude ≈ 11 m.
const ligne = (n: number, lat = 43.2): LonLat[] => Array.from({ length: n }, (_, i) => ({ lon: 5.6 + i * 0.001, lat }));

describe('✏ recoller un morceau sur les chemins', () => {
  // Un chemin à 22 m au nord de la première moitié de la trace, rien sur la seconde.
  const chemin = [{ lon: 5.599, lat: 43.2002 }, { lon: 5.605, lat: 43.2002 }];
  const seg = ligne(11);
  const s = snapToWays(seg, [chemin], 40);

  it('pose sur le chemin ce qui est près, garde le tracé ailleurs', () => {
    expect(s.share).toBeGreaterThan(40);
    expect(s.share).toBeLessThan(60);
    const milieuDebut = s.line[Math.floor(s.line.length / 4)];
    expect(milieuDebut.lat).toBeCloseTo(43.2002, 6);
    const milieuFin = s.line[Math.floor((s.line.length * 3) / 4)];
    expect(milieuFin.lat).toBeCloseTo(43.2, 6);
    expect(s.onWay[Math.floor((s.line.length * 3) / 4)]).toBe(false);
  });
  it('garde les deux bouts du morceau attachés à la trace', () => {
    expect(s.line[0]).toEqual(seg[0]);
    expect(s.line[s.line.length - 1]).toEqual(seg[seg.length - 1]);
  });
  it('repère les morceaux continus sur chemin', () => {
    const runs = wayRunsOf(s);
    expect(runs.length).toBe(1);
    expect(s.onWay[runs[0][0]]).toBe(true);
  });
  it('ne change rien sans chemin', () => {
    const r = snapToWays(seg, [], 40);
    expect(r.share).toBe(0);
    expect(r.line.length).toBeGreaterThan(seg.length);
  });
  it('remplace seulement le morceau choisi, dans un sens ou dans l’autre', () => {
    const part = [{ lon: 0, lat: 0 }];
    expect(replaceSlice(seg, 2, 4, part)).toHaveLength(seg.length - 2);
    expect(replaceSlice(seg, 4, 2, part)).toEqual(replaceSlice(seg, 2, 4, part));
    expect(replaceSlice(seg, 2, 4, part)[2]).toEqual(part[0]);
  });
  it('trouve le point de la trace le plus proche', () => {
    expect(nearestIndex(seg, { lon: 5.6031, lat: 43.2001 }).i).toBe(3);
  });
});

describe('✏ mode souple', () => {
  const l = ligne(50);
  it('répartit les ronds, départ et arrivée compris', () => {
    const n = splineNodes(l, 8);
    expect(n).toHaveLength(8);
    expect(n[0]).toBe(0);
    expect(n[7]).toBe(49);
  });
  it('ne change la trace qu’entre les deux voisins du rond déplacé', () => {
    const nodes = splineNodes(l, 8);
    const p = { lon: l[nodes[3]].lon, lat: 43.21 };
    const r = moveNode(l, nodes, 3, p);
    expect(r.line[0]).toEqual(l[0]);
    expect(r.line[r.line.length - 1]).toEqual(l[l.length - 1]);
    expect(r.line.slice(0, nodes[2] + 1)).toEqual(l.slice(0, nodes[2] + 1));
    expect(r.line[r.nodes[3]].lat).toBeCloseTo(43.21, 6);
    expect(r.line[r.nodes[4]]).toEqual(l[nodes[4]]);
    expect(r.nodes).toHaveLength(8);
    // La courbe passe d'un voisin au suivant sans saut.
    for (let i = 1; i < r.line.length; i++) expect(distanceM(r.line[i - 1], r.line[i])).toBeLessThan(600);
  });
});

describe('📍 points lus du téléphone', () => {
  it('garde ceux qui ont une position', () => {
    expect(readPins([{ lon: 5, lat: 43, txt: 'Source' }, { lat: 1 }, null])).toEqual([{ lon: 5, lat: 43, txt: 'Source', vu: true }]);
    expect(readPins('rien')).toEqual([]);
  });
});

describe('✏ houppettes du recollage (Seb, 25/11)', () => {
  // Une ligne droite de 5 points (~325 m) ; au milieu, un aller-retour de ~55 m vers le nord.
  const droite = ligne(5);
  const m = droite[2], haut = { lon: m.lon, lat: m.lat + 0.0005 };
  const avecPointe = [droite[0], droite[1], m, haut, { ...m, lon: m.lon + 0.00002 }, droite[3], droite[4]];
  it('enlève un aller-retour qui part loin du dessin', () => {
    const r = cutSpurs(avecPointe, droite);
    expect(r).not.toContainEqual(haut);
    expect(Math.max(...r.map((p) => distanceM(p, { ...p, lat: 43.2 })))).toBeLessThan(1);
  });
  it('garde un aller-retour que le dessin fait lui-même', () => {
    expect(cutSpurs(avecPointe, avecPointe)).toContainEqual(haut);
  });
  it('garde un lacet (les deux branches restent écartées)', () => {
    const lacet = [droite[0], droite[2], { lon: droite[2].lon, lat: 43.2006 }, { lon: droite[2].lon + 0.0003, lat: 43.2006 }, { lon: droite[2].lon + 0.0003, lat: 43.2 }, droite[4]];
    expect(cutSpurs(lacet, droite)).toHaveLength(lacet.length);
  });
});

describe('✏ ronds du mode souple selon le zoom', () => {
  const l = ligne(50); // ~3,97 km
  it('espace les ronds selon l’écart voulu, avec un plafond', () => {
    expect(splineNodesEvery(l, 500)).toHaveLength(9);
    expect(splineNodesEvery(l, 2000)).toHaveLength(3);
    expect(splineNodesEvery(l, 1).length).toBeLessThanOrEqual(50);
    expect(splineNodesEvery(l, 1e6)).toEqual([0, 49]);
  });
});

describe('✏ recoller un long morceau par petits bouts', () => {
  it('coupe en morceaux d’au plus 1,5 km qui se touchent', () => {
    const l = ligne(50); // ~3,97 km
    const p = piecesOf(l, 1500);
    expect(p.length).toBe(3);
    expect(p[0][0]).toBe(0);
    expect(p[p.length - 1][1]).toBe(49);
    for (let i = 1; i < p.length; i++) expect(p[i][0]).toBe(p[i - 1][1]);
  });
  it('un court morceau reste entier', () => {
    expect(piecesOf(ligne(5), 1500)).toEqual([[0, 4]]);
  });
});

describe('✏ houppette longue, en cul-de-sac (Seb, 25/11)', () => {
  it('enlève un aller-retour de 300 m que le dessin ne fait pas', () => {
    const d = ligne(5);
    const m = d[2];
    const aller = Array.from({ length: 10 }, (_, k) => ({ lon: m.lon, lat: m.lat + 0.0003 * (k + 1) }));
    const tracé = [d[0], d[1], m, ...aller, ...aller.slice(0, -1).reverse(), { ...m, lon: m.lon + 0.00003 }, d[3], d[4]];
    const r = cutSpurs(tracé, d);
    expect(r.length).toBe(6);
  });
});
