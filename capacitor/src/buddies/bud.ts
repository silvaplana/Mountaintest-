/**
 * 🐻 Bud (spec/buddies.md §5.12, écran 25) : le buddy à part qui connaît l'appli. Il ne parle que si on l'appelle
 * (« Bud, … ») ; sa réponse est un message de la conversation, vu de tous, dans sa propre bulle. Il propose (gîtes
 * et endroits posés sur la carte), les buddies décident. Même rôle côté Kotlin (Bud.kt) : garder les deux pareils.
 */
import { Preferences } from '@capacitor/preferences';
import { IA_MOT_DE_PASSE_INTEGRE, RELAIS_URL } from '../trails/webHikes';
import { compte, euros } from './count';
import { longueurTrace, type Dest } from './messages';
import type { Buddy, Depense, Hebergement, MessageBuddy, Planning, Sortie, TraceBuddy } from './store';

/** « Bud, … », « bud : … », « Les Baladins 👍 Bud, la pente ? » : Bud est appelé. */
export const pourBud = (texte: string) => /(^|[\s.!?👍])bud\s*[,:]/iu.test(texte) || /^\s*bud\b/i.test(texte);

export type Donnees = {
  nom: string; sortie?: Sortie; membres: Buddy[]; moi: string;
  traces: TraceBuddy[]; hebergements: Hebergement[]; depenses: Depense[]; plannings: Planning[]; messages: MessageBuddy[];
};

/** Ce que Bud sait de la conversation : la sortie ou la bande, en texte court (le relais le borne à 40 000 caractères). */
export function contexte(d: Dest, x: Donnees): string {
  const nom = (id: string) => (id === x.moi ? `${x.membres.find((b) => b.id === id)?.pseudo ?? 'moi'} (celui qui te parle)` : x.membres.find((b) => b.id === id)?.pseudo ?? '?');
  const l: string[] = [];
  const so = x.sortie;
  if (so) {
    l.push(`Buddy Time « ${so.nom} » du ${so.debut} au ${so.fin}${so.lieu ? `, lieu : ${so.lieu}` : ''}.`);
    l.push(`Qui vient : ${so.participants.map((p) => p.pseudo).join(', ')}.`);
    const inv = so.invitations.filter((i) => i.canal !== 'qr').map((i) => i.nom).filter(Boolean);
    if (inv.length) l.push(`Invités sans réponse : ${inv.join(', ')}.`);
  } else l.push(`Buddy Group « ${x.nom} » : ${x.membres.map((b) => b.pseudo).join(', ')}.`);
  const ici = (y: { sortie?: string | null; groupe?: string | null }) => (d.sortie ? y.sortie === d.sortie : y.groupe === d.groupe);
  const traces = x.traces.filter(ici);
  if (traces.length) {
    l.push('Traces partagées :');
    for (const t of traces) {
      const pts = t.ligne;
      l.push(`- « ${t.nom} » par ${t.par.pseudo}, ${longueurTrace(pts)}, départ ${pts[0]?.[1].toFixed(5)}, ${pts[0]?.[0].toFixed(5)}, arrivée ${pts.at(-1)?.[1].toFixed(5)}, ${pts.at(-1)?.[0].toFixed(5)} (pas d'altitude connue)${t.mot ? `, mot : ${t.mot}` : ''}`);
    }
  }
  const hs = d.sortie ? x.hebergements.filter((h) => h.sortie === d.sortie) : [];
  if (hs.length) {
    l.push('Hébergements proposés :');
    for (const h of hs) l.push(`- ${h.nom}${h.retenu ? ' (RETENU)' : ''}, ${h.prix_nuit != null ? `${h.prix_nuit} € la nuit` : 'prix inconnu'}, ${h.adresse}, ♥ de ${h.coeurs.map(nom).join(', ') || 'personne'}`);
  }
  if (so) {
    const dep = x.depenses.filter((y) => y.sortie === so.id);
    if (dep.length) {
      const c = compte(so, dep, x.moi);
      l.push(`Dépenses (Buddy count) : total ${euros(c.total)}, ${dep.length} dépense(s) : ${dep.map((y) => `${y.titre} ${euros(y.montant)} payé par ${nom(y.paye_par)}`).join(' ; ')}.`);
      l.push(c.virements.length ? `Pour équilibrer : ${c.virements.map((v) => `${nom(v.from)} doit ${v.amount.toFixed(2)} € à ${nom(v.to)}`).join(' ; ')}.` : 'Les comptes sont équilibrés.');
    }
  }
  const groupe = so ? so.groupe : d.groupe;
  for (const p of x.plannings.filter((y) => y.groupe === groupe)) {
    l.push(`Planning « ${p.nom} » (réponses avant le ${p.limite}) :`);
    for (const [debut, fin] of p.dates) {
      const ds = p.dispos.filter((y) => y.debut === debut);
      const de = (e: string) => ds.filter((y) => y.etat === e).map((y) => nom(y.qui)).join(', ') || 'personne';
      l.push(`- ${debut} au ${fin} : oui ${de('oui')} ; peut-être ${de('peut')} ; non ${de('non')}`);
    }
  }
  const ms = x.messages.filter(ici).slice(-30);
  if (ms.length) {
    l.push('Derniers messages :');
    for (const m of ms) l.push(`- ${m.bud ? 'Bud' : nom(m.par)} : ${m.nature === 'point' ? `📍 point ${m.lat}, ${m.lon}` : m.nature === 'photo' ? '📷 une photo' : m.texte}`);
  }
  return l.join('\n');
}

export type ReponseBud = {
  texte: string;
  hebergements: { nom: string; type: string; prix_nuit: number | null; adresse: string; url: string; resume: string; lat: number | null; lon: number | null }[];
  point: { nom: string; lat: number; lon: number } | null;
};

/** Pose la question à Bud (réseau). Lève une erreur lisible (pas de réseau, quota, mot de passe). */
export async function demander(question: string, ctx: string): Promise<ReponseBud> {
  const mdp = IA_MOT_DE_PASSE_INTEGRE || (await Preferences.get({ key: 'iaPassword' })).value || '';
  let res: Response;
  try {
    res = await fetch(RELAIS_URL.replace(/\/randos$/, '/bud'), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Mot-De-Passe': mdp }, body: JSON.stringify({ question, contexte: ctx }),
    });
  } catch { throw new Error('Pas de réseau : redemande à Bud quand tu en auras'); }
  const r = (await res.json().catch(() => ({}))) as Partial<ReponseBud> & { erreur?: string };
  if (!res.ok) throw new Error(res.status === 401 ? 'Bud ne te reconnaît pas (mot de passe des recherches)' : r.erreur ?? 'Bud ne répond pas');
  return { texte: r.texte ?? '', hebergements: r.hebergements ?? [], point: r.point ?? null };
}
