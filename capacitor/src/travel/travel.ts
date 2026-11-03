// Préparer un voyage en voiture : itinéraires IGN (plusieurs variantes, dessinées sur la carte pour que l'on choisisse),
// puis coût (énergie + péages) calculé par Claude via le relais du VPS (deploy/ia/relais.py). Même code côté Kotlin (Travel.kt).
import { RELAIS_URL } from '../trails/webHikes';

const ITINERAIRE = 'https://data.geopf.fr/navigation/itineraire';
const SANS_AUTOROUTE = JSON.stringify({ constraintType: 'banned', key: 'waytype', operator: '=', value: 'autoroute' });

export type Energy = 'essence' | 'diesel' | 'electrique' | 'hybride' | 'gpl';
export const ENERGIES: Record<Energy, string> = { essence: 'Essence', diesel: 'Diesel', electrique: 'Électrique', hybride: 'Hybride', gpl: 'GPL' };
export const unitFor = (e: Energy) => (e === 'electrique' ? 'kWh/100 km' : 'L/100 km');
/** Consommation proposée tant qu'on n'a pas choisi de modèle. */
export const DEFAULT_CONSO: Record<Energy, number> = { essence: 6.5, diesel: 5.5, electrique: 17, hybride: 5, gpl: 8 };

export interface Motorway { numero: string; km: number }
export interface CarRoute {
  name: string; color: string; km: number; minutes: number;
  coords: [number, number][]; motorways: Motorway[];
}

const COLORS = ['#1d6fe0', '#e4572e', '#2f9e44', '#7b3fe4'];

interface IgnStep { attributes?: Record<string, string>; distance?: number }
interface IgnRoute { distance: number; duration: number; geometry: { coordinates: [number, number][] }; portions?: { steps?: IgnStep[] }[] }

/** Kilomètres d'autoroute par numéro (A50, A8…), pour chiffrer les péages. */
export function motorways(r: IgnRoute): Motorway[] {
  const km = new Map<string, number>();
  for (const p of r.portions ?? []) for (const s of p.steps ?? []) {
    const a = s.attributes ?? {};
    if (!/autoroute/i.test(`${a.cpx_classement_administratif ?? ''} ${a.nature ?? ''}`)) continue;
    const n = (a.cpx_numero || 'autoroute').split(/[ ;]/)[0];
    km.set(n, (km.get(n) ?? 0) + (s.distance ?? 0) / 1000);
  }
  return [...km].map(([numero, k]) => ({ numero, km: Math.round(k * 10) / 10 })).filter((m) => m.km >= 0.5);
}

export function parseRoute(json: IgnRoute, name: string): CarRoute {
  return { name, color: '', km: json.distance / 1000, minutes: json.duration / 60, coords: json.geometry.coordinates, motorways: motorways(json) };
}

/** Deux variantes quasi identiques (même distance et même durée à 2 % près) n'en font qu'une. */
export function dedupe(routes: CarRoute[]): CarRoute[] {
  const out: CarRoute[] = [];
  for (const r of routes) {
    if (out.some((o) => Math.abs(o.km - r.km) < 0.02 * o.km && Math.abs(o.minutes - r.minutes) < 0.02 * o.minutes + 1)) continue;
    out.push(r);
  }
  return out.map((r, i) => ({ ...r, color: COLORS[i % COLORS.length] }));
}

async function ignRoute(from: [number, number], to: [number, number], optimization: 'fastest' | 'shortest', noMotorway: boolean, signal?: AbortSignal) {
  const q = new URLSearchParams({
    resource: 'bdtopo-pgr', profile: 'car', optimization, start: from.join(','), end: to.join(','),
    geometryFormat: 'geojson', getSteps: 'true', waysAttributes: 'cpx_classement_administratif|cpx_numero|nature',
  });
  if (noMotorway) q.set('constraints', SANS_AUTOROUTE);
  const res = await fetch(`${ITINERAIRE}?${q}`, { signal });
  if (res.status === 404 || res.status === 400) throw new Error('aucun chemin : le départ et l’arrivée doivent être en France, près d’une route');
  if (!res.ok) throw new Error(`itinéraire IGN : HTTP ${res.status}`);
  return (await res.json()) as IgnRoute;
}

