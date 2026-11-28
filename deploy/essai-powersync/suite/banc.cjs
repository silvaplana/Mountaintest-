/**
 * Banc d'essai à plusieurs téléphones : la VRAIE appli (store.ts, VITE_POWERSYNC=1) dans des Chromium, le vrai serveur,
 * le vrai PowerSync. Chaque téléphone a SON réseau : un relais par lequel passe tout ce qu'il échange, et qu'on peut
 * couper, ralentir, rendre instable, ou faire mentir (réponse perdue, erreur du serveur).
 */
const { chromium } = require('playwright');
const http = require('node:http');
const net = require('node:net');

/** « powersync » (la bêta) ou « actuelle » (la synchro de main : même appli, sans le réglage VITE_POWERSYNC). */
const MODE = process.env.MODE ?? 'powersync';
const PAGE = process.env.PAGE ?? (MODE === 'powersync' ? 'http://localhost:5174/' : 'http://localhost:5176/');
const API = process.env.API ?? 'http://localhost:8000';
const PORT_API = Number(new URL(API).port);
const PORT_FLUX = Number(process.env.PORT_FLUX ?? 8080);
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
let nav;

// ------------------------------------------------------------------ le réseau d'un téléphone

/** Un relais HTTP par téléphone. `service` : « api » (serveur Python), « flux » (PowerSync), « page » (l'appli, jamais coupée). */
function relais() {
  const r = { coupe: new Set(), latence: 0, instable: 0, regles: [], vus: [], prises: new Map() };
  // Le « flux » : ce qui apporte les changements des autres (PowerSync, ou le canal d'événements de la synchro actuelle).
  const service = (port, chemin) => (port === PORT_FLUX || (port === PORT_API && chemin.startsWith('/buddies/evenements')) ? 'flux' : port === PORT_API ? 'api' : 'page');
  const srv = http.createServer((q, rep) => {
    let u;
    try { u = new URL(q.url); } catch { rep.writeHead(400).end(); return; }
    const s = service(Number(u.port || 80), u.pathname);
    r.prises.set(q.socket, s);
    if (s !== 'page') r.vus.push(`${q.method} ${u.pathname}`);
    if (r.coupe.has(s)) { q.socket.destroy(); return; }
    const regle = s === 'page' ? undefined : r.regles.find((x) => x.reste > 0 && x.quoi.test(`${q.method} ${u.pathname}`));
    if (regle) regle.reste--;
    if (regle?.statut) { q.resume(); rep.writeHead(regle.statut, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }).end('{"detail":"panne simulée"}'); return; }
    const corps = [];
    q.on('data', (c) => corps.push(c));
    q.on('end', async () => {
      if (s !== 'page' && r.latence) await attendre(r.latence);
      if (r.coupe.has(s) || q.socket.destroyed) { q.socket.destroy(); return; }
      const p = http.request({ host: '127.0.0.1', port: u.port || 80, path: u.pathname + u.search, method: q.method, headers: q.headers }, async (x) => {
        // Réponse perdue : le serveur a fait le travail, le téléphone ne le saura pas.
        if (regle?.perdre) { x.resume(); x.on('end', () => q.socket.destroy()); return; }
        if (s !== 'page' && r.latence) await attendre(r.latence);
        if (q.socket.destroyed) { p.destroy(); return; }
        rep.writeHead(x.statusCode, x.headers);
        x.pipe(rep);
        // Réseau instable : la connexion tombe au bout d'un moment, au hasard.
        if (s !== 'page' && r.instable && Math.random() < r.instable) setTimeout(() => q.socket.destroy(), 100 + Math.random() * 1500);
      });
      p.on('error', () => q.socket.destroy());
      rep.on('close', () => { if (!rep.writableFinished) p.destroy(); });
      p.end(Buffer.concat(corps));
    });
  });
  // Les WebSocket de vite (rechargement à chaud) : un tunnel, sans intérêt pour l'essai.
  srv.on('connect', (q, prise) => {
    const [h, port] = q.url.split(':');
    const t = net.connect(Number(port), h === 'localhost' ? '127.0.0.1' : h, () => { prise.write('HTTP/1.1 200 OK\r\n\r\n'); t.pipe(prise); prise.pipe(t); });
    t.on('error', () => prise.destroy()); prise.on('error', () => t.destroy());
  });
  r.couper = (...services) => { for (const s of services) r.coupe.add(s); for (const [prise, s] of r.prises) if (r.coupe.has(s)) { prise.destroy(); r.prises.delete(prise); } };
  r.retablir = () => { r.coupe.clear(); r.latence = 0; r.instable = 0; r.regles = []; };
  r.fermer = () => { for (const prise of r.prises.keys()) prise.destroy(); srv.close(); };
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => { r.port = srv.address().port; ok(r); }));
}

