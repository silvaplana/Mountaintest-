/**
 * 🗺 « Suis ma carte » pendant un appel (spec/buddies.md §7.10) : ce qui part et ce qui arrive, sans écran.
 * Les traces partent allégées : un seul message de données doit rester petit (LiveKit).
 */
import type { LonLat, Trail } from '../trails/osmTrails';
import { lengthM } from '../trails/osmTrails';
import type { MsgCarte } from './appel';

export type TraceEnvoyee = Extract<MsgCarte, { traces: unknown }>['traces'][number];

/** Au plus `max` points en tout, partagés entre les traces (au moins 30 chacune). */
export function tracesAEnvoyer(traces: Trail[], max = 500): TraceEnvoyee[] {
  const parTrace = Math.max(30, Math.floor(max / Math.max(1, traces.length)));
  return traces.map((t) => {
    const pts = t.segments.flat();
    const pas = Math.max(1, Math.ceil(pts.length / parTrace));
    const gardes = pts.filter((_, i) => i % pas === 0);
    if (pts.length && gardes[gardes.length - 1] !== pts[pts.length - 1]) gardes.push(pts[pts.length - 1]);
    return { id: t.id, nom: t.name, couleur: t.color, ligne: gardes.map((p) => [+p.lon.toFixed(5), +p.lat.toFixed(5)] as [number, number]) };
  });
}

/**
 * Ce qui part chez ceux qui suivent (Seb, 27/11 : « tout ce qui est dans mon écran ») : toutes mes traces affichées,
 * puis les autres traces (randos…) qui passent dans l'écran ; au plus `max` traces, pour qu'un message reste petit.
 */
export function tracesAMontrer(traces: Trail[], ecran: [number, number, number, number], mien: (id: number) => boolean, max = 15): Trail[] {
  const [o, s, e, n] = ecran;
  const dedans = (t: Trail) => t.segments.some((seg) => seg.some((p) => p.lon >= o && p.lon <= e && p.lat >= s && p.lat <= n));
  return [...traces.filter((t) => mien(t.id)), ...traces.filter((t) => !mien(t.id) && dedans(t))].slice(0, max);
}

/** Les traces reçues, affichées comme des randos (identifiants positifs : jamais rangées dans Mes traces). */
export function tracesInvitees(traces: TraceEnvoyee[], de: string): Trail[] {
  return traces.filter((t) => t.ligne.length >= 2).map((t, i) => {
    const seg: LonLat[] = t.ligne.map(([lon, lat]) => ({ lon, lat }));
    return { id: 9e12 + i, name: `${t.nom} (de ${de})`, kind: '', rank: 0, color: t.couleur, segments: [seg], distanceM: lengthM([seg]) };
  });
}
