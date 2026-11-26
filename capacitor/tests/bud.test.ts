import { describe, expect, it, vi } from 'vitest';
vi.mock('@capacitor/preferences', () => ({ Preferences: { get: async () => ({ value: null }) } }));
import { contexte, pourBud } from '../src/buddies/bud';
import type { Sortie } from '../src/buddies/store';

describe('Bud', () => {
  it('ne parle que si on l’appelle', () => {
    expect(pourBud('Bud, trouve-nous un gîte')).toBe(true);
    expect(pourBud('bud : la pente ?')).toBe(true);
    expect(pourBud('Les Baladins 👍 Bud, la pente maxi ?')).toBe(true);
    expect(pourBud('On dort où le samedi ?')).toBe(false);
    expect(pourBud('Mon budget est serré')).toBe(false);
    expect(pourBud('buds quelle heure est-il')).toBe(true); // dicté « buds »
    // Dictée (Seb, 25 novembre) : « bad », « budd », « OK Bud »…
    for (const x of ['Bad, supprime ce BT', 'bad supprime ce BT', 'Budd, la météo ?', 'Bude où on dort', 'Bod, le gîte ?',
      'OK Bud, crée un BT', 'ok bad crée un BT', 'Hey Bud la pente', 'Dis bud, combien je dois ?', 'Beud, la météo'])
      expect(pourBud(x), x).toBe(true);
    for (const x of ['Sortie samedi ?', 'Badminton demain', 'OK pour samedi', 'Bodega ce soir', 'Le temps est bad'])
      expect(pourBud(x), x).toBe(false);
  });
  it('connaît la sortie, les comptes et les derniers messages', () => {
    const b = (id: string, pseudo: string) => ({ id, pseudo, photo: null, role: 'membre' });
    const so = { id: 's', groupe: 'g', nom: 'Week-end Queyras', photo: null, debut: '2026-12-12', fin: '2026-12-13', lieu: 'Ceillac',
      modifie_le: '', participants: [b('seb', 'Seb'), b('julie', 'Julie')], invitations: [] } as unknown as Sortie;
    const t = contexte({ sortie: 's' }, {
      nom: '', sortie: so, membres: so.participants, moi: 'seb', traces: [], hebergements: [], plannings: [],
      depenses: [{ id: 'd', sortie: 's', titre: 'Gîte', montant: 12000, paye_par: 'julie', pour: ['seb', 'julie'], jour: '2026-12-12', par: 'julie', modifie_le: '' }],
      messages: [{ id: 'm', groupe: null, sortie: 's', par: 'julie', nature: 'texte', texte: 'On dort où ?', lon: null, lat: null, photo: null, cree_le: '' }],
    });
    expect(t).toContain('Week-end Queyras');
    expect(t).toContain('Seb, Julie');
    expect(t).toContain('Seb (celui qui te parle) doit 60.00 € à Julie');
    expect(t).toContain('Julie : On dort où ?');
  });
});
