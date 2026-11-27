// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 📞 Seb, 27/11 : raccrocher pendant « Ça sonne… » rendait l'écran blanc. La salle LiveKit se connectait encore.
let finConnexion: () => void = () => undefined;
const micro = vi.fn(async () => undefined);
const deconnexion = vi.fn(async () => undefined);
vi.mock('livekit-client', () => {
  class Room {
    remoteParticipants = new Map();
    localParticipant = { setMicrophoneEnabled: micro, publishData: vi.fn() };
    on() { return this; }
    connect() { return new Promise<void>((ok) => { finConnexion = ok; }); }
    disconnect = deconnexion;
    startAudio = vi.fn(async () => undefined);
  }
  return { Room, RoomEvent: {}, Track: { Kind: {} } };
});
const api = vi.fn(async (_m: string, chemin: string, _corps?: unknown) => (chemin === '/appels'
  ? { id: 'a1', groupe: 'g1', sortie: null, en_ligne: [], url: 'wss://x', jeton: 'j' } : {}));
vi.mock('../src/compte/auth', () => ({ api: (...a: [string, string, unknown?]) => api(...a) }));
vi.mock('../src/buddies/store', () => ({ envoyerMessage: vi.fn(), synchroniser: vi.fn(async () => []) }));

describe('raccrocher pendant que ça sonne', () => {
  beforeEach(() => { api.mockClear(); micro.mockClear(); });
  it("n'allume pas le micro et ne se déclare pas en ligne après coup", async () => {
    const { appeler, raccrocher, appelEnCours } = await import('../src/buddies/appel');
    const p = appeler({ groupe: 'g1' }, 'Ski');
    await vi.waitFor(() => expect(appelEnCours()?.phase).toBe('appel'));
    await raccrocher();
    expect(appelEnCours()).toBeNull();
    finConnexion();
    await p.catch(() => undefined);
    await new Promise((r) => setTimeout(r, 0));
    expect(micro).not.toHaveBeenCalled();
    expect(api.mock.calls.some(([, c, corps]) => c === '/appels/a1/presence' && (corps as { en_ligne?: boolean } | undefined)?.en_ligne)).toBe(false);
    expect(appelEnCours()).toBeNull();
  });
});
