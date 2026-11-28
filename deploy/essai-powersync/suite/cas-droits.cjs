/**
 * Qui voit quoi. Avec PowerSync, on regarde aussi DANS la base du téléphone (SQLite) : une ligne qui n'aurait pas dû
 * descendre est une fuite, même si aucun écran ne la montre.
 */
const B = require('./banc.cjs');
const { MODE, js, etat, vue, sql, jusqua, vide, groupe, message, textes, aLeMessage, telephone, jeter, connecter, ouvrir, fermer, attendre, avion } = B;

const chez = (a, quoi, cond, delai) => jusqua(`${quoi} chez ${a.sub}`, async () => cond(await etat(a), await vue(a)), delai);
const partout = (tous, quoi, cond, delai) => Promise.all(tous.map((a) => chez(a, quoi, cond, delai)));
const sortie = (a, g, participants, nom = 'Dôme') => js(a, ([g, p, nom]) => window.S.creerSortie({ groupe: g, nom, photo: null, debut: '2026-12-05', fin: '2026-12-06', lieu: 'Ailefroide', participants: p }), [g, participants, nom]);
const TABLES_GROUPE = ['messages_buddies', 'plannings', 'positions_groupes', 'traces', 'sorties', 'membres', 'invitations'];
/** Tout le contenu de la base du téléphone, en un seul texte (pour y chercher ce qui ne devrait pas y être). */
const toutSqlite = async (a) => JSON.stringify(await js(a, async () => {
  const b = window.P.laBase(); const r = {};
  if (!b) return r;
  for (const t of await b.getAll("SELECT name FROM sqlite_master WHERE type IN ('view','table') AND name NOT LIKE 'ps_%' AND name NOT LIKE 'sqlite_%'")) r[t.name] = await b.getAll(`SELECT * FROM ${t.name}`).catch(() => []);
  return r;
}));
let numero = 0;
/**
 * Garnit un groupe de tout ce qui se partage, avec des textes propres à ce cas (les téléphones gardent les groupes
 * des cas d'avant). Rend la sortie et les « secrets » : ceux du groupe, ceux de la sortie.
 */
async function garnir(chef, g, autres) {
  const k = `${Date.now().toString(36)}${++numero}`;
  const s = await sortie(chef, g, autres.map((a) => a.id));
  const lat = [44.1 + numero / 1000, 44.4 + numero / 1000].map((x) => Math.round(x * 1e6) / 1e6);
  await js(chef, ([g, s, k, lat]) => {
    window.S.envoyerMessage({ groupe: g }, { texte: `secret du groupe ${k}` });
    window.S.envoyerMessage({ sortie: s }, { texte: `secret de la sortie ${k}` });
    window.S.creerPlanning({ groupe: g, nom: `Planning secret ${k}`, dates: [['2026-12-12', '2026-12-13']], limite: '2026-12-10' });
    window.S.partagerTrace(`Trace secrète ${k}`, [[6.4, 44.9], [6.41, 44.91]], '', { sorties: [], groupes: [g] });
    window.S.enregistrerDepense({ sortie: s, titre: `Dépense secrète ${k}`, montant: 4444, paye_par: window.S.lire().moi, pour: [window.S.lire().moi], jour: '2026-12-05' });
    window.S.proposerHebergement([s], { nom: `Gîte secret ${k}`, nature: 'gite', prix_nuit: 20, adresse: '', url: '', resume: '', lon: 6.4, lat: 44.9 });
    window.S.enfoncerEpingle([{ groupe: g }]); window.S.envoyerPosition({ lat: lat[0], lon: 6.4, alt: 1000, t: window.S.heureServeur() });
    window.S.garerVoiture({ lat: lat[1], lon: 6.4 });
  }, [g, s, k, lat]);
  await vide(chef);
  const duGroupe = [`secret du groupe ${k}`, `Planning secret ${k}`, `Trace secrète ${k}`, String(lat[0])];
  const deLaSortie = [`secret de la sortie ${k}`, `Dépense secrète ${k}`, `Gîte secret ${k}`];
  return { s, k, duGroupe, deLaSortie, voiture: String(lat[1]), tout: [...duGroupe, ...deLaSortie, String(lat[1])] };
}
/** Aucun de ces textes ne doit rester : ni dans l'état de l'appli, ni (PowerSync) dans la base du téléphone. */
const rien = async (a, secrets, quoi) => {
  const e = JSON.stringify(await etat(a));
  const vus = secrets.filter((s) => e.includes(s));
  if (vus.length) throw new Error(`${quoi} : l'appli de ${a.sub} garde ${vus.join(', ')}`);
  if (MODE === 'powersync' && a.page) { const b = await toutSqlite(a); const l = secrets.filter((s) => b.includes(s)); if (l.length) throw new Error(`${quoi} : la base du téléphone de ${a.sub} garde ${l.join(', ')}`); }
};

