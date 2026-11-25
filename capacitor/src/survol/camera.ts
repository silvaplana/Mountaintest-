// Survol 3D d'une trace (🎥 du menu de la trace) : trajectoire de la caméra, calculée d'avance puis lissée.
// Le film : vue d'ensemble, plongée vers le départ, suivi de la trace, petit quart de tour à l'arrivée.
// Demande de Seb (25/11) : caméra lente et lissée, cap et inclinaison sans à-coups, jamais de roulis.

export interface LonLat { lon: number; lat: number }
export type Hauteur = 'bas' | 'moyen' | 'haut';

/** Inclinaison (°) et zoom MapLibre de la caméra en suivant la trace. */
export const HAUTEURS: Record<Hauteur, { pitch: number; zoom: number }> = {
  bas: { pitch: 70, zoom: 15.6 },
  moyen: { pitch: 62, zoom: 14.6 },
  haut: { pitch: 50, zoom: 13.4 },
};

/**
 * 🧗 Alpiniste (Seb, 25/11 : « au niveau du sol… il faut quand même coller », « quand on met en bas, c'est en bas ») :
 * la caméra est `recul` m derrière soi, `haut` m au-dessus du terrain, et vise la trace `vise` m devant : elle lève
 * les yeux en montée, plonge le regard en descente. Au sommet, elle s'élève comme un drone (`drone` m) et tourne autour.
 */
export const ALPI: Record<Hauteur, { haut: number; recul: number; vise: number; drone: number }> = {
  bas: { haut: 5, recul: 30, vise: 250, drone: 700 },
  moyen: { haut: 40, recul: 120, vise: 350, drone: 1000 },
  haut: { haut: 150, recul: 400, vise: 600, drone: 1600 },
};
/**
 * Inclinaison la plus forte (°) : 90 = l'horizon, au-delà la caméra lève les yeux. Pas plus de 100 : au-delà, MapLibre
 * ne dessine plus le terrain proche (essai du 25/11 : à 110° face à une pente, l'image n'est que du ciel).
 */
export const PITCH_MAX = 100;

/** Une image de la caméra ; d = distance parcourue sur la trace (m), point = où l'on en est. */
/** sommet : altitude affichée pendant la pause au sommet (🧗). */
export interface Cam { lon: number; lat: number; zoom: number; pitch: number; bearing: number; d: number; point: LonLat; sommet?: number;
  /** 🧗 Altitude (m) du point visé, imposée à MapLibre : la caméra est exactement là où on l'a calculée. */
  elevation?: number;
  /** 🧗 Marge (m) au-dessus du sol garantie par le calcul : le garde-fou du tournage ne demande pas plus. */
  garde?: number }

/** Parts du film : vue d'ensemble → départ, puis suivi, puis tour de l'arrivée. */
export const DEBUT = 0.15, FIN = 0.85;
/** Intro plongée : plus longue (descente à la verticale depuis les nuages, puis redressement). */
export const DEBUT_PLONGEE = 0.3;
/** Durée (s) de la plongée dans les nuages : on y prend son temps (Seb, 25/11), et elle s'ajoute à la durée choisie. */
export const PLONGEE_NUAGES_S = 12;
/** Part du film prise par la plongée dans les nuages, pour un survol de `duree` secondes (le film dure duree + 12 s). */
export const partPlongee = (duree: number) => PLONGEE_NUAGES_S / (duree + PLONGEE_NUAGES_S);
/** Dans l'intro plongée : la carte se montre à la déchirure des nuages (nuages.ts, CIEL.dechirure). */
const DECHIRURE = 0.64, REDRESSE = 0.85;
/** Zoom de départ de la plongée : très haut au-dessus du départ. */
export const ZOOM_CIEL = 9.5;
const TOUR_ARRIVEE = 35;
export const IMAGES = 600;

interface Plan { x: number; y: number }

/** Projection locale en mètres (suffisant à l'échelle d'une rando). */
function projection(o: LonLat) {
  const kx = 111_320 * Math.cos((o.lat * Math.PI) / 180), ky = 110_540;
  return {
    vers: (p: LonLat): Plan => ({ x: (p.lon - o.lon) * kx, y: (p.lat - o.lat) * ky }),
    depuis: (p: Plan): LonLat => ({ lon: o.lon + p.x / kx, lat: o.lat + p.y / ky }),
  };
}

/** Ligne en mètres avec les distances cumulées ; point à une distance donnée. */
export function chemin(line: LonLat[]) {
  const pr = projection(line[0]);
  const pts = line.map(pr.vers);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = cum[cum.length - 1];
  const at = (d: number): Plan => {
    d = Math.max(0, Math.min(total, d));
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const u = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * u, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * u };
  };
  /** Point lissé : moyenne pondérée de la trace sur ± l mètres (une trace en zigzag donne une ligne douce). */
  const lisse = (d: number, l = Math.max(150, total * 0.04)): Plan => {
    let x = 0, y = 0, w = 0;
    for (let k = -8; k <= 8; k++) {
      const p = at(d + (k / 8) * l), g = Math.exp(-((k / 8) ** 2) * 3);
      x += p.x * g; y += p.y * g; w += g;
    }
    return { x: x / w, y: y / w };
  };
  return { pr, total, at, lisse };
}

/** Cap (° depuis le nord, sens horaire) de la direction générale de la trace autour de d : large fenêtre, pas chaque virage. */
export function capAutour(c: ReturnType<typeof chemin>, d: number): number {
  // On regarde loin devant (≥ 400 m) : les lacets et les zigzags ne font pas tourner la caméra.
  const arriere = Math.max(100, c.total * 0.05), avant = Math.max(400, c.total * 0.15);
  const a = c.lisse(d - arriere), b = c.lisse(d + avant);
  return (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const doux = (t: number) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) ** 2);
export const ecartAngle = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;

