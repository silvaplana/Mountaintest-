import { afterEach, describe, expect, it, vi } from 'vitest';

// Version du Play Store (VITE_PLAY=1) : pas de SCAN 25 (licence IGN grand public), autre identifiant Android.
describe('version Play Store', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('APK : Carte auto, SCAN 25 et Plan IGN', async () => {
    const c = await import('../src/config');
    expect(Object.keys(c.BASE_MODES)).toEqual(['auto', 'scan25', 'planign']);
    expect(c.FOND_DEPART).toBe('auto');
    expect(c.offlinePlan('auto', 10, 16).map((x) => x.layer)).toEqual(['planign', 'scan25']);
  });

  it('Play : Plan IGN seul, y compris hors ligne', async () => {
    vi.stubEnv('VITE_PLAY', '1');
    vi.resetModules();
    const c = await import('../src/config');
    expect(Object.keys(c.BASE_MODES)).toEqual(['planign']);
    expect(c.FOND_DEPART).toBe('planign');
    expect(c.offlinePlan('auto', 10, 16)).toEqual([{ layer: 'planign', minZoom: 10, maxZoom: 16 }]);
    const a = await import('../src/compte/auth');
    expect(a.REDIRECT).toBe('cloud.silvaplana.mountainbuddies://callback');
  });
});
