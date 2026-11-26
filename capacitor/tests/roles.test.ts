// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _reinitialiser as reinitCompte, ecrire as ecrireCompte } from '../src/compte/auth';
import { _reinitialiser, appliquer, estAdmin, estAdminPrincipal, lire, peutRetirer, retirerAdmin, synchroniser, transmettre, type Groupe } from '../src/buddies/store';

const bande = (role: 'admin_principal' | 'admin' | 'membre'): Groupe => ({
  id: 'g', nom: 'Ski du dimanche', nature: 'bande', photo: null, modifie_le: '2026-11-26T10:00:00+00:00', invitations: [],
  membres: [{ id: 'u-seb', pseudo: 'Seb', photo: null, role }, { id: 'u-j', pseudo: 'Julie', photo: null, role: role === 'admin_principal' ? 'admin' : 'admin_principal' }],
});
const sortie = { id: 's', groupe: 'g', nom: 'Queyras', photo: null, debut: '2026-12-12', fin: '2026-12-13', lieu: '', modifie_le: '', participants: [], invitations: [] };

async function avec(role: 'admin_principal' | 'admin' | 'membre') {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    curseur: 'c', moi: 'u-seb', ids: ['g'], groupes: [bande(role)], ids_sorties: ['s'], sorties: [sortie], refus: [] }), { status: 200 })));
  await synchroniser();
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
}

beforeEach(() => {
  localStorage.clear(); reinitCompte(); _reinitialiser(); vi.unstubAllGlobals();
  ecrireCompte({ refresh: 'R', access: 'A', accessExp: Date.now() + 3600e3, config: { logto: 'https://auth.test', ressource: 'r', appId: 'a' },
    profil: { id: 'u-seb', email: 'seb@exemple.fr', pseudo: 'Seb', photo: null } });
});

describe('rôles dans un groupe (Seb, 26 novembre)', () => {
  it('un membre ne retire que ce qu’il a apporté ; un admin, tout', async () => {
    await avec('membre');
    const g = appliquer(lire())[0];
    expect([estAdmin(g), estAdminPrincipal(g)]).toEqual([false, false]);
    expect([peutRetirer('u-seb', 's'), peutRetirer('u-j', 's')]).toEqual([true, false]);
    await avec('admin');
    expect(peutRetirer('u-j', 's')).toBe(true);
  });

  it('l’admin principal transmet son rôle : il en reste un seul, visible tout de suite', async () => {
    await avec('admin_principal');
    expect(estAdminPrincipal(appliquer(lire())[0])).toBe(true);
    transmettre('g', 'u-j');
    let roles = appliquer(lire())[0].membres.map((m) => m.role);
    expect(roles).toEqual(['admin', 'admin_principal']);
    retirerAdmin('g', 'u-seb');
    roles = appliquer(lire())[0].membres.map((m) => m.role);
    expect(roles).toEqual(['membre', 'admin_principal']);
  });
});
