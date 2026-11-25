// Intro « plongée » du survol, façon clip « Au DD » (vidéo de Seb, 25/11) : au-dessus d'une mer de nuages
// dorée au coucher du soleil, la caméra regarde l'horizon en penchant un peu ; elle bascule vers le bas, entre
// dans les nuages, traverse un long gris, puis les nuages se déchirent et le relief apparaît à la verticale.
// MapLibre ne sait pas faire de nuages : ils sont peints par-dessus la carte, qui reste cachée jusqu'à la déchirure.

/** Étapes de l'intro (u de 0 à 1) : au-dessus, bascule, dans le gris, déchirure, puis plus rien. */
export const CIEL = { bascule: 0.22, dedans: 0.32, dechirure: 0.64, fin: 0.76 };

import { rendreCiel } from './ciel-gl';

let texture: HTMLCanvasElement | null = null;

/** Nappe de taches floues (grises), toujours la même : le brouillard qui défile et se déchire. */
function nappe(): HTMLCanvasElement {
  if (texture) return texture;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  let g = 7;
  const alea = () => ((g = (g * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    const x = alea() * 512, y = alea() * 512, r = 40 + alea() * 110, l = 80 + Math.round(alea() * 60);
    const d = ctx.createRadialGradient(x, y, 0, x, y, r);
    d.addColorStop(0, `rgba(${l},${l + 4},${l + 10},0.9)`);
    d.addColorStop(0.6, `rgba(${l},${l + 4},${l + 10},0.45)`);
    d.addColorStop(1, `rgba(${l},${l + 4},${l + 10},0)`);
    ctx.fillStyle = d;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  return (texture = c);
}

const doux = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** Nombre pseudo-aléatoire fixe pour (i, j) : les nuages gardent leur forme d'une image à l'autre. */
const bruit = (i: number, j: number) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };

/** Mer de nuages vue de côté, horizon à yH (penché de `angle` rad), qui avance vers nous ; `pres` grossit tout. */
function merDeNuages(ctx: CanvasRenderingContext2D, w: number, h: number, u: number, yH: number, angle: number, pres: number) {
  const L = Math.hypot(w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(angle);
  ctx.translate(-w / 2, -h / 2);
  // Ciel : bleu gris en haut, doré à l'horizon, soleil bas à droite.
  const ciel = ctx.createLinearGradient(0, yH - h * 0.6, 0, yH);
  ciel.addColorStop(0, '#6f86a0'); ciel.addColorStop(0.55, '#c9bfa8'); ciel.addColorStop(0.85, '#efd8ac'); ciel.addColorStop(1, '#fff0cc');
  ctx.fillStyle = ciel;
  ctx.fillRect(-L, yH - 2 * L, 3 * L, 2 * L + 2);
  const sx = w * 0.72, soleil = ctx.createRadialGradient(sx, yH - h * 0.02, 0, sx, yH - h * 0.02, w * 0.7);
  soleil.addColorStop(0, 'rgba(255,248,225,1)'); soleil.addColorStop(0.15, 'rgba(255,232,180,0.6)'); soleil.addColorStop(1, 'rgba(255,226,170,0)');
  ctx.fillStyle = soleil;
  ctx.fillRect(-L, yH - L, 3 * L, 2 * L);
  // Dessous des nuages : clair à l'horizon, gris bleu près de nous.
  const fond = ctx.createLinearGradient(0, yH, 0, h * 1.2);
  fond.addColorStop(0, '#cfc3ae'); fond.addColorStop(0.35, '#8a9098'); fond.addColorStop(1, '#4f555d');
  ctx.fillStyle = fond;
  ctx.fillRect(-L, yH, 3 * L, 2 * L);
  // Gros cumulus étirés en largeur, du lointain vers nous ; ils avancent (u) et grossissent en approchant.
  // Le haut de chaque nuage est éclairé (doré), le dessous reste gris bleu.
  const N = 9, avance = (u * 5) % 1;
  for (let j = 0; j < N; j++) {
    const s = (j + avance) / N, y = yH + (h * 1.15 - yH) * s * s * pres, r = (10 + w * 0.42 * s * s) * pres;
    const rang = Math.floor(j - u * 5), pasX = r * 2.2;
    const n = Math.ceil((w + 2 * L * 0.3) / pasX) + 2;
    for (let i = -1; i < n; i++) {
      const x = -L * 0.3 + (i + bruit(i, rang) * 0.9) * pasX, rr = r * (0.75 + 0.6 * bruit(rang, i)), cy = y - rr * 0.2 + (bruit(i + 7, rang) - 0.5) * r * 0.5;
      const loin = 1 - s;
      ctx.save();
      ctx.translate(x, cy);
      ctx.scale(1.7 + bruit(i, rang + 3) * 0.6, 1);
      const g = ctx.createRadialGradient(-rr * 0.15, -rr * 0.5, rr * 0.05, 0, 0, rr);
      g.addColorStop(0, `rgba(255,${Math.round(236 - 10 * s)},${Math.round(200 - 15 * s)},${0.9 - 0.2 * loin})`);
      g.addColorStop(0.4, `rgba(${Math.round(190 - 50 * s)},${Math.round(188 - 46 * s)},${Math.round(186 - 36 * s)},0.9)`);
      g.addColorStop(0.8, `rgba(${Math.round(120 - 30 * s)},${Math.round(126 - 30 * s)},${Math.round(136 - 28 * s)},0.6)`);
      g.addColorStop(1, 'rgba(110,116,126,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  // Brume dorée sur l'horizon.
  const brume = ctx.createLinearGradient(0, yH - h * 0.03, 0, yH + h * 0.18);
  brume.addColorStop(0, 'rgba(250,232,196,0.9)'); brume.addColorStop(1, 'rgba(250,232,196,0)');
  ctx.fillStyle = brume;
  ctx.fillRect(-L, yH - h * 0.03, 3 * L, h * 0.21);
  ctx.restore();
}

/** Brouillard gris qui défile (dans les nuages), d'opacité a ; `trou` > 0 le déchire par endroits. */
function brouillard(ctx: CanvasRenderingContext2D, w: number, h: number, u: number, a: number, trou: number) {
  const cote = Math.max(w, h), t = nappe();
  ctx.globalAlpha = a * (1 - trou) ** 1.5;
  ctx.fillStyle = '#5c6167';
  ctx.fillRect(0, 0, w, h);
  for (const [v, f] of [[1.6, 1], [3.2, 0.8]] as const) {
    const s = cote * (1.3 + v * u);
    ctx.globalAlpha = a * f * (1 - trou) ** 0.7;
    ctx.drawImage(t, (w - s) / 2 + Math.sin(u * 7) * cote * 0.05, (h - s) / 2, s, s);
  }
  ctx.globalAlpha = 1;
}

/** Ciel de l'intro à l'avancée u (0 → 1 sur toute l'intro plongée). Rien à dessiner après CIEL.fin. */
export function dessinerNuages(ctx: CanvasRenderingContext2D, w: number, h: number, u: number) {
  if (u >= CIEL.fin || u < 0) return;
  const gl = rendreCiel(w, h, u);
  if (gl) { ctx.imageSmoothingQuality = 'high'; ctx.drawImage(gl, 0, 0, w, h); return; }
  const penche = (-5 + 3 * Math.sin(u * 9)) * Math.PI / 180;
  if (u < CIEL.bascule) {
    merDeNuages(ctx, w, h, u, h * (0.5 - 0.06 * (u / CIEL.bascule)), penche, 1);
  } else if (u < CIEL.dedans) {
    // On bascule vers le bas : l'horizon monte et sort de l'image, les nuages se rapprochent, tout devient gris.
    const v = doux((u - CIEL.bascule) / (CIEL.dedans - CIEL.bascule));
    merDeNuages(ctx, w, h, u, h * (0.44 - 0.9 * v), penche * (1 - v), 1 + 1.5 * v);
    brouillard(ctx, w, h, u, v * v, 0);
  } else if (u < CIEL.dechirure) {
    // Dans le gris : il fonce un peu, le brouillard défile.
    brouillard(ctx, w, h, u, 1, 0);
    ctx.fillStyle = `rgba(20,22,26,${0.25 * Math.sin(Math.PI * (u - CIEL.dedans) / (CIEL.dechirure - CIEL.dedans))})`;
    ctx.fillRect(0, 0, w, h);
  } else {
    // Déchirure : le brouillard s'effiloche, le relief apparaît dessous.
    brouillard(ctx, w, h, u, 1, doux((u - CIEL.dechirure) / (CIEL.fin - CIEL.dechirure)));
  }
}
