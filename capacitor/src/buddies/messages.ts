/**
 * Messagerie (spec/buddies.md §5.6, écrans 6 et 24) : les calculs, sans écran.
 * Même calcul côté Kotlin (Messages.kt) : les garder identiques.
 *
 * Une conversation par Buddy Group et par Buddy Time. Le fil mêle les messages et, en cartes cliquables,
 * les traces partagées et les hébergements proposés au même endroit : on les retrouve plus tard.
 */
import { distanceM } from '../gps/adaptive';
import { km } from './carnet';
import type { Hebergement, MessageBuddy, TraceBuddy } from './store';

export type Dest = { groupe?: string; sortie?: string };
export const cle = (d: Dest) => d.sortie ?? d.groupe ?? '';

export type Bulle =
  | { genre: 'message'; quand: string; m: MessageBuddy }
  | { genre: 'trace'; quand: string; t: TraceBuddy }
  | { genre: 'hebergement'; quand: string; h: Hebergement };

/** Le fil d'une conversation, du plus ancien au plus récent. */
export function fil(d: Dest, messages: MessageBuddy[], traces: TraceBuddy[], hebergements: Hebergement[]): Bulle[] {
  const ici = (x: { groupe?: string | null; sortie?: string | null }) => (d.sortie ? x.sortie === d.sortie : !x.sortie && x.groupe === d.groupe);
  const l: Bulle[] = [
    ...messages.filter(ici).map((m) => ({ genre: 'message' as const, quand: m.cree_le, m })),
    ...traces.filter(ici).map((t) => ({ genre: 'trace' as const, quand: t.cree_le, t })),
    ...(d.sortie ? hebergements.filter((h) => h.sortie === d.sortie).map((h) => ({ genre: 'hebergement' as const, quand: h.cree_le ?? h.modifie_le, h })) : []),
  ];
  return l.sort((a, b) => new Date(a.quand).getTime() - new Date(b.quand).getTime());
}

/** Le dernier mot d'une conversation, pour la liste : « Julie : On part à 7 h ? ». */
export function apercu(b: Bulle | undefined, nom: (id: string) => string, moi: string): string {
  if (!b) return '';
  const qui = (id: string) => (id === moi || id === 'moi' ? 'Toi' : nom(id));
  if (b.genre === 'trace') return `〰 ${b.t.par.id === moi ? 'Toi' : b.t.par.pseudo} : ${b.t.nom}`;
  if (b.genre === 'hebergement') return `🏨 ${qui(b.h.par)} : ${b.h.nom}`;
  const m = b.m;
  if (m.bud) return `🐻 Bud : ${m.nature === 'point' ? `📍 ${m.texte}` : m.texte}`;
  return `${qui(m.par)} : ${m.nature === 'point' ? '📍 je suis ici' : m.nature === 'photo' ? '📷 une photo' : m.texte}`;
}

/** « 10 h 42 » aujourd'hui, « hier 10 h 42 », sinon « 12 déc. ». */
export function heureMessage(iso: string, maintenant = new Date()): string {
  const d = new Date(iso);
  const h = `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
  const jour = (x: Date) => x.toDateString();
  if (jour(d) === jour(maintenant)) return h;
  const hier = new Date(maintenant); hier.setDate(hier.getDate() - 1);
  if (jour(d) === jour(hier)) return `hier ${h}`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/** Longueur d'une trace partagée : « 14 km ». */
export function longueurTrace(l: [number, number][]): string {
  let m = 0;
  for (let i = 1; i < l.length; i++) m += distanceM({ lon: l[i - 1][0], lat: l[i - 1][1] }, { lon: l[i][0], lat: l[i][1] });
  return km(m);
}