// ------------------------------------------------------------------ un téléphone

async function demarrer() { nav = await chromium.launch({ proxy: { server: 'http://per-context' } }); }
async function arreter() { await nav?.close(); }

async function jetonEssai(sub) { return (await (await fetch(`${API}/essai/jeton?sub=${sub}`)).json()).jeton; }

/** Un téléphone neuf, connecté au compte `sub` (créé au premier appel du serveur). */
async function telephone(sub, { ouvert = true } = {}) {
  const r = await relais();
  const ctx = await nav.newContext({ proxy: { server: `http://127.0.0.1:${r.port}`, bypass: '<-loopback>' } });
  const a = { ctx, sub, reseau: r, erreurs: [] };
  await connecter(a, sub);
  if (ouvert) await ouvrir(a);
  return a;
}
/** Pose le compte dans le téléphone (comme après la page de connexion). */
async function connecter(a, sub) {
  a.sub = sub;
  a.jeton = await jetonEssai(sub);
  const compte = { refresh: 'essai', access: a.jeton, accessExp: Date.now() + 3500e3, config: { logto: API, ressource: 'x', appId: 'x' },
    profil: { id: '', email: `${sub}@exemple.test`, pseudo: sub, photo: null } };
  a.compte = JSON.stringify(compte);
  await a.ctx.addInitScript((c) => { if (!localStorage.getItem('compte') && !localStorage.getItem('essai-deconnecte')) localStorage.setItem('compte', c); localStorage.setItem('accueil-vu', '1'); }, a.compte);
}
/** Ouvre (ou rouvre) l'appli. Les modules sont ceux que l'appli a chargés elle-même : une seule instance du store. */
async function ouvrir(a) {
  a.page = await a.ctx.newPage();
  a.page.on('pageerror', (e) => a.erreurs.push(e.message.slice(0, 300)));
  await a.page.goto(PAGE);
  await a.page.waitForFunction(async () => {
    const vus = performance.getEntriesByType('resource').map((r) => r.name);
    const de = (nom) => vus.find((n) => n.includes(nom)) ?? nom;
    window.S = await import(de('/src/buddies/store.ts'));
    window.P = await import(de('/src/buddies/powersyncEtat.ts'));
    window.C = await import(de('/src/config.ts'));
    return true;
  }, null, { timeout: 60_000 });
}
async function fermer(a) { await a.page?.close(); a.page = null; }
/** Rouvre l'appli en mode avion : la page elle-même se charge (sur un téléphone elle est dans l'appli), le réseau non. */
async function ouvrirEnAvion(a) { a.reseau.couper('api', 'flux'); await a.ctx.setOffline(false); await ouvrir(a); await a.ctx.setOffline(true); }
/** Où en est un téléphone, pour comprendre un échec. */
async function diagnostic(a) {
  if (!a.page) return `${a.sub} : appli fermée`;
  try {
    const e = await etat(a);
    const crud = MODE === 'powersync' ? await sql(a, 'SELECT count(*) AS n FROM ps_crud').then((l) => l[0].n, () => '?') : '-';
    const st = MODE === 'powersync' ? await js(a, () => { const s = window.P.laBase()?.currentStatus; return s ? `connecté ${s.connected}, envoi ${!!s.dataFlowStatus?.uploading}, erreur ${String(s.dataFlowStatus?.uploadError ?? s.dataFlowStatus?.downloadError ?? '').slice(0, 120)}` : 'pas de base'; }) : '';
    return `${a.sub} : ${e.attente.length} en attente (${[...new Set(e.attente.map((o) => o.type))].join(',')}), file PowerSync ${crud}, ${st}, dernières requêtes ${a.reseau.vus.slice(-4).join(' | ')}${MODE === 'powersync' ? ' ; file ' + JSON.stringify(await js(a, () => { const f = window.P._file(); const att = window.S.lire().attente.map((o) => o.id); return { ...f, posees: f.posees.length, parties: f.parties.length, attentePosees: att.filter((i) => f.posees.includes(i)).length, attenteParties: att.filter((i) => f.parties.includes(i)).length }; })) : ''}`;
  } catch (x) { return `${a.sub} : ${String(x.message).slice(0, 150)}`; }
}
/** L'appli est tuée puis relancée (le stockage du téléphone reste). */
async function rouvrir(a) { await fermer(a); await ouvrir(a); }
async function jeter(a) { await a.ctx.close().catch(() => undefined); a.reseau.fermer(); }

