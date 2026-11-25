// Intro « plongée » du survol (idée de Seb : un drone dans les nuages qui plonge, 25/11) : nuages dessinés
// par-dessus la carte au tout début du film. La caméra descend : ils grossissent, s'écartent et s'effacent.

let texture: HTMLCanvasElement | null = null;

/** Nappe de nuages (taches blanches floues), toujours la même. */
function nappe(): HTMLCanvasElement {
  if (texture) return texture;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  let g = 7;
  const alea = () => ((g = (g * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    const x = alea() * 512, y = alea() * 512, r = 40 + alea() * 90;
    const d = ctx.createRadialGradient(x, y, 0, x, y, r);
    d.addColorStop(0, 'rgba(255,255,255,0.85)');
    d.addColorStop(0.6, 'rgba(246,248,252,0.45)');
    d.addColorStop(1, 'rgba(240,244,250,0)');
    ctx.fillStyle = d;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  return (texture = c);
}

/**
 * Nuages à l'avancée k (0 : au-dessus des nuages, 1 : passés). Rien à dessiner après 1.
 * Deux couches qui grossissent à des vitesses différentes : on a l'impression de les traverser.
 */
export function dessinerNuages(ctx: CanvasRenderingContext2D, w: number, h: number, k: number) {
  if (k >= 1) return;
  const t = nappe(), cote = Math.max(w, h);
  for (const [vitesse, force] of [[2.5, 1], [5, 0.7]]) {
    const s = cote * (1.1 + vitesse * k * k);
    ctx.globalAlpha = force * (1 - k) ** 1.4;
    ctx.drawImage(t, (w - s) / 2, (h - s) / 2, s, s);
  }
  ctx.globalAlpha = 1;
}
