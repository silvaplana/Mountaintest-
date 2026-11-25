// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@capacitor/preferences', () => ({ Preferences: { get: async () => ({ value: null }) } }));
import { agir, annuler, type ActionDemandee } from '../src/buddies/bud';
import { _reinitialiser, lire, vue, type Planning, type Sortie } from '../src/buddies/store';

const b = (id: string, pseudo: string) => ({ id, pseudo, photo: null, role: 'membre' });
const so = { id: 's', groupe: 'g', nom: 'Queyras', photo: null, debut: '2026-12-12', fin: '2026-12-13', lieu: '', modifie_le: '',
  participants: [b('seb', 'Seb'), b('julie', 'Julie')], invitations: [] } as unknown as Sortie;
const pl = { id: 'p', groupe: 'g', nom: 'Saison ski', par: b('seb', 'Seb'), dates: [['2027-01-10', '2027-01-11']], limite: '2027-01-01',
  modifie_le: '', dispos: [] } as unknown as Planning;
const vide: ActionDemandee = { type: 'depense', titre: null, montant_euros: null, paye_par: null, pour: [], nom: null, nouveau_nom: null, debut: null, fin: null, lieu: null, etat: null };
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
  it('supprime un Buddy Time de la bande, puis Annuler le remet', () => {
    const { faites, refus } = agir([{ ...vide, type: 'supprimer_buddy_time', nom: 'queyras' }], { groupe: 'g' },
      { ...donnees, sortie: undefined, sorties: [{ ...so, par: 'seb' }] });
    expect(refus).toEqual([]);
    expect(lire().attente.map((o) => o.type)).toEqual(['supprimer_sortie']);
    annuler(faites);
    expect(lire().attente[1]).toMatchObject({ type: 'remettre_sortie', sortie: 's', copie: { nom: 'Queyras' } });
    expect(vue({ ...lire(), sorties: [so] }).sorties.map((x) => x.id)).toEqual(['s']);
    expect(vue({ ...lire(), sorties: [so], attente: lire().attente.slice(0, 1) }).sorties).toEqual([]);
  });
  it('renomme un Buddy Time, puis Annuler remet l’ancien nom', () => {
    const { faites, refus } = agir([{ ...vide, type: 'renommer_buddy_time', nouveau_nom: '  Raquettes au Queyras ' }], { sortie: 's' }, donnees);
    expect(refus).toEqual([]);
    expect(lire().attente[0]).toMatchObject({ type: 'renommer_sortie', sortie: 's', nom: 'Raquettes au Queyras' });
    expect(vue({ ...lire(), sorties: [so] }).sorties[0].nom).toBe('Raquettes au Queyras');
    annuler(faites);
    expect(vue({ ...lire(), sorties: [so] }).sorties[0].nom).toBe('Queyras');
  });
  it('ne supprime pas le Buddy Time d’un autre si je ne suis pas admin', () => {
    const { faites, refus } = agir([{ ...vide, type: 'supprimer_buddy_time' }], { sortie: 's' }, { ...donnees, sortie: { ...so, par: 'julie' } });
    expect(faites).toEqual([]);
    expect(refus).toHaveLength(1);
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
