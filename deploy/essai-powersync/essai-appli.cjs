/**
 * Bêta PowerSync : la VRAIE appli (store.ts, VITE_POWERSYNC=1), deux « téléphones » Chromium, le vrai serveur.
 * À la fin, l'état lu dans SQLite est comparé, champ par champ, à ce que répond l'ancienne synchro
 * (POST /buddies/sync) pour la même personne : les deux doivent dire la même chose.
 *   (cd ../../capacitor && VITE_POWERSYNC=1 VITE_API_URL=http://localhost:8000 npx vite --port 5174)
 *   node essai-appli.cjs
 */
const { chromium } = require('playwright');
const crypto = require('node:crypto');

const PAGE = process.env.PAGE ?? 'http://localhost:5174/';
const API = process.env.API ?? 'http://localhost:8000';
const resultats = [];
let nav;

async function telephone(sub) {
  const jeton = (await (await fetch(`${API}/essai/jeton?sub=${sub}`)).json()).jeton;
  const ctx = await nav.newContext();
  const compte = { refresh: 'essai', access: jeton, accessExp: Date.now() + 3500e3, config: { logto: API, ressource: 'x', appId: 'x' },
    profil: { id: '', email: `${sub}@exemple.test`, pseudo: sub, photo: null } };
  await ctx.addInitScript((c) => { if (!localStorage.getItem('compte')) localStorage.setItem('compte', c); localStorage.setItem('accueil-vu', '1'); }, JSON.stringify(compte));
  const a = { ctx, sub, jeton };
  await ouvrir(a);
  return a;
}
async function ouvrir(a) {
  a.page = await a.ctx.newPage();
  a.page.on('pageerror', (e) => console.log(`   [${a.sub}] erreur page : ${e.message.slice(0, 300)}`));
  await a.page.goto(PAGE);
  await a.page.waitForFunction(async () => { window.S = await import('/src/buddies/store.ts'); window.P = await import('/src/buddies/powersyncEtat.ts'); return true; }, null, { timeout: 60_000 });
}
const js = (a, f, arg) => a.page.evaluate(f, arg);
const etat = (a) => js(a, () => window.S.lire());
const vue = (a) => js(a, () => { const e = window.S.lire(); const v = window.S.vue(e); return { groupes: window.S.appliquer(e), sorties: v.sorties, messages: v.messages, attente: e.attente.length, moi: e.moi }; });
async function jusqua(quoi, cond, delai = 20_000) {
  const t0 = Date.now();
  for (;;) {
    const v = await cond();
    if (v) return Date.now() - t0;
    if (Date.now() - t0 > delai) throw new Error(`« ${quoi} » pas arrivé en ${delai} ms`);
    await new Promise((r) => setTimeout(r, 30));
  }
}
const vide = (a) => jusqua(`file de ${a.sub} vide`, async () => (await etat(a)).attente.length === 0);
async function scenario(nom, f) {
  console.log(`▶ ${nom}`);
  try { const note = await f(); resultats.push({ nom, ok: true }); console.log(`  ✓ ${note ?? ''}`); }
  catch (e) { resultats.push({ nom, ok: false }); console.log(`  ✗ ${e.message}`); }
}

