// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _reinitialiser as reinitCompte, ecrire as ecrireCompte } from '../src/compte/auth';
import {
  _reinitialiser, envoyerMessage, lire, marquerLu, modifierMessage, reagir, retirerMessage, statut, vue, type Lecture, type MessageBuddy,
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
