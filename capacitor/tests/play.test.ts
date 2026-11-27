import { afterEach, describe, expect, it, vi } from 'vitest';

// Version du Play Store (VITE_PLAY=1) : pas de SCAN 25 (licence IGN grand public) sauf débloqué par le Super User,
// autre identifiant Android.
describe('version Play Store', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('APK : Carte auto, SCAN 25 et Plan IGN', async () => {
    const c = await import('../src/config');
    expect(c.fondsPermis(false)).toEqual(['auto', 'scan25', 'planign']);
    expect(c.offlinePlan('auto', 10, 16).map((x) => x.layer)).toEqual(['planign', 'scan25']);
  });

  it('Play : Plan IGN seul, sauf SCAN 25 débloqué', async () => {
    vi.stubEnv('VITE_PLAY', '1');
    vi.resetModules();
    const c = await import('../src/config');
    expect(c.fondsPermis(false)).toEqual(['planign']);
    expect(c.fondsPermis(true)).toEqual(['auto', 'scan25', 'planign']);
    const a = await import('../src/compte/auth');
    expect(a.REDIRECT).toBe('cloud.silvaplana.mountainbuddies://callback');
  });
});
