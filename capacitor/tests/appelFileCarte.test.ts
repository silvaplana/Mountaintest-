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
    const { appeler, appelEnCours, envoyerCarte, raccrocher } = await import('../src/buddies/appel');
    await appeler({ groupe: 'g1' }, 'Ski');
    expect(appelEnCours()?.phase).toBe('en_ligne');
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