function flou(v: number[], sigma: number): number[] {
  const n = v.length - 1, r = Math.ceil(3 * sigma), poids: number[] = [];
  for (let k = -r; k <= r; k++) poids.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  return v.map((_, i) => {
    let s = 0, w = 0;
    for (let k = -r; k <= r; k++) { const j = Math.min(n, Math.max(0, i + k)); s += v[j] * poids[k + r]; w += poids[k + r]; }
    // Aux deux bouts, on revient doucement à la valeur exacte : le film part bien de la vue d'ensemble
    // et finit bien sur l'arrivée (ces passages-là sont déjà doux).
    const a = Math.min(1, i / r, (n - i) / r);
    return v[i] * (1 - a) + (s / w) * a;
  });
}

/** 🎬 Styles de prise de vue (maquette validée par Seb le 25/11). */
export type Style = 'suivi' | 'cote' | 'alpi' | 'cine';
export type Descente = 'gopro' | 'large';
/** 🧗 Ce que le film raconte : l'aller ('montee', du début à la fin de la trace), le retour ('descente', de la fin au
 * début) ou l'aller-retour ('deux'). Les noms datent d'avant (réglages gardés sur le téléphone). */
export type Sens = 'deux' | 'montee' | 'descente';
/** Relief lu dans le MNT IGN (relief.ts) : altitude d'un point, et les sommets marquants de la zone. */
export interface Relief { alt: (p: LonLat) => number | null; sommets: (LonLat & { alt: number })[];
  /** Taille d'une maille du relief (m) : plus il est grossier, plus la caméra au sol garde de marge. */
  maille?: number }
/** nuages : l'intro plongée attend derrière les nuages (par défaut) ; false = plongée simple, on descend tout de suite. */
export interface Options { style?: Style; descente?: Descente; sens?: Sens; relief?: Relief | null; nuages?: boolean;
  /** Part du film prise par l'intro, et pour 🧗 les moments (0 → 1 du survol) où finissent montée, sommet et descente : voir dureeFilm. */
  debut?: number; temps?: [number, number, number];
  /** Hauteur de la carte à l'écran (px) : donne la distance de la caméra, pour ne jamais passer sous le relief. */
  hauteurPx?: number }

/** Inclinaison de la caméra GoPro de la descente (au ras de la pente). */
export const PITCH_GOPRO = 76;

interface Brut { x: number; y: number; zoom: number; pitch: number; bearing: number; d: number; s: number; sommet?: number }

/**
 * Note de beauté le long de la trace (🎬 Ciné), avec le relief : pente raide, crête (plus haut que les alentours),
 * et 👀 points de vue = un sommet haut et proche sur le côté de la marche (50° à 130°). Rend aussi les 2 meilleurs
 * points de vue, assez loin l'un de l'autre, où la caméra tournera la tête.
 */
export function beaute(c: ReturnType<typeof chemin>, relief: Relief) {
  const alt = (p: Plan) => relief.alt(c.pr.depuis(p)) ?? 0;
  const pics = relief.sommets.map((x) => ({ ...c.pr.vers(x), alt: x.alt }));
  const crete = (p: Plan) => {
    let m = 0;
    for (let k = 0; k < 8; k++) m += alt({ x: p.x + 600 * Math.cos((k * Math.PI) / 4), y: p.y + 600 * Math.sin((k * Math.PI) / 4) });
    return alt(p) - m / 8;
  };
  const pente = (d: number) => Math.abs(alt(c.at(d + 25)) - alt(c.at(d - 25))) / 50;
  const vues: { d: number; cap: number; note: number }[] = [];
  for (let i = 4; i <= 96; i += 2) {
    const d = (c.total * i) / 100, p = c.at(d), cap = capAutour(c, d), h = alt(p);
    for (const k of pics) {
      const dist = Math.hypot(k.x - p.x, k.y - p.y);
      if (dist < 800 || dist > 8000 || k.alt <= h) continue;
      const b = (Math.atan2(k.x - p.x, k.y - p.y) * 180) / Math.PI, e = Math.abs(ecartAngle(cap, b));
      if (e >= 50 && e <= 130) vues.push({ d, cap: b, note: ((k.alt - h) / dist) * 1000 });
    }
  }
  vues.sort((u, v) => v.note - u.note);
  const choisis: typeof vues = [];
  for (const v of vues) { if (choisis.every((w) => Math.abs(w.d - v.d) > c.total * 0.25)) choisis.push(v); if (choisis.length === 2) break; }
  const largeur = c.total * 0.09;
  const regard = (d: number) => {
    let w = 0, cap: number | null = null;
    for (const v of choisis) { const e = Math.abs(d - v.d) / largeur; if (e < 1) { const k = Math.sin((Math.PI / 2) * (1 - e)) ** 2; if (k > w) { w = k; cap = v.cap; } } }
    return { w, cap };
  };
  /** Sommet vers lequel regarder en avançant (devant, à moins de 75°), ou null. */
  const devant = (d: number) => {
    const p = c.at(d), cap = capAutour(c, d), h = alt(p);
    let best: number | null = null, note = 0;
    for (const k of pics) {
      const dist = Math.hypot(k.x - p.x, k.y - p.y);
      if (dist < 800 || dist > 8000 || k.alt <= h) continue;
      const b = (Math.atan2(k.x - p.x, k.y - p.y) * 180) / Math.PI;
      if (Math.abs(ecartAngle(cap, b)) > 75) continue;
      const n = (k.alt - h) / dist;
      if (n > note) { note = n; best = b; }
    }
    return best;
  };
  // Le temps passé sur chaque morceau suit sa beauté : ralenti sur les beaux passages, accéléré sur le plat.
  const N = 200, cumul = [0];
  for (let i = 1; i <= N; i++) {
    const d = (c.total * i) / N, p = c.at(d);
    const b = Math.min(1, pente(d) / 0.7) + Math.max(0, Math.min(1, crete(p) / 150)) + 2.5 * regard(d).w;
    cumul.push(cumul[i - 1] + 1 + 1.6 * b);
  }
  const distA = (u: number) => {
    const cible = u * cumul[N];
    let i = 1;
    while (i < N && cumul[i] < cible) i++;
    const f = (cible - cumul[i - 1]) / (cumul[i] - cumul[i - 1] || 1);
    return (c.total * (i - 1 + f)) / N;
  };
  return { crete, regard, devant, distA, vues: choisis, alt };
}

