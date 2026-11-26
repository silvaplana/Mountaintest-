/**
 * Carnet d'une sortie (spec/buddies.md §5.8, écrans 12 à 14) : les calculs, sans écran.
 * Même calcul côté Kotlin (Carnet.kt) : les garder identiques.
 *
 * - Photos : les ⭐ de l'album ; sans ⭐, un choix automatique réparti sur toute la sortie (on peut en changer).
 * - Trace : une couleur par jour quand il y a une trace par jour (la 1re trace partagée = jour 1…), sinon une par trace.
 * - Chiffres : distance depuis les traces ; montée, descente, point haut depuis le relief IGN (une fois en ligne, puis
 *   gardés sur le téléphone) ; durée, départ, difficulté, météo, conditions tapés dans le carnet.
 */
import { distanceM } from '../gps/adaptive';
import { elevate } from '../trails/elevation';
import type { Trail } from '../trails/osmTrails';
import { carnetVide, type CarnetBuddy, type Fiche, type PhotoBuddy, type Sortie, type TraceBuddy } from './store';

export const COULEURS_JOURS = ['#7b3fe4', '#e4572e', '#2f8f5b', '#2c7fb8', '#c9862b', '#b5534a', '#2c8c8c'];
export const MAX_PHOTOS = 12;

export const carnetDe = (x: Sortie): CarnetBuddy => ({ ...carnetVide(), ...x.carnet });

/** Les jours de la sortie, AAAA-MM-JJ. */
export function joursDe(x: Sortie): string[] {
  const out: string[] = [];
  for (let d = new Date(`${x.debut}T12:00:00`); out.length < 60; d.setDate(d.getDate() + 1)) {
    const j = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (j > x.fin) break;
    out.push(j);
  }
  return out;
}

/** Photos du carnet : les ⭐ ; sans ⭐, au plus 12 réparties dans le temps (auto = vrai). Les films (celui du parcours
 * surtout) y sont toujours, en premier, le plus récent d'abord (Seb, 25/11). */
export function choixPhotos(photos: PhotoBuddy[], max = MAX_PHOTOS): { photos: PhotoBuddy[]; auto: boolean } {
  const films = photos.filter((p) => p.video).sort((a, b) => b.prise_le.localeCompare(a.prise_le));
  const l = photos.filter((p) => !p.video).sort((a, b) => a.prise_le.localeCompare(b.prise_le));
  const et = l.filter((p) => p.etoile);
  if (et.length) return { photos: [...films, ...et], auto: false };
  if (l.length <= max) return { photos: [...films, ...l], auto: l.length > 0 };
  const idx = new Set(Array.from({ length: max }, (_, i) => Math.round(i * (l.length - 1) / (max - 1))));
  return { photos: [...films, ...l.filter((_, i) => idx.has(i))], auto: true };
}

export type TraceCarnet = { t: TraceBuddy; couleur: string; libelle: string; jour: string | null };
/** Une couleur par jour quand il y a une trace par jour (dans l'ordre du partage) ; sinon une couleur et le nom par trace. */
export function tracesDuCarnet(traces: TraceBuddy[], jours: string[]): TraceCarnet[] {
  const l = [...traces].sort((a, b) => a.cree_le.localeCompare(b.cree_le));
  const parJour = l.length > 1 && l.length === jours.length;
  return l.map((t, i) => ({ t, couleur: COULEURS_JOURS[i % COULEURS_JOURS.length], libelle: parJour ? `Jour ${i + 1}` : t.nom,
    jour: parJour ? jours[i] : jours.length === 1 && l.length === 1 ? jours[0] : null }));
}

export function longueur(l: [number, number][]) {
  let m = 0;
  for (let i = 1; i < l.length; i++) m += distanceM({ lon: l[i - 1][0], lat: l[i - 1][1] }, { lon: l[i][0], lat: l[i][1] });
  return m;
}

// ------------------------------------------------------------------ relief (montée, descente, point haut, profil)

/** Relief d'une trace : profil réduit à 200 points au plus (d en m, z en m). */
export type Relief = { d: number[]; z: number[]; montee: number; descente: number; haut: number };
const CLE_RELIEF = 'carnet-relief:';

export function reliefGarde(id: string): Relief | null {
  try { return JSON.parse(localStorage.getItem(CLE_RELIEF + id) ?? 'null') as Relief | null; } catch { return null; }
}
const enCours = new Map<string, Promise<Relief | null>>();
/** Relief gardé, sinon demandé une fois au service d'altitudes IGN (null sans réseau : on réessaiera). */
export function relief(t: TraceBuddy): Promise<Relief | null> {
  const g = reliefGarde(t.id);
  if (g) return Promise.resolve(g);
  if (!enCours.has(t.id)) {
    enCours.set(t.id, (async () => {
      try {
        const seg = t.ligne.map(([lon, lat]) => ({ lon, lat }));
        const el = await elevate({ id: 0, name: t.nom, kind: '', rank: 0, color: '', segments: [seg], distanceM: longueur(t.ligne) } as Trail);
        const r = reduireRelief(el.segments[0], el.gainM, el.lossM);
        if (r) try { localStorage.setItem(CLE_RELIEF + t.id, JSON.stringify(r)); } catch { /* stockage plein */ }
        return r;
      } catch { return null; } finally { enCours.delete(t.id); }
    })());
  }
  return enCours.get(t.id)!;
}