/** Variantes : avec péages le plus rapide, le plus court et sans autoroute ; sans péages, les deux sans autoroute. */
export async function carRoutes(from: [number, number], to: [number, number], tolls: boolean, signal?: AbortSignal): Promise<CarRoute[]> {
  const asks: [string, 'fastest' | 'shortest', boolean][] = tolls
    ? [['Le plus rapide', 'fastest', false], ['Le plus court', 'shortest', false], ['Sans autoroute', 'fastest', true]]
    : [['Sans autoroute, rapide', 'fastest', true], ['Sans autoroute, court', 'shortest', true]];
  const got = await Promise.allSettled(asks.map(([, o, n]) => ignRoute(from, to, o, n, signal)));
  const ok = got.flatMap((g, i) => (g.status === 'fulfilled' ? [parseRoute(g.value, asks[i][0])] : []));
  if (!ok.length) throw (got[0] as PromiseRejectedResult).reason;
  return dedupe(ok);
}

export function formatDuration(min: number) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

export const routeLine = (r: CarRoute) =>
  `${Math.round(r.km)} km · ${formatDuration(r.minutes)}${r.motorways.length ? ` · ${r.motorways.map((m) => `${m.numero} ${Math.round(m.km)} km`).join(', ')}` : ''}`;

// ---------- Relais IA ----------

const relay = (path: string) => RELAIS_URL.replace(/\/randos$/, `/${path}`);

/** password : un ou plusieurs mots de passe séparés par un retour à la ligne (intégré à l'APK, puis tapé) ; on essaie le suivant si refusé. */
async function post<T>(path: string, body: unknown, password: string, signal?: AbortSignal): Promise<T> {
  const tries = password.split('\n').filter(Boolean);
  let res!: Response;
  for (const p of tries) {
    res = await fetch(relay(path), {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'X-Mot-De-Passe': p }, body: JSON.stringify(body),
    });
    if (res.status !== 401) break;
  }
  let json: T & { erreur?: string } = {} as T & { erreur?: string };
  try { json = await res.json(); } catch { /* réponse non JSON */ }
  // 404 « inconnu » : le relais du VPS tourne encore l'ancienne version (mise à jour toutes les 5 à 10 min).
  if (res.status === 404) throw new Error('le serveur IA n’est pas encore à jour, réessaie dans quelques minutes');
  if (!res.ok) throw new Error(json.erreur ?? `relais HTTP ${res.status}`);
  return json;
}

export interface Car { nom: string; energies: { energie: Energy; conso: number; unite: string }[] }

export async function searchCars(text: string, password: string, signal?: AbortSignal): Promise<Car[]> {
  const r = await post<{ voitures?: Car[] }>('voiture', { recherche: text }, password, signal);
  return (r.voitures ?? []).filter((c) => c.nom && c.energies?.length);
}

export interface TripCost {
  prix_unitaire: number; unite_prix: string; cout_energie: number; peages: number; peages_detail: string;
  total: number; explication: string; cache?: boolean; cout_usd?: number; cumul_mois_usd?: number; cumul_total_usd?: number;
}

export function tripCost(t: { depart: string; arrivee: string; route: CarRoute; voiture: string; energie: Energy; conso: number },
  password: string, signal?: AbortSignal): Promise<TripCost> {
  return post<TripCost>('voyage', {
    depart: t.depart, arrivee: t.arrivee, km: Math.round(t.route.km * 10) / 10, duree_min: Math.round(t.route.minutes),
    autoroutes: t.route.motorways, voiture: t.voiture, energie: t.energie, conso: t.conso, unite: unitFor(t.energie),
  }, password, signal);
}

export const euros = (v: number) => `${v.toFixed(v < 10 ? 2 : 0).replace('.', ',')} €`;