/** Trace prise dans le sens du film : « Retour » la parcourt de la fin au début. */
export const dansLeSens = (line: LonLat[], sens?: Sens) => (sens === 'descente' ? [...line].reverse() : line);

/**
 * 🧗 Où le film s'arrête pour tourner comme un drone (Seb, 25/11 : un film a un début et une fin, c'est un aller et un
 * retour, pas une montée et une descente). `c` est la trace dans le sens du film (dansLeSens).
 * Aller-retour : toute la trace, le tour au bout, puis retour par le même chemin (retour = true).
 * Aller (ou Retour, trace retournée) : toute la trace ; le tour se fait au point le plus haut s'il est en chemin,
 * sinon au départ ou à l'arrivée. `mode` dit ce que la caméra enchaîne : avant le tour, après, ou les deux.
 */
export function sommetTrace(c: ReturnType<typeof chemin>, relief: Relief, sens: Sens = 'deux') {
  const alt = (x: number) => relief.alt(c.pr.depuis(c.at(x))) ?? -Infinity;
  if (sens === 'deux') return { d: c.total, alt: alt(c.total), retour: true, depart: false, fin: 0, mode: 'deux' as Sens };
  let d = 0, h = -Infinity;
  for (let i = 0; i <= 200; i++) { const x = (c.total * i) / 200, a = alt(x); if (a > h) { h = a; d = x; } }
  if (d < c.total * 0.2) return { d: 0, alt: alt(0), retour: false, depart: false, fin: c.total, mode: 'descente' as Sens };
  if (d > c.total * 0.8) return { d: c.total, alt: alt(c.total), retour: false, depart: false, fin: c.total, mode: 'montee' as Sens };
  return { d, alt: h, retour: false, depart: false, fin: c.total, mode: 'deux' as Sens };
}

/** Vitesses du film au choix (km/h le long de la trace) : on choisit une allure, pas une durée (Seb, 25/11). */
export const VITESSES = [200, 400, 800];
/** Durées fixes (s) : au sommet (s'élever, tourner, replonger, attendre), regard final, intro simple ou plongée. */
const T_SOMMET = 12, T_FINAL = 5;
export const T_INTRO = 4, T_PLONGEE = 8;
/** Bornes (s) du survol de la trace : une trace très longue va plus vite que demandé plutôt que de durer des heures. */
export const SURVOL_MIN = 12, SURVOL_MAX = 240;

/**
 * Durée (s) du survol de la trace, sans l'intro, à la vitesse `kmh` : la trace défile à cette vitesse (la descente
 * de 🧗 une fois et demie plus vite), le sommet et le regard final ont une durée fixe. Pour 🧗, `temps` donne les
 * moments où finissent la montée, le sommet et la descente.
 */
export function dureeFilm(line: LonLat[], kmh: number, o: Options = {}): { corps: number; temps?: [number, number, number] } {
  const v = kmh / 3.6;
  if (o.style !== 'alpi' || !o.relief) return { corps: Math.round(Math.max(SURVOL_MIN, Math.min(SURVOL_MAX, chemin(line).total / v + T_FINAL))) };
  const c = chemin(dansLeSens(line, o.sens)), s = sommetTrace(c, o.relief, o.sens);
  o = { ...o, sens: s.mode };
  const lm = o.sens === 'descente' ? 0 : s.depart ? c.total - s.d : s.d, ld = o.sens === 'montee' ? 0 : Math.abs(s.fin - s.d);
  const fixe = T_SOMMET + (ld ? T_FINAL : 0);
  let tm = lm / v, td = ld / (1.5 * v);
  // Chaque partie garde au moins 5 s ; au-delà de la durée la plus longue, on accélère d'autant.
  const k = Math.min(1, (SURVOL_MAX - fixe) / (tm + td));
  tm = lm ? Math.max(5, tm * k) : 0; td = ld ? Math.max(5, td * k) : 0;
  const T = tm + td + fixe;
  return { corps: Math.round(T), temps: ld ? [tm / T, (tm + T_SOMMET) / T, (tm + T_SOMMET + td) / T] : [tm / T, 1.01, 2] };
}

/**
 * Trajectoire complète (IMAGES + 1 positions, du début à la fin du film), puis lissée : cap, inclinaison,
 * zoom et position passent dans un flou gaussien large. La caméra ne fait jamais de roulis (MapLibre n'en a pas).
 * Styles : 🎥 suivi (derrière), 🎞 de côté, 🧗 alpiniste/skieur (montée, pause au sommet, descente GoPro ou large),
 * 🎬 ciné (bas aux vallées, haut aux crêtes, regard vers les sommets et les points de vue, grand recul à la fin).
 * Sans relief, alpiniste et ciné font un suivi.
 */
