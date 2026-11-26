// Loupe 🔍 « refuge », « gîte », « cabane » : les points de refuges.info autour d'un lieu (ou du centre de la carte),
// par le relais du VPS (/refuges, API publique gratuite, pas de Claude). Posés sur la carte comme les hébergements trouvés.
import { relayPost } from './travel/travel';
import { searchPlaces, type NatureRefuge } from './search';
import type { PlacedLodging } from './Lodging';

/** Rectangle d'environ 2 × km autour du point. */
export function autour(c: { lon: number; lat: number }, km = 10) {
  const dLat = km / 111, dLon = km / (111 * Math.cos((c.lat * Math.PI) / 180));
  return { o: c.lon - dLon, s: c.lat - dLat, e: c.lon + dLon, n: c.lat + dLat };
}

export async function chercherRefugesInfo(d: { nature: NatureRefuge; lieu: string }, centre: { lon: number; lat: number }, password: string): Promise<PlacedLodging[]> {
  const ici = d.lieu.length >= 2 ? (await searchPlaces(d.lieu, AbortSignal.timeout(5000)).catch(() => []))[0] ?? centre : centre;
  const r = await relayPost<{ hebergements?: PlacedLodging[] }>('refuges', { ...autour(ici), nature: d.nature }, password);
  return r.hebergements ?? [];
}
