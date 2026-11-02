// Ombres du relief pour une position du soleil, sur une grille d'altitudes (MNT) en Web Mercator.
// Même algorithme côté Kotlin (Shade.kt) : garder les deux identiques.
//
// Ombre portée : on balaie la grille en partant du côté du soleil. Pour chaque point, on reprend
// la « hauteur d'ombre » du point voisin vers le soleil (interpolée), diminuée de la descente du
// rayon sur un pas ; si elle dépasse le sol, le point est à l'ombre. Un seul passage : O(n).
// Ombre propre : versant tourné à l'opposé du soleil (normale · soleil ≤ 0).

export const LIT = 0;
export const SELF_SHADE = 1;
export const CAST_SHADOW = 2;
export const NIGHT = 3;

/** Marge en mètres avant de déclarer un point à l'ombre (bruit du MNT). */
const TOLERANCE_M = 0.5;

/**
 * @param dem altitudes en mètres, ligne 0 au nord, w × h
 * @param cellM taille d'une maille au sol, en mètres
 * @returns un code par maille : LIT, SELF_SHADE, CAST_SHADOW ou NIGHT
 */
export function computeShade(dem: Float32Array, w: number, h: number, cellM: number, azimuthDeg: number, altitudeDeg: number): Uint8Array {
  const out = new Uint8Array(w * h);
  if (altitudeDeg <= 0) return out.fill(NIGHT);
  const az = (azimuthDeg * Math.PI) / 180;
  const alt = (altitudeDeg * Math.PI) / 180;
  // Direction vers le soleil dans la grille : x vers l'est, y vers le sud.
  const dx = Math.sin(az), dy = -Math.cos(az);
  const tanAlt = Math.tan(alt);

  // Ombre propre.
  const sx = Math.sin(az) * Math.cos(alt), sy = Math.cos(az) * Math.cos(alt), sz = Math.sin(alt);
  for (let y = 0; y < h; y++) {
    const yu = Math.max(0, y - 1), yd = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const xl = Math.max(0, x - 1), xr = Math.min(w - 1, x + 1);
      const dzdx = (dem[y * w + xr] - dem[y * w + xl]) / ((xr - xl || 1) * cellM);
      const dzdn = (dem[yu * w + x] - dem[yd * w + x]) / ((yd - yu || 1) * cellM);
      // Normale (-dz/dx, -dz/dnord, 1) · soleil (est, nord, haut)
      if (-dzdx * sx - dzdn * sy + sz <= 0) out[y * w + x] = SELF_SHADE;
    }
  }

  // Ombre portée.
  const hs = new Float32Array(w * h);
  if (Math.abs(dx) >= Math.abs(dy)) {
    const step = dx > 0 ? 1 : -1; // colonne voisine vers le soleil
    const f = dy / Math.abs(dx);  // décalage de ligne correspondant
    const drop = cellM * Math.hypot(1, f) * tanAlt;
    const xs = dx > 0 ? w - 1 : 0;
    for (let i = 0; i < w; i++) {
      const x = xs - i * step;
      const xu = x + step;
      for (let y = 0; y < h; y++) {
        const k = y * w + x, g = dem[k];
        let up = -Infinity;
        if (xu >= 0 && xu < w) {
          const yy = y + f, y0 = Math.floor(yy), t = yy - y0;
          if (y0 >= 0 && y0 + 1 < h) up = hs[y0 * w + xu] * (1 - t) + hs[(y0 + 1) * w + xu] * t;
          else if (y0 === h - 1 && t === 0) up = hs[y0 * w + xu];
          up -= drop;
        }
        if (up > g + TOLERANCE_M) { out[k] = CAST_SHADOW; hs[k] = up; } else hs[k] = g;
      }
    }
  } else {
    const step = dy > 0 ? 1 : -1;
    const f = dx / Math.abs(dy);
    const drop = cellM * Math.hypot(1, f) * tanAlt;
    const ys = dy > 0 ? h - 1 : 0;
    for (let i = 0; i < h; i++) {
      const y = ys - i * step;
      const yu = y + step;
      for (let x = 0; x < w; x++) {
        const k = y * w + x, g = dem[k];
        let up = -Infinity;
        if (yu >= 0 && yu < h) {
          const xx = x + f, x0 = Math.floor(xx), t = xx - x0;
          if (x0 >= 0 && x0 + 1 < w) up = hs[yu * w + x0] * (1 - t) + hs[yu * w + x0 + 1] * t;
          else if (x0 === w - 1 && t === 0) up = hs[yu * w + x0];
          up -= drop;
        }
        if (up > g + TOLERANCE_M) { out[k] = CAST_SHADOW; hs[k] = up; } else hs[k] = g;
      }
    }
  }
  return out;
}

/** Part de mailles à l'ombre (propre ou portée), pour l'affichage et les tests. */
export function shadeRatio(codes: Uint8Array): number {
  let n = 0;
  for (const c of codes) if (c !== LIT) n++;
  return codes.length ? n / codes.length : 0;
}
