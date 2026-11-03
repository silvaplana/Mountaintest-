// Sorties de ski de rando publiées sur skitour.fr, dans une zone encadrée. Passe par le relais du VPS
// (deploy/ia/relais.py), qui garde la clé de l'API skitour. Même appel côté Kotlin (Skitour.kt).
import { relayPost } from '../travel/travel';
import type { Bbox } from '../config';

export interface Outing {
  id: number; titre: string; date: number; massif: string; sommet: string; altitude: number | null;
  lat: number; lon: number; denivele: number | null; dif_ski: string | number | null; orientation: string;
  conditions: string; auteur: string; url: string;
}

export async function fetchOutings(b: Bbox, days: number, password: string): Promise<Outing[]> {
  const r = await relayPost<{ sorties?: Outing[] }>('skitour', { ouest: b[0], sud: b[1], est: b[2], nord: b[3], jours: days }, password);
  return (r.sorties ?? []).filter((o) => Number.isFinite(o.lat) && Number.isFinite(o.lon)).sort((x, y) => y.date - x.date);
}

export const outingDate = (o: Outing) => new Date(o.date * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

export const outingLine = (o: Outing) => [o.sommet + (o.altitude ? ` ${o.altitude} m` : ''), o.denivele ? `D+ ${o.denivele} m` : '',
  o.dif_ski ? `ski ${o.dif_ski}` : '', o.orientation].filter(Boolean).join(' · ');
