/**
 * Aide en ligne des icônes de la carte : un appui long sur une icône affiche sa bulle.
 * Mêmes textes côté Kotlin (kotlin-natif/.../IconHelp.kt) : les garder identiques.
 */
export type IconKey =
  | 'close' | 'locate' | 'search' | 'photo' | 'layer' | 'avion' | 'poche' | 'draw'
  | 'slopes' | 'shade' | 'ski' | 'skiText' | 'weatherMountain' | 'travel' | 'lodging' | 'expenses';

export const ICON_HELP: Record<IconKey, { title: string; text: string }> = {
  close: { title: '✕ Quitter', text: "Ferme l'appli." },
  locate: { title: '◎ Me localiser', text: 'Centre la carte sur ta position GPS et la suit. Appuie de nouveau pour couper le GPS et économiser la batterie.' },
  search: { title: '🔍 Chercher un lieu', text: "Tape le nom d'une ville, d'un sommet ou d'un lieu-dit : la carte s'y centre." },
  photo: { title: '📷 Appareil photo', text: "Ouvre l'appareil photo du téléphone ; le bouton Retour ramène à la carte." },
  layer: { title: '🗺 Fond de carte', text: 'Chaque appui passe au fond suivant : Carte auto, SCAN 25 (IGN au 1:25 000), Plan IGN.' },
  avion: { title: '✈ Mode avion', text: "Android ne laisse pas une appli basculer le mode avion : l'icône est verte quand il est actif et ouvre le réglage. Le GPS marche toujours en mode avion et la batterie dure bien plus longtemps. Le 1er appui montre aussi 👖." },
  poche: { title: '👖 Mode poche', text: "Téléphone vertical 3 s = écran noir, pour ne rien toucher dans la poche (le GPS de ◎ se coupe, l'enregistrement d'une sortie continue). À plat ou deux secousses pour rallumer." },
  draw: { title: '✏ Tracer au doigt', text: 'Dessine un parcours sur la carte : sa longueur, son dénivelé et son profil s’affichent.' },
  slopes: { title: '⛰ Pentes', text: "Carte IGN des pentes en montagne. Sous 30°, pas de couleur. Le 1er appui montre aussi 🌗." },
  shade: { title: '🌗 Ombres du relief', text: 'Film des ombres du soleil sur 24 h, toutes les 30 min, calculé dans le téléphone à partir du relief IGN. Choisis la date et fais glisser l’heure.' },
  ski: { title: '⛷🗺 Sorties ski de rando', text: "Sorties de skitour.fr dans la zone affichée ; toucher une sortie ouvre sa fiche. Le 1er appui montre aussi ⛷💬." },
  skiText: { title: '⛷💬 Question sur les sorties ski', text: 'Pose une question en texte sur les sorties de skitour.fr (par exemple les conditions récentes dans un massif).' },
  weatherMountain: { title: '🏔 Météo montagne', text: 'Ouvre la météo montagne de Météo-France (bulletins, risque d’avalanche).' },
  travel: { title: '🚗 Voyage en voiture', text: 'Itinéraires avec km, durée, coût du carburant et péages.' },
  lodging: { title: '🏨 Hébergement', text: 'Cherche les meilleurs prix près de ta destination (IA).' },
  expenses: { title: 'Partage des frais', text: 'Façon Tricount : qui a payé quoi, et qui doit combien à qui. Les participants sont invités par mail.' },
};

/** Légende de la couche IGN « Carte des pentes » (GEOGRAPHICALGRIDSYSTEMS.SLOPES.MOUNTAIN). */
export const SLOPE_LEGEND: { color: string; label: string }[] = [
  { color: '#FFE600', label: '30° à 35°' },
  { color: '#FF9900', label: '35° à 40°' },
  { color: '#E3170A', label: '40° à 45°' },
  { color: '#9B30D9', label: 'plus de 45°' },
];

/** Étiquettes de pente le long d'un tracé (mêmes seuils que MapView et MainActivity). */
export const SLOPE_TAGS_HELP = 'Sur un tracé, les étiquettes donnent la pente du chemin : orange dès 9° (16 %), rouge dès 17° (30 %).';
