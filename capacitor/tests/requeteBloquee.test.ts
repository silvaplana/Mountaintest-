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

describe('réponse coupée au milieu', () => {
  it('abandonne aussi quand le corps n’arrive plus (les en-têtes étaient là)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      const corps = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode('{"curseur":'));
          init?.signal?.addEventListener('abort', () => c.error(new DOMException('abort', 'AbortError')));
        },
      });
      return new Response(corps, { status: 200 });
    }));
    const p = api('POST', '/buddies/sync', {});
    const fin = expect(p).rejects.toBeInstanceOf(HorsLigne);
    await vi.advanceTimersByTimeAsync(31_000);
    await fin;
  });

  it('une réponse lente mais qui avance n’est pas abandonnée', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const morceaux = ['{"a"', ':', '1', '}'];
      const corps = new ReadableStream<Uint8Array>({
        async pull(c) {
          await new Promise((r) => setTimeout(r, 20_000));
          const m = morceaux.shift();
          if (m) c.enqueue(new TextEncoder().encode(m)); else c.close();
        },
      });
      return new Response(corps, { status: 200 });
    }));
    const p = api<{ a: number }>('POST', '/buddies/sync', {});
    await vi.advanceTimersByTimeAsync(120_000);
    await expect(p).resolves.toEqual({ a: 1 });
  });
});
