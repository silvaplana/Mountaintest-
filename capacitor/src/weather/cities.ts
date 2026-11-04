// Villes affichées sur la carte simplifiée (quand la météo est posée dessus) : nom, latitude, longitude, rang.
// Rang 1 : grandes villes (dès le zoom 5) ; 2 : préfectures (zoom 7) ; 3 : villes de montagne et du Sud (zoom 9).
// Même liste côté Kotlin (Cities.kt).
export type City = [name: string, lat: number, lon: number, rank: 1 | 2 | 3];

export const CITY_MIN_ZOOM: Record<1 | 2 | 3, number> = { 1: 5, 2: 7, 3: 9 };

export const CITIES: City[] = [
  ['Paris', 48.86, 2.35, 1], ['Marseille', 43.30, 5.37, 1], ['Lyon', 45.76, 4.84, 1], ['Toulouse', 43.60, 1.44, 1],
  ['Nice', 43.70, 7.27, 1], ['Nantes', 47.22, -1.55, 1], ['Strasbourg', 48.57, 7.75, 1], ['Montpellier', 43.61, 3.88, 1],
  ['Bordeaux', 44.84, -0.58, 1], ['Lille', 50.63, 3.06, 1], ['Rennes', 48.11, -1.68, 1], ['Grenoble', 45.19, 5.72, 1],
  ['Clermont-Ferrand', 45.78, 3.08, 1], ['Dijon', 47.32, 5.04, 1], ['Brest', 48.39, -4.49, 1], ['Limoges', 45.83, 1.26, 1],
  ['Tours', 47.39, 0.69, 1], ['Rouen', 49.44, 1.10, 1], ['Nancy', 48.69, 6.18, 1], ['Perpignan', 42.70, 2.90, 1],
  ['Bastia', 42.70, 9.45, 1], ['Ajaccio', 41.93, 8.74, 1], ['Genève', 46.20, 6.15, 1], ['Turin', 45.07, 7.69, 1],
  ['Orléans', 47.90, 1.91, 2], ['Caen', 49.18, -0.37, 2], ['Metz', 49.12, 6.18, 2], ['Reims', 49.26, 4.03, 2],
  ['Besançon', 47.24, 6.02, 2], ['Pau', 43.30, -0.37, 2], ['Bayonne', 43.49, -1.48, 2], ['Toulon', 43.12, 5.93, 2],
  ['Avignon', 43.95, 4.81, 2], ['Nîmes', 43.84, 4.36, 2], ['Annecy', 45.90, 6.13, 2], ['Chambéry', 45.57, 5.92, 2],
  ['Gap', 44.56, 6.08, 2], ['Digne-les-Bains', 44.09, 6.24, 2], ['Valence', 44.93, 4.89, 2], ['Saint-Étienne', 45.44, 4.39, 2],
  ['Le Havre', 49.49, 0.11, 2], ['Amiens', 49.89, 2.30, 2], ['Poitiers', 46.58, 0.34, 2], ['La Rochelle', 46.16, -1.15, 2],
  ['Angers', 47.47, -0.55, 2], ['Le Mans', 48.00, 0.20, 2], ['Mulhouse', 47.75, 7.34, 2], ['Troyes', 48.30, 4.07, 2],
  ['Auxerre', 47.80, 3.57, 2], ['Nevers', 46.99, 3.16, 2], ['Bourges', 47.08, 2.40, 2], ['Châteauroux', 46.81, 1.69, 2],
  ['Aurillac', 44.93, 2.44, 2], ['Le Puy-en-Velay', 45.04, 3.88, 2], ['Mende', 44.52, 3.50, 2], ['Rodez', 44.35, 2.57, 2],
  ['Albi', 43.93, 2.15, 2], ['Montauban', 44.02, 1.35, 2], ['Cahors', 44.45, 1.44, 2], ['Agen', 44.20, 0.62, 2],
  ['Auch', 43.65, 0.59, 2], ['Tarbes', 43.23, 0.07, 2], ['Foix', 42.97, 1.61, 2], ['Carcassonne', 43.21, 2.35, 2],
  ['Privas', 44.74, 4.60, 2], ['Bourg-en-Bresse', 46.21, 5.23, 2], ['Mâcon', 46.31, 4.83, 2], ['Lons-le-Saunier', 46.67, 5.55, 2],
  ['Vesoul', 47.62, 6.16, 2], ['Belfort', 47.64, 6.86, 2], ['Colmar', 48.08, 7.36, 2], ['Épinal', 48.17, 6.45, 2],
  ['Chaumont', 48.11, 5.14, 2], ['Bar-le-Duc', 48.77, 5.16, 2], ['Châlons-en-Champagne', 48.96, 4.37, 2], ['Charleville-Mézières', 49.77, 4.72, 2],
  ['Laon', 49.56, 3.62, 2], ['Arras', 50.29, 2.78, 2], ['Beauvais', 49.43, 2.08, 2], ['Évreux', 49.02, 1.15, 2],
  ['Chartres', 48.44, 1.49, 2], ['Blois', 47.59, 1.33, 2], ['Laval', 48.07, -0.77, 2], ['Alençon', 48.43, 0.09, 2],
  ['Saint-Lô', 49.12, -1.09, 2], ['Saint-Brieuc', 48.51, -2.76, 2], ['Quimper', 48.00, -4.10, 2], ['Vannes', 47.66, -2.76, 2],
  ['La Roche-sur-Yon', 46.67, -1.43, 2], ['Niort', 46.32, -0.46, 2], ['Angoulême', 45.65, 0.16, 2], ['Périgueux', 45.18, 0.72, 2],
  ['Tulle', 45.27, 1.77, 2], ['Guéret', 46.17, 1.87, 2], ['Moulins', 46.57, 3.33, 2], ['Mont-de-Marsan', 43.89, -0.50, 2],
  ['Andorre', 42.51, 1.52, 2], ['Monaco', 43.73, 7.42, 2],
  ['Béziers', 43.34, 3.22, 3], ['Narbonne', 43.18, 3.00, 3], ['Arles', 43.68, 4.63, 3], ['Aix-en-Provence', 43.53, 5.45, 3],
  ['La Ciotat', 43.17, 5.60, 3], ['Briançon', 44.90, 6.64, 3], ['Barcelonnette', 44.39, 6.65, 3], ['Embrun', 44.56, 6.50, 3],
  ['Sisteron', 44.19, 5.94, 3], ['Manosque', 43.83, 5.79, 3], ['Draguignan', 43.54, 6.46, 3], ['Fréjus', 43.43, 6.74, 3],
  ['Cannes', 43.55, 7.02, 3], ['Antibes', 43.58, 7.12, 3], ['Menton', 43.78, 7.50, 3], ['Aubenas', 44.62, 4.39, 3],
  ['Montélimar', 44.56, 4.75, 3], ['Orange', 44.14, 4.81, 3], ['Carpentras', 44.06, 5.05, 3], ['Apt', 43.88, 5.40, 3],
  ['Cavaillon', 43.84, 5.04, 3], ['Salon-de-Provence', 43.64, 5.10, 3], ['Martigues', 43.40, 5.05, 3], ['Hyères', 43.12, 6.13, 3],
  ['Brignoles', 43.41, 6.06, 3], ['Albertville', 45.68, 6.39, 3], ['Bourg-Saint-Maurice', 45.62, 6.77, 3], ['Modane', 45.20, 6.67, 3],
  ['Saint-Jean-de-Maurienne', 45.28, 6.35, 3], ['Chamonix', 45.92, 6.87, 3], ['Thonon-les-Bains', 46.37, 6.48, 3], ['Chalon-sur-Saône', 46.78, 4.85, 3],
  ['Vichy', 46.13, 3.43, 3], ['Montluçon', 46.34, 2.60, 3], ['Roanne', 46.04, 4.07, 3], ['Vienne', 45.53, 4.87, 3],
  ['Dax', 43.71, -1.05, 3], ['Lourdes', 43.10, -0.05, 3], ['Saint-Gaudens', 43.11, 0.72, 3], ['Millau', 44.10, 3.08, 3],
  ['Sète', 43.40, 3.70, 3], ['Alès', 44.13, 4.08, 3], ['Corte', 42.31, 9.15, 3], ['Calvi', 42.57, 8.76, 3],
  ['Porto-Vecchio', 41.59, 9.28, 3], ['Saint-Nazaire', 47.27, -2.21, 3], ['Lorient', 47.75, -3.37, 3], ['Cherbourg', 49.64, -1.62, 3],
  ['Calais', 50.95, 1.86, 3], ['Boulogne-sur-Mer', 50.73, 1.61, 3], ['Dunkerque', 51.03, 2.38, 3], ['Saint-Quentin', 49.85, 3.29, 3],
];
