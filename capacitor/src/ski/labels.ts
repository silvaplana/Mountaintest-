// Placement des étiquettes de la carte (sorties skitour, parkings) pour qu'elles se chevauchent le moins possible.
// Même algorithme côté Kotlin (SkiLabels.kt).

export interface LabelIn { x: number; y: number; w: number; h: number }
export interface Pt { x: number; y: number }

/** Coin haut-gauche de l'étiquette par rapport à son point, dans l'ordre de préférence (à droite d'abord). */
export function candidates(w: number, h: number, gap = 13): [number, number][] {
  const g = gap * 0.6;
  return [[gap, -h / 2], [-gap - w, -h / 2], [g, -h - g], [g, g], [-w - g, -h - g], [-w - g, g], [-w / 2, -h - gap], [-w / 2, gap]];
}

const overlap = (a: [number, number, number, number], b: [number, number, number, number]) =>
  Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

/**
 * Glouton : chaque étiquette (dans l'ordre donné, la sortie choisie en premier) prend la première place libre autour
 * de son point, sans toucher les étiquettes déjà posées ni les autres points, dans l'écran ; sinon la place qui chevauche le moins.
 * Rend le décalage (dx, dy) du coin haut-gauche de chaque étiquette par rapport à son point, en pixels écran.
 */
export function placeLabels(items: LabelIn[], points: Pt[], view?: { w: number; h: number }, r = 10): [number, number][] {
  const placed: [number, number, number, number][] = [];
  const dots = points.map((p) => [p.x - r, p.y - r, p.x + r, p.y + r] as [number, number, number, number]);
  return items.map((it) => {
    let best: [number, number] = [13, -it.h / 2];
    let bestCost = Infinity;
    for (const [dx, dy] of candidates(it.w, it.h)) {
      const box: [number, number, number, number] = [it.x + dx, it.y + dy, it.x + dx + it.w, it.y + dy + it.h];
      let cost = 0;
      for (const p of placed) cost += overlap(box, p);
      for (const d of dots) cost += overlap(box, d);
      // Ce qui dépasse de l'écran (ou passe sous la colonne d'icônes) compte aussi comme un chevauchement.
      if (view) cost += it.w * it.h - overlap(box, [0, 0, view.w, view.h]);
      if (cost < bestCost) { bestCost = cost; best = [dx, dy]; }
      if (cost === 0) break;
    }
    placed.push([it.x + best[0], it.y + best[1], it.x + best[0] + it.w, it.y + best[1] + it.h]);
    return best;
  });
}
