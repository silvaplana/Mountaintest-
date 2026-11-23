// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@capacitor/preferences', () => ({ Preferences: { get: async () => ({ value: null }) } }));
import { agir, annuler, type ActionDemandee } from '../src/buddies/bud';
import { _reinitialiser, lire, type Planning, type Sortie } from '../src/buddies/store';

const b = (id: string, pseudo: string) => ({ id, pseudo, photo: null, role: 'membre' });
const so = { id: 's', groupe: 'g', nom: 'Queyras', photo: null, debut: '2026-12-12', fin: '2026-12-13', lieu: '', modifie_le: '',
  participants: [b('seb', 'Seb'), b('julie', 'Julie')], invitations: [] } as unknown as Sortie;
const pl = { id: 'p', groupe: 'g', nom: 'Saison ski', par: b('seb', 'Seb'), dates: [['2027-01-10', '2027-01-11']], limite: '2027-01-01',
  modifie_le: '', dispos: [] } as unknown as Planning;
const vide: ActionDemandee = { type: 'depense', titre: null, montant_euros: null, paye_par: null, pour: [], nom: null, debut: null, fin: null, lieu: null, etat: null };
const donnees = { nom: '', sortie: so, membres: so.participants, moi: 'seb', traces: [], hebergements: [], depenses: [], plannings: [pl], messages: [],
  groupe: { id: 'g', nature: 'bande', membres: so.participants } };

describe('Bud agit à ma demande', () => {
  beforeEach(() => { localStorage.clear(); _reinitialiser(); });
  it('ajoute une dépense, ma dispo et un Buddy Time, puis Annuler défait tout', () => {
    const { faites, refus } = agir([
      { ...vide, titre: 'Gîte', montant_euros: 120, paye_par: 'julie' },
      { ...vide, type: 'dispo', nom: 'saison ski', debut: '2027-01-10', etat: 'oui' },
      { ...vide, type: 'buddy_time', nom: 'Rando Belledonne', debut: '2027-02-06' },
    ], { sortie: 's' }, donnees);
    expect(refus).toEqual([]);
    expect(faites.map((a) => a.genre)).toEqual(['depense', 'dispo', 'sortie']);
    const types = () => lire().attente.map((o) => o.type);
    expect(types()).toEqual(['depense', 'dispo', 'creer_sortie']);
    expect(lire().attente[0]).toMatchObject({ montant: 12000, paye_par: 'julie', pour: ['seb', 'julie'] });
    annuler(faites);
    expect(types().slice(3)).toEqual(['retirer_sortie', 'dispo', 'retirer_depense']);
    expect(lire().attente[4]).toMatchObject({ etat: '' });
  });
  it('écarte ce qui sort de la bande ou du planning', () => {
    const { faites, refus } = agir([
      { ...vide, titre: 'Essence', montant_euros: 50, paye_par: 'Marc' },
      { ...vide, type: 'dispo', debut: '2027-03-01', etat: 'oui' },
    ], { sortie: 's' }, donnees);
    expect(faites).toEqual([]);
    expect(refus).toHaveLength(2);
  });
});
