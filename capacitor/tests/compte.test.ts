// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _reinitialiser, API_URL, changerPseudo, claims, connecte, debutConnexion, defi, deconnecter, finConnexion,
  HorsLigne, jetonAcces, lire, REDIRECT, Refuse, retourWeb, retourWebEnAttente, synchroniser, type Config,
} from '../src/compte/auth';

const CONFIG: Config = { logto: 'https://auth.test', ressource: 'https://api.test', appId: 'app1' };
const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '');
const ID_TOKEN = `x.${b64({ email: 'seb@exemple.fr', sub: 'u1' })}.y`;

type Appel = { url: string; init?: RequestInit };
let appels: Appel[] = [];
function reseau(f: (a: Appel) => Response | 'coupure') {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const a = { url, init }; appels.push(a);
    const r = f(a);
    if (r === 'coupure') throw new TypeError('Failed to fetch');
    return r;
  }));
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
const corps = (a: Appel) => new URLSearchParams(String(a.init?.body ?? ''));

async function seConnecter() {
  const url = new URL(await debutConnexion(CONFIG, 'seb@exemple.fr'));
  const state = url.searchParams.get('state')!;
  reseau((a) => a.url.endsWith('/oidc/token')
    ? json({ access_token: 'A1', refresh_token: 'R1', id_token: ID_TOKEN, expires_in: 3600 })
    : json({ id: 'p1', email: 'seb@exemple.fr', pseudo: 'seb', photo: null }));
  await finConnexion(`${REDIRECT}?code=C1&state=${state}`);
}

beforeEach(() => { localStorage.clear(); _reinitialiser(); appels = []; vi.unstubAllGlobals(); });

