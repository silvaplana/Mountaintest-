// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _reinitialiser as reinitCompte, ecrire as ecrireCompte } from '../src/compte/auth';
import {
  _reinitialiser, envoyerMessage, lire, marquerLu, modifierMessage, reagir, retirerMessage, statut, transferer, voter, vue, type Lecture, type MessageBuddy,
} from '../src/buddies/store';
import { jourMessage, morceaux, resume } from '../src/buddies/messages';

/** La messagerie reprise d'AppBase (spec/buddies.md §5.6) : répondre, modifier, supprimer, réagir, coches. */
beforeEach(() => {
  localStorage.clear(); reinitCompte(); _reinitialiser(); vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
  ecrireCompte({ refresh: 'R', access: 'A', accessExp: Date.now() + 3600e3, config: { logto: 'https://auth.test', ressource: 'r', appId: 'a' },
    profil: { id: 'u-seb', email: 'seb@exemple.fr', pseudo: 'Seb', photo: null } });
  localStorage.setItem('buddies', JSON.stringify({ moi: 'u-seb', serveur: [], sorties: [], traces: [], plannings: [], photos: [], attente: [] }));
  _reinitialiser();
});

const m = (o: Partial<MessageBuddy> = {}): MessageBuddy => ({ id: 'm1', groupe: 'g', sortie: null, par: 'u-seb', nature: 'texte', texte: 'Salut',
  lon: null, lat: null, photo: null, cree_le: '2026-11-24T10:00:00Z', ...o });

describe('messagerie façon AppBase', () => {
  it('sans réseau : répondre, modifier, réagir, supprimer', () => {
    const a = envoyerMessage({ groupe: 'g' }, { texte: 'On part à 7 h ?' });
    const b = envoyerMessage({ groupe: 'g' }, { texte: 'Plutôt 6 h', repond_a: a });
    modifierMessage(a, '  On part à 6 h 30 ?  ');
    reagir(a, '👍');
    reagir(a, '❤️'); // remplace
    retirerMessage(b);
    const [x, y] = vue(lire()).messages;
    expect([x.texte, x.edite, x.reactions]).toEqual(['On part à 6 h 30 ?', true, [{ qui: 'u-seb', emoji: '❤️' }]]);
    expect([y.repond_a, y.supprime, y.texte]).toEqual([a, true, '']);
    reagir(a, null);
    expect(vue(lire()).messages[0].reactions).toEqual([]);
    expect(lire().attente.map((o) => o.type)).toEqual(['message', 'message', 'modifier_message', 'reagir', 'reagir', 'retirer_message', 'reagir']);
  });

  it('lu jusqu’au dernier message reçu : part aux autres', () => {
    marquerLu('g', '2026-11-24T10:05:00Z');
    expect(lire().lus?.g).toBe(Date.parse('2026-11-24T10:05:00Z'));
    expect(lire().attente.at(-1)).toMatchObject({ type: 'lu', cle: 'g', jusqu: '2026-11-24T10:05:00Z' });
  });

  it('coches : 🕓, ✓ envoyé, ✓✓ reçu, ✓✓ bleues lu par tous', () => {
    const l = (qui: string, vu: string, lu?: string): Lecture => ({ qui, vu_le: vu, lus: lu ? { g: lu } : {} });
    expect(statut(m({ attente: true }), ['julie'], [])).toBe('attente');
    expect(statut(m(), ['julie'], [])).toBe('envoye');
    expect(statut(m(), ['julie'], [l('julie', '2026-11-24T09:00:00Z')])).toBe('envoye');
    expect(statut(m(), ['julie', 'luc'], [l('julie', '2026-11-24T10:01:00Z'), l('luc', '2026-11-24T10:02:00Z', '2026-11-24T10:00:00Z')])).toBe('recu');
    expect(statut(m(), ['julie', 'luc'], [l('julie', '2026-11-24T10:01:00Z', '2026-11-24T10:01:00Z'), l('luc', '2026-11-24T10:02:00Z', '2026-11-24T10:00:00Z')])).toBe('lu');
  });

  it('liens cliquables, jours du fil, rappel d’une réponse', () => {
    expect(morceaux('Voir www.skitour.fr. Et https://a.b/c?d=1 !')).toEqual([
      { texte: 'Voir ' }, { texte: 'www.skitour.fr', lien: 'https://www.skitour.fr' }, { texte: '. Et ' },
      { texte: 'https://a.b/c?d=1', lien: 'https://a.b/c?d=1' }, { texte: ' !' }]);
    const maintenant = new Date('2026-11-24T12:00:00');
    expect(jourMessage('2026-11-24T08:00:00', maintenant)).toBe('Aujourd’hui');
    expect(jourMessage('2026-11-23T08:00:00', maintenant)).toBe('Hier');
    expect(jourMessage('2026-11-21T08:00:00', maintenant)).toBe('samedi 21 novembre');
    expect(resume(m({ nature: 'point' }))).toBe('📍 Position');
    expect(resume(m({ supprime: true }))).toBe('Ce message a été supprimé');
  });
});

