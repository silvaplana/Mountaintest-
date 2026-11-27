// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _reinitialiser as reinitCompte, ecrire as ecrireCompte } from '../src/compte/auth';
import { APPAREIL } from '../src/buddies/store';
import { ouvrirFluxEvenements } from '../src/buddies/evenements';

// Flux d'événements repris d'AppBase (Seb, 27/11) : un faux EventSource, comme celui du navigateur.
class FauxFlux {
  static tous: FauxFlux[] = [];
  readyState = 0; ferme = false;
  onopen: (() => void) | null = null; onmessage: ((e: { data: string }) => void) | null = null; onerror: (() => void) | null = null;
  constructor(public url: string) { FauxFlux.tous.push(this); }
  close() { this.ferme = true; this.readyState = 2; }
}
const dernier = () => FauxFlux.tous[FauxFlux.tous.length - 1];
const compte = (access: string) => ecrireCompte({ refresh: 'R', access, accessExp: Date.now() + 3600e3, config: { logto: 'https://auth.test', ressource: 'r', appId: 'a' } });
let fermer: () => void = () => undefined;

beforeEach(() => {
  localStorage.clear(); reinitCompte(); FauxFlux.tous = [];
  vi.stubGlobal('EventSource', FauxFlux);
  compte('A1');
  vi.useFakeTimers();
});
afterEach(() => { fermer(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('flux d’événements', () => {
  it('synchro à l’ouverture et à chaque événement, sauf le mien', async () => {
    const synchro = vi.fn();
    fermer = ouvrirFluxEvenements(synchro);
    await vi.advanceTimersByTimeAsync(0);
    expect(dernier().url).toContain('/buddies/evenements?jeton=A1');
    dernier().onopen!();
    expect(synchro).toHaveBeenCalledTimes(1);
    dernier().onmessage!({ data: JSON.stringify({ type: 'synchro', sauf: null }) });
    dernier().onmessage!({ data: JSON.stringify({ type: 'synchro', sauf: 'autre-appareil' }) });
    expect(synchro).toHaveBeenCalledTimes(3);
    dernier().onmessage!({ data: JSON.stringify({ type: 'synchro', sauf: APPAREIL }) }); // mon propre envoi
    dernier().onmessage!({ data: 'pas du JSON' });
    expect(synchro).toHaveBeenCalledTimes(3);
  });

  it('jeton périmé : EventSource abandonne (401), le flux est recréé avec un jeton neuf', async () => {
    fermer = ouvrirFluxEvenements(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    const premier = dernier();
    compte('A2'); // le jeton a été renouvelé entre-temps
    premier.readyState = 2; premier.onerror!();
    await vi.advanceTimersByTimeAsync(5000);
    expect(FauxFlux.tous.length).toBe(2);
    expect(dernier().url).toContain('jeton=A2');
    // Une simple coupure (il réessaie seul) : on ne recrée rien.
    dernier().readyState = 0; dernier().onerror!();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FauxFlux.tous.length).toBe(2);
  });

  it('fermé en arrière-plan (batterie), rouvert au retour à l’écran', async () => {
    fermer = ouvrirFluxEvenements(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    const premier = dernier();
    const etat = vi.spyOn(document, 'visibilityState', 'get');
    etat.mockReturnValue('hidden'); document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(premier.ferme).toBe(true);
    expect(FauxFlux.tous.length).toBe(1);
    etat.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(FauxFlux.tous.length).toBe(2);
    etat.mockRestore();
  });
});
