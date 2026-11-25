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
export interface Cam { lon: number; lat: number; zoom: number; pitch: number; bearing: number; d: number; point: LonLat }

/** Parts du film : vue d'ensemble → départ, puis suivi, puis tour de l'arrivée. */
export const DEBUT = 0.15, FIN = 0.85;
/** Intro plongée : plus longue (descente à la verticale depuis les nuages, puis redressement). */
export const DEBUT_PLONGEE = 0.3;
/** Les nuages sont traversés pendant ce début du film (intro plongée). */
export const NUAGES = 0.12;
/** Zoom de départ de la plongée : très haut au-dessus du départ. */
const ZOOM_CIEL = 9.5;
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
  return { pr, total, at };
}

/** Cap (° depuis le nord, sens horaire) de la direction générale de la trace autour de d : large fenêtre, pas chaque virage. */
export function capAutour(c: ReturnType<typeof chemin>, d: number): number {
  const arriere = Math.max(40, c.total * 0.05), avant = Math.max(80, c.total * 0.1);
  const a = c.at(d - arriere), b = c.at(d + avant);
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

/**
 * Trajectoire complète (IMAGES + 1 positions, du début à la fin du film), puis lissée : cap, inclinaison,
 * zoom et position passent dans un flou gaussien large. La caméra ne fait jamais de roulis (MapLibre n'en a pas).
 */
export function trajectoire(line: LonLat[], hauteur: Hauteur, ensemble: { center: LonLat; zoom: number }, n = IMAGES, plongee = false): Cam[] {
  const debut = plongee ? DEBUT_PLONGEE : DEBUT;
  const c = chemin(line);
  const h = HAUTEURS[hauteur];
  const vue = { ...c.pr.vers(ensemble.center), zoom: ensemble.zoom, pitch: 45, bearing: 0 };
  const brut: { x: number; y: number; zoom: number; pitch: number; bearing: number; d: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (plongee && t < debut) {
      // Au-dessus du départ, regard vers le bas : on plonge (de plus en plus vite), puis on se redresse en tournant.
      const u = t / debut, p = c.at(0), cap = capAutour(c, 0), chute = Math.min(1, u / 0.6), redresse = doux(Math.max(0, (u - 0.6) / 0.4));
      brut.push({ x: p.x, y: p.y, zoom: lerp(ZOOM_CIEL, h.zoom - 0.3, chute * chute) + 0.3 * redresse, pitch: lerp(0, h.pitch, redresse),
        bearing: ecartAngle(0, cap) * redresse, d: 0 });
    } else if (t < debut) {
      const u = doux(t / debut), p = c.at(0), cap = capAutour(c, 0);
      brut.push({ x: lerp(vue.x, p.x, u), y: lerp(vue.y, p.y, u), zoom: lerp(vue.zoom, h.zoom, u), pitch: lerp(vue.pitch, h.pitch, u),
        bearing: vue.bearing + ecartAngle(vue.bearing, cap) * u, d: 0 });
    } else if (t <= FIN) {
      const d = ((t - debut) / (FIN - debut)) * c.total, p = c.at(d);
      brut.push({ x: p.x, y: p.y, zoom: h.zoom, pitch: h.pitch, bearing: capAutour(c, d), d });
    } else {
      const u = (t - FIN) / (1 - FIN), p = c.at(c.total);
      brut.push({ x: p.x, y: p.y, zoom: lerp(h.zoom, h.zoom - 0.4, u), pitch: lerp(h.pitch, 55, u),
        bearing: capAutour(c, c.total) + TOUR_ARRIVEE * u, d: c.total });
    }
  }
  // Cap déroulé (pas de saut 179° → −179°) avant le flou.
  for (let i = 1; i < brut.length; i++) brut[i].bearing = brut[i - 1].bearing + ecartAngle(brut[i - 1].bearing, brut[i].bearing);
  const k = n / 600;
  const cap = flou(brut.map((b) => b.bearing), 45 * k), x = flou(brut.map((b) => b.x), 12 * k), y = flou(brut.map((b) => b.y), 12 * k);
  const zoom = flou(brut.map((b) => b.zoom), 30 * k), pitch = flou(brut.map((b) => b.pitch), 30 * k);
  return brut.map((b, i) => {
    const centre = c.pr.depuis({ x: x[i], y: y[i] });
    return { lon: centre.lon, lat: centre.lat, zoom: zoom[i], pitch: pitch[i], bearing: cap[i], d: b.d, point: c.pr.depuis(c.at(b.d)) };
  });
}

/** Caméra au temps t (0 → 1) du film, entre deux positions calculées. */
export function cameraA(track: Cam[], t: number): Cam {
  const n = track.length - 1, f = Math.max(0, Math.min(1, t)) * n, i = Math.min(n - 1, Math.floor(f)), u = f - i;
  const a = track[i], b = track[i + 1];
  return { lon: lerp(a.lon, b.lon, u), lat: lerp(a.lat, b.lat, u), zoom: lerp(a.zoom, b.zoom, u), pitch: lerp(a.pitch, b.pitch, u),
    bearing: lerp(a.bearing, b.bearing, u), d: lerp(a.d, b.d, u), point: u < 0.5 ? a.point : b.point };
}

/** Heures des ombres du film : de h0 à h1 toutes les 30 min (h en heures décimales). */
export function heuresOmbres(h0: number, h1: number): number[] {
  const out: number[] = [];
  for (let h = h0; h <= h1 + 1e-9; h += 0.5) out.push(h);
  return out;
}

export const heureTexte = (h: number) => `${Math.floor(h)} h${h % 1 ? ' 30' : ''}`;
