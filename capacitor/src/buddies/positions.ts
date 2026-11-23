/**
 * Position des buddies (spec/buddies.md §5.9, écran 15) : les calculs, sans écran.
 * Même calcul côté Kotlin (Positions.kt) : les garder identiques.
 *
 * - N'apparaissent que ceux qui ont enfoncé l'épingle dans ce Buddy Time (le serveur ne garde rien d'autre).
 * - Chaque position porte l'heure de la dernière reçue et grise en vieillissant ; épingle relevée : grisée.
 */
import { distanceM } from '../gps/adaptive';
import { km, metres } from './carnet';
import type { Buddy, Position, Sortie } from './store';

/** Au-delà, une épingle enfoncée sans nouvelle position : « plus de réseau ? ». */
export const SANS_NOUVELLES_MIN = 20;

export type Repere = { b: Buddy; p: Position & { lat: number; lon: number; prise_le: number }; moi: boolean; actif: boolean; age: number };

/** Les buddies visibles de ce Buddy Time (moi compris), les plus récents d'abord. */
export function reperes(x: Sortie, ps: Position[], moi: string, t = Date.now()): Repere[] {
  const out: Repere[] = [];
  for (const b of x.participants) {
    const p = ps.find((y) => y.sortie === x.id && y.qui === b.id);
    if (!p || p.lat == null || p.lon == null || p.prise_le == null) continue;
    out.push({ b, p: p as Repere['p'], moi: b.id === moi || b.id === 'moi', actif: p.jusqu > t, age: Math.max(0, Math.round((t - p.prise_le) / 60_000)) });
  }
  return out.sort((a, c) => Number(c.actif) - Number(a.actif) || c.p.prise_le - a.p.prise_le);
}

export const heureCourte = (ms: number) => {
  const d = new Date(ms);
  return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
};

/** « toi », « à l'instant », « il y a 4 min », sinon l'heure : « 10 h 42 ». */
export function etiquette(r: Repere): string {
  if (r.moi) return 'toi';
  if (r.age < 1) return "à l'instant";
  return r.age < 60 ? `il y a ${r.age} min` : heureCourte(r.p.prise_le);
}

/** Grise en vieillissant ; épingle relevée : pâle. */
export function opacite(r: Repere): number {
  if (!r.actif) return 0.5;
  return r.age <= SANS_NOUVELLES_MIN ? 1 : r.age <= 60 ? 0.8 : 0.6;
}

/** « à 1,2 km de toi · 2 310 m · plus de réseau ? » */
export function detail(r: Repere, moi?: Repere): string {
  const d = moi && !r.moi ? distanceM(moi.p, r.p) : null;
  return [
    d != null && `à ${d < 1000 ? `${Math.round(d / 10) * 10} m` : km(d)} de toi`,
    r.p.alt != null && metres(r.p.alt),
    r.actif && r.age > SANS_NOUVELLES_MIN && 'plus de réseau ?',
    !r.actif && "a relevé l'épingle",
  ].filter(Boolean).join(' · ');
}

/** Pendant le Buddy Time (le jour même compris) : on peut enfoncer l'épingle. */
export const pendant = (x: Sortie, auj: string) => x.debut <= auj && auj <= x.fin;
