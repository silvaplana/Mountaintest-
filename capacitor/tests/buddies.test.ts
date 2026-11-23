// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _reinitialiser as reinitCompte, ecrire as ecrireCompte, HorsLigne } from '../src/compte/auth';
import {
  _reinitialiser, aRemplir, appliquer, deposerPhotos, mettreEtoile, parJour, retirerPhoto, creerGroupe, creerPlanning, creerSortie, datesPlanning, inviter, joursAvant, lire, nouveauCode,
  enregistrerCarnet, nouveautes, partagerTrace, prochaine, quitter, rejoindre, repondre, sortieDeLigne, synchroniser, vue, type Groupe, type PhotoBuddy, type Planning, type Sortie, type TraceBuddy,
} from '../src/buddies/store';
import { exif } from '../src/buddies/album';
import { chiffres, choixPhotos, fiches, joursDe, lireDuree, lireKm, lireMetres, texteCarnet, tracesDuCarnet, type Relief } from '../src/buddies/carnet';

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

describe('Buddy Times et traces partagées (bloc 2)', () => {
  const sortie = (id: string, debut: string, fin = debut): Sortie => ({ id, groupe: 'a', nom: id, photo: null, debut, fin, lieu: '',
    modifie_le: '2026-11-23T10:00:00+00:00', participants: [], invitations: [] });

  it('un Buddy Time créé sans réseau apparaît tout de suite, avec les buddies cochés', async () => {
    reseau(() => ({ curseur: 'c', moi: 'u-seb', ids: ['me', 'a'], refus: [], ids_sorties: [], sorties: [], ids_traces: [], traces: [],
      groupes: [ME, { ...groupe('a', 'A'), membres: [{ id: 'u-seb', pseudo: 'Seb', photo: null, role: 'admin' }, { id: 'u-j', pseudo: 'Julie', photo: null, role: 'membre' }, { id: 'u-p', pseudo: 'Paul', photo: null, role: 'membre' }] }] }));
    await synchroniser();
    reseau(() => 'coupure');
    const id = creerSortie({ groupe: 'a', nom: 'Week-end Queyras', photo: null, debut: '2026-12-12', fin: '2026-12-13', lieu: 'Ceillac', participants: ['u-j'] });
    const x = vue(lire()).sorties.find((y) => y.id === id)!;
    expect(x.attente).toBe(true);
    expect(x.participants.map((p) => p.pseudo)).toEqual(['Seb', 'Julie']);
    expect(lire().attente.at(-1)).toMatchObject({ type: 'creer_sortie', groupe: 'a', participants: ['u-j'] });
  });

  it('dans Me Time, les copains sont invités à la sortie', () => {
    reseau(() => 'coupure');
    const id = creerSortie({ groupe: 'me', nom: 'Sainte-Victoire', photo: null, debut: '2026-11-29', fin: '', lieu: '', participants: [] },
      [{ canal: 'sms', nom: 'Paul', contact: '06', code: nouveauCode() }]);
    expect(lire().attente.map((o) => [o.type, o.sortie])).toEqual([['creer_sortie', id], ['inviter', id]]);
    const x = vue(lire()).sorties[0];
    expect(x.fin).toBe('2026-11-29');
    expect(x.invitations[0].nom).toBe('Paul');
    expect(() => creerSortie({ groupe: 'me', nom: ' ', photo: null, debut: '2026-11-29', fin: '', lieu: '', participants: [] })).toThrow();
  });

  it('partager une trace : un envoi par Buddy Time ou groupe choisi, visible tout de suite', () => {
    reseau(() => 'coupure');
    partagerTrace('Col Girardin', [[6.700001, 44.6], [6.71, 44.61]], 'samedi ?', { sorties: ['s1'], groupes: ['a'] });
    const ops = lire().attente.filter((o) => o.type === 'partager_trace');
    expect(ops.map((o) => [o.sortie ?? null, o.groupe ?? null])).toEqual([['s1', null], [null, 'a']]);
    expect(ops[0].ligne).toEqual([[6.7, 44.6], [6.71, 44.61]]);
    expect(vue(lire()).traces).toHaveLength(2);
  });

  it('la synchro garde les Buddy Times et traces reçus', async () => {
    reseau(() => ({ curseur: 'c', moi: 'u-seb', ids: ['me'], groupes: [ME], refus: [], ids_sorties: ['s1'], sorties: [sortie('s1', '2026-12-12')],
      ids_traces: ['t1'], traces: [{ id: 't1', sortie: 's1', groupe: null, nom: 'Col', ligne: [[6, 44], [6.1, 44.1]], mot: '', par: { id: 'u-j', pseudo: 'Julie', photo: null }, cree_le: '2026-11-23T10:00:00+00:00' }] }));
    await synchroniser();
    reseau(() => ({ curseur: 'c2', moi: 'u-seb', ids: ['me'], groupes: [], refus: [], ids_sorties: ['s1'], sorties: [], ids_traces: ['t1'], traces: [] }));
    await synchroniser();
    expect(vue(lire()).sorties.map((x) => x.id)).toEqual(['s1']);
    expect(vue(lire()).traces[0].par.pseudo).toBe('Julie');
  });

  it('le Buddy Time en cours, sinon le prochain, va en haut', () => {
    const l = [sortie('passé', '2026-11-01'), sortie('loin', '2027-01-10'), sortie('bientôt', '2026-12-12', '2026-12-13')];
    expect(prochaine(l, '2026-11-23')!.id).toBe('bientôt');
    expect(prochaine(l, '2026-12-13')!.id).toBe('bientôt');
    expect(joursAvant(l[2], '2026-12-07')).toBe(5);
  });
});

