// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@capacitor/preferences', () => ({ Preferences: { get: async () => ({ value: null }) } }));
import { _reinitialiser as reinitCompte, HorsLigne, api } from '../src/compte/auth';

// Seb, 27/11 : la voiture garée ne partait plus vers le groupe jusqu'à relancer l'appli. Une requête sans réponse
// (réseau qui change, serveur muet) bloquait la synchro pour toujours.
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('compte', JSON.stringify({ refresh: 'R', access: 'A', accessExp: Date.now() + 3600_000,
    config: { logto: 'https://auth.test', ressource: 'r', appId: 'a' } }));
  reinitCompte();
  vi.useFakeTimers();
});

describe('requête sans réponse', () => {
  it('abandonne au bout de 30 s (HorsLigne) au lieu de bloquer', async () => {
    vi.stubGlobal('fetch', vi.fn((_u: string, init?: RequestInit) => new Promise((_ok, ko) => {
      init?.signal?.addEventListener('abort', () => ko(new DOMException('abort', 'AbortError')));
    })));
    const p = api('POST', '/buddies/sync', {});
    const fin = expect(p).rejects.toBeInstanceOf(HorsLigne);
    await vi.advanceTimersByTimeAsync(31_000);
    await fin;
  });
});
