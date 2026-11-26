// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _reinitialiser as reinitCompte, ecrire as ecrireCompte, HorsLigne } from '../src/compte/auth';
import {
  _reinitialiser, aRemplir, appliquer, deposerPhotos, mettreEtoile, parJour, retirerPhoto, creerGroupe, creerPlanning, creerSortie, datesPlanning, inviter, joursAvant, lire, nouveauCode,
  enregistrerCarnet, enregistrerDepense, nouveautes, retirerDepense, partagerTrace, prochaine, quitter, rejoindre, repondre, sortieDeLigne, synchroniser, vue, type Groupe, type PhotoBuddy, type Planning, type Sortie, type TraceBuddy,
} from '../src/buddies/store';
import { exif } from '../src/buddies/album';
import { compte, euros, icone, lireEuros } from '../src/buddies/count';
import { detail, etiquette, opacite, reperes, reperesTous } from '../src/buddies/positions';
import { enfoncerEpingle, envoyerPosition, finEpingle, mesEpingles, monEpingle, positions, releverEpingle } from '../src/buddies/store';
import { mettreCoeur, proposerHebergement, retenirHebergement, retirerHebergement } from '../src/buddies/store';
import { iconeHebergement, prixHebergement } from '../src/buddies/Hebergements';
import { envoyerMessage, marquerLu, nonLus, retirerMessage, type MessageBuddy } from '../src/buddies/store';
import { apercu, fil, heureMessage, longueurTrace } from '../src/buddies/messages';
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
  it('plus de Me Time (Seb, 25 novembre) : aucun groupe tant qu’on n’en crée pas', () => {
    expect(appliquer(lire())).toEqual([]);
  });

  it('sans réseau, un groupe créé apparaît tout de suite avec 🕓 et part au retour du réseau', async () => {
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

  it('pastille de 👥 : les groupes qui ont bougé depuis la dernière ouverture', async () => {
    reseau(() => ({ curseur: 'c', moi: 'u-seb', ids: ['me', 'a'], refus: [], groupes: [ME, groupe('a', 'A', new Date().toISOString())] }));
    await synchroniser();
    expect(nouveautes()).toBe(1);
  });
});