describe('Planning de saison (bloc 3)', () => {
  it('week-ends de décembre à février, ou tous les jours', () => {
    const w = datesPlanning('2026-12', '2027-02', 'weekends');
    expect(w[0]).toEqual(['2026-12-05', '2026-12-06']);
    expect(w.at(-1)).toEqual(['2027-02-27', '2027-02-28']);
    expect(w).toHaveLength(13);
    expect(w).toContainEqual(['2027-01-02', '2027-01-03']);
    const j = datesPlanning('2027-02', '2027-02', 'jours');
    expect(j).toHaveLength(28);
    expect(j[0]).toEqual(['2027-02-01', '2027-02-01']);
  });

  it('publier puis répondre sans réseau : visible tout de suite, la dernière réponse compte', () => {
    reseau(() => 'coupure');
    const id = creerPlanning({ groupe: 'a', nom: ' Saison  ski ', dates: [['2026-12-12', '2026-12-13'], ['2026-12-05', '2026-12-06']], limite: '2026-11-30' });
    repondre(id, '2026-12-05', 'non');
    repondre(id, '2026-12-05', 'peut', 'Samedi seulement');
    const p = vue(lire()).plannings[0];
    expect(p).toMatchObject({ nom: 'Saison ski', attente: true });
    expect(p.dates[0][0]).toBe('2026-12-05');
    expect(p.dispos).toEqual([{ qui: 'moi', debut: '2026-12-05', etat: 'peut', mot: 'Samedi seulement' }]);
    expect(aRemplir(p, 'moi', '2026-11-23')).toBe(1);
    repondre(id, '2026-12-05', '');
    expect(vue(lire()).plannings[0].dispos).toEqual([]);
    expect(() => creerPlanning({ groupe: 'a', nom: 'x', dates: [], limite: '2026-11-30' })).toThrow();
  });

  it('la synchro garde les plannings reçus ; une ligne devient un lien vers le Buddy Time du même jour', async () => {
    const p: Planning = { id: 'p1', groupe: 'a', nom: 'Saison', par: { id: 'u-seb', pseudo: 'Seb', photo: null }, dates: [['2026-12-12', '2026-12-13']],
      limite: '2026-11-30', modifie_le: '2026-11-23T10:00:00+00:00', dispos: [{ qui: 'u-j', debut: '2026-12-12', etat: 'oui', mot: '' }] };
    reseau(() => ({ curseur: 'c', moi: 'u-seb', ids: ['me'], groupes: [ME], refus: [], ids_plannings: ['p1'], plannings: [p] }));
    await synchroniser();
    expect(vue(lire()).plannings[0].dispos[0].qui).toBe('u-j');
    const s: Sortie = { id: 's', groupe: 'a', nom: 'Queyras', photo: null, debut: '2026-12-12', fin: '2026-12-13', lieu: '', modifie_le: '', participants: [], invitations: [] };
    expect(sortieDeLigne([s], p, '2026-12-12')?.id).toBe('s');
    expect(sortieDeLigne([{ ...s, groupe: 'b' }], p, '2026-12-12')).toBeUndefined();
  });
});

