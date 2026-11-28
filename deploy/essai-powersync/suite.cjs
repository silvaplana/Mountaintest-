/**
 * La batterie de tests à trois téléphones (Seb, Julie, Marc), jouable sur les deux synchros :
 *   MODE=powersync node suite.cjs            la bêta (appli lancée avec VITE_POWERSYNC=1, port 5174)
 *   MODE=actuelle  node suite.cjs            la synchro de main (même appli sans le réglage, port 5176)
 *   node suite.cjs reseau                    seulement les cas dont le nom ou la famille contient « reseau »
 *   LOURD=1 node suite.cjs                   avec les cas qui redémarrent PowerSync, Postgres ou le serveur
 * Après chaque cas, le juge (`converge`) vérifie que chaque téléphone a exactement l'état que décrit le serveur.
 * Résultats : resultats-<mode>.json. Voir README.md pour lancer ce qu'il faut autour.
 */
const fs = require('node:fs');
const path = require('node:path');
const B = require('./suite/banc.cjs');

const filtre = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
const FAMILLES = ['fonctions', 'reseau', 'droits', 'hasard', 'lourd'];
const DELAI_CAS = 180_000;

(async () => {
  await B.demarrer();
  const tirage = Date.now().toString(36);
  let n = 0;
  const monde = async () => { n++; const [seb, julie, marc] = await Promise.all(['seb', 'julie', 'marc'].map((p) => B.telephone(`${p}${tirage}${n}`))); return { seb, julie, marc, tous: [seb, julie, marc] }; };
  let m = await monde();
  const resultats = [];
  for (const famille of FAMILLES) {
    const cas = require(`./suite/cas-${famille}.cjs`);
    for (const c of cas) {
      if (filtre && !filtre.test(`${famille} ${c.nom}`)) continue;
      if (c.lourd && !process.env.LOURD) continue;
      if (c.seulement && c.seulement !== B.MODE) { resultats.push({ famille, nom: c.nom, etat: 'sans objet' }); continue; }
      const t0 = Date.now();
      let note, erreur;
      try {
        note = await Promise.race([
          (async () => { const r = await c.f(m); for (const a of m.tous) await B.retablir(a); if (!c.sansJuge) await B.converge(m.tous); return r; })(),
          new Promise((_, non) => setTimeout(() => non(new Error(`cas trop long (${DELAI_CAS / 1000} s)`)), DELAI_CAS)),
        ]);
      } catch (e) { erreur = String(e.message ?? e) + '\n       ' + (await Promise.all(m.tous.map((a) => B.diagnostic(a)))).join('\n       '); }
      const ms = Date.now() - t0;
      resultats.push({ famille, nom: c.nom, etat: erreur ? 'échec' : 'réussi', ms, note: note ?? '', erreur });
      console.log(`${erreur ? '✗' : '✓'} [${famille}] ${c.nom}  (${(ms / 1000).toFixed(1)} s)${note ? `\n    ${note}` : ''}${erreur ? `\n    ${erreur}` : ''}`);
      // Après un échec, on repart de téléphones neufs : un cas raté ne doit pas en faire rater d'autres.
      if (erreur) { await Promise.all(m.tous.map((a) => B.jeter(a))); m = await monde(); }
    }
  }
  await B.arreter();
  const joues = resultats.filter((r) => r.etat !== 'sans objet');
  const rates = joues.filter((r) => r.etat === 'échec');
  console.log(`\n${B.MODE} : ${joues.length - rates.length}/${joues.length} cas réussis`);
  if (!filtre) fs.writeFileSync(path.join(__dirname, `resultats-${B.MODE}.json`), JSON.stringify({ mode: B.MODE, quand: new Date().toISOString(), resultats }, null, 1));
  process.exit(rates.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
