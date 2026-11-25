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

/** Une image de la caméra ; d = distance parcourue sur la trace (m), point = où l'on en est. */
/** sommet : altitude affichée pendant la pause au sommet (🧗). */
export interface Cam { lon: number; lat: number; zoom: number; pitch: number; bearing: number; d: number; point: LonLat; sommet?: number }

/** Parts du film : vue d'ensemble → départ, puis suivi, puis tour de l'arrivée. */
export const DEBUT = 0.15, FIN = 0.85;
/** Intro plongée : plus longue (descente à la verticale depuis les nuages, puis redressement). */
export const DEBUT_PLONGEE = 0.3;
/** Part du film prise par l'intro plongée : environ 7 s (comme le clip), entre 30 % et 55 % du film. */
export const partPlongee = (duree: number) => Math.max(DEBUT_PLONGEE, Math.min(0.55, 7 / duree));
/** Dans l'intro plongée : la carte se montre à la déchirure des nuages (nuages.ts, CIEL.dechirure). */
const DECHIRURE = 0.62, REDRESSE = 0.85;
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
/** Relief lu dans le MNT IGN (relief.ts) : altitude d'un point, et les sommets marquants de la zone. */
export interface Relief { alt: (p: LonLat) => number | null; sommets: (LonLat & { alt: number })[] }
/** nuages : l'intro plongée attend derrière les nuages (par défaut) ; false = plongée simple, on descend tout de suite. */
export interface Options { style?: Style; descente?: Descente; relief?: Relief | null; nuages?: boolean;
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

/** Point le plus haut de la trace (🧗) ; retour = la trace finit au sommet, on redescend par le même chemin. */
export function sommetTrace(c: ReturnType<typeof chemin>, relief: Relief) {
  let d = 0, h = -Infinity;
  for (let i = 0; i <= 200; i++) { const x = (c.total * i) / 200, a = relief.alt(c.pr.depuis(c.at(x))) ?? -Infinity; if (a > h) { h = a; d = x; } }
  const retour = c.total - d < c.total * 0.2;
  return { d, alt: h, retour, fin: retour ? 0 : c.total };
}

/**
 * Trajectoire complète (IMAGES + 1 positions, du début à la fin du film), puis lissée : cap, inclinaison,
 * zoom et position passent dans un flou gaussien large. La caméra ne fait jamais de roulis (MapLibre n'en a pas).
 * Styles : 🎥 suivi (derrière), 🎞 de côté, 🧗 alpiniste/skieur (montée, pause au sommet, descente GoPro ou large),
 * 🎬 ciné (bas aux vallées, haut aux crêtes, regard vers les sommets et les points de vue, grand recul à la fin).
 * Sans relief, alpiniste et ciné font un suivi.
 */
export function trajectoire(line: LonLat[], hauteur: Hauteur, ensemble: { center: LonLat; zoom: number }, n = IMAGES, plongee: boolean | number = false, o: Options = {}): Cam[] {
  const c = chemin(line);
  const h = HAUTEURS[hauteur];
  const style: Style = (o.style === 'alpi' || o.style === 'cine') && !o.relief ? 'suivi' : o.style ?? 'suivi';
  // plongee : true (part par défaut) ou la part du film prise par l'intro (partPlongee).
  const debut = typeof plongee === 'number' ? plongee : plongee ? DEBUT_PLONGEE : style === 'cine' ? 0.12 : DEBUT;
  const fin = style === 'alpi' ? 1 : style === 'cine' ? 0.82 : FIN;
  const vue = { ...c.pr.vers(ensemble.center), zoom: ensemble.zoom, pitch: 45, bearing: 0 };
  const b = o.relief ? beaute(c, o.relief) : null;
  const som = o.relief && style === 'alpi' ? sommetTrace(c, o.relief) : null;
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
      if (u < 0.5) {
        const d = (u / 0.5) * som.d, p = c.lisse(d);
        return { ...p, zoom: h.zoom, pitch: dansLaPente(h.pitch, pente(d, 1)), bearing: capAutour(c, d), d, s: d };
      }
      if (u < 0.65) {
        // Pause au sommet : demi-tour panoramique, la caméra recule un peu et regarde plus loin.
        const v = doux((u - 0.5) / 0.15), bosse = Math.sin(v * Math.PI), p = c.at(som.d);
        return { ...p, zoom: h.zoom - 0.7 * bosse, pitch: h.pitch - 10 * bosse, bearing: capAutour(c, som.d) + 180 * v, d: som.d, s: som.d, sommet: som.alt };
      }
      const v = (u - 0.65) / 0.35, s = lerp(som.d, som.fin, v), p = c.lisse(s);
      const cap = som.retour ? capAutour(c, s) + 180 : capAutour(c, s);
      const penteDescente = pente(s, som.retour ? -1 : 1);
      return { ...p, zoom: gopro ? h.zoom + 0.6 : h.zoom - 0.4, pitch: dansLaPente(gopro ? PITCH_GOPRO : Math.min(64, h.pitch + 2), penteDescente),
        bearing: cap, d: som.d + Math.abs(s - som.d), s };
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

  const brut: Brut[] = [];
  const depart = corps(0);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (plongee && t < debut) {
      // Façon clip « Au DD » : tant qu'on est dans les nuages (peints par-dessus), la carte attend à la verticale
      // du départ, très haut. À la déchirure, on descend tout droit en tournant lentement sur soi, puis on se redresse.
      // Plongée simple : pas de nuages à attendre, la descente commence tout de suite.
      const u = t / debut, cap = depart.bearing, attente = o.nuages === false ? 0 : DECHIRURE * 0.8;
      const chute = doux(Math.max(0, Math.min(1, (u - attente) / (REDRESSE - attente))));
      const redresse = doux(Math.max(0, (u - REDRESSE) / (1 - REDRESSE)));
      const tour = Math.min(1, Math.max(0, (u - attente) / (1 - attente)));
      brut.push({ x: depart.x, y: depart.y, zoom: lerp(ZOOM_CIEL, depart.zoom - 0.3, chute * chute) + 0.3 * redresse, pitch: lerp(0, depart.pitch, redresse),
        bearing: cap - 70 * (1 - tour), d: 0, s: 0 });
    } else if (t < debut && style === 'cine') {
      // Ciné : on découvre le départ de près, en tournant autour.
      const u = doux(t / debut);
      brut.push({ ...depart, zoom: depart.zoom + 0.5 * (1 - u), pitch: lerp(Math.min(70, depart.pitch + 6), depart.pitch, u), bearing: depart.bearing - 110 * (1 - u) });
    } else if (t < debut) {
      const u = doux(t / debut);
      brut.push({ x: lerp(vue.x, depart.x, u), y: lerp(vue.y, depart.y, u), zoom: lerp(vue.zoom, depart.zoom, u), pitch: lerp(vue.pitch, depart.pitch, u),
        bearing: vue.bearing + ecartAngle(vue.bearing, depart.bearing) * u, d: 0, s: 0 });
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
  const zoom = flou(brut.map((v) => v.zoom), 30 * k);
  let pitch = flou(brut.map((v) => v.pitch), 30 * k);
  const centres = brut.map((_, i) => c.pr.depuis({ x: x[i], y: y[i] }));
  if (o.relief) pitch = degager(centres, zoom, pitch, cap, o.relief, o.hauteurPx ?? 800, k);
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

/** Point au sol à `m` mètres derrière le centre (à l'opposé du cap). */
function derriere(p: LonLat, cap: number, m: number): LonLat {
  const a = (cap * Math.PI) / 180;
  return { lon: p.lon - (m * Math.sin(a)) / (111_320 * Math.cos((p.lat * Math.PI) / 180)), lat: p.lat - (m * Math.cos(a)) / 110_540 };
}

/** La caméra (et le début de son regard) passe-t-elle au-dessus du relief, avec une marge ? */
export function camLibre(centre: LonLat, zoom: number, pitch: number, cap: number, relief: Relief, hauteurPx: number): boolean {
  const D = distanceCamera(zoom, centre.lat, hauteurPx), base = relief.alt(centre);
  if (base == null) return true;
  const p = (pitch * Math.PI) / 180, marge = 40 + 0.04 * D;
  for (const f of [1, 0.85, 0.7, 0.55]) {
    const sol = relief.alt(derriere(centre, cap, f * D * Math.sin(p)));
    if (sol != null && base + f * D * Math.cos(p) < sol + marge * f) return false;
  }
  return true;
}

/**
 * Jamais dans la montagne (Seb, 25/11 : « on voit l'envers de la montagne ») : là où la caméra passerait sous le relief,
 * on la redresse (moins inclinée = plus haute et moins loin derrière). La limite est anticipée et lissée : pas d'à-coup.
 */
function degager(centres: LonLat[], zoom: number[], pitch: number[], cap: number[], relief: Relief, hauteurPx: number, k: number): number[] {
  const max = pitch.map((p, i) => {
    let q = p;
    while (q > 20 && !camLibre(centres[i], zoom[i], q, cap[i], relief, hauteurPx)) q -= 2;
    return q;
  });
  // Plus petite limite à ± 1,5 s, puis flou : la caméra se redresse à l'avance et doucement.
  const r = Math.round(40 * k), proche = max.map((_, i) => Math.min(...max.slice(Math.max(0, i - r), i + r + 1)));
  const lisse = flou(proche, 20 * k);
  return pitch.map((p, i) => Math.min(p, lisse[i], proche[i] + 2));
}

/** Caméra au temps t (0 → 1) du film, entre deux positions calculées. */
export function cameraA(track: Cam[], t: number): Cam {
  const n = track.length - 1, f = Math.max(0, Math.min(1, t)) * n, i = Math.min(n - 1, Math.floor(f)), u = f - i;
  const a = track[i], b = track[i + 1];
  return { lon: lerp(a.lon, b.lon, u), lat: lerp(a.lat, b.lat, u), zoom: lerp(a.zoom, b.zoom, u), pitch: lerp(a.pitch, b.pitch, u),
    bearing: lerp(a.bearing, b.bearing, u), d: lerp(a.d, b.d, u),
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
