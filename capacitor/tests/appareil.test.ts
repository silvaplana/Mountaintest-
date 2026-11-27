import { describe, expect, it } from 'vitest';
import { appareilLisible, relireAppareil } from '../src/buddies/appareil';

describe('ligne d\'appareil du support', () => {
  it('version web sur un PC Windows', () => {
    expect(appareilLisible({ plateforme: 'web', fabricant: 'Google Inc.', modele: 'Windows NT 10.0', os: 'windows', osVersion: 'Windows NT 10.0; Win64; x64' }))
      .toBe('Ordinateur Windows · version web');
  });
  it('appli Android', () => {
    expect(appareilLisible({ version: '1.2.3', plateforme: 'android', fabricant: 'samsung', modele: 'SM-S911B', os: 'android', osVersion: '14' }))
      .toBe('Android 14 · Samsung SM-S911B · version 1.2.3');
  });
  it('appli iPhone', () => {
    expect(appareilLisible({ version: '1.2.3', plateforme: 'ios', fabricant: 'Apple', modele: 'iPhone14,2', os: 'ios', osVersion: '17.1' }))
      .toBe('iOS 17.1 · iPhone · version 1.2.3');
  });
  it('relit les anciennes lignes brutes', () => {
    expect(relireAppareil('version web · Google Inc. Windows NT 10.0 · windows Windows NT 10.0; Win64; x64')).toBe('Ordinateur Windows · version web');
    expect(relireAppareil('version 1.2.3 (45) · samsung SM-S911B · android 14')).toBe('Android 14 · Samsung SM-S911B · version 1.2.3');
    expect(relireAppareil('Ordinateur Windows · version web')).toBe('Ordinateur Windows · version web');
  });
});