describe('Sorties et traces partagées (bloc 2)', () => {
  const sortie = (id: string, debut: string, fin = debut): Sortie => ({ id, groupe: 'a', nom: id, photo: null, debut, fin, lieu: '',
    modifie_le: '2026-11-23T10:00:00+00:00', participants: [], invitations: [] });

  it('une sortie créé sans réseau apparaît tout de suite, avec les buddies cochés', async () => {
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

  it('première sortie seul, sans Groupe perso encore : envoyée vers « seul », visible tout de suite (Seb, 26 novembre)', () => {
    reseau(() => 'coupure');
    const id = creerSortie({ groupe: 'seul', nom: 'Calanques', photo: null, debut: '2026-11-29', fin: '', lieu: '', participants: [] });
    expect(lire().attente.at(-1)).toMatchObject({ type: 'creer_sortie', sortie: id, groupe: 'seul' });
    const x = vue(lire()).sorties.find((y) => y.id === id)!;
    expect(x.attente).toBe(true);
    expect(x.participants.map((p) => p.pseudo)).toEqual(['Seb']);
  });

  it('partager une trace : un envoi par sortie ou groupe choisi, visible tout de suite', () => {
    reseau(() => 'coupure');
    partagerTrace('Col Girardin', [[6.700001, 44.6], [6.71, 44.61]], 'samedi ?', { sorties: ['s1'], groupes: ['a'] });
    const ops = lire().attente.filter((o) => o.type === 'partager_trace');
    expect(ops.map((o) => [o.sortie ?? null, o.groupe ?? null])).toEqual([['s1', null], [null, 'a']]);
    expect(ops[0].ligne).toEqual([[6.7, 44.6], [6.71, 44.61]]);
    expect(vue(lire()).traces).toHaveLength(2);
  });

  it('la synchro garde les sorties et traces reçus', async () => {
    reseau(() => ({ curseur: 'c', moi: 'u-seb', ids: ['me'], groupes: [ME], refus: [], ids_sorties: ['s1'], sorties: [sortie('s1', '2026-12-12')],
      ids_traces: ['t1'], traces: [{ id: 't1', sortie: 's1', groupe: null, nom: 'Col', ligne: [[6, 44], [6.1, 44.1]], mot: '', par: { id: 'u-j', pseudo: 'Julie', photo: null }, cree_le: '2026-11-23T10:00:00+00:00' }] }));
    await synchroniser();
    reseau(() => ({ curseur: 'c2', moi: 'u-seb', ids: ['me'], groupes: [], refus: [], ids_sorties: ['s1'], sorties: [], ids_traces: ['t1'], traces: [] }));
    await synchroniser();
    expect(vue(lire()).sorties.map((x) => x.id)).toEqual(['s1']);
    expect(vue(lire()).traces[0].par.pseudo).toBe('Julie');
  });

  it('la sortie en cours, sinon le prochain, va en haut', () => {
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

  it('la synchro garde les plannings reçus ; une ligne devient un lien vers la sortie du même jour', async () => {
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

  it('🎥 un film de survol rangé dans l’album : marqué vidéo, envoyé comme les photos', () => {
    reseau(() => 'coupure');
    deposerPhotos('s1', [{ photo: 'f1', prise_le: '2026-10-18T11:00:00', lon: 6.7, lat: 44.6, video: true }]);
    expect(vue(lire()).photos.map((p) => [p.id, p.video, p.attente])).toEqual([['f1', true, true]]);
    expect(lire().attente.some((o) => o.type === 'ajouter_photo' && o.photo === 'f1' && o.video === true)).toBe(true);
    expect(lire().envois).toEqual(['f1']);
  });

  it('une photo refusée par le serveur est oubliée de la file d’envoi', async () => {
    reseau(() => 'coupure');
    deposerPhotos('s-inconnu', [{ photo: 'p1', prise_le: '2026-10-18T10:00:00', lon: null, lat: null }]);
    await synchroniser().catch(() => undefined);
    reseau((a) => ({ curseur: 'c', moi: 'u-seb', ids: ['me'], groupes: [ME], refus: [{ id: a.corps.ops[0].id, raison: 'Sortie inconnu' }], ids_photos: [], photos: [] }));
    expect(await synchroniser()).toEqual(['Sortie inconnu']);
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
    // Le film du parcours passe toujours en premier, sans ⭐ (Seb, 25/11).
    const film = { ...photo('film', '2026-11-25T22:00:00'), video: true };
    expect(choixPhotos([...l, photo('et', '2026-10-19T10:00:00', true), film]).photos.map((p) => p.id)).toEqual(['film', 'et']);
    expect(choixPhotos([...l, film]).photos.map((p) => p.id).slice(0, 2)).toEqual(['film', 'p0']);
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

describe('Buddy count (bloc 6)', () => {
  const seb = { id: 'u-seb', pseudo: 'Seb', photo: null };
  const ppl = ['Julie', 'Luc', 'Nico'].map((n) => ({ id: `u-${n}`, pseudo: n, photo: null }));
  const x: Sortie = { id: 's1', groupe: 'a', nom: 'Queyras', photo: null, debut: '2026-12-12', fin: '2026-12-13', lieu: '', modifie_le: '',
    participants: [seb, ...ppl], invitations: [] };

  it('sans réseau : ajouter, corriger, retirer ; équilibres et « qui doit à qui »', () => {
    localStorage.setItem('buddies', JSON.stringify({ moi: 'u-seb', serveur: [], sorties: [x], traces: [], plannings: [], photos: [], attente: [] }));
    _reinitialiser();
    reseau(() => 'coupure');
    const tous = x.participants.map((p) => p.id);
    const gite = enregistrerDepense({ sortie: 's1', titre: ' Gîte  Les Baladins ', montant: 24000, paye_par: 'u-seb', pour: tous, jour: '2026-12-12' });
    enregistrerDepense({ sortie: 's1', titre: 'Essence + péage', montant: 12500, paye_par: 'u-Julie', pour: tous, jour: '2026-12-12' });
    const courses = enregistrerDepense({ sortie: 's1', titre: 'Courses', montant: 4700, paye_par: 'u-seb', pour: tous, jour: '2026-12-13' });
    let ds = vue(lire()).depenses;
    expect(ds[0].titre).toBe('Courses'); // le dernier jour en haut
    expect(ds.map((d) => [d.titre, d.attente]).sort()).toEqual([['Courses', true], ['Essence + péage', true], ['Gîte Les Baladins', true]]);
    const c = compte(x, ds, 'u-seb');
    expect([euros(c.total), euros(c.chacun)]).toEqual(['412\u00a0€', '103\u00a0€']);
    expect(c.soldes).toEqual({ 'u-seb': 184, 'u-Julie': 22, 'u-Luc': -103, 'u-Nico': -103 });
    expect(c.virements.map((v) => [v.from, v.to, v.amount])).toEqual([['u-Luc', 'u-seb', 103], ['u-Nico', 'u-seb', 81], ['u-Nico', 'u-Julie', 22]]);
    // Corriger (même identifiant) puis retirer.
    enregistrerDepense({ depense: gite, sortie: 's1', titre: 'Gîte', montant: 20000, paye_par: 'u-seb', pour: tous, jour: '2026-12-12' });
    retirerDepense(courses);
    ds = vue(lire()).depenses;
    expect(ds.map((d) => [d.titre, d.montant]).sort()).toEqual([['Essence + péage', 12500], ['Gîte', 20000]]);
    expect(() => enregistrerDepense({ sortie: 's1', titre: 'x', montant: 100, paye_par: 'u-seb', pour: [], jour: '2026-12-12' })).toThrow();
  });

  it('montants tapés et icônes devinées', () => {
    expect(['24,50', '24.5 €', '1 240', '0', 'douze'].map(lireEuros)).toEqual([2450, 2450, 124000, null, null]);
    expect([euros(2450), euros(-10600)]).toEqual(['24,50\u00a0€', '−106\u00a0€']);
    expect(['Gîte Les Baladins', 'Essence + péage', 'Courses', 'Location de skis', 'Bières'].map(icone)).toEqual(['🏨', '⛽', '🧀', '🎿', '🍽']);
  });
});

describe('Position des buddies (bloc 7)', () => {
  const seb = { id: 'u-seb', pseudo: 'Seb', photo: null };
  const julie = { id: 'u-julie', pseudo: 'Julie', photo: null };
  const luc = { id: 'u-luc', pseudo: 'Luc', photo: null };
  const x: Sortie = { id: 's1', groupe: 'a', nom: 'Queyras', photo: null, debut: '2026-12-12', fin: '2026-12-13', lieu: '', modifie_le: '',
    participants: [seb, julie, luc], invitations: [] };
  const T = new Date(2026, 11, 12, 10, 0).getTime();

  it('l’épingle se relève seule à 19 h (#223)', () => {
    expect(new Date(finEpingle(new Date(2026, 11, 12, 9, 10))).getHours()).toBe(19);
    expect(new Date(finEpingle(new Date(2026, 11, 12, 21, 30))).toTimeString().slice(0, 5)).toBe('23:59');
  });

  it('sans réseau : épingle enfoncée, seule la dernière position attend, relevée elle ne part plus', () => {
    localStorage.setItem('buddies', JSON.stringify({ moi: 'u-seb', serveur: [], sorties: [x], traces: [], plannings: [], photos: [], attente: [] }));
    _reinitialiser();
    reseau(() => 'coupure');
    envoyerPosition({ lat: 44.6, lon: 6.7, t: T }); // sans épingle : rien
    expect(lire().attente).toEqual([]);
    enfoncerEpingle([{ sortie: 's1' }], T);
    expect(monEpingle(lire(), T + 1000)?.sortie).toBe('s1');
    envoyerPosition({ lat: 44.6, lon: 6.7, alt: 2310.4, t: T + 60_000 });
    envoyerPosition({ lat: 44.61, lon: 6.71, alt: 2320, t: T + 360_000 });
    expect(lire().attente.map((o) => o.type)).toEqual(['epingle', 'position']);
    const p = positions(lire())[0];
    expect([p.lat, p.lon, p.alt, p.prise_le, p.attente]).toEqual([44.61, 6.71, 2320, T + 360_000, true]);
    releverEpingle({ sortie: 's1' }, T + 400_000);
    expect(monEpingle(lire(), T + 500_000)).toBeUndefined();
    envoyerPosition({ lat: 45, lon: 7, t: T + 600_000 });
    expect(positions(lire())[0].lat).toBe(44.61);
  });

  it('visages, heures et détails ; une seule épingle à la fois', () => {
    const ps = [
      { sortie: 's1', qui: 'u-seb', depuis: T - 3600e3, jusqu: T + 3600e3, lat: 44.6, lon: 6.7, alt: 2100, prise_le: T - 60_000 },
      { sortie: 's1', qui: 'u-julie', depuis: T - 3600e3, jusqu: T + 3600e3, lat: 44.61, lon: 6.71, alt: 2310, prise_le: T - 4 * 60_000 },
      { sortie: 's1', qui: 'u-luc', depuis: T - 7200e3, jusqu: T + 3600e3, lat: 44.62, lon: 6.72, alt: 2699, prise_le: T - 80 * 60_000 },
    ];
    const rs = reperes(x, ps, 'u-seb', T);
    expect(rs.map((r) => [r.b.pseudo, etiquette(r), opacite(r)])).toEqual([['Seb', 'toi', 1], ['Julie', 'il y a 4 min', 1],
      ['Luc', `${new Date(T - 80 * 60_000).getHours()} h 40`, 0.6]]);
    expect(detail(rs[1], rs[0])).toBe('à 1,4 km de toi · 2 310 m');
    expect(detail(rs[2], rs[0])).toContain('plus de réseau ?');
    // Luc relève son épingle : il reste, grisé.
    const r = reperes(x, [{ ...ps[2], jusqu: T - 60_000 }], 'u-seb', T)[0];
    expect([r.actif, opacite(r), detail(r)]).toEqual([false, 0.5, "2 699 m · a relevé l'épingle"]);
    // Enfoncer ailleurs relève la première.
    localStorage.setItem('buddies', JSON.stringify({ moi: 'u-seb', serveur: [], sorties: [x], traces: [], plannings: [], photos: [], attente: [], positions: ps }));
    _reinitialiser();
    reseau(() => 'coupure');
    enfoncerEpingle([{ sortie: 's2' }], T);
    expect(monEpingle(lire(), T + 1000)?.sortie).toBe('s2');
    expect(positions(lire()).find((p) => p.qui === 'u-seb' && p.sortie === 's1')?.jusqu).toBe(T);
  });

  it('📍 de la colonne : partagée avec deux groupes hors sortie, chaque position part vers les deux', () => {
    localStorage.setItem('buddies', JSON.stringify({ moi: 'u-seb', serveur: [], sorties: [x], traces: [], plannings: [], photos: [], attente: [] }));
    _reinitialiser();
    reseau(() => 'coupure');
    enfoncerEpingle([{ sortie: 's1' }], T);
    enfoncerEpingle([{ groupe: 'a' }, { groupe: 'b' }], T + 1000); // relève celle de la sortie
    expect(mesEpingles(lire(), T + 2000).map((p) => p.groupe).sort()).toEqual(['a', 'b']);
    envoyerPosition({ lat: 44.6, lon: 6.7, t: T + 60_000 });
    envoyerPosition({ lat: 44.61, lon: 6.71, t: T + 360_000 });
    const pos = lire().attente.filter((o) => o.type === 'position');
    expect(pos.map((o) => [o.groupe, o.lat])).toEqual([['a', 44.61], ['b', 44.61]]);
    expect(positions(lire()).find((p) => p.sortie === 's1')?.jusqu).toBe(T + 1000);
    releverEpingle(undefined, T + 400_000);
    expect(mesEpingles(lire(), T + 500_000)).toEqual([]);
    // Un buddy visible dans un groupe et une sortie n'apparaît qu'une fois, avec sa position la plus récente.
    const julie2 = { qui: 'u-julie', depuis: T - 3600e3, jusqu: T + 3600e3, alt: null };
    const rs = reperesTous([{ ...julie2, sortie: 's1', lat: 44, lon: 6, prise_le: T - 600_000 }, { ...julie2, groupe: 'a', lat: 45, lon: 7, prise_le: T - 60_000 }],
      [seb, julie], 'u-seb', T);
    expect(rs.map((r) => [r.b.pseudo, r.p.lat, etiquette(r)])).toEqual([['Julie', 45, 'il y a 1 min']]);
  });
});

describe('Hébergement partagé (bloc 8)', () => {
  const x: Sortie = { id: 's1', groupe: 'a', nom: 'Queyras', photo: null, debut: '2026-12-12', fin: '2026-12-13', lieu: '', modifie_le: '',
    participants: [{ id: 'u-seb', pseudo: 'Seb', photo: null }, { id: 'u-julie', pseudo: 'Julie', photo: null }], invitations: [] };
  const h = (nom: string, prix: number | null) => ({ nom, nature: 'gîte', prix_nuit: prix, adresse: 'Ceillac', url: 'https://x.fr', resume: '', lon: null, lat: null });

  it('sans réseau : proposer, ♥, retenir (un seul), retirer ; le retenu en haut', () => {
    localStorage.setItem('buddies', JSON.stringify({ moi: 'u-seb', serveur: [], sorties: [x], traces: [], plannings: [], photos: [], attente: [] }));
    _reinitialiser();
    reseau(() => 'coupure');
    proposerHebergement(['s1'], h('Gîte Les Baladins', 60));
    proposerHebergement(['s1'], { ...h('Refuge de la Cime', 48), url: 'javascript:alert(1)' });
    proposerHebergement(['s1'], h('Chalet Le Mélezin', 72));
    let hs = vue(lire()).hebergements;
    expect(hs.map((y) => y.nom)).toEqual(['Refuge de la Cime', 'Gîte Les Baladins', 'Chalet Le Mélezin']); // moins chers d'abord
    expect(hs[0].url).toBe('');
    const [refuge, gite, chalet] = hs;
    mettreCoeur(gite.id, true);
    retenirHebergement(refuge.id, true);
    retenirHebergement(gite.id, true);
    retirerHebergement(chalet.id);
    hs = vue(lire()).hebergements;
    expect(hs.map((y) => [y.nom, y.retenu, y.coeurs])).toEqual([['Gîte Les Baladins', true, ['u-seb']], ['Refuge de la Cime', false, []]]);
    mettreCoeur(gite.id, false);
    expect(vue(lire()).hebergements[0].coeurs).toEqual([]);
  });

  it('image et prix', () => {
    expect(['Refuge CAF', 'Camping', 'Hôtel du Col', 'Chalet', 'Gîte'].map(iconeHebergement)).toEqual(['🏔', '⛺', '🏨', '🛖', '🏠']);
    expect([prixHebergement({ prix_nuit: 60 }), prixHebergement({ prix_nuit: null })]).toEqual(['60 € / nuit', 'prix à voir']);
  });
});

describe('Messagerie (bloc 9)', () => {
  const m = (id: string, par: string, cree_le: string, o: Partial<MessageBuddy> = {}): MessageBuddy => ({ id, groupe: null, sortie: 's1', par,
    nature: 'texte', texte: id, lon: null, lat: null, photo: null, cree_le, ...o });

  it('sans réseau : texte, point, retrait ; les vides ne partent pas', () => {
    localStorage.setItem('buddies', JSON.stringify({ moi: 'u-seb', serveur: [], sorties: [], traces: [], plannings: [], photos: [], attente: [] }));
    _reinitialiser();
    reseau(() => 'coupure');
    envoyerMessage({ sortie: 's1' }, { texte: '  Top ! RDV 7 h 30 au parking ?  ' });
    envoyerMessage({ groupe: 'a' }, { texte: '   ' });
    envoyerMessage({ sortie: 's1' }, { nature: 'point', lon: 6.712345678, lat: 44.6 });
    const ms = vue(lire()).messages;
    expect(ms.map((x) => [x.nature, x.texte, x.sortie, x.par, x.attente])).toEqual([
      ['texte', 'Top ! RDV 7 h 30 au parking ?', 's1', 'u-seb', true], ['point', '', 's1', 'u-seb', true]]);
    expect(ms[1].lon).toBe(6.712346);
    retirerMessage(ms[0].id);
    expect(vue(lire()).messages.map((x) => [x.nature, x.supprime ?? false, x.texte])).toEqual([['texte', true, ''], ['point', false, '']]);
  });

  it('reçus du serveur, non lus', async () => {
    const recus = [m('m1', 'u-julie', '2026-11-23T08:00:00Z'), m('m2', 'u-seb', '2026-11-23T08:05:00Z'), m('m3', 'u-luc', '2026-11-23T08:10:00Z')];
    reseau(() => ({ curseur: 'c', moi: 'u-seb', ids: ['me'], groupes: [ME], refus: [], ids_sorties: [], sorties: [], ids_traces: [], traces: [],
      ids_plannings: [], plannings: [], ids_photos: [], photos: [], ids_depenses: [], depenses: [], ids_messages: ['m1', 'm2', 'm3'], messages: recus }));
    await synchroniser();
    expect(vue(lire()).messages.map((x) => x.id)).toEqual(['m1', 'm2', 'm3']);
    expect(nonLus(lire(), 's1', vue(lire()).messages)).toBe(2);
    marquerLu('s1', '2026-11-23T08:07:00Z');
    expect(nonLus(lire(), 's1', vue(lire()).messages)).toBe(1);
  });

  it('le fil mêle messages, traces et hébergements ; aperçu et heure', () => {
    const t: TraceBuddy = { id: 't1', sortie: 's1', groupe: null, nom: 'Col Girardin', ligne: [[6.7, 44.6], [6.7, 44.7]], mot: '',
      par: { id: 'u-julie', pseudo: 'Julie', photo: null }, cree_le: '2026-11-23T08:02:00Z' };
    const h = { id: 'h1', sortie: 's1', nom: 'Gîte Les Baladins', nature: 'gîte', prix_nuit: 60, adresse: '', url: '', resume: '', lon: null, lat: null,
      retenu: false, par: 'u-seb', coeurs: [], cree_le: '2026-11-23T08:20:00Z', modifie_le: '2026-11-23T09:00:00Z' };
    const autre = { ...t, id: 't2', sortie: null, groupe: 'a' };
    const ms = [m('m1', 'u-julie', '2026-11-23T08:00:00Z'), m('m2', 'u-seb', '2026-11-23T08:10:00Z', { nature: 'point', texte: '' }),
      m('m3', 'u-luc', '2026-11-23T08:00:00Z', { sortie: null, groupe: 'a' })];
    const f = fil({ sortie: 's1' }, ms, [t, autre], [h]);
    expect(f.map((b) => b.genre)).toEqual(['message', 'trace', 'message', 'hebergement']);
    expect(fil({ groupe: 'a' }, ms, [t, autre], [h]).map((b) => b.genre)).toEqual(['message', 'trace']);
    const nom = (id: string) => ({ 'u-julie': 'Julie', 'u-luc': 'Luc' })[id] ?? '?';
    expect(f.map((b) => apercu(b, nom, 'u-seb'))).toEqual(['Julie : m1', '〰 Julie : Col Girardin', 'Toi : 📍 je suis ici', '🏨 Toi : Gîte Les Baladins']);
    const now = new Date(2026, 10, 23, 12, 0);
    expect(heureMessage(new Date(2026, 10, 23, 9, 5).toISOString(), now)).toBe('9 h 05');
    expect(heureMessage(new Date(2026, 10, 22, 18, 30).toISOString(), now)).toBe('hier 18 h 30');
    expect(heureMessage(new Date(2026, 10, 12, 18, 30).toISOString(), now)).toBe('12 nov.');
    expect(longueurTrace(t.ligne)).toBe('11 km');
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
