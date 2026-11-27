// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _reinitialiser as reinitCompte, ecrire as ecrireCompte } from '../src/compte/auth';
import { _ecrit, _reinitialiser, charger, envoyerMessage, lire, partagerTrace, synchroniser, vue } from '../src/buddies/store';

// Copie locale dans IndexedDB (Seb, 27/11) : plus de plafond de 5 Mo, et la file reste à l'abri dans localStorage.
const vide = { curseur: 'C1', moi: 'u-seb', ids: [], groupes: [], refus: [], ids_sorties: [], sorties: [], ids_traces: [], traces: [],
  ids_plannings: [], plannings: [], ids_photos: [], photos: [], ids_depenses: [], depenses: [] };
const fermerEtRouvrir = async () => { await _ecrit(); _reinitialiser(); await charger(); };

beforeEach(() => {
  localStorage.clear(); reinitCompte(); _reinitialiser(); vi.unstubAllGlobals();
  vi.stubGlobal('indexedDB', new IDBFactory());
  ecrireCompte({ refresh: 'R', access: 'A', accessExp: Date.now() + 3600e3, config: { logto: 'https://auth.test', ressource: 'r', appId: 'a' } });
});

describe('copie locale dans IndexedDB', () => {
  it('reprend la copie d’avant (localStorage) une fois, puis la retire de localStorage', async () => {
    localStorage.setItem('buddies', JSON.stringify({ moi: 'u-seb', curseur: 'C0', serveur: [{ id: 'g1', nom: 'Ski', nature: 'bande', photo: null, modifie_le: '', membres: [], invitations: [] }],
      sorties: [], traces: [], plannings: [], photos: [], attente: [{ id: 'o1', type: 'quitter', groupe: 'g9', t: 1 }] }));
    await charger();
    expect(lire().serveur.map((g) => g.nom)).toEqual(['Ski']);
    expect(lire().attente.map((o) => o.id)).toEqual(['o1']);
    expect(localStorage.getItem('buddies')).toBeNull();
    await fermerEtRouvrir();
    expect(lire().curseur).toBe('C0');
    expect(lire().serveur.map((g) => g.nom)).toEqual(['Ski']);
  });

  it('une copie de plus de 5 Mo tient, et revient à la réouverture', async () => {
    await charger();
    const ligne = Array.from({ length: 20_000 }, (_, i) => [6 + i / 1e5, 44 + i / 1e5]);
    const traces = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, sortie: null, groupe: 'g1', nom: `Trace ${i}`, ligne, mot: '', par: { id: 'u-julie', pseudo: 'Julie', photo: null }, cree_le: '2026-11-27T10:00:00+00:00' }));
    expect(JSON.stringify(traces).length).toBeGreaterThan(5_000_000);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...vide, ids_traces: traces.map((t) => t.id), traces }), { status: 200 })));
    await synchroniser();
    expect(localStorage.getItem('buddies')).toBeNull(); // plus rien de gros dans localStorage
    await fermerEtRouvrir();
    expect(vue(lire()).traces.length).toBe(20);
    expect(lire().curseur).toBe('C1');
  });

  it('appli tuée juste après une action : la file est déjà dans localStorage', async () => {
    await charger();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    envoyerMessage({ groupe: 'g1' }, { texte: 'Écrit hors ligne' });
    partagerTrace('Col', [[6, 44], [6.1, 44.1]], '', { sorties: [], groupes: ['g1'] });
    // Tuée avant la fin de l'écriture IndexedDB : on repart d'une base vide, seule la petite clé reste.
    _reinitialiser(); vi.stubGlobal('indexedDB', new IDBFactory());
    await charger();
    expect(lire().attente.map((o) => o.type)).toEqual(['message', 'partager_trace']);
  });

  it('sans IndexedDB : tout reste dans localStorage, comme avant', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await charger();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(vide), { status: 200 })));
    await synchroniser();
    expect(JSON.parse(localStorage.getItem('buddies')!).curseur).toBe('C1');
  });
});