// ------------------------------------------------------------------ comparaison avec l'ancienne synchro
const date = (x) => (typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(x) && /(Z|[+-]\d\d:\d\d)$/.test(x) ? Date.parse(x) : x);
function normal(x, cle = '') {
  if (Array.isArray(x)) { const l = x.map((y) => normal(y, cle)); return ['ligne', 'dates', 'options'].includes(cle) ? l : l.sort((p, q) => JSON.stringify(p).localeCompare(JSON.stringify(q))); }
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).filter((k) => !['organisation', 'vu_le', 'attente'].includes(k) && x[k] !== undefined).sort().map((k) => [k, normal(x[k], k)]));
  return date(x);
}
function differences(a, b, chemin, sortie = []) {
  if (sortie.length > 12) return sortie;
  if (JSON.stringify(a) === JSON.stringify(b)) return sortie;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) differences(a[k], b[k], `${chemin}.${k}`, sortie);
  } else sortie.push(`${chemin} : SQLite ${JSON.stringify(a)?.slice(0, 80)} ≠ ancienne synchro ${JSON.stringify(b)?.slice(0, 80)}`);
  return sortie;
}
async function comparer(a) {
  const r = await (await fetch(`${API}/buddies/sync`, { method: 'POST', headers: { Authorization: `Bearer ${a.jeton}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: [] }) })).json();
  const e = await etat(a);
  const champs = { serveur: r.groupes, sorties: r.sorties, traces: r.traces, plannings: r.plannings, photos: r.photos, counts: r.counts,
    depenses: r.depenses.map((d) => (d.count ? { ...d, sortie: d.count } : d)), hebergements: r.hebergements, messages: r.messages,
    positions: r.positions, voitures: r.voitures, appels: r.appels, bloques: r.bloques, lectures: r.lectures };
  const diff = [];
  for (const [k, attendu] of Object.entries(champs)) differences(normal(e[k] ?? []), normal(attendu), k, diff);
  if (diff.length) throw new Error(`${a.sub} : ${diff.length} écarts\n     ` + diff.join('\n     '));
  return Object.entries(champs).map(([k, v]) => `${v.length} ${k}`).join(', ');
}

(async () => {
  nav = await chromium.launch();
  const suffixe = Date.now().toString(36);
  const seb = await telephone('seb' + suffixe), julie = await telephone('julie' + suffixe);
  let groupe, sortie, code;

  await scenario('Groupe : Seb crée un groupe et invite, Julie rejoint par le lien, chacun voit les deux membres', async () => {
    code = await js(seb, () => window.S.nouveauCode());
    groupe = await js(seb, (code) => window.S.creerGroupe('Essai bêta', null, [{ canal: 'lien', nom: 'Julie', contact: '', code }]), code);
    await vide(seb);
    await js(julie, (code) => window.S.rejoindre(code), code);
    const ms = await jusqua('2 membres chez Seb', async () => (await vue(seb)).groupes.find((g) => g.id === groupe)?.membres.length === 2);
    await jusqua('2 membres chez Julie', async () => (await vue(julie)).groupes.find((g) => g.id === groupe)?.membres.length === 2);
    seb.id = (await etat(seb)).moi; julie.id = (await etat(julie)).moi;
    return `Julie apparaît chez Seb en ${ms} ms`;
  });

  await scenario('Messagerie : un message de Seb arrive chez Julie ; chez Seb il ne disparaît jamais entre l\'envoi et le retour', async () => {
    // Chez Seb, on regarde à chaque changement d'état si le message est à l'écran.
    await js(seb, () => { window.trous = 0; window.vuUneFois = false; window.S.suivre((e) => {
      const la = window.S.vue(e).messages.some((m) => m.texte === 'Salut Julie'); if (la) window.vuUneFois = true; else if (window.vuUneFois) window.trous++; }); });
    await js(seb, (g) => window.S.envoyerMessage({ groupe: g }, { texte: 'Salut Julie' }), groupe);
    const ms = await jusqua('message chez Julie', async () => (await vue(julie)).messages.some((m) => m.texte === 'Salut Julie'));
    await vide(seb);
    const trous = await js(seb, () => window.trous);
    if (trous) throw new Error(`le message a disparu ${trous} fois chez Seb`);
    return `chez Julie en ${ms} ms, aucun trou chez Seb`;
  });

  await scenario('Réponse, réaction, sondage et vote', async () => {
    const m = (await vue(julie)).messages.find((x) => x.texte === 'Salut Julie');
    await js(julie, ([g, id]) => { window.S.envoyerMessage({ groupe: g }, { texte: 'Salut Seb', repond_a: id }); window.S.reagir(id, '👍'); }, [groupe, m.id]);
    const sondage = await js(seb, (g) => window.S.envoyerMessage({ groupe: g }, { nature: 'sondage', sondage: { question: 'Samedi ?', multiple: false, options: ['Oui', 'Non'] } }), groupe);
    await jusqua('sondage chez Julie', async () => (await vue(julie)).messages.some((x) => x.id === sondage));
    await js(julie, (id) => window.S.voter(id, [0]), sondage);
    await jusqua('réaction et vote chez Seb', async () => { const l = (await vue(seb)).messages; return l.find((x) => x.id === m.id)?.reactions?.length === 1 && l.find((x) => x.id === sondage)?.sondage?.votes.length === 1; });
  });

  await scenario('Sortie, hébergement, dépense, planning et dispo, carnet, trace partagée', async () => {
    sortie = await js(seb, ([g, j]) => window.S.creerSortie({ groupe: g, nom: 'Dôme des Écrins', photo: null, debut: '2026-12-05', fin: '2026-12-06', lieu: 'Ailefroide', participants: [j] }), [groupe, julie.id]);
    await jusqua('sortie chez Julie', async () => (await vue(julie)).sorties.some((s) => s.id === sortie && s.participants.length === 2));
    await js(julie, (s) => window.S.proposerHebergement([s], { nom: 'Refuge', nature: 'refuge', prix_nuit: 30, adresse: 'Ailefroide', url: '', resume: '', lon: 6.4, lat: 44.9 }), sortie);
    await js(seb, ([s, moi, j]) => window.S.enregistrerDepense({ sortie: s, titre: 'Essence', montant: 4200, paye_par: moi, pour: [moi, j], jour: '2026-12-05' }), [sortie, seb.id, julie.id]);
    const planning = await js(seb, (g) => window.S.creerPlanning({ groupe: g, nom: 'Hiver', dates: [['2026-12-12', '2026-12-13'], ['2026-12-19', '2026-12-20']], limite: '2026-12-10' }), groupe);
    await jusqua('planning chez Julie', async () => (await etat(julie)).plannings.some((p) => p.id === planning));
    await js(julie, (p) => window.S.repondre(p, '2026-12-12', 'oui', 'Chaud !'), planning);
    await js(julie, (s) => window.S.enregistrerCarnet(s, { recit: 'Belle neige.', carnet: { difficulte: 'PD', meteo: 'Grand beau', conditions: 'Poudreuse' } }), sortie);
    await js(seb, (s) => window.S.partagerTrace('Montée', [[6.4, 44.9], [6.41, 44.91]], 'Par le glacier', { sorties: [s], groupes: [] }), sortie);
    await vide(seb); await vide(julie);
    await jusqua('tout chez Seb', async () => { const e = await etat(seb); return e.hebergements?.length === 1 && e.plannings[0]?.dispos.length === 1 && e.sorties[0]?.carnet?.recits.length === 1; });
    await jusqua('tout chez Julie', async () => { const e = await etat(julie); return e.depenses?.length === 1 && e.traces.length === 1; });
  });

  await scenario('Voiture garée et position partagée', async () => {
    await js(seb, () => window.S.garerVoiture({ lat: 44.92, lon: 6.41 }));
    await js(seb, (g) => { window.S.enfoncerEpingle([{ groupe: g }]); window.S.envoyerPosition({ lat: 44.93, lon: 6.42, alt: 1900, t: window.S.heureServeur() }); }, groupe);
    const ms = await jusqua('voiture et position chez Julie', async () => { const e = await etat(julie); return e.voitures?.some((v) => v.lat === 44.92) && e.positions?.some((p) => p.lat === 44.93); });
    return `chez Julie en ${ms} ms`;
  });

  await scenario('Hors ligne : Julie écrit 3 messages sans réseau, ferme et rouvre l\'appli, le réseau revient, Seb les reçoit dans l\'ordre', async () => {
    await julie.ctx.setOffline(true);
    for (const t of ['un', 'deux', 'trois']) await js(julie, ([g, t]) => window.S.envoyerMessage({ groupe: g }, { texte: t }), [groupe, t]);
    if ((await vue(julie)).messages.filter((m) => ['un', 'deux', 'trois'].includes(m.texte)).length !== 3) throw new Error('pas visibles tout de suite');
    await new Promise((r) => setTimeout(r, 1500));
    await julie.page.close();
    await julie.ctx.route(/:(8000|8080)\//, (r) => r.abort());
    await julie.ctx.setOffline(false);
    await ouvrir(julie);
    await jusqua('messages gardés à la réouverture', async () => (await vue(julie)).messages.filter((m) => ['un', 'deux', 'trois'].includes(m.texte)).length === 3, 10_000);
    if ((await vue(seb)).messages.some((m) => ['un', 'deux', 'trois'].includes(m.texte))) throw new Error('Seb a reçu des messages alors que Julie est sans réseau');
    await julie.ctx.unroute(/:(8000|8080)\//);
    await js(julie, () => window.S.synchroniser().catch(() => undefined));
    await jusqua("3 messages chez Seb", async () => (await vue(seb)).messages.filter((m) => ['un', 'deux', 'trois'].includes(m.texte)).length === 3, 30_000);
    const ordre = (await vue(seb)).messages.filter((m) => ['un', 'deux', 'trois'].includes(m.texte)).map((m) => m.texte).join(' ');
    if (ordre !== 'un deux trois') throw new Error(`ordre : ${ordre}`);
    await vide(julie);
    return 'gardés à la réouverture, reçus dans l\'ordre au retour du réseau';
  });

  await scenario('Même état que l\'ancienne synchro, champ par champ, pour Seb et pour Julie', async () => {
    await new Promise((r) => setTimeout(r, 1500));
    return `Seb : ${await comparer(seb)} ; Julie : ${await comparer(julie)}`;
  });

  await scenario('Droits : Julie quitte le groupe, tout ce qui est du groupe disparaît de son téléphone', async () => {
    await js(julie, (g) => window.S.quitter(g), groupe).catch(async () => js(julie, (g) => window.S.quitterGroupe(g), groupe));
    const ms = await jusqua('plus rien chez Julie', async () => { const e = await etat(julie); return !e.serveur.some((g) => g.id === groupe) && !(e.messages ?? []).length && !e.plannings.length; });
    await jusqua('1 membre chez Seb', async () => (await vue(seb)).groupes.find((g) => g.id === groupe)?.membres.length === 1);
    return `retiré en ${ms} ms`;
  });

  await nav.close();
  const rates = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - rates.length}/${resultats.length} scénarios réussis`);
  process.exit(rates.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