describe('Album (bloc 4)', () => {
  const x: Sortie = { id: 's1', groupe: 'a', nom: 'Viso', photo: null, debut: '2026-10-18', fin: '2026-10-19', lieu: '', modifie_le: '', participants: [], invitations: [] };

  it('déposer sans réseau : les photos sont là tout de suite avec 🕓, rangées par jour', () => {
    reseau(() => 'coupure');
    deposerPhotos('s1', [
      { photo: 'p2', prise_le: '2026-10-19T08:00:00', lon: null, lat: null },
      { photo: 'p1', prise_le: '2026-10-18T10:00:00', lon: 6.7, lat: 44.6 },
    ]);
    const l = vue(lire()).photos;
    expect(l.map((p) => [p.id, p.attente])).toEqual([['p1', true], ['p2', true]]);
    expect(lire().envois).toEqual(['p2', 'p1']);
    expect(parJour(l, x).map((j) => [j.n, j.jour, j.photos.length])).toEqual([[1, '2026-10-18', 1], [2, '2026-10-19', 1]]);
    mettreEtoile('p1', true);
    retirerPhoto('p2');
    expect(vue(lire()).photos.map((p) => [p.id, p.etoile])).toEqual([['p1', true]]);
    expect(lire().envois).toEqual(['p1']);
  });

  it('une photo refusée par le serveur est oubliée de la file d’envoi', async () => {
    reseau(() => 'coupure');
    deposerPhotos('s-inconnu', [{ photo: 'p1', prise_le: '2026-10-18T10:00:00', lon: null, lat: null }]);
    await synchroniser().catch(() => undefined);
    reseau((a) => ({ curseur: 'c', moi: 'u-seb', ids: ['me'], groupes: [ME], refus: [{ id: a.corps.ops[0].id, raison: 'Buddy Time inconnu' }], ids_photos: [], photos: [] }));
    expect(await synchroniser()).toEqual(['Buddy Time inconnu']);
    expect(lire().envois).toEqual([]);
    expect(vue(lire()).photos).toEqual([]);
  });

  it('lit l’heure et le lieu dans l’EXIF d’une photo', () => {
    expect(exif(exifDeTest())).toEqual({ prise_le: '2026-10-18T09:41:07', lat: 44.5, lon: -6.75 });
    expect(exif(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer)).toEqual({ prise_le: null, lon: null, lat: null });
  });
});

