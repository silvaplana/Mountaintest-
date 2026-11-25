/**
 * 🐻 Bud (spec/buddies.md §5.12, écran 25) : le buddy à part qui connaît l'appli. Il ne parle que si on l'appelle
 * (« Bud, … ») ; sa réponse est un message de la conversation, vu de tous, dans sa propre bulle. Il propose (gîtes
 * et endroits posés sur la carte), les buddies décident. Même rôle côté Kotlin (Bud.kt) : garder les deux pareils.
 */
import { Preferences } from '@capacitor/preferences';
import { IA_MOT_DE_PASSE_INTEGRE, RELAIS_URL } from '../trails/webHikes';
import { compte, euros } from './count';
import { longueurTrace, type Dest } from './messages';
import {
  aujourdhui, creerSortie, enregistrerDepense, remettreSortie, repondre, retirerDepense, retirerSortie, supprimerSortie,
  type ActionBud, type Buddy, type Depense, type Hebergement, type MessageBuddy, type Planning, type Sortie, type TraceBuddy,
} from './store';

/** « Bud, … », « bud : … », « Les Baladins 👍 Bud, la pente ? » : Bud est appelé. */
export const pourBud = (texte: string) => /(^|[\s.!?👍])buds?\s*[,:]/iu.test(texte) || /^\s*buds?\b/i.test(texte);

export type Donnees = {
  nom: string; sortie?: Sortie; membres: Buddy[]; moi: string;
  traces: TraceBuddy[]; hebergements: Hebergement[]; depenses: Depense[]; plannings: Planning[]; messages: MessageBuddy[];
  /** Les Buddy Times que je vois (Bud les nomme, et peut en supprimer un à ma demande). */
  sorties?: Sortie[];
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
  } else {
    l.push(`Buddy Group « ${x.nom} » : ${x.membres.map((b) => b.pseudo).join(', ')}.`);
    const bts = (x.sorties ?? []).filter((y) => y.groupe === d.groupe);
    if (bts.length) l.push(`Ses Buddy Times : ${bts.map((y) => `« ${y.nom} » du ${y.debut} au ${y.fin}`).join(' ; ')}.`);
  }
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
  actions: ActionDemandee[];
};
/** Ce que Bud propose de faire (§7.12) : une dépense, un Buddy Time (le créer ou le supprimer), ma dispo à un planning. */
export type ActionDemandee = {
  type: 'depense' | 'buddy_time' | 'supprimer_buddy_time' | 'dispo'; titre: string | null; montant_euros: number | null; paye_par: string | null; pour: string[];
  nom: string | null; debut: string | null; fin: string | null; lieu: string | null; etat: 'oui' | 'peut' | 'non' | null;
};

const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const meme = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * 🐻 Fait ce que Bud propose, en mon nom (choix de Seb, 23 novembre) : seulement une dépense du Buddy count de ce
 * Buddy Time, un Buddy Time dans cette bande (le créer, ou le supprimer si je l'ai créé ou administre la bande : Seb,
 * 25 novembre), ou ma propre dispo à un planning de la bande. Le reste est écarté.
 * Rend ce qui est fait (pour « Annuler ») et ce qui ne l'est pas (à dire).
 */