export function trajectoire(line: LonLat[], hauteur: Hauteur, ensemble: { center: LonLat; zoom: number }, n = IMAGES, plongee: boolean | number = false, o: Options = {}): Cam[] {
  const style: Style = (o.style === 'alpi' || o.style === 'cine') && !o.relief ? 'suivi' : o.style ?? 'suivi';
  const c = chemin(style === 'alpi' ? dansLeSens(line, o.sens) : line);
  const h = HAUTEURS[hauteur];
  // plongee : true (part par défaut) ou la part du film prise par l'intro (partPlongee).
  const debut = o.debut != null ? o.debut : typeof plongee === 'number' ? plongee : plongee ? DEBUT_PLONGEE : style === 'cine' ? 0.12 : DEBUT;
  const fin = style === 'alpi' ? 1 : style === 'cine' ? 0.82 : FIN;
  const vue = { ...c.pr.vers(ensemble.center), zoom: ensemble.zoom, pitch: 45, bearing: 0 };
  const b = o.relief ? beaute(c, o.relief) : null;
  const som = o.relief && style === 'alpi' ? sommetTrace(c, o.relief, o.sens) : null;
  if (som) o = { ...o, sens: som.mode };
  const gopro = o.descente !== 'large';
  /** Pente (°, positive en montée) devant soi à la distance d, en avançant dans le sens `sens` (+1 ou −1). */
  const pente = (d: number, sens: number) => {
    const r = o.relief, l = 150;
    const a = r?.alt(c.pr.depuis(c.lisse(d - sens * l))), b = r?.alt(c.pr.depuis(c.lisse(d + sens * l)));
    return a == null || b == null ? 0 : (Math.atan2(b - a, 2 * l) * 180) / Math.PI;
  };

  /** Le corps du film (u de 0 à 1), selon le style. */
  const corps = (u: number): Brut => {
    if (style === 'cote') {
      const d = u * c.total, p = c.lisse(d);
      return { ...p, zoom: h.zoom - 0.2, pitch: Math.min(66, h.pitch + 4), bearing: capAutour(c, d) + 75, d, s: d };
    }
    if (style === 'alpi' && som) {
      // La caméra se penche dans la pente (Seb, 25/11) : elle lève les yeux en montée, plonge le regard en descente.
      // Pente mesurée sur ± 150 m, dans le sens de la marche ; le flou final adoucit encore.
      // Parts du film : montée jusqu'à m1, pause au sommet jusqu'à m2, puis descente.
      // Trace qui part du sommet : « les deux » = remonter depuis le bas puis redescendre ; « montée » = remonter.
      const [m1, m2] = o.sens === 'montee' ? [0.82, 1.01] : o.sens === 'descente' ? [0, 0.18] : [0.5, 0.65];
      if (u < m1) {
        if (som.depart) {
          const d = lerp(c.total, som.d, u / m1), p = c.lisse(d);
          return { ...p, zoom: h.zoom, pitch: dansLaPente(h.pitch, pente(d, -1)), bearing: capAutour(c, d) + 180, d: c.total - d, s: d };
        }
        const d = (u / m1) * som.d, p = c.lisse(d);
        return { ...p, zoom: h.zoom, pitch: dansLaPente(h.pitch, pente(d, 1)), bearing: capAutour(c, d), d, s: d };
      }
      // Distance déjà parcourue au sommet (pour km · alt), caps de la montée et de la descente au sommet.
      const monte = o.sens === 'descente' ? 0 : som.depart ? c.total - som.d : som.d;
      const capM = capAutour(c, som.d) + (som.depart ? 180 : 0), capD = capAutour(c, som.d) + (som.retour ? 180 : 0);
      if (u < m2) {
        // Pause au sommet : tour panoramique qui finit face à la descente (un tour complet si on continue tout droit),
        // la caméra recule un peu et regarde plus loin. Descente seule : demi-tour qui finit face à la descente.
        const v = doux((u - m1) / (m2 - m1)), bosse = Math.sin(v * Math.PI), p = c.at(som.d);
        let tour = ecartAngle(capM, capD);
        if (Math.abs(tour) < 90) tour += 360;
        const cap = o.sens === 'descente' ? capD - 180 * (1 - v) : o.sens === 'montee' ? capM + 180 * v : capM + tour * v;
        return { ...p, zoom: h.zoom - 0.7 * bosse, pitch: h.pitch - 10 * bosse, bearing: cap, d: monte, s: som.d, sommet: som.alt };
      }
      const v = (u - m2) / (1 - m2), s = lerp(som.d, som.fin, v), p = c.lisse(s);
      const cap = som.retour ? capAutour(c, s) + 180 : capAutour(c, s);
      const penteDescente = pente(s, som.retour ? -1 : 1);
      return { ...p, zoom: gopro ? h.zoom + 0.6 : h.zoom - 0.4, pitch: dansLaPente(gopro ? PITCH_GOPRO : Math.min(64, h.pitch + 2), penteDescente),
        bearing: cap, d: monte + Math.abs(s - som.d), s };
    }
    if (style === 'cine' && b) {
      const d = b.distA(u), p = c.lisse(d), k = Math.max(0, Math.min(1, (b.crete(p) + 40) / 160)), cap = capAutour(c, d);
      const sommet = b.devant(d), c1 = sommet == null ? cap : cap + ecartAngle(cap, sommet) * 0.5;
      const r = b.regard(d), c2 = r.cap == null ? c1 : c1 + ecartAngle(c1, r.cap) * 0.85 * r.w;
      return { ...p, zoom: lerp(h.zoom + 0.3, h.zoom - 0.7, k) - 0.6 * r.w, pitch: lerp(Math.min(70, h.pitch + 8), h.pitch - 8, k) - 10 * r.w, bearing: c2, d, s: d };
    }
    const d = u * c.total, p = c.lisse(d);
    return { ...p, zoom: h.zoom, pitch: h.pitch, bearing: capAutour(c, d), d, s: d };
  };

  /** L'intro (t < debut) : plongée depuis le ciel, découverte ciné, ou vue d'ensemble qui descend vers le départ. */
  const intro = (t: number, depart: Brut): Brut => {
    if (plongee) {
      // Façon clip « Au DD » : tant qu'on est dans les nuages (peints par-dessus), la carte attend à la verticale
      // du départ, très haut. À la déchirure, on descend tout droit en tournant lentement sur soi, puis on se redresse.
      // Plongée simple : pas de nuages à attendre, la descente commence tout de suite.
      const u = t / debut, cap = depart.bearing, attente = o.nuages === false ? 0 : DECHIRURE * 0.8;
      const chute = doux(Math.max(0, Math.min(1, (u - attente) / (REDRESSE - attente))));
      const redresse = doux(Math.max(0, (u - REDRESSE) / (1 - REDRESSE)));
      const tour = Math.min(1, Math.max(0, (u - attente) / (1 - attente)));
      return ({ x: depart.x, y: depart.y, zoom: lerp(ZOOM_CIEL, depart.zoom - 0.3, chute * chute) + 0.3 * redresse, pitch: lerp(0, depart.pitch, redresse),
        bearing: cap - 70 * (1 - tour), d: 0, s: 0 });
    }
    if (style === 'cine') {
      // Ciné : on découvre le départ de près, en tournant autour.
      const u = doux(t / debut);
      return ({ ...depart, zoom: depart.zoom + 0.5 * (1 - u), pitch: lerp(Math.min(70, depart.pitch + 6), depart.pitch, u), bearing: depart.bearing - 110 * (1 - u) });
    }
    {
      const u = doux(t / debut);
      return ({ x: lerp(vue.x, depart.x, u), y: lerp(vue.y, depart.y, u), zoom: lerp(vue.zoom, depart.zoom, u), pitch: lerp(vue.pitch, depart.pitch, u),
        bearing: vue.bearing + ecartAngle(vue.bearing, depart.bearing) * u, d: 0, s: 0 });
    }
  };

  /**
   * 🧗 Alpiniste : film calculé en position réelle de caméra (œil, cap, distance du regard), puis traduit pour MapLibre.
   * Montée au ras du sol (selon la Hauteur), le regard vers le haut de la pente ; au sommet la caméra s'élève comme un
   * drone, fait le tour, s'arrête dans l'axe de la descente, replonge au sol, attend (« 1, 2, 3… feu ») et part ;
   * la descente prend de la hauteur et du recul au fil de la pente ; à l'arrivée on se retourne vers le sommet et,
   * si on le voit, on s'en approche (Seb, 25/11). Jamais dans la montagne : l'œil est relevé là où le sol l'exige.
   */
  const filmAlpi = (): Cam[] => {
    interface Pose { ex: number; ey: number; cap: number; L: number; rel: number; abs: number; k: number; tAbs: number; kt: number; d: number; s: number; sommet?: number;
      /** Regard le plus bas (° sous l'horizon, négatif) quand la caméra est au sol. */
      bas: number }
    const s0 = som!, rl = o.relief!, maille = rl.maille ?? 7, A = ALPI[hauteur], H = o.hauteurPx ?? 800;
    const alt = (x: number, y: number) => rl.alt(c.pr.depuis({ x, y }));
    /** Sol le plus haut sous l'œil et à 8 m autour. */
    const solSous = (x: number, y: number) => {
      let m = -Infinity;
      for (const [dx, dy] of [[0, 0], [8, 0], [-8, 0], [0, 8], [0, -8]]) { const a = alt(x + dx, y + dy); if (a != null && a > m) m = a; }
      return m;
    };
    // Trace très lissée (± 300 m) : la caméra monte droit et sans à-coup, les lacets défilent sous elle.
    const LISSE = Math.max(300, c.total * 0.04);
    const rad = Math.PI / 180, borne = (v: number) => Math.max(0, Math.min(1, v));
    const capVers = (ax: number, ay: number, bx: number, by: number) => Math.atan2(bx - ax, by - ay) / rad;
    /** Point lissé de la trace, prolongé tout droit au-delà de ses bouts (le regard ne bute pas sur l'arrivée). */
    const loin = (d: number): Plan => {
      if (d >= 0 && d <= c.total) return c.lisse(d, LISSE);
      const bout = d < 0 ? 0 : c.total, p = c.lisse(bout, LISSE), q = c.lisse(d < 0 ? 200 : c.total - 200, LISSE);
      const l = Math.hypot(p.x - q.x, p.y - q.y) || 1, e = Math.abs(d - bout);
      return { x: p.x + ((p.x - q.x) / l) * e, y: p.y + ((p.y - q.y) / l) * e };
    };
    /** Caméra près du sol à la distance d, en marchant dans le sens `sens` ; mult éloigne (descente). */
    const auSol = (d: number, sens: number, mult = 1): Pose => {
      const e = c.lisse(d - sens * A.recul * mult, LISSE), t = loin(d + sens * A.vise * (1 + (mult - 1) * 0.5));
      const rel = Math.max(A.haut, 0.6 * maille) * mult;
      // Sol lissé sur ± 60 m le long du chemin de la caméra : elle suit la pente, pas chaque bosse.
      let sl = 0, w = 0;
      for (let j = -4; j <= 4; j++) {
        const q = c.lisse(d - sens * A.recul * mult + j * 15, LISSE), a = solSous(q.x, q.y), p = Math.exp(-(j * j) / 8);
        if (Number.isFinite(a)) { sl += a * p; w += p; }
      }
      return { ex: e.x, ey: e.y, cap: capVers(e.x, e.y, t.x, t.y), L: Math.hypot(t.x - e.x, t.y - e.y), rel, abs: (w ? sl / w : s0.alt) + rel,
        k: 0, tAbs: alt(t.x, t.y) ?? s0.alt, kt: 0, d, s: d, bas: -30 };
    };
    const S = c.at(s0.d);
    /** Vue drone : en orbite autour du sommet, au cap donné. */
    const drone = (cap: number): Pose => {
      const L = A.drone * 0.85;
      return { ex: S.x - L * Math.sin(cap * rad), ey: S.y - L * Math.cos(cap * rad), cap, L, rel: 0, abs: s0.alt + A.drone * 0.53, k: 1, tAbs: s0.alt, kt: 1, d: 0, s: s0.d, bas: -30 };
    };
    /** Descente « large » : la vue haute d'avant, derrière soi. */
    const large = (s: number, sens: number): Pose => {
      const p = c.lisse(s), cap = capAutour(c, s) + (sens < 0 ? 180 : 0), g = alt(p.x, p.y) ?? s0.alt;
      const D = distanceCamera(h.zoom - 0.4, c.pr.depuis(p).lat, H), q = dansLaPente(Math.min(64, h.pitch + 2), pente(s, sens)) * rad, L = D * Math.sin(q);
      return { ex: p.x - L * Math.sin(cap * rad), ey: p.y - L * Math.cos(cap * rad), cap, L, rel: 0, abs: g + D * Math.cos(q), k: 1, tAbs: g, kt: 1, d: s, s, bas: -30 };
    };
    const mix = (a: Pose, b: Pose, t: number): Pose => ({ ...a, ex: lerp(a.ex, b.ex, t), ey: lerp(a.ey, b.ey, t), cap: a.cap + ecartAngle(a.cap, b.cap) * t,
      L: lerp(a.L, b.L, t), rel: lerp(a.rel, b.rel, t), abs: lerp(a.abs, b.abs, t), k: lerp(a.k, b.k, t), tAbs: lerp(a.tAbs, b.tAbs, t), kt: lerp(a.kt, b.kt, t), bas: lerp(a.bas, b.bas, t) });
    /** Avance de 0 à 1 avec un départ (a) et une arrivée (b) en douceur : on démarre, on file, on freine. */
    const elan = (v: number, a: number, b: number) => {
      const T = 1 - a / 2 - b / 2;
      return v < a ? (v * v) / (2 * a) / T : v > 1 - b ? 1 - ((1 - v) * (1 - v)) / (2 * b) / T : (v - a / 2) / T;
    };

    // Distance déjà parcourue au sommet (pour km · alt).
    const monte = o.sens === 'descente' ? 0 : s0.depart ? c.total - s0.d : s0.d;
    const montee = (v: number): Pose => {
      const w = elan(v, 0.08, 0.1);
      if (s0.depart) { const d = lerp(c.total, s0.d, w); return { ...auSol(d, -1), d: c.total - d, s: d }; }
      return auSol(w * s0.d, 1);
    };
    const sensD = s0.retour ? -1 : 1;
    const descente = (v: number): Pose => {
      // « Feu » : départ franc ; puis la caméra prend de la hauteur et du recul (on se détend, on voit loin).
      const w = elan(v, 0.1, 0.12), s = lerp(s0.d, s0.fin, w), dd = monte + Math.abs(s - s0.d);
      // Le regard ne plonge pas sous 18° : on garde l'horizon et la vallée dans l'image, comme un skieur.
      const p = { ...auSol(s, sensD, lerp(1.5, 4, doux(borne((v - 0.12) / 0.6)))), bas: -18 };
      return { ...(gopro ? p : mix(p, large(s, sensD), doux(borne(v / 0.15)))), d: dd, s };
    };
    /** Au sommet (v de 0 à 1) : s'élever, tourner, replonger dans l'axe de la descente, attendre. */
    const sommet = (v: number): Pose => {
      const a = o.sens === 'descente' ? null : montee(1), z = o.sens === 'montee' ? null : descente(0);
      let cap: number, k: number, base: Pose;
      if (a && z) {
        // Le plus petit tour d'au moins un demi-tour qui finit face à la descente.
        const e = ecartAngle(a.cap, z.cap), tour = [e, e + 360, e - 360].filter((x) => Math.abs(x) >= 179).sort((x, y) => Math.abs(x) - Math.abs(y))[0];
        cap = a.cap + tour * elan(borne((v - 0.04) / 0.58), 0.3, 0.3);
        k = v < 0.4 ? doux(borne(v / 0.2)) : 1 - doux(borne((v - 0.56) / 0.24));
        base = v < 0.4 ? a : z;
      } else if (a) {
        cap = a.cap + 360 * doux(borne((v - 0.1) / 0.9)); k = doux(borne(v / 0.3)); base = a;
      } else {
        cap = z!.cap - 360 * (1 - doux(borne(v / 0.6))); k = 1 - doux(borne((v - 0.56) / 0.24)); base = z!;
      }
      return { ...mix(base, drone(cap), k), d: monte, s: s0.d, sommet: s0.alt };
    };
    /** À l'arrivée (w de 0 à 1) : on se retourne vers le sommet ; si on le voit, on s'élève un peu et on s'en approche. */
    const z1 = o.sens === 'montee' ? null : descente(1);
    const arrivee = (() => {
      if (!z1) return null;
      const Ls = Math.hypot(S.x - z1.ex, S.y - z1.ey), gE = alt(z1.ex, z1.ey) ?? s0.alt, oeil = gE + z1.rel + Math.max(30, 0.06 * Ls);
      // Visible : rien ne coupe la ligne entre la caméra (une fois élevée) et le sommet ; on ne regarde pas les
      // derniers 10 %, où la ligne rase forcément la pente du sommet.
      let visible = Ls > 300;
      for (let i = 1; i <= 36 && visible; i++) { const f = i / 40, g = alt(lerp(z1.ex, S.x, f), lerp(z1.ey, S.y, f)); if (g != null && g > lerp(oeil, s0.alt + 20, f)) visible = false; }
      return { Ls, gE, visible, cap: capVers(z1.ex, z1.ey, S.x, S.y) };
    })();
    const final = (w: number): Pose => {
      const f = arrivee!, e = z1!, q = elan(borne(w / 0.6), 0.3, 0.3), a = f.visible ? 0.35 * doux(borne((w - 0.3) / 0.7)) : 0;
      const vers: Pose = { ...e, ex: lerp(e.ex, S.x, a), ey: lerp(e.ey, S.y, a), cap: f.cap, L: Math.max(50, f.Ls * (1 - a)),
        abs: lerp(f.gE, s0.alt, a) + e.rel + Math.max(30, 0.06 * f.Ls) * doux(w), k: 1, tAbs: s0.alt, kt: 1 };
      return mix({ ...e, ex: vers.ex, ey: vers.ey }, vers, q);
    };
    const corpsAlpi = (u: number): Pose => {
      const [m1, m2, m3] = o.temps ?? (o.sens === 'montee' ? [0.66, 1.01, 2] : o.sens === 'descente' ? [0, 0.32, 0.85] : [0.38, 0.7, 0.87]);
      return u < m1 ? montee(u / m1) : u < m2 ? sommet((u - m1) / (m2 - m1)) : u < m3 ? descente((u - m2) / (m3 - m2)) : final((u - m3) / (1 - m3));
    };

    const i0 = Math.ceil(debut * n - 1e-9), P: Pose[] = [];
    for (let i = i0; i <= n; i++) P.push(corpsAlpi((i / n - debut) / (1 - debut)));
    const k = n / 600, m = P.length;
    // Sol sous l'œil (et à mi-chemin de l'image voisine) et hauteur de l'œil.
    const g = P.map((p, i) => {
      const q = P[Math.min(m - 1, i + 1)], v = Math.max(solSous(p.ex, p.ey), solSous((p.ex + q.ex) / 2, (p.ey + q.ey) / 2));
      return Number.isFinite(v) ? v : -Infinity;
    });
    const ez = P.map((p) => p.abs);
    // Jamais dans la montagne : là où le sol dépasse (bosse, crête), l'œil est relevé, à l'avance et en douceur.
    const marge = P.map((p) => lerp(Math.max(2, 0.3 * maille), 30, p.k));
    const besoin = P.map((_, i) => Math.max(0, g[i] + marge[i] - ez[i])), r = Math.ceil(12 * k) + 1;
    const leve = flou(besoin.map((_, i) => Math.max(...besoin.slice(Math.max(0, i - r), i + r + 1))), 4 * k);
    const cible = P.map((p) => ({ x: p.ex + p.L * Math.sin(p.cap * rad), y: p.ey + p.L * Math.cos(p.cap * rad) }));
    const gc = flou(cible.map((t, i) => alt(t.x, t.y) ?? P[i].tAbs), 6 * k);
    const corps: Cam[] = P.map((p, i) => {
      const z = ez[i] + leve[i], ll = c.pr.depuis(cible[i]);
      // Au sol, on vise 8° sous la trace devant soi (la pente remplit l'image, le ciel reste en haut), entre `bas` et
      // PITCH_MAX. L'altitude du point visé est libre : c'est elle qu'on règle.
      const vise = Math.atan2(gc[i] - z, p.L) / rad - 8, auSolA = Math.max(p.bas, Math.min(PITCH_MAX - 90, vise));
      const tz = Math.min(lerp(z + p.L * Math.tan(auSolA * rad), p.tAbs, p.kt), z + p.L * Math.tan((PITCH_MAX - 90) * rad));
      return { lon: ll.lon, lat: ll.lat, zoom: zoomPourDistance(Math.hypot(p.L, tz - z), ll.lat, H), pitch: 90 + Math.atan2(tz - z, p.L) / rad, bearing: p.cap,
        d: p.d, point: c.pr.depuis(c.at(p.s)), sommet: p.sommet, elevation: tz, garde: lerp(1.5, 25, p.k) };
    });
    // L'intro arrive sur la première image du corps.
    const c0 = corps[0], depart: Brut = { ...cible[0], zoom: c0.zoom, pitch: c0.pitch, bearing: c0.bearing, d: 0, s: P[0].s };
    const out: Cam[] = [];
    for (let i = 0; i < i0; i++) {
      const t = i / n, b = intro(t, depart), ll = c.pr.depuis(b), u = t / debut;
      out.push({ lon: ll.lon, lat: ll.lat, zoom: b.zoom, pitch: b.pitch, bearing: b.bearing, d: 0, point: c0.point,
        elevation: plongee ? c0.elevation : lerp(rl.alt(ll) ?? c0.elevation!, c0.elevation!, doux(u)), garde: lerp(25, c0.garde!, u * u) });
    }
    out.push(...corps);
    for (let i = 1; i < out.length; i++) out[i].bearing = out[i - 1].bearing + ecartAngle(out[i - 1].bearing, out[i].bearing);
    return out;
  };
  if (style === 'alpi' && som && o.relief) return filmAlpi();
  const brut: Brut[] = [];
  const depart = corps(0);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (t < debut) {
      brut.push(intro(t, depart));
    } else if (t <= fin) {
      brut.push(corps((t - debut) / (fin - debut)));
    } else {
      const u = (t - fin) / (1 - fin), a = corps(1);
      if (style === 'cine') {
        // Grand recul final sur toute la trace, en tournant lentement.
        const v = doux(u);
        brut.push({ x: lerp(a.x, vue.x, v), y: lerp(a.y, vue.y, v), zoom: lerp(a.zoom, vue.zoom, v), pitch: lerp(a.pitch, 48, v), bearing: a.bearing + 100 * v, d: a.d, s: a.s });
      } else {
        brut.push({ ...a, zoom: lerp(a.zoom, a.zoom - 0.4, u), pitch: lerp(a.pitch, Math.min(a.pitch, 55), u), bearing: a.bearing + TOUR_ARRIVEE * u });
      }
    }
  }
  // Cap déroulé (pas de saut 179° → −179°) avant le flou.
  for (let i = 1; i < brut.length; i++) brut[i].bearing = brut[i - 1].bearing + ecartAngle(brut[i - 1].bearing, brut[i].bearing);
  const k = n / 600;
  const cap = flou(brut.map((x) => x.bearing), 70 * k), x = flou(brut.map((v) => v.x), 24 * k), y = flou(brut.map((v) => v.y), 24 * k);
  let zoom = flou(brut.map((v) => v.zoom), 30 * k);
  let pitch = flou(brut.map((v) => v.pitch), 30 * k);
  const centres = brut.map((_, i) => c.pr.depuis({ x: x[i], y: y[i] }));
  if (o.relief) ({ pitch, zoom } = degager(centres, zoom, pitch, cap, o.relief, o.hauteurPx ?? 800, k));
  return brut.map((v, i) => ({ lon: centres[i].lon, lat: centres[i].lat, zoom: zoom[i], pitch: pitch[i], bearing: cap[i], d: v.d,
    point: c.pr.depuis(c.at(v.s)), sommet: v.sommet }));
}

