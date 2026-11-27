import { describe, expect, it } from 'vitest';
import { chercherModeles, dessinVoiture, formeDuModele } from '../src/buddies/voitureDessin';

describe('Ma voiture (Seb, 27/11)', () => {
  it('propose les modèles connus avec leur silhouette', () => {
    expect(chercherModeles('dus')[0]).toEqual({ nom: 'Dacia Duster', forme: 'suv' });
    expect(chercherModeles('Dacia Dus').map((m) => m.nom)).toEqual(['Dacia Duster', 'Dacia Duster Pick-up']);
    expect(chercherModeles('citroen c3').map((m) => m.nom)).toContain('Citroën C3');
    expect(chercherModeles('d')).toEqual([]);
  });
  it('déduit la silhouette du modèle tapé', () => {
    expect(formeDuModele('dacia duster')).toBe('suv');
    expect(formeDuModele('Clio')).toBe('citadine');
    expect(formeDuModele('VW California')).toBeUndefined(); // marque inconnue écrite ainsi : on choisit à la main
    expect(formeDuModele('Volkswagen California')).toBe('camping');
  });
  it('dessine la voiture à la couleur choisie', () => {
    const svg = dessinVoiture('suv', 'bleu', 96);
    expect(svg).toContain('width="96"');
    expect(svg).toContain('#1e5fb4');
  });
});
