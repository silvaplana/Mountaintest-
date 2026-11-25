/**
 * 🐻 « Bud choisit » (spec/buddies.md §7.16) : Bud regarde les petites images de l'album et garde les meilleures pour
 * le carnet, sans doublon. Son choix devient les ⭐ (on peut les retoucher, ou tout annuler).
 */
import { Preferences } from '@capacitor/preferences';
import { IA_MOT_DE_PASSE_INTEGRE } from '../trails/webHikes';
import { relayPost } from '../travel/travel';
import { adresse } from './album';
import { mettreEtoile, type PhotoBuddy } from './store';

export const COMBIEN = 8;
/** Le relais n'en lit pas plus à la fois. */
export const MAX_ENVOI = 90;

/** Les photos montrées à Bud : pas les films ; au-delà de la limite, une sur n, réparties sur toute la sortie. */
export function aMontrer(photos: PhotoBuddy[], max = MAX_ENVOI): PhotoBuddy[] {
  const l = photos.filter((p) => !p.video).sort((a, b) => a.prise_le.localeCompare(b.prise_le));
  if (l.length <= max) return l;
  return Array.from({ length: max }, (_, i) => l[Math.floor((i * l.length) / max)]);
}

/** Les ⭐ à changer pour que le carnet soit exactement le choix (les films ne sont pas touchés). */
export function changements(photos: PhotoBuddy[], choix: string[]): { id: string; etoile: boolean }[] {
  const oui = new Set(choix);
  return photos.filter((p) => !p.video && p.etoile !== oui.has(p.id)).map((p) => ({ id: p.id, etoile: oui.has(p.id) }));
}

const base64 = (b: Blob) => new Promise<string>((ok, non) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1] ?? '');
  r.onerror = () => non(r.error);
  r.readAsDataURL(b);
});

/** Demande à Bud (réseau) et pose les ⭐. Renvoie ce qu'il a changé, pour « Annuler ». Lève une erreur lisible. */
export async function budChoisit(photos: PhotoBuddy[]): Promise<{ n: number; faits: { id: string; etoile: boolean }[] }> {
  const envoi: { id: string; image: string; quand: string }[] = [];
  for (const p of aMontrer(photos)) {
    const u = await adresse(p.id, 'petite', p.envoyee);
    if (!u) continue;
    const b = await (await fetch(u)).blob();
    envoi.push({ id: p.id, image: await base64(b), quand: p.prise_le.slice(0, 16).replace('T', ' ') });
  }
  if (envoi.length < 2) throw new Error('Bud ne voit pas les photos : réessaie avec du réseau');
  const mdp = IA_MOT_DE_PASSE_INTEGRE || (await Preferences.get({ key: 'iaPassword' })).value || '';
  let r: { choix?: string[] };
  try {
    r = await relayPost<{ choix?: string[] }>('photos-choix', { photos: envoi, combien: COMBIEN }, mdp);
  } catch (e) {
    throw new Error(e instanceof TypeError ? 'Pas de réseau : redemande à Bud quand tu en auras' : `Bud n'a pas pu choisir (${(e as Error).message})`);
  }
  const choix = r.choix ?? [];
  if (!choix.length) throw new Error('Bud n’a rien retenu');
  const faits = changements(photos, choix);
  for (const c of faits) mettreEtoile(c.id, c.etoile);
  return { n: choix.length, faits };
}

/** « Annuler » : les ⭐ redeviennent comme avant le choix de Bud. */
export function annulerChoix(faits: { id: string; etoile: boolean }[]) {
  for (const c of faits) mettreEtoile(c.id, !c.etoile);
}
