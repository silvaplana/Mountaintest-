/**
 * 🚗 Ma voiture (Seb, 27/11 ; maquette maquettes/voiture-modele/, style A) : chacun sa voiture sur la carte.
 * Pas de photo ni d'IA : 8 silhouettes dessinées une fois (vue de profil, avant à droite) et une table
 * « marque modèle → silhouette » pour proposer la bonne d'après ce qu'on tape. Tout marche hors ligne.
 */

export type Forme = 'citadine' | 'berline' | 'break' | 'suv' | 'van' | 'camping' | 'pickup' | 'cabriolet';
export type Couleur = 'rouge' | 'bleu' | 'blanc' | 'gris' | 'noir' | 'vert' | 'jaune' | 'orange';

/** Carrosserie, vitres, roues (x) et rayon des roues, dans une boîte 120 × 60. */
const SILHOUETTES: Record<Forme, { nom: string; corps: string; vitres: string; roues: [number, number]; r?: number }> = {
  citadine: { nom: 'Citadine', corps: 'M10,48 L10,30 Q11,24 16,20 L26,11 Q28,9 34,9 L66,9 Q73,9 79,16 L90,28 L104,31 Q112,33 112,40 L112,48 Z', vitres: 'M20,27 L29,14 L65,14 L77,27 Z', roues: [29, 92] },
  berline: { nom: 'Berline', corps: 'M4,48 L4,34 Q5,29 14,28 L28,27 L42,13 Q45,10 52,10 L78,10 Q82,10 88,18 L94,27 L110,30 Q116,32 116,40 L116,48 Z', vitres: 'M33,27 L45,15 L77,15 L87,27 Z', roues: [24, 96] },
  break: { nom: 'Break', corps: 'M4,48 L4,20 Q4,10 14,10 L76,10 Q81,10 86,18 L93,28 L109,31 Q116,33 116,40 L116,48 Z', vitres: 'M11,15 L75,15 L85,28 L11,28 Z', roues: [24, 96] },
  suv: { nom: 'SUV', corps: 'M6,46 L6,16 Q6,5 16,5 L76,5 Q82,5 88,13 L96,25 L110,27 Q116,29 116,37 L116,46 Z', vitres: 'M12,10 L76,10 L88,25 L12,25 Z', roues: [27, 93], r: 11 },
  van: { nom: 'Van', corps: 'M4,48 L4,10 Q4,2 12,2 L88,2 Q94,2 98,10 L106,25 Q116,27 116,35 L116,48 Z', vitres: 'M82,7 L91,7 L101,25 L82,25 Z M10,7 L76,7 L76,22 L10,22 Z', roues: [22, 98] },
  camping: { nom: 'Camping-car', corps: 'M4,48 L4,8 Q4,2 10,2 L86,2 Q92,2 92,8 L92,20 L102,21 Q108,22 111,29 L116,36 L116,48 Z', vitres: 'M95,24 L104,25 L108,33 L95,33 Z M14,9 L36,9 L36,20 L14,20 Z', roues: [22, 98] },
  pickup: { nom: 'Pick-up', corps: 'M4,48 L4,27 L48,27 L50,10 Q52,6 58,6 L78,6 Q84,6 90,15 L96,26 L110,29 Q116,31 116,39 L116,48 Z', vitres: 'M54,11 L76,11 L87,26 L54,26 Z', roues: [24, 96], r: 10 },
  cabriolet: { nom: 'Cabriolet', corps: 'M4,48 L4,32 Q6,27 16,27 L94,27 L110,30 Q116,32 116,40 L116,48 Z', vitres: 'M70,27 L60,13 L64,12 L76,27 Z', roues: [25, 96] },
};
export const FORMES = Object.keys(SILHOUETTES) as Forme[];

/**
 * Longueur d'une voiture garée à l'écran, en pixels, selon le zoom (Seb, 27/11 : « les voitures qui gardent la même
 * taille quand on zoome, c'est pas cohérent »). Elle grandit d'un facteur √2 par cran de zoom, entre la taille fixe
 * et l'échelle réelle (qui la ferait disparaître), bornée : 34 px au moins (visible, touchable), 120 px au plus.
 * 80 px au zoom 16. Même règle en 2D (Positions.tsx) et en 3D (voitures3d.ts).
 */
