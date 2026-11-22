// Mes traces affichées sur la carte et le suivi en cours, gardés quand l'appli se ferme (demande de Seb) :
// à la réouverture, les traces sont toujours là et le suivi reprend. Même format côté Kotlin (ShownTraces).
import { Preferences } from '@capacitor/preferences';
import type { Trail } from './osmTrails';
import { isMine } from './route';
import { lengthM } from './osmTrails';

const KEY = 'tracesAffichees';

export interface ShownState { trails: Trail[]; navId: number | null; navPaused: boolean }

export function encodeShown(trails: Trail[], navId: number | null, navPaused: boolean): string {
  return JSON.stringify({
    trails: trails.filter((t) => isMine(t.id)).map((t) => ({
      id: t.id, name: t.name, kind: t.kind, color: t.color, onPaths: t.onPaths ?? false, savedId: t.savedId ?? null,
      segments: t.segments.map((s) => s.map((p) => [p.lon, p.lat])),
    })),
    navId, navPaused,
  });
}

export function decodeShown(v: string | null): ShownState {
  const empty: ShownState = { trails: [], navId: null, navPaused: false };
  if (!v) return empty;
  try {
    const o = JSON.parse(v);
    const trails: Trail[] = (Array.isArray(o.trails) ? o.trails : []).map((t: Record<string, unknown>) => {
      const segments = (t.segments as [number, number][][]).map((s) => s.map(([lon, lat]) => ({ lon, lat }))).filter((s) => s.length >= 2);
      return {
        id: Number(t.id), name: String(t.name ?? 'Tracé'), kind: String(t.kind ?? ''), rank: 0, color: String(t.color ?? '#7b3fe4'),
        segments, distanceM: lengthM(segments), onPaths: !!t.onPaths, savedId: t.savedId == null ? null : Number(t.savedId),
      };
    }).filter((t: Trail) => t.segments.length && isMine(t.id));
    const navId = typeof o.navId === 'number' && trails.some((t) => t.id === o.navId) ? o.navId : null;
    return { trails, navId, navPaused: !!o.navPaused };
  } catch { return empty; }
}

export async function saveShown(trails: Trail[], navId: number | null, navPaused: boolean) {
  try { await Preferences.set({ key: KEY, value: encodeShown(trails, navId, navPaused) }); } catch { /* ignoré */ }
}

export async function loadShown(): Promise<ShownState> {
  try { return decodeShown((await Preferences.get({ key: KEY })).value); } catch { return decodeShown(null); }
}