const js = (a, f, arg) => a.page.evaluate(f, arg);
const etat = (a) => js(a, () => window.S.lire());
/** Ce que les écrans montrent : état du serveur + ce qui attend. */
const vue = (a) => js(a, () => { const e = window.S.lire(); const v = window.S.vue(e); return { groupes: window.S.appliquer(e), sorties: v.sorties, messages: v.messages, attente: e.attente.length, moi: e.moi }; });
/** Lecture directe de la base SQLite du téléphone. */
const sql = (a, requete, params = []) => js(a, ([q, p]) => window.P.laBase().getAll(q, p), [requete, params]);

async function jusqua(quoi, cond, delai = 20_000) {
  const t0 = Date.now();
  let dernier;
  for (;;) {
    try { const v = await cond(); if (v) return Date.now() - t0; dernier = undefined; } catch (e) { dernier = e; }
    if (Date.now() - t0 > delai) throw new Error(`« ${quoi} » pas arrivé en ${delai} ms${dernier ? ` (${String(dernier.message).slice(0, 200)})` : ''}`);
    await attendre(40);
  }
}
const vide = (a, delai = 20_000) => jusqua(`file de ${a.sub} vide`, async () => (await etat(a)).attente.length === 0, delai);

// ------------------------------------------------------------------ pannes

/** Mode avion : le téléphone SAIT qu'il n'a pas de réseau. */
async function avion(a, oui) { if (oui) a.reseau.couper('api', 'flux'); else a.reseau.retablir(); await a.ctx.setOffline(oui); if (!oui && a.page) await js(a, () => window.S.synchroniser().catch(() => undefined)); }
/** Réseau mort sans que le téléphone le sache (wifi sans internet, tunnel). */
function couper(a, ...services) { a.reseau.couper(...(services.length ? services : ['api', 'flux'])); }
async function retablir(a) { a.reseau.retablir(); await a.ctx.setOffline(false); if (a.page) await js(a, () => window.S.synchroniser().catch(() => undefined)).catch(() => undefined); }
const lent = (a, ms) => { a.reseau.latence = ms; };
const instable = (a, proba) => { a.reseau.instable = proba; };
/** Les `n` prochaines requêtes qui correspondent : le serveur travaille, la réponse se perd. */
const perdreReponse = (a, quoi, n = 1) => a.reseau.regles.push({ quoi, reste: n, perdre: true });
/** Les `n` prochaines requêtes qui correspondent reçoivent une erreur, sans atteindre le serveur. */
const panne = (a, quoi, statut = 503, n = 1) => a.reseau.regles.push({ quoi, reste: n, statut });

// ------------------------------------------------------------------ l'ancienne synchro comme juge