export function agir(actions: ActionDemandee[], d: Dest, x: Donnees & { groupe?: { id: string; nature: string; membres: Buddy[] } }) {
  const faites: ActionBud[] = [];
  const refus: string[] = [];
  const id = (noms: string[], parmi: Buddy[]) => noms.map((n) => parmi.find((b) => meme(b.pseudo, n))?.id);
  for (const a of actions.slice(0, 3)) {
    try {
      if (a.type === 'depense') {
        const so = x.sortie;
        if (!so) throw new Error('une dépense va dans un Buddy Time');
        const montant = Math.round((a.montant_euros ?? 0) * 100);
        const paye = a.paye_par ? id([a.paye_par], so.participants)[0] : x.moi;
        const pour = a.pour.length ? id(a.pour, so.participants) : so.participants.map((p) => p.id);
        if (!paye || pour.some((p) => !p)) throw new Error('seuls les buddies du Buddy Time partagent ses frais');
        const titre = (a.titre ?? 'Dépense').slice(0, 80);
        const dep = enregistrerDepense({ sortie: so.id, titre, montant, paye_par: paye, pour: pour as string[], jour: aujourdhui() });
        faites.push({ genre: 'depense', id: dep, texte: `💶 ${titre} · ${euros(montant)}` });
      } else if (a.type === 'buddy_time') {
        const g = x.groupe;
        if (!g || !a.nom || !a.debut || !JOUR.test(a.debut)) throw new Error('il faut une bande, un nom et une date');
        const qui = g.nature === 'me_time' ? [] : (a.pour.length ? id(a.pour, g.membres) : g.membres.map((b) => b.id)).filter((p): p is string => !!p);
        const fin = a.fin && JOUR.test(a.fin) && a.fin >= a.debut ? a.fin : a.debut;
        const sid = creerSortie({ groupe: g.id, nom: a.nom, photo: null, debut: a.debut, fin, lieu: (a.lieu ?? '').slice(0, 120), participants: qui });
        faites.push({ genre: 'sortie', id: sid, texte: `📅 Buddy Time « ${a.nom} » · ${a.debut}` });
      } else if (a.type === 'supprimer_buddy_time') {
        // Celui de cette conversation, ou celui de la bande qui porte ce nom (et cette date si Bud la donne).
        const groupe = x.sortie?.groupe ?? d.groupe;
        const so = !a.nom && x.sortie ? x.sortie : (x.sorties ?? []).filter((y) => y.groupe === groupe && !!a.nom && meme(y.nom, a.nom)
          && (!a.debut || y.debut === a.debut)).at(0);
        if (!so) throw new Error('je ne trouve pas ce Buddy Time');
        const admin = x.groupe?.membres.find((b) => b.id === x.moi)?.role === 'admin';
        if (so.par && so.par !== x.moi && !admin) throw new Error('seul celui qui a créé le Buddy Time (ou un admin) peut le supprimer');
        supprimerSortie(so.id);
        faites.push({ genre: 'suppression', copie: so, texte: `🗑 Buddy Time « ${so.nom} » supprimé` });
      } else if (a.type === 'dispo') {
        const groupe = x.sortie?.groupe ?? d.groupe;
        const p = x.plannings.find((y) => y.groupe === groupe && (!a.nom || meme(y.nom, a.nom))) ;
        if (!p || !a.debut || !p.dates.some(([deb]) => deb === a.debut) || !a.etat) throw new Error('date hors du planning');
        const avant = p.dispos.find((y) => y.qui === x.moi && y.debut === a.debut);
        repondre(p.id, a.debut, a.etat, avant?.mot ?? '');
        faites.push({ genre: 'dispo', planning: p.id, debut: a.debut, avant: { etat: avant?.etat ?? '', mot: avant?.mot ?? '' },
          texte: `🗓 ${p.nom} · ${a.debut} : ${{ oui: 'oui', peut: 'peut-être', non: 'non' }[a.etat]}` });
      }
    } catch (e) { refus.push((e as Error).message); }
  }
  return { faites, refus };
}

/** « Annuler » sous la réponse de Bud : défait ce qu'il a fait, dans l'ordre inverse. */
export function annuler(faites: ActionBud[]) {
  for (const a of [...faites].reverse()) {
    if (a.genre === 'depense') retirerDepense(a.id);
    else if (a.genre === 'sortie') retirerSortie(a.id);
    else if (a.genre === 'suppression') remettreSortie(a.copie);
    else repondre(a.planning, a.debut, a.avant.etat, a.avant.mot);
  }
}

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
  return { texte: r.texte ?? '', hebergements: r.hebergements ?? [], point: r.point ?? null, actions: r.actions ?? [] };
}
