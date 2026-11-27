// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

// 🗺 Seb, 27/11 : le suivi de carte se figeait. Les envois ne s'empilent plus : un seul en route par nature, le dernier gagne.
const envois: { m: { trait?: number[][]; carte?: unknown }; reliable: boolean; fini: () => void }[] = [];
vi.mock('livekit-client', () => {
  class Room {
    remoteParticipants = new Map([['julie', { identity: 'julie', name: 'Julie' }]]);
    localParticipant = {
      setMicrophoneEnabled: vi.fn(async () => undefined),
      publishData: (d: Uint8Array, o: { reliable: boolean }) => new Promise<void>((ok) => { envois.push({ m: JSON.parse(new TextDecoder().decode(d)), reliable: o.reliable, fini: ok }); }),
    };
    on() { return this; }
    connect = vi.fn(async () => undefined);
    disconnect = vi.fn(async () => undefined);
    startAudio = vi.fn(async () => undefined);
  }
  return { Room, RoomEvent: {}, Track: { Kind: {} } };
});
vi.mock('../src/compte/auth', () => ({ api: vi.fn(async (_m: string, c: string) => (c === '/appels' ? { id: 'a1', groupe: 'g1', sortie: null, en_ligne: [], url: 'w', jeton: 'j' } : {})) }));
vi.mock('../src/buddies/store', () => ({ envoyerMessage: vi.fn(), synchroniser: vi.fn(async () => []) }));

describe('file d\'envoi de la carte', () => {
  it('un trait à la fois, et seulement le dernier quand le réseau traîne', async () => {
    const { appeler, appelEnCours, envoyerCarte, montrerMaCarte, raccrocher } = await import('../src/buddies/appel');
    await appeler({ groupe: 'g1' }, 'Ski');
    expect(appelEnCours()?.phase).toBe('en_ligne');
    montrerMaCarte(true);
    for (let i = 1; i <= 10; i++) envoyerCarte({ trait: [[i, i]] });
    expect(envois.filter((x) => x.m.trait).length).toBe(1);
    envois[0].fini();
    await new Promise((r) => setTimeout(r, 0));
    const traits = envois.filter((x) => x.m.trait);
    expect(traits.length).toBe(2);
    expect(traits[1].m.trait).toEqual([[10, 10]]);
    // La vue part en rapide, sans attendre.
    envoyerCarte({ carte: { c: [0, 0], z: 1, b: 0, p: 0, fond: 'auto' } });
    expect(envois[envois.length - 1].reliable).toBe(false);
    await raccrocher();
  });
});

// Audit du 27/11 : le canal rapide ne garde pas l'ordre, et il est distinct du canal sûr.
describe('ordre des messages de carte', () => {
  const julie = { id: 'julie', pseudo: 'Julie' };
  const vue = (z: number, s: number, n: number) => ({ carte: { c: [0, 0] as [number, number], z, b: 0, p: 0, fond: 'auto' }, s, n });

  it('une vue en retard après la fin de la carte ne fait pas resuivre ; une vieille vue ne remplace pas une neuve', async () => {
    const { appeler, appelEnCours, suivreCartes, raccrocher, _recevoirCarte } = await import('../src/buddies/appel');
    await appeler({ groupe: 'g1' }, 'Ski');
    const zooms: number[] = [];
    const stop = suivreCartes((m) => { if ('carte' in m) zooms.push(m.carte.z); }, () => undefined);
    _recevoirCarte(vue(10, 1000, 1), julie);
    _recevoirCarte(vue(12, 1000, 3), julie);
    _recevoirCarte(vue(11, 1000, 2), julie); // doublée par la suivante : jetée
    expect(zooms).toEqual([10, 12]);
    expect(appelEnCours()?.suit?.id).toBe('julie');
    _recevoirCarte({ carteFin: true, s: 1000, n: 5 }, julie);
    expect(appelEnCours()?.suit).toBeNull();
    _recevoirCarte(vue(13, 1000, 4), julie); // partie avant la fin, arrivée après
    expect(appelEnCours()?.suit).toBeNull();
    // Elle rallume : nouvelle époque, on la suit de nouveau.
    _recevoirCarte(vue(14, 1001, 1), julie);
    expect(appelEnCours()?.suit?.id).toBe('julie');
    expect(zooms).toEqual([10, 12, 14]);
    stop(); await raccrocher();
  });

  it('deux buddies allument en même temps : un seul garde la main, pas aucun', async () => {
    const { appeler, appelEnCours, envoyerCarte, montrerMaCarte, raccrocher, _recevoirCarte } = await import('../src/buddies/appel');
    await appeler({ groupe: 'g1' }, 'Ski');
    montrerMaCarte(true);
    envois.length = 0;
    envoyerCarte(vue(9, 0, 0));
    const mienne = (envois[0].m as { s: number }).s;
    expect(mienne).toBeGreaterThan(0);
    // Julie a allumé juste avant moi (époque plus petite) : je garde la main, elle s'éteindra en recevant la mienne.
    _recevoirCarte(vue(10, mienne - 5, 1), julie);
    expect(appelEnCours()?.jeMontre).toBe(true);
    // Julie rallume après avoir vu la mienne (époque plus grande) : c'est moi qui m'éteins, et je la suis.
    _recevoirCarte(vue(10, mienne + 1, 1), julie);
    expect(appelEnCours()?.jeMontre).toBe(false);
    expect(appelEnCours()?.suit?.id).toBe('julie');
    // Ma carte éteinte : un mouvement encore en route ne part plus (il ferait resuivre les autres).
    envois.length = 0;
    envoyerCarte(vue(8, 0, 0));
    expect(envois.length).toBe(0);
    // Si je rallume, mon époque dépasse la sienne, même avec une horloge en retard.
    montrerMaCarte(true);
    envoyerCarte(vue(8, 0, 0));
    expect((envois[0].m as { s: number }).s).toBeGreaterThan(mienne + 1);
    await raccrocher();
  });
});
