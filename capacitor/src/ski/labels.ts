// Placement des étiquettes de la carte (sorties skitour, parkings) pour qu'elles se chevauchent le moins possible.
// Même algorithme côté Kotlin (SkiLabels.kt).

export interface LabelIn { x: number; y: number; w: number; h: number }
export interface Pt { x: number; y: number }

/** Coin haut-gauche de l'étiquette par rapport à son point, dans l'ordre de préférence (à droite d'abord). */
export function candidates(w: number, h: number, gap = 13): [number, number][] {
  const g = gap * 0.6;
  return [[gap, -h / 2], [-gap - w, -h / 2], [g, -h - g], [g, g], [-w - g, -h - g], [-w - g, g], [-w / 2, -h - gap], [-w / 2, gap]];
}

/** Places essayées : d'abord tout près du point, puis un peu plus loin (2e et 3e tours) si tout est pris autour. */
export function allCandidates(w: number, h: number): { d: [number, number]; pen: number }[] {
  return [13, 34, 58].flatMap((gap, ring) => candidates(w, h, gap).map((d, k) => ({ d, pen: ring * 60 + k * 0.5 })));
}

type Box = [number, number, number, number];
const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

/**
 * Chaque étiquette (sorties et parkings, la sortie choisie en premier) cherche autour de son point la place qui ne
 * touche ni les autres étiquettes, ni les autres points, ni le bord de l'écran ; si tout est pris tout près, elle
 * s'écarte un peu. Un premier passage glouton, puis quelques passages où chacune se replace en voyant toutes les autres.
 * Rend le décalage (dx, dy) du coin haut-gauche de chaque étiquette par rapport à son point, en pixels écran.
 */
export function placeLabels(items: LabelIn[], points: Pt[], view?: { w: number; h: number }, r = 10): [number, number][] {
  const dots = points.map((p) => [p.x - r, p.y - r, p.x + r, p.y + r] as Box);
  const boxes: (Box | null)[] = items.map(() => null);
  const out: [number, number][] = items.map((it) => [13, -it.h / 2]);
  const cands = items.map((it) => allCandidates(it.w, it.h));
  const best = (i: number) => {
    const it = items[i];
    let b = out[i], bestCost = Infinity;
    for (const { d: [dx, dy], pen } of cands[i]) {
      const box: Box = [it.x + dx, it.y + dy, it.x + dx + it.w, it.y + dy + it.h];
      let cost = pen;
      // Chevaucher une autre étiquette est le pire ; un point ou le bord de l'écran gêne moins.
      boxes.forEach((p, j) => { if (p && j !== i) cost += 6 * overlap(box, p); });
      for (const d of dots) cost += 2 * overlap(box, d);
      if (view) cost += 3 * (it.w * it.h - overlap(box, [0, 0, view.w, view.h]));
      if (cost < bestCost) { bestCost = cost; b = [dx, dy]; }
    }
    return b;
  };
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    items.forEach((it, i) => {
      const b = best(i);
      if (pass === 0 || b[0] !== out[i][0] || b[1] !== out[i][1]) moved = true;
      out[i] = b; boxes[i] = [it.x + b[0], it.y + b[1], it.x + b[0] + it.w, it.y + b[1] + it.h];
    });
    if (!moved) break;
  }
  return out;
}