describe('Carnet (bloc 5)', () => {
  const seb = { id: 'u-seb', pseudo: 'Seb', photo: null };
  const julie = { id: 'u-julie', pseudo: 'Julie', photo: null };
  const x: Sortie = { id: 's1', groupe: 'a', nom: 'Viso', photo: null, debut: '2026-10-18', fin: '2026-10-19', lieu: '', modifie_le: '',
    participants: [seb, julie], invitations: [],
    carnet: { difficulte: '', meteo: '', conditions: '', recits: [{ par: julie, texte: 'Polenta.', modifie_le: '' }], fiches: [] } };
  const trace = (id: string, cree_le: string, ligne: [number, number][]): TraceBuddy =>
    ({ id, sortie: 's1', groupe: null, nom: id, ligne, mot: '', par: seb, cree_le });
  const photo = (id: string, prise_le: string, etoile = false): PhotoBuddy =>
    ({ id, sortie: 's1', par: seb, prise_le, lon: null, lat: null, etoile, envoyee: true, modifie_le: '' });

  it('écrire sans réseau : mon texte à côté de celui de Julie, la fiche du jour et les conditions, avec 🕓', () => {
    localStorage.setItem('buddies', JSON.stringify({ moi: 'u-seb', serveur: [], sorties: [x], traces: [], plannings: [], photos: [], attente: [] }));
    _reinitialiser();
    reseau(() => 'coupure');
    enregistrerCarnet('s1', { recit: ' Départ à la frontale. ', fiches: [{ jour: '2026-10-18', nom: 'Castello', depart: '07:10', duree: 320, distance: null, denivele: null }],
      carnet: { difficulte: 'T3', meteo: '', conditions: 'Lac gelé' } });
    const c = vue(lire()).sorties[0].carnet!;
    expect(c.recits.map((r) => [r.par.pseudo, r.texte, !!r.attente])).toEqual([['Julie', 'Polenta.', false], ['Seb', 'Départ à la frontale.', true]]);
    expect(c.fiches.map((f) => [f.jour, f.nom, f.duree])).toEqual([['2026-10-18', 'Castello', 320]]);
    expect([c.difficulte, c.conditions]).toEqual(['T3', 'Lac gelé']);
    // Tout vider : mon texte et la fiche disparaissent.
    enregistrerCarnet('s1', { recit: '', fiches: [{ jour: '2026-10-18', nom: ' ', depart: '', duree: null, distance: null, denivele: null }] });
    const c2 = vue(lire()).sorties[0].carnet!;
    expect(c2.recits.map((r) => r.par.pseudo)).toEqual(['Julie']);
    expect(c2.fiches).toEqual([]);
  });

  it('photos : les ⭐, sinon 12 réparties dans le temps', () => {
    const l = Array.from({ length: 30 }, (_, i) => photo(`p${i}`, `2026-10-18T${String(6 + Math.floor(i / 3)).padStart(2, '0')}:${String(i % 3 * 10).padStart(2, '0')}:00`));
    const auto = choixPhotos(l);
    expect(auto.auto).toBe(true);
    expect(auto.photos.length).toBe(12);
    expect([auto.photos[0].id, auto.photos[11].id]).toEqual(['p0', 'p29']);
    expect(choixPhotos([...l, photo('et', '2026-10-19T10:00:00', true)])).toEqual({ photos: [expect.objectContaining({ id: 'et' })], auto: false });
  });

  it('une couleur par jour quand il y a une trace par jour ; fiches et chiffres depuis la trace', () => {
    const t1 = trace('aller', '2026-10-10T10:00:00Z', [[7, 44.6], [7, 44.61]]), t2 = trace('retour', '2026-10-11T10:00:00Z', [[7, 44.61], [7, 44.63]]);
    const tc = tracesDuCarnet([t2, t1], joursDe(x));
    expect(tc.map((t) => [t.t.id, t.libelle, t.jour])).toEqual([['aller', 'Jour 1', '2026-10-18'], ['retour', 'Jour 2', '2026-10-19']]);
    expect(tracesDuCarnet([t1], joursDe(x)).map((t) => [t.libelle, t.jour])).toEqual([['aller', null]]);
    const reliefs = new Map<string, Relief>([['aller', { d: [0, 1112], z: [1500, 2740], montee: 1240, descente: 0, haut: 2740 }],
      ['retour', { d: [0, 2224], z: [2740, 3019], montee: 600, descente: 0, haut: 3019 }]]);
    const xx = { ...x, carnet: { ...x.carnet!, fiches: [{ jour: '2026-10-18', nom: 'Castello', depart: '07:10', duree: 320, distance: null, denivele: null }] } };
    const fs = fiches(xx, tc, reliefs);
    expect(fs.map((f) => [f.n, f.nom, f.distance, f.denivele])).toEqual([[1, 'Castello', 1112, 1240], [2, '', 2224, 600]]);
    expect(chiffres(xx, tc, reliefs, fs).map((t) => `${t.v} ${t.l}`)).toEqual([
      '3,3 km distance', '+1\u00a0840 m montée', '−0 m descente', '5 h 20 durée', '3\u00a0019 m point haut', '2 jours 1 nuit', '2 buddies', '+ conditions']);
    expect(texteCarnet(xx, '18 – 19 oct.', chiffres(xx, tc, reliefs, fs), fs)).toContain('Polenta.\n— Julie');
  });

  it('lit les chiffres tapés : durée, km, mètres', () => {
    expect(['5 h 20', '5h20', '5 h', '320', 'demain'].map(lireDuree)).toEqual([320, 320, 300, 320, null]);
    expect(['11', '11,5', '11.5 km', 'x'].map(lireKm)).toEqual([11000, 11500, 11500, null]);
    expect(['1 240', '+600 m', ''].map(lireMetres)).toEqual([1240, 600, null]);
  });
});

/** Petit JPEG avec un bloc EXIF (Motorola) : DateTimeOriginal, GPS 44°30' N, 6°45' W. */
function exifDeTest(): ArrayBuffer {
  const t: number[] = [];
  const u16 = (n: number) => t.push(n >> 8, n & 255);
  const u32 = (n: number) => t.push((n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255);
  const ent = (tag: number, type: number, n: number, val: number) => { u16(tag); u16(type); u32(n); u32(val); };
  t.push(0x4d, 0x4d); u16(42); u32(8);                         // en-tête TIFF, IFD0 en 8
  u16(2); ent(0x8769, 4, 1, 38); ent(0x8825, 4, 1, 56); u32(0); // IFD0 (8..37) : Exif en 38, GPS en 56
  u16(1); ent(0x9003, 2, 20, 110); u32(0);                     // Exif IFD (38..55) : date en 110
  u16(4);                                                      // GPS IFD (56..109)
  ent(1, 2, 2, 0x4e000000); ent(2, 5, 3, 130); ent(3, 2, 2, 0x57000000); ent(4, 5, 3, 154); u32(0);
  for (const c of '2026:10:18 09:41:07\0') t.push(c.charCodeAt(0));  // 110..129
  for (const [a, b] of [[44, 1], [30, 1], [0, 1], [6, 1], [45, 1], [0, 1]]) { u32(a); u32(b); } // 130..177
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...t];
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255, ...app1, 0xff, 0xd9]).buffer;
}
