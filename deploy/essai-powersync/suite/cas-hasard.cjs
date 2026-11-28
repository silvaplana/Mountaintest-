/**
 * Tirages au hasard : trois téléphones font des dizaines d'actions tirées au sort pendant que leur réseau tombe,
 * ralentit, revient, et que l'appli est tuée. À la fin tout est rétabli, et le juge vérifie que chacun a exactement
 * l'état du serveur. Le tirage est rejouable : GRAINE=1234 node suite.cjs hasard
 */
const B = require('./banc.cjs');
const { js, etat, vue, jusqua, vide, groupe, textes, avion, couper, retablir, lent, instable, rouvrir, attendre } = B;

function hasard(graine) { let a = graine >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Une action tirée au sort, jouée dans l'appli avec ce que CE téléphone connaît à cet instant. */
const action = (a, g, s, tirage, n) => js(a, ([g, s, r, n, nom]) => {
  const S = window.S, e = S.lire(), v = S.vue(e), moi = e.moi;
  const choisir = (l) => l[Math.floor(r[1] * l.length)];
  const ms = v.messages.filter((m) => m.groupe === g && !m.supprime);
  const miens = ms.filter((m) => m.par === moi && m.nature === 'texte');
  const membres = (S.appliquer(e).find((x) => x.id === g)?.membres ?? []).map((b) => b.id);
  const deps = (e.depenses ?? []).filter((d) => d.sortie === s && !d.remb);
  const k = Math.floor(r[0] * 14);
  if (k <= 3) return S.envoyerMessage({ groupe: g }, { texte: `${nom}-${n}` }) && `message ${nom}-${n}`;
  if (k === 4 && ms.length) { const m = choisir(ms); S.reagir(m.id, r[2] < 0.3 ? null : choisir(['👍', '🔥', '😂'])); return 'réaction'; }
  if (k === 5 && miens.length) { const m = choisir(miens); S.modifierMessage(m.id, `${m.texte.split(' (')[0]} (modifié ${n})`); return 'modification'; }
  if (k === 6 && miens.length > 2) { S.retirerMessage(choisir(miens).id); return 'suppression de message'; }
  if (k === 7 && membres.length) { S.enregistrerDepense({ sortie: s, titre: `Dépense ${nom}-${n}`, montant: 100 + Math.floor(r[2] * 9000), paye_par: moi, pour: membres.filter((_x, i) => i === 0 || r[2] > 0.3), jour: '2026-12-05' }); return 'dépense'; }
  if (k === 8 && deps.length) { const d = choisir(deps); if (r[2] < 0.4) S.retirerDepense(d.id); else S.enregistrerDepense({ depense: d.id, sortie: s, titre: d.titre, montant: d.montant + 100, paye_par: d.paye_par, pour: d.pour, jour: d.jour }); return 'dépense modifiée ou retirée'; }
  if (k === 9) { S.renommerSortie(s, `Sortie ${nom}-${n}`); return 'sortie renommée'; }
  if (k === 10) { if (r[2] < 0.6) S.garerVoiture({ lat: 44 + r[1], lon: 6 + r[2] }); else S.enleverVoiture(); return 'voiture'; }
  if (k === 11) { if (!S.monEpingle()) S.enfoncerEpingle([{ groupe: g }]); S.envoyerPosition({ lat: 44 + r[1], lon: 6 + r[2], alt: 1500, t: S.heureServeur() }); return 'position'; }
  if (k === 12) { S.enregistrerCarnet(s, { recit: `Récit de ${nom}, version ${n}` }); return 'récit'; }
  if (k === 13 && e.plannings.length) { S.repondre(e.plannings[0].id, e.plannings[0].dates[0][0], choisir(['oui', 'peut', 'non']), `mot ${n}`); return 'réponse au planning'; }
  return S.envoyerMessage({ groupe: g }, { texte: `${nom}-${n}` }) && `message ${nom}-${n}`;
}, [g, s, [tirage(), tirage(), tirage()], n, a.sub.slice(0, 3)]);

async function tirage(m, graine, etapes) {
  const { seb, julie, marc, tous } = m;
  const r = hasard(graine);
  const g = await groupe(seb, [julie, marc], `Hasard ${graine}`);
  const s = await js(seb, ([g, p]) => window.S.creerSortie({ groupe: g, nom: 'Sortie au hasard', photo: null, debut: '2026-12-05', fin: '2026-12-06', lieu: '', participants: p }), [g, [julie.id, marc.id]]);
  await js(seb, (g) => window.S.creerPlanning({ groupe: g, nom: 'Hasard', dates: [['2026-12-12', '2026-12-13']], limite: '2026-12-10' }), g);
  for (const a of tous) await jusqua(`sortie et planning chez ${a.sub}`, async () => (await vue(a)).sorties.some((x) => x.id === s) && (await etat(a)).plannings.some((p) => p.groupe === g));
  const journal = [];
  const enAvion = new Set();
  for (let n = 1; n <= etapes; n++) {
    const a = tous[Math.floor(r() * 3)];
    const p = r();
    // Une étape sur cinq touche au réseau ou tue l'appli.
    if (p < 0.05) { if (enAvion.has(a)) { await avion(a, false); enAvion.delete(a); journal.push(`${a.sub}: fin du mode avion`); } else { await avion(a, true); enAvion.add(a); journal.push(`${a.sub}: mode avion`); } }
    else if (p < 0.09 && !enAvion.has(a)) { couper(a, r() < 0.5 ? 'flux' : 'api'); journal.push(`${a.sub}: coupure partielle`); }
    else if (p < 0.12 && !enAvion.has(a)) { lent(a, 300 + Math.floor(r() * 900)); journal.push(`${a.sub}: réseau lent`); }
    else if (p < 0.15 && !enAvion.has(a)) { instable(a, 0.5); journal.push(`${a.sub}: réseau instable`); }
    else if (p < 0.18 && !enAvion.has(a)) { await retablir(a); journal.push(`${a.sub}: réseau rétabli`); }
    else if (p < 0.21) { if (enAvion.has(a)) { await B.fermer(a); await B.ouvrirEnAvion(a); } else await rouvrir(a); journal.push(`${a.sub}: appli tuée et rouverte`); }
    else journal.push(`${a.sub}: ${await action(a, g, s, r, n)}`);
    if (r() < 0.3) await attendre(Math.floor(r() * 400));
  }
  for (const a of tous) { enAvion.delete(a); await retablir(a); }
  try {
    for (const a of tous) await vide(a, 90_000);
    // Mêmes messages, dans le même ordre, sans doublon, chez les trois.
    let fils;
    await jusqua('le même fil chez les trois', async () => { fils = await Promise.all(tous.map((a) => textes(a, g))); return fils.every((l) => l.join('|') === fils[0].join('|')); }, 60_000);
    const dits = fils[0].filter((t) => t);  // un message supprimé n'a plus de texte
    if (new Set(dits).size !== dits.length) throw new Error(`doublons dans le fil : ${dits.filter((t, i) => dits.indexOf(t) !== i).join(', ')}`);
    await B.converge(tous, 60_000);
    return `graine ${graine} : ${etapes} étapes, ${fils[0].length} messages au bout, ${journal.filter((x) => /avion|coupure|lent|instable|tuée/.test(x)).length} incidents de réseau`;
  } catch (e) {
    throw new Error(`${e.message}\n       graine ${graine}, dernières étapes : ${journal.slice(-12).join(' ; ')}`);
  }
}

const GRAINES = process.env.GRAINE ? [Number(process.env.GRAINE)] : [11, 23, 37, 41, 53];
module.exports = GRAINES.map((graine) => ({ nom: `Tirage au hasard n° ${graine} : 120 actions et incidents`, f: (m) => tirage(m, graine, 120) }));