/** Inclinaison qui suit la pente : + ½ de la pente en montée (regard vers le haut), − ¾ en descente (regard vers le bas). */
export function dansLaPente(pitch: number, pente: number): number {
  return Math.max(30, Math.min(PITCH_GOPRO, pitch + (pente > 0 ? 0.5 : 0.75) * pente));
}

/** Distance caméra → centre de l'image (m) dans MapLibre : 1,5 × la hauteur de la carte (champ de 36,87°). */
export function distanceCamera(zoom: number, lat: number, hauteurPx: number): number {
  return 1.5 * hauteurPx * (40_075_016.7 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

/** Zoom MapLibre qui met la caméra à D mètres du centre de l'image (inverse de distanceCamera). */
export function zoomPourDistance(D: number, lat: number, hauteurPx: number): number {
  return Math.log2((1.5 * hauteurPx * 40_075_016.7 * Math.cos((lat * Math.PI) / 180)) / (512 * D));
}

/** Point au sol à `m` mètres derrière le centre (à l'opposé du cap). */
function derriere(p: LonLat, cap: number, m: number): LonLat {
  const a = (cap * Math.PI) / 180;
  return { lon: p.lon - (m * Math.sin(a)) / (111_320 * Math.cos((p.lat * Math.PI) / 180)), lat: p.lat - (m * Math.cos(a)) / 110_540 };
}

/** La caméra (et le début de son regard) passe-t-elle au-dessus du relief, avec une marge ? */
export function camLibre(centre: LonLat, zoom: number, pitch: number, cap: number, relief: Relief, hauteurPx: number): boolean {
  const D = distanceCamera(zoom, centre.lat, hauteurPx), base = relief.alt(centre);
  if (base == null) return true;
  // Marge large : le relief lu ici (mailles de 30 à 55 m) arrondit les crêtes que MapLibre dessine plus fines.
  const p = (pitch * Math.PI) / 180, marge = 60 + 0.05 * D, a = (cap * Math.PI) / 180;
  for (const f of [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.5, 0.4]) {
    const recul = f * D * Math.sin(p), haut = base + f * D * Math.cos(p), m = marge * Math.max(f, 0.5);
    const ici = derriere(centre, cap, recul);
    const points = f === 1 ? [ici, derriere(centre, cap, recul + 80), decaler(ici, a, 80), decaler(ici, a, -80)] : [ici];
    for (const q of points) {
      const sol = relief.alt(q);
      if (sol != null && haut < sol + m) return false;
    }
  }
  return true;
}

/** Point décalé de m mètres sur le côté (droite si m > 0) par rapport au cap. */
function decaler(p: LonLat, a: number, m: number): LonLat {
  return { lon: p.lon + (m * Math.cos(a)) / (111_320 * Math.cos((p.lat * Math.PI) / 180)), lat: p.lat - (m * Math.sin(a)) / 110_540 };
}

/**
 * Jamais dans la montagne (Seb, 25/11 : « on voit l'envers de la montagne ») : là où la caméra passerait sous le relief,
 * on la redresse (moins inclinée = plus haute et moins loin derrière). La limite est anticipée et lissée : pas d'à-coup.
 */
function degager(centres: LonLat[], zoom: number[], pitch: number[], cap: number[], relief: Relief, hauteurPx: number, k: number) {
  // Pour chaque image : inclinaison la plus forte qui passe ; si même redressée à 20° ça ne passe pas, on recule (zoom).
  const lim = pitch.map((p, i) => {
    let q = p, z = zoom[i];
    while (q > 20 && !camLibre(centres[i], z, q, cap[i], relief, hauteurPx)) q -= 2;
    while (z > zoom[i] - 3 && !camLibre(centres[i], z, q, cap[i], relief, hauteurPx)) z -= 0.1;
    return { q, recul: zoom[i] - z };
  });
  // Pire cas à ± 1,5 s, puis flou : la caméra se redresse (ou recule) à l'avance et doucement, sans jamais dépasser la limite.
  const r = Math.round(40 * k);
  const fenetre = (v: number[], pire: (...x: number[]) => number) => v.map((_, i) => pire(...v.slice(Math.max(0, i - r), i + r + 1)));
  const qMin = fenetre(lim.map((l) => l.q), Math.min), reculMax = fenetre(lim.map((l) => l.recul), Math.max);
  const q = flou(qMin, 20 * k), recul = flou(reculMax, 20 * k);
  return {
    pitch: pitch.map((p, i) => Math.min(p, q[i], qMin[i] + 2)),
    zoom: zoom.map((z, i) => z - Math.max(recul[i], reculMax[i] - 0.1)),
  };
}

/** Caméra au temps t (0 → 1) du film, entre deux positions calculées. */
export function cameraA(track: Cam[], t: number): Cam {
  const n = track.length - 1, f = Math.max(0, Math.min(1, t)) * n, i = Math.min(n - 1, Math.floor(f)), u = f - i;
  const a = track[i], b = track[i + 1];
  return { lon: lerp(a.lon, b.lon, u), lat: lerp(a.lat, b.lat, u), zoom: lerp(a.zoom, b.zoom, u), pitch: lerp(a.pitch, b.pitch, u),
    bearing: lerp(a.bearing, b.bearing, u), d: lerp(a.d, b.d, u),
    elevation: a.elevation != null && b.elevation != null ? lerp(a.elevation, b.elevation, u) : undefined,
    garde: a.garde != null && b.garde != null ? lerp(a.garde, b.garde, u) : undefined,
    point: { lon: lerp(a.point.lon, b.point.lon, u), lat: lerp(a.point.lat, b.point.lat, u) }, sommet: u < 0.5 ? a.sommet : b.sommet };
}

/** Heures des ombres du film : de h0 à h1 toutes les 30 min (h en heures décimales). */
export function heuresOmbres(h0: number, h1: number): number[] {
  const out: number[] = [];
  for (let h = h0; h <= h1 + 1e-9; h += 0.5) out.push(h);
  return out;
}

export const heureTexte = (h: number) => `${Math.floor(h)} h${h % 1 ? ' 30' : ''}`;

/** Début de la trace jusqu'à d mètres (trace qui se dessine pendant le film), le dernier point coupé au bon endroit. */
export function debutTrace(line: LonLat[], d: number): LonLat[] {
  const c = chemin(line);
  if (d <= 0 || line.length < 2) return [];
  const out = [line[0]];
  let cum = 0;
  for (let i = 1; i < line.length; i++) {
    const a = c.pr.vers(line[i - 1]), b = c.pr.vers(line[i]), l = Math.hypot(b.x - a.x, b.y - a.y);
    if (cum + l >= d) { out.push(c.pr.depuis(c.at(d))); return out; }
    cum += l;
    out.push(line[i]);
  }
  return out;
}