describe('discussions à deux', () => {
  it('même identifiant que le serveur (uuid5), une seule par paire', async () => {
    const { uuid5, ouvrirDuo, appliquer, contacts, presence } = await import('../src/buddies/store');
    expect(await uuid5('aa:bb')).toBe('aef85378-86bf-5bbb-b7cc-611b92e9772a');
    const g = { id: 'g', nom: 'Ski', nature: 'bande' as const, photo: null, modifie_le: '2026-11-24T10:00:00Z', invitations: [],
      membres: [{ id: 'u-seb', pseudo: 'Seb', photo: null }, { id: 'u-julie', pseudo: 'Julie', photo: null }, { id: 'u-alex', pseudo: 'Alex', photo: null }] };
    localStorage.setItem('buddies', JSON.stringify({ ...lire(), serveur: [g] }));
    _reinitialiser();
    expect(contacts().map((c) => [c.b.pseudo, c.bandes])).toEqual([['Alex', ['Ski']], ['Julie', ['Ski']]]);
    const a = await ouvrirDuo(g.membres[1]);
    expect(await ouvrirDuo(g.membres[1])).toBe(a);
    const duos = appliquer(lire()).filter((x) => x.nature === 'duo');
    expect(duos.map((x) => [x.id, x.membres.map((b) => b.pseudo)])).toEqual([[a, ['Seb', 'Julie']]]);
    expect(lire().attente.filter((o) => o.type === 'duo')).toHaveLength(1);
    const maintenant = Date.parse('2026-11-24T10:00:20Z');
    expect(presence('u-julie', [{ qui: 'u-julie', vu_le: '2026-11-24T10:00:00Z', lus: {} }], maintenant)).toBe('en ligne');
    expect(presence('u-julie', [{ qui: 'u-julie', vu_le: '2026-11-24T08:05:00Z', lus: {} }], maintenant)).toMatch(/^vu aujourd’hui à \d+ h 05$/);
    expect(presence('u-luc', [], maintenant)).toBeNull();
  });

  it('sondage, fichier joint et transfert, sans réseau', () => {
    const s = envoyerMessage({ groupe: 'g' }, { nature: 'sondage', sondage: { question: 'Quel jour ?', multiple: false, options: ['Samedi', 'Dimanche'] } });
    voter(s, [1]);
    const f = { id: 'f1', nom: 'topo.pdf', mime: 'application/pdf', taille: 2048, envoye: false };
    const p = envoyerMessage({ groupe: 'g' }, { nature: 'fichier', fichier: f });
    const [ms, mp] = vue(lire()).messages;
    expect(ms.sondage?.votes).toEqual([{ qui: 'u-seb', option: 1 }]);
    expect(resume(ms)).toBe('📊 Quel jour ?');
    expect(resume(mp)).toBe('📄 topo.pdf');
    expect(lire().envoisFichiers).toEqual(['f1']);
    // Transférer : le sondage reste ici, le fichier part (sans être renvoyé : déjà annoncé).
    transferer(vue(lire()).messages.filter((x) => [s, p].includes(x.id)), [{ groupe: 'h' }]);
    const t = vue(lire()).messages.filter((x) => x.groupe === 'h');
    expect(t.map((x) => [x.nature, x.transfere, x.fichier?.id])).toEqual([['fichier', true, 'f1']]);
    expect(lire().envoisFichiers).toEqual(['f1']);
  });
});