export function reduireRelief(pts: { lon: number; lat: number; ele: number | null }[], montee: number, descente: number, max = 200): Relief | null {
  const d: number[] = [], z: number[] = [];
  let acc = 0;
  pts.forEach((p, i) => {
    if (i > 0) acc += distanceM(pts[i - 1], p);
    if (p.ele != null) { d.push(Math.round(acc)); z.push(Math.round(p.ele)); }
  });
  if (d.length < 2) return null;
  const pas = Math.max(1, Math.ceil(d.length / max));
  const k = d.map((_, i) => i).filter((i) => i % pas === 0 || i === d.length - 1);
  return { d: k.map((i) => d[i]), z: k.map((i) => z[i]), montee: Math.round(montee), descente: Math.round(descente), haut: Math.max(...z) };
}

// ------------------------------------------------------------------ chiffres

const espace = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
export const km = (m: number) => `${(m / 1000).toFixed(m < 10_000 ? 1 : 0).replace('.', ',')} km`;
export const metres = (m: number) => `${espace(m)} m`;
export function duree(min: number) { return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`; }
/** « 5 h 20 », « 5h20 », « 5 h », « 320 » (minutes) → minutes ; null si vide ou illisible. */
export function lireDuree(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})\s*h\s*(\d{0,2})$/);
  if (m) return +m[1] * 60 + (m[2] ? +m[2] : 0);
  return /^\d{1,4}$/.test(t) ? +t : null;
}
/** « 11 », « 11,5 » (km) → mètres. */
export function lireKm(s: string): number | null {
  const t = s.trim().replace(',', '.').replace(/\s*km$/, '');
  return t && /^\d+(\.\d+)?$/.test(t) ? Math.round(+t * 1000) : null;
}
export function lireMetres(s: string): number | null {
  const t = s.replace(/[\s +m]/g, '');
  return t && /^\d+$/.test(t) ? +t : null;
}

/** Fiche d'un jour telle qu'affichée : ce qui est tapé, sinon pris dans la trace du jour. */
export type FicheAffichee = Fiche & { n: number; couleur: string; trace: boolean };
export function fiches(x: Sortie, traces: TraceCarnet[], reliefs: Map<string, Relief>): FicheAffichee[] {
  const c = carnetDe(x);
  return joursDe(x).map((jour, i) => {
    const f = c.fiches.find((y) => y.jour === jour);
    const tc = traces.find((t) => t.jour === jour);
    const r = tc && reliefs.get(tc.t.id);
    return { jour, n: i + 1, couleur: tc?.couleur ?? COULEURS_JOURS[i % COULEURS_JOURS.length], trace: !!tc,
      nom: f?.nom ?? '', depart: f?.depart ?? '', duree: f?.duree ?? null,
      distance: f?.distance ?? (tc ? Math.round(longueur(tc.t.ligne)) : null),
      denivele: f?.denivele ?? (r ? r.montee : null) };
  }).filter((f) => f.nom || f.depart || f.duree != null || f.distance != null || f.denivele != null);
}

export type Tuile = { v: string; l: string; vide?: boolean };
/** Les chiffres du carnet (écran 13), seulement ceux qu'on connaît ; les conditions en pointillé tant qu'elles manquent. */
export function chiffres(x: Sortie, traces: TraceCarnet[], reliefs: Map<string, Relief>, fs: FicheAffichee[]): Tuile[] {
  const c = carnetDe(x);
  const out: Tuile[] = [];
  const dist = traces.reduce((n, t) => n + longueur(t.t.ligne), 0);
  if (dist) out.push({ v: km(dist), l: 'distance' });
  const rs = traces.map((t) => reliefs.get(t.t.id));
  if (traces.length && rs.every(Boolean)) {
    out.push({ v: `+${metres(rs.reduce((n, r) => n + r!.montee, 0))}`, l: 'montée' });
    out.push({ v: `−${metres(rs.reduce((n, r) => n + r!.descente, 0))}`, l: 'descente' });
  }
  const min = fs.reduce((n, f) => n + (f.duree ?? 0), 0);
  if (min) out.push({ v: duree(min), l: 'durée' });
  if (traces.length && rs.every(Boolean)) out.push({ v: metres(Math.max(...rs.map((r) => r!.haut))), l: 'point haut' });
  const nj = joursDe(x).length;
  out.push({ v: `${nj} jour${nj > 1 ? 's' : ''}`, l: nj > 1 ? `${nj - 1} nuit${nj > 2 ? 's' : ''}` : 'sur la journée' });
  out.push({ v: String(x.participants.length), l: x.participants.length > 1 ? 'buddies' : 'buddy' });
  if (c.difficulte) out.push({ v: c.difficulte, l: 'difficulté' });
  if (c.meteo) out.push({ v: c.meteo, l: 'météo' });
  if (!c.conditions) out.push({ v: '+', l: 'conditions', vide: true });
  return out;
}

/** Le carnet en texte, pour le partager par message ou par mail. */
export function texteCarnet(x: Sortie, dates: string, tuiles: Tuile[], fs: FicheAffichee[]): string {
  const c = carnetDe(x);
  const l = [`📖 ${x.nom}`, `${dates} · ${x.participants.map((p) => p.pseudo).join(', ')}`, ''];
  for (const r of c.recits) l.push(`${r.texte}\n— ${r.par.pseudo}`, '');
  const t = tuiles.filter((y) => !y.vide).map((y) => `${y.v} ${y.l}`);
  if (t.length) l.push(t.join(' · '), '');
  if (c.conditions) l.push(`Conditions : ${c.conditions}`, '');
  for (const f of fs) {
    const d = [f.depart && `départ ${f.depart.replace(':', ' h ')}`, f.duree != null && duree(f.duree), f.distance != null && km(f.distance),
      f.denivele != null && `+${metres(f.denivele)}`].filter(Boolean).join(' · ');
    l.push(`Jour ${f.n}${f.nom ? ` · ${f.nom}` : ''}${d ? ` : ${d}` : ''}`);
  }
  return l.join('\n').trim();
}
