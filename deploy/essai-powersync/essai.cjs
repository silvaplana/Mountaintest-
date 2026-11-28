/**
 * Essai PowerSync, de bout en bout : de vrais navigateurs (un « appareil » = un contexte Chromium avec sa propre
 * base SQLite), le vrai serveur, le vrai service PowerSync. Lancer : voir README.md.
 *   node essai.cjs
 */
const { chromium } = require('playwright');
const { execSync } = require('node:child_process');
const crypto = require('node:crypto');

const PAGE = process.env.PAGE ?? 'http://localhost:5173/essai-powersync.html';
const compose = (c) => execSync(`docker compose ${c}`, { cwd: __dirname, stdio: 'pipe' }).toString();
const resultats = [];
let nav;

async function appareil(sub, n = '1') {
  const ctx = await nav.newContext();
  const a = { ctx, sub, n, nom: `${sub}#${n}` };
  await ouvrir(a);
  return a;
}
async function ouvrir(a) {
  a.page = await a.ctx.newPage();
  a.page.on('pageerror', (e) => console.log(`   [${a.nom}] erreur page : ${e.message.slice(0, 200)}`));
  await a.page.goto(`${PAGE}?sub=${a.sub}&appareil=${a.n}`);
  await a.page.waitForFunction(() => document.title === 'pret', null, { timeout: 30_000 });
}
const js = (a, f, arg) => a.page.evaluate(f, arg);
const voitures = (a) => js(a, () => window.essai.ps.lireVoitures());
const positions = (a) => js(a, () => window.essai.ps.lirePositions());
const enAttente = (a) => js(a, () => window.essai.enAttente());
async function sync(a, ops) {
  const r = await js(a, (ops) => window.essai.appel('POST', '/buddies/sync', { ops }), ops.map((o) => ({ id: crypto.randomUUID(), ...o })));
  if (r.refus.length) throw new Error('préparation refusée : ' + JSON.stringify(r.refus));
}
const garer = (a, lat, lon, t = Date.now()) => js(a, ([lat, lon, t]) => window.essai.ps.garer({ lat, lon }, t, t + 3600e3), [lat, lon, t]);
/** Attend qu'une condition soit vraie sur un appareil ; rend le temps mis (ms). */
async function jusqua(a, quoi, cond, delai = 20_000) {
  const t0 = Date.now();
  for (;;) {
    const v = await cond();
    if (v) return Date.now() - t0;
    if (Date.now() - t0 > delai) throw new Error(`${a.nom} : « ${quoi} » pas arrivé en ${delai} ms`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
const voit = (a, qui, lat) => jusqua(a, `voiture de ${qui.sub} à ${lat}`, async () => (await voitures(a)).some((v) => v.qui === qui.id && v.lat === lat));
const neVoitPlus = (a, qui) => jusqua(a, `plus de voiture de ${qui.sub}`, async () => !(await voitures(a)).some((v) => v.qui === qui.id));
const connecte = (a) => jusqua(a, 'connecté', () => js(a, () => window.essai.statut().connecte));

async function scenario(nom, f) {
  process.stdout.write(`▶ ${nom}\n`);
  try { const note = await f(); resultats.push({ nom, ok: true, note }); console.log(`  ✓ ${note ?? ''}`); }
  catch (e) { resultats.push({ nom, ok: false, note: e.message }); console.log(`  ✗ ${e.message}`); }
}

(async () => {
  nav = await chromium.launch();
  const suffixe = Date.now().toString(36); // des comptes neufs à chaque passage
  const seb = await appareil('seb' + suffixe), julie = await appareil('julie' + suffixe), marc = await appareil('marc' + suffixe);
  for (const a of [seb, julie, marc]) { await connecte(a); a.id = await js(a, () => window.essai.ps.quiSuisJe()); }

  // Seb et Julie dans le même groupe ; Marc n'est dans aucun groupe avec eux.
  const groupe = crypto.randomUUID(), code = 'Essai' + crypto.randomUUID().replaceAll('-', '').slice(0, 20);
  await sync(seb, [{ type: 'creer_groupe', groupe, nom: 'Essai PowerSync' },
    { type: 'inviter', groupe, invitation: crypto.randomUUID(), code, canal: 'lien', nom: 'Julie', contact: '' }]);
  await sync(julie, [{ type: 'rejoindre', code }]);

  await scenario('Deux appareils : Seb gare sa voiture, Julie la voit, Marc (hors du groupe) ne la voit jamais', async () => {
    await garer(seb, 43.1, 5.6);
    const ms = await voit(julie, seb, 43.1);
    await new Promise((r) => setTimeout(r, 1500));
    if ((await voitures(marc)).length) throw new Error('Marc voit une voiture qui ne le regarde pas');
    return `chez Julie en ${ms} ms`;
  });

  await scenario('Positions : Seb enfonce son épingle dans le groupe et bouge, Julie suit', async () => {
    const t = Date.now();
    await js(seb, ([g, t]) => window.essai.ps.epingle(g, true, t, t + 3600e3), [groupe, t]);
    await js(seb, ([g, t]) => window.essai.ps.position(g, { lat: 44.5, lon: 6.3, alt: 1800, t: t + 1 }), [groupe, t]);
    const ms = await jusqua(julie, 'position de Seb', async () => (await positions(julie)).some((p) => p.qui === seb.id && p.lat === 44.5 && p.alt === 1800));
    return `chez Julie en ${ms} ms`;
  });

  await scenario('Hors ligne puis retour : Julie gare sans réseau, ferme l\'appli, la rouvre, puis le réseau revient', async () => {
    await julie.ctx.setOffline(true);
    await garer(julie, 45.2, 6.7);
    if (!(await voitures(julie)).some((v) => v.qui === julie.id && v.lat === 45.2)) throw new Error('pas visible tout de suite chez Julie');
    await new Promise((r) => setTimeout(r, 2000));
    if ((await voitures(seb)).some((v) => v.qui === julie.id)) throw new Error('Seb la voit alors que Julie est hors ligne');
    // Appli fermée puis rouverte, toujours sans serveur (la page se recharge, le serveur et PowerSync restent coupés).
    await julie.page.close();
    await julie.ctx.route(/:(8000|8080)\//, (r) => r.abort());
    await julie.ctx.setOffline(false);
    await ouvrir(julie);
    if (!(await voitures(julie)).some((v) => v.qui === julie.id && v.lat === 45.2)) throw new Error('voiture perdue à la réouverture');
    const file = await enAttente(julie);
    if (!file) throw new Error('file d\'envoi perdue à la réouverture');
    await julie.ctx.unroute(/:(8000|8080)\//);
    const ms = await voit(seb, julie, 45.2);
    await jusqua(julie, 'file vide', async () => (await enAttente(julie)) === 0);
    return `gardée à la réouverture (${file} écritures en attente), chez Seb ${ms} ms après le retour du réseau`;
  });

  await scenario('Conflit : deux téléphones de Seb, l\'un hors ligne gare en premier, l\'autre gare après ; le plus récent gagne partout', async () => {
    const seb2 = await appareil(seb.sub, '2');
    await connecte(seb2); seb2.id = seb.id;
    await voit(seb2, seb, 43.1);
    await seb2.ctx.setOffline(true);
    const t = Date.now();
    await garer(seb2, 10.0, 10.0, t - 60_000);   // hors ligne, il y a une minute
    await garer(seb, 20.0, 20.0, t);             // en ligne, maintenant
    await voit(julie, seb, 20.0);
    await seb2.ctx.setOffline(false);            // le vieil envoi part : le serveur l'ignore
    const ms = await voit(seb2, seb, 20.0);
    await new Promise((r) => setTimeout(r, 1500));
    for (const a of [seb, seb2, julie]) {
      const v = (await voitures(a)).find((x) => x.qui === seb.id);
      if (v?.lat !== 20.0) throw new Error(`${a.nom} voit ${v?.lat} au lieu de 20`);
    }
    await seb2.ctx.close();
    return `l'appareil en retard s'est corrigé seul en ${ms} ms, les trois appareils d'accord`;
  });

  await scenario('Refus : une opération que le serveur refuse se défait toute seule sur le téléphone', async () => {
    const inconnu = crypto.randomUUID();
    const t = Date.now();
    await js(marc, ([g, t]) => window.essai.ps.epingle(g, true, t, t + 3600e3), [inconnu, t]); // Marc n'est pas de ce groupe
    if (!(await positions(marc)).length) throw new Error('pas visible tout de suite');
    const ms = await jusqua(marc, 'épingle refusée retirée', async () => (await positions(marc)).length === 0);
    return `épingle affichée puis retirée en ${ms} ms`;
  });

  await scenario('Reprise après coupure du service PowerSync : arrêté pendant une écriture, puis relancé', async () => {
    compose('stop powersync');
    await garer(seb, 30.0, 30.0);
    await new Promise((r) => setTimeout(r, 3000));
    if ((await voitures(julie)).some((v) => v.qui === seb.id && v.lat === 30.0)) throw new Error('Julie voit sans PowerSync ?');
    compose('start powersync');
    const ms = await voit(julie, seb, 30.0, 60_000);
    return `chez Julie ${ms} ms après la relance, sans rien toucher`;
  });

  await scenario('Reprise après coupure de Postgres : base redémarrée, la réplication reprend', async () => {
    compose('restart db');
    await new Promise((r) => setTimeout(r, 4000));
    let ok = false;
    for (let i = 0; i < 30 && !ok; i++) { try { await garer(seb, 31.0, 31.0); ok = true; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
    const ms = await jusqua(julie, 'voiture à 31', async () => (await voitures(julie)).some((v) => v.qui === seb.id && v.lat === 31.0), 90_000);
    return `chez Julie en ${ms} ms`;
  });

  await scenario('Droits : Julie quitte le groupe, la voiture et la position de Seb disparaissent de son téléphone', async () => {
    await sync(julie, [{ type: 'quitter', groupe }]);
    const ms = await neVoitPlus(julie, seb);
    await jusqua(julie, 'plus de position de Seb', async () => !(await positions(julie)).some((p) => p.qui === seb.id));
    if (!(await voitures(julie)).some((v) => v.qui === julie.id)) throw new Error('Julie a perdu sa propre voiture');
    return `retirées en ${ms} ms, sa propre voiture reste`;
  });

  await nav.close();
  const rates = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - rates.length}/${resultats.length} scénarios réussis`);
  process.exit(rates.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
