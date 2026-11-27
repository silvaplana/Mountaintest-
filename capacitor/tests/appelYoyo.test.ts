// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

// 📞 Seb, 27/11 : « tou-dou, tou-dou… » en boucle quand la connexion d'un buddy (PC) saute et revient.
const handlers: Record<string, (...a: unknown[]) => void> = {};
const presents = new Map<string, { identity: string; name: string }>();
vi.mock('livekit-client', () => {
  class Room {
    remoteParticipants = presents;
    localParticipant = { setMicrophoneEnabled: vi.fn(async () => undefined), publishData: vi.fn() };
    on(ev: string, f: (...a: unknown[]) => void) { handlers[ev] = f; return this; }
    connect = vi.fn(async () => undefined);
    disconnect = vi.fn(async () => undefined);
    startAudio = vi.fn(async () => undefined);
  }
  return { Room, RoomEvent: { ParticipantConnected: 'pc', ParticipantDisconnected: 'pd' }, Track: { Kind: {} } };
});
vi.mock('../src/compte/auth', () => ({ api: vi.fn(async (_m: string, c: string) => (c === '/appels' ? { id: 'a1', groupe: 'g1', sortie: null, en_ligne: [], url: 'w', jeton: 'j' } : {})) }));
vi.mock('../src/buddies/store', () => ({ envoyerMessage: vi.fn(), synchroniser: vi.fn(async () => []) }));

describe('connexion qui saute', () => {
  it("n'annonce Julie qu'une fois, et pas ses départs de moins de 5 s", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
    const { appeler, appelEnCours, raccrocher } = await import('../src/buddies/appel');
    await appeler({ groupe: 'g1' }, 'Ski');
    const annonces: string[] = [];
    const vu = () => { const a = appelEnCours()?.annonce?.texte; if (a && annonces[annonces.length - 1] !== a) annonces.push(a); };
    const entre = () => { presents.set('julie', { identity: 'julie', name: 'Julie' }); handlers.pc(); vu(); };
    const sort = () => { presents.delete('julie'); handlers.pd(); vu(); };
    entre();
    for (let i = 0; i < 4; i++) { sort(); vi.advanceTimersByTime(1000); entre(); vi.advanceTimersByTime(1000); }
    vi.advanceTimersByTime(6000); vu();
    expect(annonces).toEqual(['Julie a décroché']);
    sort(); vi.advanceTimersByTime(6000); vu();
    expect(annonces).toEqual(['Julie a décroché', 'Julie a raccroché']);
    await raccrocher();
    vi.useRealTimers();
  });
});

describe('tonalité', () => {
  it("s'arrête dès que quelqu'un est dans l'appel, même avant le passage « en ligne »", async () => {
    const { tonaliteDoitSonner } = await import('../src/buddies/appel');
    const base = { id: 'a', nom: 'Ski', dest: {}, parle: [] as string[], muet: false };
    expect(tonaliteDoitSonner(true, { ...base, phase: 'appel', voix: [] })).toBe(true);
    expect(tonaliteDoitSonner(true, { ...base, phase: 'appel', voix: [{ id: 'j', pseudo: 'Julie' }] })).toBe(false);
    expect(tonaliteDoitSonner(true, { ...base, phase: 'en_ligne', voix: [] })).toBe(false);
    expect(tonaliteDoitSonner(false, { ...base, phase: 'connexion', voix: [] })).toBe(false);
  });
});