export const longueurVoiturePx = (zoom: number) => Math.min(120, Math.max(34, 80 * 2 ** ((zoom - 16) / 2)));
export const nomForme = (f: Forme) => SILHOUETTES[f].nom;

export const COULEURS: Record<Couleur, string> = {
  rouge: '#d32f2f', bleu: '#1e5fb4', blanc: '#f6f6f4', gris: '#8a939c', noir: '#22272d', vert: '#2e7d4f', jaune: '#f2c230', orange: '#ee7a22',
};
export const NOMS_COULEURS: Record<Couleur, string> = {
  rouge: 'rouge', bleu: 'bleue', blanc: 'blanche', gris: 'grise', noir: 'noire', vert: 'verte', jaune: 'jaune', orange: 'orange',
};

function fonce(hex: string) {
  const n = parseInt(hex.slice(1), 16), k = 0.58;
  return `rgb(${Math.round((n >> 16) * k)},${Math.round(((n >> 8) & 255) * k)},${Math.round((n & 255) * k)})`;
}

/** La voiture en SVG (texte), large de `largeur` px. `contour` : liseré blanc pour la carte (lisible sur l'IGN). */
export function dessinVoiture(forme: Forme, couleur: Couleur, largeur: number, contour = true): string {
  const s = SILHOUETTES[forme] ?? SILHOUETTES.citadine, r = s.r ?? 9, c = COULEURS[couleur] ?? COULEURS.rouge, d = fonce(c);
  const roues = s.roues.map((x) => `<circle cx="${x}" cy="49" r="${r}" fill="#1c1f24"${contour ? ' stroke="#fff" stroke-width="6" paint-order="stroke"' : ''}/>`).join('');
  const moyeux = s.roues.map((x) => `<circle cx="${x}" cy="49" r="${r * 0.45}" fill="#b8bec5"/>`).join('');
  const phare = forme === 'van' || forme === 'camping' ? 106 : 104;
  return `<svg viewBox="-6 -6 132 72" width="${largeur}" height="${Math.round(largeur * 72 / 132)}" aria-hidden="true">`
    + (contour ? `<path d="${s.corps}" fill="#fff" stroke="#fff" stroke-width="8" stroke-linejoin="round"/>` : '')
    + roues
    + `<path d="${s.corps}" fill="${c}" stroke="${d}" stroke-width="2.5" stroke-linejoin="round"/>`
    + `<path d="${s.vitres}" fill="#cfe6f5" stroke="${d}" stroke-width="2" stroke-linejoin="round"/>`
    + `<rect x="${phare}" y="${forme === 'suv' ? 30 : 33}" width="8" height="4" rx="2" fill="#ffe9a8"/>`
    + moyeux + '</svg>';
}