describe('compte (connexion Logto, hors ligne)', () => {
  it('prépare la page de connexion avec PKCE', async () => {
    const url = new URL(await debutConnexion(CONFIG, 'seb@exemple.fr'));
    expect(url.origin + url.pathname).toBe('https://auth.test/oidc/auth');
    const q = url.searchParams;
    expect(q.get('client_id')).toBe('app1');
    expect(q.get('redirect_uri')).toBe('fr.assomoutain.rando://callback');
    expect(q.get('scope')).toContain('offline_access');
    expect(q.get('resource')).toBe('https://api.test');
    expect(q.get('login_hint')).toBe('seb@exemple.fr');
    expect(q.get('code_challenge')).toBe(await defi(lire().pkce!.verifier));
  });

  it('se connecte, garde la session et le profil', async () => {
    await seConnecter();
    const t = appels[0];
    expect(corps(t).get('grant_type')).toBe('authorization_code');
    expect(corps(t).get('code_verifier')).toBe(corps(t).get('code_verifier'));
    const e = lire();
    expect(connecte(e)).toBe(true);
    expect(e.email).toBe('seb@exemple.fr');
    expect(e.profil?.pseudo).toBe('seb');
    expect(e.pkce).toBeUndefined();
    expect(appels[1].url).toBe(`${API_URL}/moi`);
    expect((appels[1].init?.headers as Record<string, string>).Authorization).toBe('Bearer A1');
    // Toujours connecté après redémarrage de l'appli (relu depuis le stockage)
    _reinitialiser();
    expect(connecte()).toBe(true);
  });

  it('refuse un retour dont l\'état ne correspond pas', async () => {
    await debutConnexion(CONFIG);
    await expect(finConnexion(`${REDIRECT}?code=C1&state=autre`)).rejects.toThrow(/expirée/);
    expect(connecte()).toBe(false);
  });

  it('hors ligne : reste connecté, le pseudo attend puis part au retour du réseau', async () => {
    await seConnecter();
    reseau(() => 'coupure');
    const e = await changerPseudo('  Seb  le skieur ');
    expect(e.profil?.pseudo).toBe('Seb le skieur');
    expect(e.attente?.pseudo).toBe('Seb le skieur');
    expect(connecte()).toBe(true);
    // Jeton d'accès expiré et pas de réseau : HorsLigne, la session n'est pas touchée
    localStorage.clear(); _reinitialiser();
    const { ecrire } = await import('../src/compte/auth');
    ecrire({ ...e, accessExp: 0 });
    await expect(jetonAcces()).rejects.toBeInstanceOf(HorsLigne);
    expect(lire().refresh).toBe('R1');
    expect(lire().aReconnecter).toBeFalsy();
    // Retour du réseau
    reseau((a) => a.url.endsWith('/oidc/token')
      ? json({ access_token: 'A2', expires_in: 3600 })
      : json({ id: 'p1', email: 'seb@exemple.fr', pseudo: JSON.parse(String(a.init?.body)).pseudo, photo: null }));
    await synchroniser();
    const put = appels.find((a) => a.init?.method === 'PUT')!;
    expect(JSON.parse(String(put.init?.body))).toEqual({ pseudo: 'Seb le skieur' });
    expect(lire().attente?.pseudo).toBeUndefined();
    expect(lire().refresh).toBe('R1'); // pas de rotation : le même jeton de renouvellement reste valable
    expect(lire().synchro).toBeGreaterThan(0);
  });

  it('jeton refusé par Logto : demande de se reconnecter sans effacer le profil', async () => {
    await seConnecter();
    const { ecrire } = await import('../src/compte/auth');
    ecrire({ ...lire(), accessExp: 0 });
    reseau(() => json({ error: 'invalid_grant' }, 400));
    await expect(jetonAcces()).rejects.toBeInstanceOf(Refuse);
    expect(lire().aReconnecter).toBe(true);
    expect(lire().profil?.pseudo).toBe('seb');
    expect(connecte()).toBe(true);
  });

  it('se déconnecter oublie la session mais garde la configuration', async () => {
    await seConnecter();
    reseau(() => 'coupure');
    await deconnecter();
    expect(connecte()).toBe(false);
    expect(lire().profil).toBeUndefined();
    expect(lire().config?.appId).toBe('app1');
  });

  it('lit les infos d\'un jeton, accents compris', () => {
    const t = `x.${btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ name: 'Séb' })))).replace(/=+$/, '')}.y`;
    expect(claims(t).name).toBe('Séb');
  });

  it('Google : la page Logto envoie directement chez Google ; refusé si pas encore activé', async () => {
    const url = new URL(await debutConnexion({ ...CONFIG, fournisseurs: ['google'] }, undefined, 'google'));
    expect(url.searchParams.get('direct_sign_in')).toBe('social:google');
    await expect(debutConnexion({ ...CONFIG, fournisseurs: [] }, undefined, 'google')).rejects.toThrow(/pas encore activé/);
    await expect(debutConnexion({ ...CONFIG, fournisseurs: ['google'] }, undefined, 'apple')).rejects.toThrow(/Apple/);
  });

  it('version web (iPhone) : retour sur la page, même adresse donnée à Logto puis à l\'échange du code', async () => {
    const page = retourWeb({ origin: 'https://silvaplana.cloud', pathname: '/mountaintest/index.html' });
    expect(page).toBe('https://silvaplana.cloud/mountaintest/');
    const url = new URL(await debutConnexion(CONFIG, undefined, 'google', page));
    expect(url.searchParams.get('redirect_uri')).toBe(page);
    const retour = `${page}?code=C9&state=${url.searchParams.get('state')}`;
    expect(retourWebEnAttente(retour)).toBe(true);
    expect(retourWebEnAttente(page)).toBe(false);
    reseau((a) => a.url.endsWith('/oidc/token')
      ? json({ access_token: 'A1', refresh_token: 'R1', id_token: ID_TOKEN, expires_in: 3600 })
      : json({ id: 'p1', email: 'seb@exemple.fr', pseudo: 'seb', photo: null }));
    await finConnexion(retour);
    expect(corps(appels[0]).get('redirect_uri')).toBe(page);
    expect(corps(appels[0]).get('code')).toBe('C9');
    expect(connecte()).toBe(true);
  });
});

describe('fiche du membre (comme AppBase)', () => {
  it('IBAN vérifié comme AppBase ; vide = effacé', async () => {
    const { normaliserIban } = await import('../src/compte/auth');
    expect(normaliserIban(' fr76 3000 6000 0112 3456 7890 189 ')).toBe('FR7630006000011234567890189');
    expect(normaliserIban('  ')).toBe('');
    expect(() => normaliserIban('FR76 3000 6000 0112 3456 7890 188')).toThrow(/incorrect/);
    expect(() => normaliserIban('1234')).toThrow(/forme/);
  });
});
