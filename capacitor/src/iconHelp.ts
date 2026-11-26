/**
 * Aide en ligne des icônes de la carte : un appui long sur une icône affiche sa bulle.
 */
export type IconKey =
  | 'close' | 'locate' | 'search' | 'photo' | 'layer' | 'avion' | 'poche' | 'reglages' | 'carrefours' | 'vibre' | 'doubletap' | 'draw'
  | 'slopes' | 'view3d' | 'compass' | 'shade' | 'forests' | 'ski' | 'skiText' | 'weatherMountain' | 'travel' | 'lodging' | 'expenses' | 'groups' | 'moi' | 'drones';

export const ICON_HELP: Record<IconKey, { title: string; text: string }> = {
  close: { title: '✕ Quitter', text: 'Ferme l\'appli.' },
  locate: { title: 'Me localiser', text: 'Centre la carte sur toi. Encore : coupe le GPS.' },
  search: { title: '🔍 Chercher un lieu', text: 'Cherche une ville, un sommet, un col… Tape ou dis le nom avec 🎤.' },
  photo: { title: '📷 Appareil photo', text: 'Ouvre l’appareil photo.' },
  layer: { title: '🗺 Fond de carte', text: 'SCAN 25, Plan IGN ou auto.' },
  avion: { title: '✈ Mode avion', text: 'Ouvre le réglage. Le GPS marche toujours.' },
  poche: { title: '👖 Mode poche', text: 'Vertical 3 s = écran noir.' },
  reglages: { title: '⚙ Réglages du suivi', text: 'Montre ⑂, la vibration hors trace et le double tap.' },
  carrefours: { title: '⑂ Écran aux carrefours', text: 'Écran rallumé avant les carrefours et hors trace, pendant le suivi.' },
  vibre: { title: 'Vibration hors trace', text: 'Vibre si tu t’éloignes de 50 m de la trace suivie.' },
  doubletap: { title: 'Double tap', text: 'Ouvre le réglage du téléphone : deux coups sur l’écran éteint le rallument.' },
  draw: { title: '✏ Tracer au doigt', text: 'Dessine un parcours : km et dénivelé.' },
  slopes: { title: '⛰ Pentes', text: 'Carte IGN des pentes :' },
  view3d: { title: '🗻 Vue 3D', text: 'Incline la carte sur le relief. Aussi : deux doigts vers le haut. Inclinée, elle tourne à deux doigts.' },
  compass: { title: '🧭 À plat', text: 'Remet la carte à plat, nord en haut.' },
  shade: { title: '🌗 Ombres', text: 'Ombres du soleil heure par heure.' },
  forests: { title: '🌲 Forêts', text: 'Forêts par essence de la zone affichée (carte forestière IGN). Encore : les efface.' },
  ski: { title: '⛷🗺 Sorties ski', text: 'Sorties skitour.fr sur la carte.' },
  skiText: { title: '⛷ Sorties ski', text: 'Sorties skitour.fr ; 🗺 : sur la carte.' },
  weatherMountain: { title: '🏔 Météo montagne', text: 'Météo-France montagne.' },
  travel: { title: '🚗 Voyage en voiture', text: 'Km, coût, péages.' },
  lodging: { title: '🏨 Hébergement', text: 'Les meilleurs prix.' },
  expenses: { title: 'Partage des frais', text: 'Qui doit combien à qui.' },
  groups: { title: '👥 Buddies', text: 'Mes Buddy Groups et mes sorties entre copains.' },
  moi: { title: '👤 Moi', text: 'Mon compte, mon profil. Rond vert : connecté.' },
  drones: { title: 'Drones', text: 'Carte officielle des zones pour drone de loisir :' },
};

/** Légende de la carte DGAC « Restrictions UAS catégorie Ouverte et aéromodélisme ». */
export const DRONE_LEGEND: { color: string; label: string }[] = [
  { color: '#E3170A', label: 'Interdit' },
  { color: '#FF9900', label: 'Hauteur limitée : 30 à 100 m selon la zone' },
  { color: 'transparent', label: 'Sans couleur : jusqu’à 120 m' },
];
export const DRONE_HELP = 'Ne montre pas les interdictions du jour (préfet, mairie, parcs). Toujours loin des gens.';

/** Légende de la couche IGN « Carte des pentes » (GEOGRAPHICALGRIDSYSTEMS.SLOPES.MOUNTAIN). */
export const SLOPE_LEGEND: { color: string; label: string }[] = [
  { color: '#FFE600', label: '30° à 35°' },
  { color: '#FF9900', label: '35° à 40°' },
  { color: '#E3170A', label: '40° à 45°' },
  { color: '#9B30D9', label: 'plus de 45°' },
];

/** Étiquettes de pente le long d'un tracé (mêmes seuils que MapView et MainActivity). */
export const SLOPE_TAGS_HELP = 'Tracés : orange dès 9°, rouge dès 17°.';