/** Les modèles courants en France et leur silhouette (marque, modèle, silhouette). Inconnu : on choisit à la main. */
const M: [string, string, Forme][] = [];
const ajouter = (marque: string, forme: Forme, modeles: string) => modeles.split(',').forEach((m) => M.push([marque, m.trim(), forme]));
ajouter('Renault', 'citadine', 'Clio, Twingo, Zoe, R5, Mégane, Captur');
ajouter('Renault', 'suv', 'Arkana, Austral, Kadjar, Koleos, Rafale, Scenic, Symbioz, R4');
ajouter('Renault', 'berline', 'Talisman, Laguna');
ajouter('Renault', 'break', 'Mégane Estate, Clio Estate');
ajouter('Renault', 'van', 'Kangoo, Trafic, Master, Espace');
ajouter('Peugeot', 'citadine', '108, 208, 207, 206, 308');
ajouter('Peugeot', 'berline', '408, 508');
ajouter('Peugeot', 'break', '308 SW, 508 SW, 208 SW, 207 SW');
ajouter('Peugeot', 'suv', '2008, 3008, 5008');
ajouter('Peugeot', 'van', 'Rifter, Partner, Expert, Traveller, Boxer');
ajouter('Citroën', 'citadine', 'C1, C3, C4, DS3, Ami');
ajouter('Citroën', 'suv', 'C3 Aircross, C5 Aircross, C4 X');
ajouter('Citroën', 'berline', 'C5, C5 X');
ajouter('Citroën', 'van', 'Berlingo, Jumpy, SpaceTourer, Jumper, Picasso');
ajouter('Dacia', 'citadine', 'Sandero, Spring');
ajouter('Dacia', 'suv', 'Duster, Bigster, Sandero Stepway');
ajouter('Dacia', 'break', 'Logan MCV, Jogger');
ajouter('Dacia', 'van', 'Dokker, Lodgy');
ajouter('Dacia', 'pickup', 'Duster Pick-up');
ajouter('Volkswagen', 'citadine', 'Polo, Golf, Up, ID.3');
ajouter('Volkswagen', 'berline', 'Passat, Arteon, Jetta');
ajouter('Volkswagen', 'break', 'Golf SW, Passat SW');
ajouter('Volkswagen', 'suv', 'T-Roc, T-Cross, Tiguan, Touareg, Taigo, ID.4');
ajouter('Volkswagen', 'van', 'Caddy, Transporter, Multivan, ID. Buzz, Touran');
ajouter('Volkswagen', 'camping', 'California, Grand California');
ajouter('Volkswagen', 'pickup', 'Amarok');
ajouter('Toyota', 'citadine', 'Yaris, Aygo, Auris, Corolla');
ajouter('Toyota', 'berline', 'Prius, Camry');
ajouter('Toyota', 'break', 'Corolla Touring Sports');
ajouter('Toyota', 'suv', 'Yaris Cross, C-HR, RAV4, Land Cruiser, bZ4X');
ajouter('Toyota', 'van', 'Proace, Proace City');
ajouter('Toyota', 'pickup', 'Hilux');
ajouter('Ford', 'citadine', 'Fiesta, Focus, Ka');
ajouter('Ford', 'suv', 'Puma, Kuga, EcoSport, Explorer, Mustang Mach-E');
ajouter('Ford', 'break', 'Focus SW, Mondeo SW');
ajouter('Ford', 'van', 'Transit, Transit Custom, Tourneo, C-Max, S-Max');
ajouter('Ford', 'camping', 'Transit Nugget');
ajouter('Ford', 'pickup', 'Ranger');
ajouter('Ford', 'cabriolet', 'Mustang');
ajouter('Fiat', 'citadine', '500, Panda, Punto, Tipo');
ajouter('Fiat', 'suv', '500X, 600');
ajouter('Fiat', 'van', 'Doblo, Ducato, Scudo, Multipla');
ajouter('Fiat', 'camping', 'Ducato camping-car');
ajouter('Fiat', 'cabriolet', '124 Spider');
ajouter('Opel', 'citadine', 'Corsa, Astra, Adam');
ajouter('Opel', 'suv', 'Mokka, Crossland, Grandland');
ajouter('Opel', 'van', 'Combo, Vivaro, Zafira');
ajouter('Skoda', 'citadine', 'Fabia, Scala');
ajouter('Skoda', 'berline', 'Octavia, Superb');
ajouter('Skoda', 'break', 'Octavia Combi, Superb Combi');
ajouter('Skoda', 'suv', 'Kamiq, Karoq, Kodiaq, Enyaq');
ajouter('Seat', 'citadine', 'Ibiza, Leon, Mii');
ajouter('Seat', 'suv', 'Arona, Ateca, Tarraco');
ajouter('Cupra', 'citadine', 'Born, Leon');
ajouter('Cupra', 'suv', 'Formentor');
ajouter('Tesla', 'berline', 'Model 3, Model S');
ajouter('Tesla', 'suv', 'Model Y, Model X');
ajouter('BMW', 'citadine', 'Série 1, i3');
ajouter('BMW', 'berline', 'Série 3, Série 5');
ajouter('BMW', 'break', 'Série 3 Touring, Série 5 Touring');
ajouter('BMW', 'suv', 'X1, X2, X3, X5, iX');
ajouter('BMW', 'cabriolet', 'Z4, Série 4 Cabriolet');
ajouter('Mercedes', 'citadine', 'Classe A');
ajouter('Mercedes', 'berline', 'Classe C, Classe E');
ajouter('Mercedes', 'suv', 'GLA, GLB, GLC, GLE, Classe G');
ajouter('Mercedes', 'van', 'Vito, Sprinter, Classe V, Citan');
ajouter('Mercedes', 'camping', 'Marco Polo');
ajouter('Audi', 'citadine', 'A1, A3');
ajouter('Audi', 'berline', 'A4, A5, A6');
ajouter('Audi', 'break', 'A4 Avant, A6 Avant');
ajouter('Audi', 'suv', 'Q2, Q3, Q5, Q7, Q4 e-tron');
ajouter('Nissan', 'citadine', 'Micra, Leaf');
ajouter('Nissan', 'suv', 'Juke, Qashqai, X-Trail, Ariya');
ajouter('Nissan', 'pickup', 'Navara');
ajouter('Nissan', 'van', 'Townstar, Primastar');
ajouter('Hyundai', 'citadine', 'i10, i20, i30');
ajouter('Hyundai', 'suv', 'Kona, Tucson, Santa Fe, Ioniq 5, Bayon');
ajouter('Kia', 'citadine', 'Picanto, Rio, Ceed');
ajouter('Kia', 'suv', 'Stonic, Niro, Sportage, Sorento, EV6');
ajouter('Kia', 'break', 'Ceed SW');
ajouter('Suzuki', 'citadine', 'Swift, Ignis');
ajouter('Suzuki', 'suv', 'Jimny, Vitara, S-Cross');
ajouter('Mazda', 'citadine', 'Mazda2, Mazda3');
ajouter('Mazda', 'suv', 'CX-3, CX-30, CX-5, CX-60');
ajouter('Mazda', 'cabriolet', 'MX-5');
ajouter('Mitsubishi', 'suv', 'Outlander, ASX, Eclipse Cross, Pajero');
ajouter('Mitsubishi', 'pickup', 'L200');
ajouter('Volvo', 'suv', 'XC40, XC60, XC90, EX30');
ajouter('Volvo', 'break', 'V60, V90');
ajouter('Volvo', 'berline', 'S60, S90');
ajouter('Subaru', 'suv', 'Forester, Outback, XV, Crosstrek');
ajouter('Land Rover', 'suv', 'Defender, Discovery, Range Rover, Evoque');
ajouter('Jeep', 'suv', 'Renegade, Compass, Wrangler, Avenger');
ajouter('Mini', 'citadine', 'Cooper, Countryman');
ajouter('Mini', 'cabriolet', 'Cabrio');
ajouter('DS', 'citadine', 'DS 3, DS 4');
ajouter('DS', 'suv', 'DS 7');
ajouter('Isuzu', 'pickup', 'D-Max');
ajouter('MG', 'citadine', 'MG4, MG3');
ajouter('MG', 'suv', 'ZS, HS');
ajouter('Alpine', 'cabriolet', 'A110');
ajouter('Porsche', 'cabriolet', '911, Boxster');
ajouter('Porsche', 'suv', 'Cayenne, Macan');

const simple = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s-]+/g, ' ').trim();

/** Ce qu'on tape (« dus », « dacia d ») → les modèles connus qui commencent ainsi, les plus courts d'abord. */
export function chercherModeles(texte: string, max = 5): { nom: string; forme: Forme }[] {
  const t = simple(texte);
  if (t.length < 2) return [];
  return M.map(([marque, modele, forme]) => ({ nom: `${marque} ${modele}`, forme, m: simple(modele), tout: simple(`${marque} ${modele}`) }))
    .filter((x) => x.tout.startsWith(t) || x.m.startsWith(t) || x.tout.split(' ').some((mot) => mot.startsWith(t) && t.length >= 3))
    .sort((a, b) => a.nom.length - b.nom.length)
    .slice(0, max).map(({ nom, forme }) => ({ nom, forme }));
}

/** La silhouette d'un modèle connu (« Dacia Duster » → suv), sinon rien. */
export function formeDuModele(texte: string): Forme | undefined {
  const t = simple(texte);
  return M.find(([marque, modele]) => simple(`${marque} ${modele}`) === t || simple(modele) === t)?.[2];
}
