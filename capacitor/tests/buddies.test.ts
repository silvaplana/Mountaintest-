// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _reinitialiser as reinitCompte, ecrire as ecrireCompte, HorsLigne } from '../src/compte/auth';
import {
  _reinitialiser, appliquer, creerGroupe, inviter, lire, nouveauCode, nouveautes, quitter, rejoindre, synchroniser, type Groupe,
} from '../src/buddies/store';

type Appel = { url: string; corps: { ops: { type: string; id: string }[]; depuis: string | null } };
let appels: Appel[] = [];
function reseau(f: (a: Appel) => unknown | 'coupure') {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const a = { url, corps: JSON.parse(String(init?.body ?? '{}')) };
    appels.push(a);
    const r = f(a);
    if (r === 'coupure') throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(r), { status: 200 });
  }));
}
const groupe = (id: string, nom: string, modifie_le = '2026-11-23T10:00:00+00:00', nature: Groupe['nature'] = 'bande'): Groupe => ({
  id, nom, nature, photo: null, modifie_le, membres: [{ id: 'u-seb', pseudo: 'Seb', photo: null, role: 'admin' }], invitations: [],
});
const ME = groupe('me', 'Me Time', '2026-11-01T10:00:00+00:00', 'me_time');

beforeEach(() => {
  localStorage.clear(); reinitCompte(); _reinitialiser(); appels = []; vi.unstubAllGlobals();
  // Connecté, jeton encore valide : pas d'appel à Logto.
  ecrireCompte({ refresh: 'R', access: 'A', accessExp: Date.now() + 3600e3, config: { logto: 'https://auth.test', ressource: 'r', appId: 'a' },
    profil: { id: 'u-seb', email: 'seb@exemple.fr', pseudo: 'Seb', photo: null } });
});

describe('Buddies : copie locale et file d’attente', () => {
  it('Me Time est là avant même la première synchro', () => {
    const gs = appliquer(lire());
    expect(gs.map((g) => [g.nom, g.nature])).toEqual([['Me Time', 'me_time']]);
  });

  it('sans réseau, un Buddy Group créé apparaît tout de suite avec 🕓 et part au retour du réseau', async () => {
    reseau(() => 'coupure');
    const id = creerGroupe('  Ski   du dimanche ', null, [{ canal: 'sms', nom: 'Julie', contact: '0612', code: nouveauCode() }]);
    await expect(synchroniser()).rejects.toBeInstanceOf(HorsLigne);
    const g = appliquer(lire()).find((x) => x.id === id)!;
    expect(g.nom).toBe('Ski du dimanche');
    expect(g.attente).toBe(true);
    expect(g.invitations[0]).toMatchObject({ nom: 'Julie', attente: true });
    expect(lire().attente.map((o) => o.type)).toEqual(['creer_groupe', 'inviter']);

    // Retour du réseau : tout part d'un coup, la version du serveur remplace la copie locale.
    reseau((a) => ({
      curseur: '2026-11-23T12:00:00+00:00', moi: 'u-seb', ids: ['me', id], refus: [],
      groupes: [ME, { ...groupe(id, 'Ski du dimanche'), invitations: [{ id: 'i1', code: 'c', canal: 'sms', nom: 'Julie', contact: '0612', par: 'u-seb' }] }],
      _ops: a.corps.ops,
    }));
    expect(await synchroniser()).toEqual([]);
    expect(appels[0].url).toMatch(/\/buddies\/sync$/);
    expect(appels[0].corps.ops.map((o) => o.type)).toEqual(['creer_groupe', 'inviter']);
    expect(appels[0].corps.depuis).toBeNull();
    expect(lire().attente).toEqual([]);
    expect(lire().curseur).toBe('2026-11-23T12:00:00+00:00');
    const apres = appliquer(lire()).find((x) => x.id === id)!;
    expect(apres.attente).toBeUndefined();
    expect(apres.invitations[0].attente).toBeUndefined();
  });

  it('nouveautés depuis : un groupe pas renvoyé est gardé, un groupe quitté disparaît', async () => {
    reseau(() => ({ curseur: 'c1', moi: 'u-seb', ids: ['me', 'a', 'b'], refus: [], groupes: [ME, groupe('a', 'A'), groupe('b', 'B')] }));
    await synchroniser();
    reseau(() => ({ curseur: 'c2', moi: 'u-seb', ids: ['me', 'a'], refus: [], groupes: [] }));
    await synchroniser();
    expect(appels[1].corps.depuis).toBe('c1');
    expect(lire().serveur.map((g) => g.id)).toEqual(['me', 'a']);
  });

  it('un groupe connu du serveur mais jamais reçu fait tout redemander', async () => {
    reseau(() => ({ curseur: 'c1', moi: 'u-seb', ids: ['me', 'x'], refus: [], groupes: [ME] }));
    await synchroniser();
    expect(lire().curseur).toBeUndefined();
  });

  it('une opération refusée est montrée puis oubliée', async () => {
    reseau(() => 'coupure');
    quitter('me');
    await synchroniser().catch(() => undefined);
    reseau((a) => ({ curseur: 'c', moi: 'u-seb', ids: ['me'], groupes: [ME], refus: [{ id: a.corps.ops[0].id, raison: 'On ne quitte pas son Me Time' }] }));
    expect(await synchroniser()).toEqual(['On ne quitte pas son Me Time']);
    expect(lire().attente).toEqual([]);
    expect(appliquer(lire()).some((g) => g.id === 'me')).toBe(true);
  });

  it('quitter retire le groupe tout de suite ; inviter ajoute l’invitation', async () => {
    reseau(() => ({ curseur: 'c', moi: 'u-seb', ids: ['me', 'a'], refus: [], groupes: [ME, groupe('a', 'A')] }));
    await synchroniser();
    reseau(() => 'coupure');
    inviter('a', { canal: 'mail', nom: 'Luc', contact: 'luc@exemple.fr', code: nouveauCode() });
    expect(appliquer(lire()).find((g) => g.id === 'a')!.invitations[0].nom).toBe('Luc');
    quitter('a');
    expect(appliquer(lire()).some((g) => g.id === 'a')).toBe(false);
  });

  it('un lien d’invitation ouvert deux fois ne fait qu’une demande', () => {
    reseau(() => 'coupure');
    rejoindre('CodeSecret0123456789'); rejoindre('CodeSecret0123456789');
    expect(lire().attente.filter((o) => o.type === 'rejoindre')).toHaveLength(1);
  });

  it('les codes d’invitation sont longs et sans caractère gênant dans un lien', () => {
    const c = nouveauCode();
    expect(c).toMatch(/^[A-Za-z0-9_-]{20}$/);
    expect(nouveauCode()).not.toBe(c);
  });

  it('pastille de 👥 : les Buddy Groups qui ont bougé depuis la dernière ouverture', async () => {
    reseau(() => ({ curseur: 'c', moi: 'u-seb', ids: ['me', 'a'], refus: [], groupes: [ME, groupe('a', 'A', new Date().toISOString())] }));
    await synchroniser();
    expect(nouveautes()).toBe(1);
  });
});
