/**
 * Aide en ligne des icônes de la carte : un appui long sur une icône affiche sa bulle.
 * Mêmes textes côté Kotlin (kotlin-natif/.../IconHelp.kt) : les garder identiques.
 */
export type IconKey =
  | 'close' | 'locate' | 'search' | 'photo' | 'layer' | 'avion' | 'poche' | 'draw'
  | 'slopes' | 'shade' | 'ski' | 'skiText' | 'weatherMountain' | 'travel' | 'lodging' | 'expenses';

export const ICON_HELP: Record<IconKey, { title: string; text: string }> = {
  close: { title: '✕ Quitter', text: 'Ferme l\'appli.' },
  locate: { title: 'Me localiser', text: 'Centre la carte sur toi. Encore : coupe le GPS.' },
  search: { title: '🔍 Chercher un lieu', text: 'Cherche une ville, un sommet…' },
  photo: { title: '📷 Appareil photo', text: 'Ouvre l’appareil photo.' },
  layer: { title: '🗺 Fond de carte', text: 'SCAN 25, Plan IGN ou auto.' },
  avion: { title: '✈ Mode avion', text: 'Ouvre le réglage. Le GPS marche toujours.' },
  poche: { title: '👖 Mode poche', text: 'Vertical 3 s = écran noir.' },
  draw: { title: '✏ Tracer au doigt', text: 'Dessine un parcours : km et dénivelé.' },
  slopes: { title: '⛰ Pentes', text: 'Carte IGN des pentes :' },
  shade: { title: '🌗 Ombres', text: 'Ombres du soleil heure par heure.' },
  ski: { title: '⛷🗺 Sorties ski', text: 'Sorties skitour.fr sur la carte.' },
  skiText: { title: '⛷ Sorties ski', text: 'Sorties skitour.fr ; 🗺 : sur la carte.' },
  weatherMountain: { title: '🏔 Météo montagne', text: 'Météo-France montagne.' },
  travel: { title: '🚗 Voyage en voiture', text: 'Km, coût, péages.' },
  lodging: { title: '🏨 Hébergement', text: 'Meilleurs prix (IA).' },
  expenses: { title: 'Partage des frais', text: 'Qui doit combien à qui.' },
};

/** Légende de la couche IGN « Carte des pentes » (GEOGRAPHICALGRIDSYSTEMS.SLOPES.MOUNTAIN). */
export const SLOPE_LEGEND: { color: string; label: string }[] = [
  { color: '#FFE600', label: '30° à 35°' },
  { color: '#FF9900', label: '35° à 40°' },
  { color: '#E3170A', label: '40° à 45°' },
  { color: '#9B30D9', label: 'plus de 45°' },
];

/** Étiquettes de pente le long d'un tracé (mêmes seuils que MapView et MainActivity). */
export const SLOPE_TAGS_HELP = 'Tracés : orange dès 9°, rouge dès 17°.';