module.exports = [
  { nom: 'Quelqu\'un qui n\'est pas du groupe n\'en reçoit rien, ni à l\'écran ni dans la base du téléphone', f: async ({ seb, julie, marc }) => {
    const g = await groupe(seb, [julie]);
    const x = await garnir(seb, g, [julie]);
    await chez(julie, 'le contenu du groupe', (e) => x.tout.every((s) => JSON.stringify(e).includes(s)));
    await attendre(1500);
    await rien(marc, [...x.duGroupe, ...x.deLaSortie], 'hors du groupe');
  } },

  { nom: 'Quitter un groupe : tout son contenu disparaît du téléphone', f: async ({ seb, julie, marc }) => {
    const g = await groupe(seb, [julie, marc]);
    const x = await garnir(seb, g, [julie, marc]);
    await chez(julie, 'le contenu du groupe', (e) => x.tout.every((s) => JSON.stringify(e).includes(s)));
    await js(julie, (g) => window.S.quitter(g), g);
    await chez(julie, 'plus de groupe', (_e, v) => !v.groupes.some((y) => y.id === g));
    // Règle du serveur (les deux synchros) : qui quitte un groupe reste participant des sorties où il était inscrit.
    await jusqua('plus rien du groupe chez Julie', async () => rien(julie, x.duGroupe, 'après le départ').then(() => true), 20_000);
    await chez(marc, 'toujours le contenu', (e) => x.tout.every((s) => JSON.stringify(e).includes(s)));
    return 'elle garde la sortie où elle était inscrite (règle du serveur, pareil sur les deux synchros)';
  } },

  { nom: 'Retiré par un admin : tout disparaît, et la personne ne reçoit plus la suite', f: async ({ seb, julie, marc }) => {
    const g = await groupe(seb, [julie, marc]);
    const x = await garnir(seb, g, [julie, marc]);
    await chez(marc, 'le contenu du groupe', (e) => x.tout.every((s) => JSON.stringify(e).includes(s)));
    await js(seb, ([g, k]) => window.S.retirer(g, k), [g, marc.id]);
    await chez(marc, 'plus de groupe', (_e, v) => !v.groupes.some((y) => y.id === g));
    await message(seb, g, `la suite ${x.k}`);
    await aLeMessage(julie, g, `la suite ${x.k}`);
    await attendre(1500);
    await jusqua('plus rien du groupe chez Marc', async () => rien(marc, [...x.duGroupe, `la suite ${x.k}`], 'après le retrait').then(() => true), 20_000);
  } },

  { nom: 'Un membre simple ne peut pas retirer quelqu\'un ni supprimer le groupe : refusé, rien ne change', f: async ({ seb, julie, marc, tous }) => {
    const g = await groupe(seb, [julie, marc]);
    await js(julie, ([g, k]) => { window.S.retirer(g, k); window.S.supprimerGroupe(g); window.S.nommerAdmin(g, window.S.lire().moi); }, [g, marc.id]);
    await vide(julie, 30_000);
    await attendre(1500);
    await partout(tous, 'toujours 3 membres, Julie membre', (_e, v) => { const x = v.groupes.find((y) => y.id === g); return x?.membres.length === 3 && x.membres.find((b) => b.id === julie.id)?.role === 'membre'; });
  } },

  { nom: 'Modifier ou supprimer le message d\'un autre : refusé', f: async ({ seb, julie }) => {
    const g = await groupe(seb, [julie]);
    const id = await message(seb, g, 'À moi');
    await aLeMessage(julie, g, 'À moi');
    await js(julie, (id) => { window.S.modifierMessage(id, 'Piraté'); window.S.retirerMessage(id); }, id);
    await vide(julie, 30_000);
    await attendre(1500);
    for (const a of [seb, julie]) if (!(await textes(a, g)).includes('À moi')) throw new Error(`le message a changé chez ${a.sub}`);
  } },

  { nom: 'Nouveau membre : il reçoit tout l\'historique du groupe', f: async ({ seb, julie, marc }) => {
    const code = await js(seb, () => window.S.nouveauCode());
    const g = await js(seb, (code) => window.S.creerGroupe('Avec historique', null, [{ canal: 'lien', nom: 'x', contact: '', code }]), code);
    await vide(seb);
    await js(julie, (c) => window.S.rejoindre(c), code);
    await chez(seb, '2 membres', (_e, v) => v.groupes.find((x) => x.id === g)?.membres.length === 2);
    julie.id ??= (await etat(julie)).moi; seb.id ??= (await etat(seb)).moi;
    const x = await garnir(seb, g, [julie]);
    for (let i = 0; i < 30; i++) await message(i % 2 ? seb : julie, g, `histoire ${i}`);
    await vide(seb); await vide(julie);
    await js(marc, (c) => window.S.rejoindre(c), code);
    await chez(marc, 'tout l\'historique', (e, v) => v.messages.filter((m) => m.groupe === g && m.texte.startsWith('histoire')).length === 30 && x.duGroupe.slice(0, 3).every((s) => JSON.stringify(e).includes(s)), 40_000);
  } },

  { nom: 'Invité d\'une sortie : il a la sortie et son contenu, rien du groupe', f: async ({ seb, julie, marc }) => {
    const g = await groupe(seb, [julie]);
    const x = await garnir(seb, g, [julie]); const s = x.s;
    const code = await js(seb, () => window.S.nouveauCode());
    await js(seb, ([s, code]) => window.S.inviterSortie(s, { canal: 'lien', nom: 'Marc', contact: '', code }), [s, code]);
    await vide(seb);
    await js(marc, (c) => window.S.rejoindre(c), code);
    await chez(marc, 'la sortie et son contenu', (e) => x.deLaSortie.every((t) => JSON.stringify(e).includes(t)), 40_000);
    await attendre(1500);
    await rien(marc, x.duGroupe, 'invité d\'une seule sortie');
  } },

  { nom: 'Données privées : ni le mail ni le téléphone des autres ne descendent dans la base du téléphone', seulement: 'powersync', f: async ({ seb, julie, marc }) => {
    await groupe(seb, [julie, marc]);
    await attendre(1500);
    for (const a of [seb, julie, marc]) {
      const b = await toutSqlite(a);
      for (const autre of [seb, julie, marc]) if (autre !== a && b.includes(`${autre.sub}@exemple.test`)) throw new Error(`la base de ${a.sub} contient le mail de ${autre.sub}`);
      const colonnes = Object.keys((await sql(a, 'SELECT * FROM utilisateurs LIMIT 1'))[0] ?? {});
      const interdites = colonnes.filter((c) => /iban|telephone|email|logto|wero|^prenom$|^nom$/.test(c));
      if (interdites.length) throw new Error(`la fiche des personnes dans la base de ${a.sub} a les colonnes ${interdites.join(', ')}`);
    }
  } },

  { nom: 'Personne bloquée : elle ne doit plus recevoir ma position ni ma voiture', f: async ({ seb, julie, marc }) => {
    const g = await groupe(seb, [julie, marc]);
    await js(seb, ([g, j]) => window.S.bloquer(window.S.appliquer(window.S.lire()).find((x) => x.id === g).membres.find((b) => b.id === j)), [g, julie.id]);
    await vide(seb);
    await js(seb, (g) => { window.S.enfoncerEpingle([{ groupe: g }]); window.S.envoyerPosition({ lat: 44.5555, lon: 6.4, alt: 1000, t: window.S.heureServeur() }); window.S.garerVoiture({ lat: 44.6666, lon: 6.4 }); }, g);
    await chez(marc, 'position et voiture de Seb', (e) => (e.positions ?? []).some((p) => p.lat === 44.5555) && (e.voitures ?? []).some((v) => v.lat === 44.6666));
    await attendre(1500);
    const e = await etat(julie);
    if ((e.positions ?? []).some((p) => p.lat === 44.5555) || (e.voitures ?? []).some((v) => v.lat === 44.6666)) throw new Error('Julie, bloquée, voit la position ou la voiture de Seb à l\'écran');
    if (MODE === 'powersync') { const b = await toutSqlite(julie); if (b.includes('44.5555') || b.includes('44.6666')) throw new Error('la position ou la voiture de Seb est dans la base du téléphone de Julie, bloquée (pas à l\'écran)'); }
    // Débloquée, elle les revoit (et les cas suivants repartent sans blocage).
    await js(seb, (j) => window.S.debloquer(j), julie.id);
    await chez(julie, 'position et voiture de Seb après déblocage', (e) => (e.positions ?? []).some((p) => p.lat === 44.5555) && (e.voitures ?? []).some((v) => v.lat === 44.6666), 30_000);
  } },

  { nom: 'Deux téléphones pour le même compte : ce que je fais sur l\'un apparaît sur l\'autre', f: async ({ seb, julie }) => {
    const g = await groupe(seb, [julie]);
    const seb2 = await telephone(seb.sub);
    try {
      await chez(seb2, 'le groupe sur le 2e téléphone', (_e, v) => v.groupes.some((x) => x.id === g), 30_000);
      await message(seb, g, 'depuis le premier');
      await aLeMessage(seb2, g, 'depuis le premier');
      await message(seb2, g, 'depuis le second');
      await aLeMessage(seb, g, 'depuis le second'); await aLeMessage(julie, g, 'depuis le second');
      await js(seb2, () => window.S.garerVoiture({ lat: 44.2, lon: 6.2 }));
      await chez(seb, 'ma voiture garée depuis l\'autre téléphone', (e) => (e.voitures ?? []).some((v) => v.lat === 44.2));
      await B.converge([seb2]);
    } finally { await jeter(seb2); }
  } },

  { nom: 'Déconnexion puis autre compte sur le même téléphone : aucune donnée du premier ne reste', f: async ({ seb, julie }) => {
    const g = await groupe(seb, [julie]);
    const x = await garnir(seb, g, [julie]);
    const t = await telephone(julie.sub);
    try {
      await chez(t, 'le contenu de Julie', (e) => x.tout.every((s) => JSON.stringify(e).includes(s)), 30_000)
        .catch(async (err) => { const e = JSON.stringify(await etat(t)); throw new Error(`${err.message} ; manque ${x.tout.filter((s) => !e.includes(s)).join(', ')} ; groupes ${(await vue(t)).groupes.length}`); });
      const inconnu = `inconnu${Date.now().toString(36)}`;
      await js(t, async () => { localStorage.setItem('essai-deconnecte', '1'); const c = await import(performance.getEntriesByType('resource').map((r) => r.name).find((n) => n.includes('/src/compte/auth.ts')) ?? '/src/compte/auth.ts'); await (c.deconnecter ?? c.seDeconnecter)(); });
      await attendre(1500);
      await fermer(t);
      await connecter(t, inconnu);
      // Après la déconnexion il reste une fiche « compte » sans jeton : on pose le nouveau compte une fois, comme le ferait la connexion.
      await t.ctx.addInitScript(([c, sub]) => { localStorage.removeItem('essai-deconnecte'); if (localStorage.getItem('essai-compte') !== sub) { localStorage.setItem('compte', c); localStorage.setItem('essai-compte', sub); } }, [t.compte, t.sub]);
      await ouvrir(t);
      await attendre(3000);
      await rien(t, x.tout, 'après changement de compte');
      if ((await vue(t)).groupes.some((y) => y.id === g)) throw new Error('le nouveau compte voit le groupe de l\'ancien');
      // Et le nouveau compte marche : il crée un groupe, l'écriture part.
      const g2 = await js(t, () => window.S.creerGroupe('Nouveau compte', null, []));
      await vide(t, 30_000);
      await chez(t, 'son groupe', (e) => e.serveur.some((y) => y.id === g2), 30_000);
    } finally { await jeter(t); }
  } },

  { nom: 'Premier lancement sur un téléphone neuf, hors ligne : l\'appli s\'ouvre vide, puis se remplit au retour du réseau', f: async ({ seb, julie }) => {
    const g = await groupe(seb, [julie]);
    await message(seb, g, 'déjà là');
    const t = await telephone(julie.sub, { ouvert: false });
    try {
      await B.ouvrirEnAvion(t);
      await attendre(1500);
      if ((await vue(t)).groupes.length) throw new Error('des groupes sans jamais avoir eu de réseau ?');
      await avion(t, false);
      await aLeMessage(t, g, 'déjà là', 40_000);
    } finally { await jeter(t); }
  } },
];
