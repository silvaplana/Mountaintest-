// Massifs de skitour.fr, groupés comme sur le site (page Sorties). Remplacé par /api/massifs (id, nom, groupe)
// via le relais quand il est joignable ; cette liste sert hors ligne et pour la maquette.
export const MASSIF_GROUPS: [string, string[]][] = [
  ['Haute Savoie', ['Bornes - Aravis', 'Chablais - Faucigny', 'Haut Giffre - Aiguilles Rouges', 'Mont Blanc']],
  ['Savoie', ['Alpes Grées N', 'Alpes Grées S', 'Bauges', 'Beaufortain', 'Lauzière - Cheval Noir', 'Vanoise']],
  ['Isère', ['Belledonne', 'Chartreuse', 'Grandes Rousses - Arves', 'Taillefer - Matheysine', 'Vercors']],
  ['Hautes Alpes', ['Cerces - Thabor - Mont Cenis', 'Devoluy', 'Ecrins', 'Queyras - Alpes Cozie N']],
  ['Alpes du Sud - Corse', ['Corse', 'Mercantour - Alpes Maritimes Italiennes', 'Préalpes de Digne', 'Préalpes de Grasse', 'Préalpes de provence', 'Ubaye - Parpaillon - Alpes Cozie S']],
  ['Pyrénées', ['Andorre - Ariège', 'Canigó - Catalogne Est', 'Cerdagne - Capcir - Conflent', 'Couserans - Catalogne Ouest', 'Luchon - Posets - Maladeta', 'Mont-Perdu - Gavarnie - Bigorre', 'Navarre - Béarn']],
  ['Autres massifs', ['Jura', 'Massif Central', 'Montagne Ardéchoise', 'Vosges']],
];
/** « Limiter à » de skitour.fr, en jours. */
export const LIMITS: [number, string][] = [[1, '1 jour'], [2, '2 jours'], [3, '3 jours'], [4, '4 jours'], [5, '5 jours'], [6, '6 jours'],
  [7, '1 sem.'], [14, '2 sem.'], [30, '1 mois'], [60, '2 mois'], [90, '3 mois'], [180, '6 mois']];