const date = (x) => (typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(x) && /(Z|[+-]\d\d:\d\d)$/.test(x) ? Date.parse(x) : x);
function normal(x, cle = '') {
  if (Array.isArray(x)) { const l = x.map((y) => normal(y, cle)); return ['ligne', 'dates', 'options'].includes(cle) ? l : l.sort((p, q) => JSON.stringify(p).localeCompare(JSON.stringify(q))); }
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).filter((k) => !['organisation', 'vu_le', 'attente'].includes(k) && x[k] !== undefined).sort().map((k) => [k, normal(x[k], k)]));
  return date(x);
}
function differences(a, b, chemin, sortie = []) {
  if (sortie.length > 8) return sortie;
  if (JSON.stringify(a) === JSON.stringify(b)) return sortie;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) differences(a[k], b[k], `${chemin}.${k}`, sortie);
  } else sortie.push(`${chemin} : téléphone ${JSON.stringify(a)?.slice(0, 90)} ≠ serveur ${JSON.stringify(b)?.slice(0, 90)}`);
  return sortie;
}
/** Ce que l'ancienne synchro (POST /buddies/sync, sans curseur) répond pour ce compte : la vérité du serveur. */
async function verite(a) {
  const r = await (await fetch(`${API}/buddies/sync`, { method: 'POST', headers: { Authorization: `Bearer ${a.jeton}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: [] }) })).json();
  return { serveur: r.groupes, sorties: r.sorties, traces: r.traces, plannings: r.plannings, photos: r.photos, counts: r.counts,
    depenses: r.depenses.map((d) => (d.count ? { ...d, sortie: d.count } : d)), hebergements: r.hebergements, messages: r.messages,
    positions: r.positions, voitures: r.voitures, appels: r.appels, bloques: r.bloques, lectures: r.lectures };
}
async function ecarts(a) {
  const [v, e] = [await verite(a), await etat(a)];
  const diff = [];
  for (const [k, attendu] of Object.entries(v)) differences(normal(e[k] ?? []), normal(attendu), k, diff);
  return diff;
}
/**
 * Le juge : pour chaque téléphone, plus rien n'attend, et ce qu'il a en SQLite dit exactement ce que le serveur
 * répond à l'ancienne synchro. On laisse le temps à la réplication d'arriver.
 */
async function converge(telephones, delai = 20_000) {
  for (const a of telephones) {
    await vide(a, delai);
    let diff = [];
    await jusqua(`${a.sub} au même état que le serveur`, async () => { diff = await ecarts(a); return !diff.length; }, delai)
      .catch(() => { throw new Error(`${a.sub} : ${diff.length} écarts avec le serveur\n       ` + diff.join('\n       ')); });
    if (a.erreurs.length) throw new Error(`${a.sub} : erreur dans la page : ${a.erreurs.splice(0).join(' | ')}`);
  }
}

// ------------------------------------------------------------------ raccourcis de scénario

/** Un groupe neuf créé par `chef`, rejoint par les autres. Rend son identifiant. */
async function groupe(chef, autres = [], nom = 'Essai') {
  const code = await js(chef, () => window.S.nouveauCode());
  const g = await js(chef, ([nom, code]) => window.S.creerGroupe(nom, null, [{ canal: 'lien', nom: 'Copains', contact: '', code }]), [nom, code]);
  await vide(chef);
  chef.id ??= (await etat(chef)).moi;
  for (const a of autres) { await js(a, (c) => window.S.rejoindre(c), code); }
  for (const a of autres) { await vide(a); a.id ??= (await jusqua(`identité de ${a.sub}`, async () => (await etat(a)).moi) , (await etat(a)).moi); }
  for (const a of [chef, ...autres]) await jusqua(`${autres.length + 1} membres chez ${a.sub}`, async () => (await vue(a)).groupes.find((x) => x.id === g)?.membres.length === autres.length + 1);
  return g;
}
const message = (a, g, texte, plus = {}) => js(a, ([g, texte, plus]) => window.S.envoyerMessage({ groupe: g }, { texte, ...plus }), [g, texte, plus]);
const textes = async (a, g) => (await vue(a)).messages.filter((m) => m.groupe === g && !m.retire).map((m) => m.texte);
const aLeMessage = (a, g, texte, delai) => jusqua(`« ${texte} » chez ${a.sub}`, async () => (await textes(a, g)).includes(texte), delai);

module.exports = { ouvrirEnAvion, diagnostic, MODE, PAGE, API, attendre, demarrer, arreter, telephone, connecter, ouvrir, fermer, rouvrir, jeter, js, etat, vue, sql, jusqua, vide, avion, couper,
  retablir, lent, instable, perdreReponse, panne, verite, ecarts, converge, groupe, message, textes, aLeMessage, jetonEssai };
