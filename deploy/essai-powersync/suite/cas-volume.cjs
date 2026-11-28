/**
 * Un gros compte : des centaines de messages avec réactions, des dizaines de sorties avec messages et dépenses.
 * PowerSync plafonne à 1000 « paquets » par personne : des règles qui en font un par message ou plusieurs par sortie
 * arrêtent toute la synchro du compte (trouvé par cette batterie, le 28 novembre). Ce cas le rejoue.
 */
const B = require('./banc.cjs');
const { js, vue, jusqua, vide, groupe, textes, rouvrir } = B;

module.exports = [
  { nom: 'Gros compte : 400 messages, 300 réactions, 90 sorties avec message et dépense, puis appli rouverte', delai: 420_000, f: async ({ seb, julie, marc, tous }) => {
    const g = await groupe(seb, [julie, marc]);
    await js(seb, (g) => { for (let i = 1; i <= 400; i++) window.S.envoyerMessage({ groupe: g }, { texte: `gros-${i}` }); }, g);
    await vide(seb, 120_000);
    await jusqua('400 messages chez Julie', async () => (await textes(julie, g)).length >= 400, 90_000);
    await js(julie, (g) => { const S = window.S; S.vue(S.lire()).messages.filter((m) => m.groupe === g).slice(0, 300).forEach((m) => S.reagir(m.id, '👍')); }, g);
    await vide(julie, 120_000);
    await js(seb, ([g, p]) => { const S = window.S; for (let i = 1; i <= 90; i++) {
      const s = S.creerSortie({ groupe: g, nom: `Sortie ${i}`, photo: null, debut: '2026-12-05', fin: '2026-12-05', lieu: '', participants: p });
      S.envoyerMessage({ sortie: s }, { texte: `dans la sortie ${i}` });
      S.enregistrerDepense({ sortie: s, titre: `Frais ${i}`, montant: 1000 + i, paye_par: S.lire().moi, pour: [S.lire().moi, ...p], jour: '2026-12-05' });
    } }, [g, [julie.id, marc.id]]);
    await vide(seb, 180_000);
    const compte = async (a) => { const v = await vue(a), e = await B.etat(a); return { sorties: v.sorties.filter((s) => s.groupe === g).length, reactions: v.messages.filter((m) => m.groupe === g && m.reactions.length).length, depenses: (e.depenses ?? []).filter((d) => /^Frais /.test(d.titre)).length }; };
    const attendu = (c) => c.sorties === 90 && c.reactions === 300 && c.depenses >= 90;
    for (const a of tous) await jusqua(`tout chez ${a.sub}`, async () => attendu(await compte(a)), 120_000);
    // Le vrai juge du plafond : une appli qui repart de zéro doit tout retrouver.
    await rouvrir(marc);
    await jusqua('tout chez Marc après réouverture', async () => attendu(await compte(marc)), 120_000);
    return '400 messages, 300 réactions, 90 sorties : tout arrive, y compris après réouverture';
  } },
];
