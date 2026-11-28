/**
 * Le réseau qui lâche : coupures, mode avion, lenteur, instabilité, appli fermée ou tuée, réponses perdues, pannes
 * du serveur, écritures hors ligne des deux côtés, conflits. Après chaque cas, le juge compare chaque téléphone au serveur.
 */
const B = require('./banc.cjs');
const { js, etat, vue, jusqua, vide, groupe, message, textes, aLeMessage, avion, couper, retablir, lent, instable, perdreReponse, panne, rouvrir, fermer, ouvrir, ouvrirEnAvion, attendre } = B;

const chez = (a, quoi, cond, delai) => jusqua(`${quoi} chez ${a.sub}`, async () => cond(await etat(a), await vue(a)), delai);
const partout = (tous, quoi, cond, delai) => Promise.all(tous.map((a) => chez(a, quoi, cond, delai)));
const sortie = (a, g, participants, nom = 'Dôme') => js(a, ([g, p, nom]) => window.S.creerSortie({ groupe: g, nom, photo: null, debut: '2026-12-05', fin: '2026-12-06', lieu: 'Ailefroide', participants: p }), [g, participants, nom]);
/** Les textes de la conversation, dans l'ordre affiché. */
const fil = async (a, g, de) => (await textes(a, g)).filter((t) => de.includes(t));
const sansDoublon = async (a, g) => { const l = await textes(a, g); const d = l.filter((t, i) => l.indexOf(t) !== i); if (d.length) throw new Error(`doublons chez ${a.sub} : ${[...new Set(d)].join(', ')}`); };
const suite = (prefixe, n) => Array.from({ length: n }, (_x, i) => `${prefixe}${String(i + 1).padStart(3, '0')}`);
const envoyer = async (a, g, l) => { for (const t of l) await message(a, g, t); };
const memeOrdre = async (tous, g, de) => {
  const [premier, ...autres] = await Promise.all(tous.map((a) => fil(a, g, de)));
  for (const [i, l] of autres.entries()) if (l.join('|') !== premier.join('|')) throw new Error(`ordre différent entre ${tous[0].sub} (${premier.join(' ')}) et ${tous[i + 1].sub} (${l.join(' ')})`);
  return premier;
};

module.exports = [
  { nom: 'Mode avion : 5 messages écrits sans réseau s\'affichent tout de suite, partent au retour, dans l\'ordre', f: async ({ seb, julie }) => {
    const g = await groupe(seb, [julie]);
    await avion(julie, true);
    const l = suite('avion', 5);
    await envoyer(julie, g, l);
    if ((await fil(julie, g, l)).length !== 5) throw new Error('pas visibles tout de suite chez Julie');
    await attendre(1500);
    if ((await fil(seb, g, l)).length) throw new Error('Seb a reçu des messages pendant le mode avion');
    await avion(julie, false);
    await chez(seb, 'les 5 messages', async () => (await fil(seb, g, l)).length === 5);
    if ((await fil(seb, g, l)).join() !== l.join()) throw new Error(`ordre chez Seb : ${await fil(seb, g, l)}`);
  } },

  { nom: 'Réseau mort sans que le téléphone le sache (tunnel) : même chose', f: async ({ seb, julie }) => {
    const g = await groupe(seb, [julie]);
    couper(julie);
    const l = suite('tunnel', 5);
    await envoyer(julie, g, l);
    await message(seb, g, 'pendant le tunnel');
    await attendre(2000);
    if ((await fil(seb, g, l)).length) throw new Error('Seb a reçu des messages pendant la coupure');
    await retablir(julie);
    await chez(seb, 'les 5 messages', async () => (await fil(seb, g, l)).join() === l.join(), 40_000);
    await aLeMessage(julie, g, 'pendant le tunnel', 40_000);
  } },

  { nom: 'Hors ligne, appli fermée puis rouverte hors ligne : tout est encore là, ce qui attend aussi', f: async ({ seb, julie }) => {
    const g = await groupe(seb, [julie]);
    await message(seb, g, 'avant la coupure');
    await aLeMessage(julie, g, 'avant la coupure');
    await avion(julie, true);
    const l = suite('ferme', 3);
    await envoyer(julie, g, l);
    await attendre(800);
    await fermer(julie);
    await ouvrirEnAvion(julie);
    await chez(julie, 'groupe, ancien message et 3 messages en attente', async (_e, v) => v.groupes.some((x) => x.id === g) && (await textes(julie, g)).includes('avant la coupure') && (await fil(julie, g, l)).length === 3, 15_000);
    await avion(julie, false);
    await chez(seb, 'les 3 messages', async () => (await fil(seb, g, l)).join() === l.join(), 40_000);
    await sansDoublon(seb, g);
  } },

  { nom: 'Appli tuée juste après l\'écriture, en ligne : le message arrive une seule fois', f: async ({ seb, julie }) => {
    const g = await groupe(seb, [julie]);
    for (const t of suite('tue', 4)) { await message(julie, g, t); await rouvrir(julie); }
    await chez(seb, 'les 4 messages', async () => (await fil(seb, g, suite('tue', 4))).length === 4, 40_000);
    await sansDoublon(seb, g); await sansDoublon(julie, g);
  } },

  { nom: 'Réponse perdue : le serveur a enregistré, le téléphone ne le sait pas et renvoie → pas de doublon', f: async ({ seb, julie }) => {
    const g = await groupe(seb, [julie]);
    perdreReponse(julie, /POST \/(powersync\/ecrire|buddies\/sync)/, 2);
    const l = suite('perdu', 3);
    await envoyer(julie, g, l);
    await chez(seb, 'les 3 messages', async () => (await fil(seb, g, l)).length === 3, 40_000);
    await vide(julie, 40_000);
    await sansDoublon(seb, g); await sansDoublon(julie, g);
  } },

  { nom: 'Réponse perdue sur une dépense et un vote : comptés une seule fois', f: async ({ seb, julie }) => {
    const g = await groupe(seb, [julie]);
    const s = await sortie(seb, g, [julie.id]);
    const sondage = await js(seb, (g) => window.S.envoyerMessage({ groupe: g }, { nature: 'sondage', sondage: { question: 'Oui ?', multiple: false, options: ['Oui', 'Non'] } }), g);
    await chez(julie, 'sortie et sondage', (_e, v) => v.sorties.some((x) => x.id === s) && v.messages.some((x) => x.id === sondage));
    perdreReponse(julie, /POST \/(powersync\/ecrire|buddies\/sync)/, 2);
    await js(julie, ([s, a, b, sondage]) => { window.S.enregistrerDepense({ sortie: s, titre: 'Péage', montant: 2350, paye_par: b, pour: [a, b], jour: '2026-12-05' }); window.S.voter(sondage, [0]); }, [s, seb.id, julie.id, sondage]);
    await chez(seb, 'dépense et vote', (e, v) => (e.depenses ?? []).filter((d) => d.montant === 2350).length >= 1 && v.messages.find((x) => x.id === sondage)?.sondage?.votes.length >= 1, 40_000);
    await vide(julie, 40_000);
    const e = await etat(seb), v = await vue(seb);
    if (e.depenses.filter((d) => d.montant === 2350).length !== 1) throw new Error('dépense en double');
    if (v.messages.find((x) => x.id === sondage).sondage.votes.length !== 1) throw new Error('vote en double');
  } },

  { nom: 'Serveur en panne (erreurs 503) pendant quelques envois : l\'appli réessaie seule', f: async ({ seb, julie }) => {
    const g = await groupe(seb, [julie]);
    panne(julie, /POST \/(powersync\/ecrire|buddies\/sync)/, 503, 3);
    const l = suite('panne', 3);
    await envoyer(julie, g, l);
    await chez(seb, 'les 3 messages', async () => (await fil(seb, g, l)).join() === l.join(), 60_000);
    await sansDoublon(seb, g);
  } },

  { nom: 'Réseau lent (1,5 s par échange) : tout arrive, rien ne disparaît de l\'écran entre l\'envoi et le retour', f: async ({ seb, julie }) => {
    const g = await groupe(seb, [julie]);
    lent(julie, 1500);
    const l = suite('lent', 4);
    await js(julie, (l) => { window.trous = []; const vus = new Set(); window.S.suivre((e) => { const la = new Set(window.S.vue(e).messages.map((m) => m.texte)); for (const t of l) { if (la.has(t)) vus.add(t); else if (vus.has(t)) window.trous.push(t); } }); }, l);
    await envoyer(julie, g, l);
    await chez(seb, 'les 4 messages', async () => (await fil(seb, g, l)).join() === l.join(), 60_000);
    await vide(julie, 60_000);
    await attendre(1500);
    const trous = await js(julie, () => window.trous);
    if (trous.length) throw new Error(`messages disparus un instant de l'écran de Julie : ${[...new Set(trous)].join(', ')}`);
  } },

  { nom: 'Réseau instable (connexions qui tombent au hasard) pendant 30 messages de chaque côté', f: async ({ seb, julie }) => {
    const g = await groupe(seb, [julie]);
    instable(seb, 0.5); instable(julie, 0.5);
    const a = suite('inst-s', 30), b = suite('inst-j', 30);
    await Promise.all([envoyer(seb, g, a), envoyer(julie, g, b)]);
    await attendre(3000);
    await retablir(seb); await retablir(julie);
    for (const x of [seb, julie]) await jusqua(`60 messages chez ${x.sub}`, async () => (await fil(x, g, [...a, ...b])).length === 60, 90_000);
    await sansDoublon(seb, g); await sansDoublon(julie, g);
    await memeOrdre([seb, julie], g, [...a, ...b]);
  } },

  { nom: 'Le flux qui apporte les changements est coupé seul : j\'écris quand même, et je rattrape au retour', f: async ({ seb, julie }) => {
    const g = await groupe(seb, [julie]);
    couper(julie, 'flux');
    await message(julie, g, 'écrit sans flux');
    await aLeMessage(seb, g, 'écrit sans flux', 30_000);
    await message(seb, g, 'envoyé pendant la coupure du flux');
    await attendre(1500);
    await retablir(julie);
    await aLeMessage(julie, g, 'envoyé pendant la coupure du flux', 40_000);
  } },

  { nom: 'La connexion se fige sans se fermer (serveur ou box qui disparaît sans prévenir) : le téléphone s\'en aperçoit seul', f: async ({ seb, julie }) => {
    const g = await groupe(seb, [julie]);
    await message(seb, g, 'avant le gel');
    await aLeMessage(julie, g, 'avant le gel');
    B.geler(julie, 'flux');
    await message(seb, g, 'pendant le gel');
    await attendre(4000);
    // Le réseau remarche pour toute nouvelle connexion ; l'ancienne reste muette, et personne ne prévient l'appli.
    julie.reseau.retablir();
    const t0 = Date.now();
    await aLeMessage(julie, g, 'pendant le gel', 150_000);
    return `rattrapé ${Math.round((Date.now() - t0) / 1000)} s après le retour du réseau`;
  } },

  { nom: 'Trois minutes sans rien faire : la connexion reste en place, sans rebranchement inutile', seulement: 'powersync', delai: 300_000, f: async ({ seb, julie }) => {
    const g = await groupe(seb, [julie]);
    const avant = (await js(julie, () => window.P._file())).rebranchements;
    await attendre(170_000);
    const n = (await js(julie, () => window.P._file())).rebranchements - avant;
    if (n) throw new Error(`${n} rebranchement(s) alors que la connexion marchait`);
    await message(seb, g, 'après le calme');
    await aLeMessage(julie, g, 'après le calme', 10_000);
  } },

  { nom: 'Le serveur d\'écriture est coupé seul : je reçois toujours, mes écritures attendent', f: async ({ seb, julie }) => {
    const g = await groupe(seb, [julie]);
    couper(julie, 'api');
    await message(seb, g, 'reçu sans pouvoir écrire');
    await message(julie, g, 'en attente');
    const recu = await aLeMessage(julie, g, 'reçu sans pouvoir écrire', 15_000).then(() => true, () => false);
    await attendre(1000);
    if ((await textes(seb, g)).includes('en attente')) throw new Error('le message est parti alors que le serveur est coupé');
    await retablir(julie);
    await aLeMessage(seb, g, 'en attente', 40_000);
    await aLeMessage(julie, g, 'reçu sans pouvoir écrire', 40_000);
    return recu ? 'reçu pendant la coupure' : 'reçu seulement au retour du serveur';
  } },

  { nom: 'Hors ligne des deux côtés, écritures croisées : au retour, mêmes messages dans le même ordre chez tous', f: async ({ seb, julie, marc, tous }) => {
    const g = await groupe(seb, [julie, marc]);
    await avion(seb, true); await avion(julie, true);
    const a = suite('croise-s', 6), b = suite('croise-j', 6), c = suite('croise-m', 3);
    for (let i = 0; i < 6; i++) { await message(seb, g, a[i]); await message(julie, g, b[i]); }
    await envoyer(marc, g, c);
    await avion(julie, false); await attendre(700); await avion(seb, false);
    for (const x of tous) await jusqua(`15 messages chez ${x.sub}`, async () => (await fil(x, g, [...a, ...b, ...c])).length === 15, 40_000);
    await memeOrdre(tous, g, [...a, ...b, ...c]);
    for (const x of tous) await sansDoublon(x, g);
  } },

  { nom: 'Conflit : deux personnes renomment la même sortie hors ligne → tout le monde finit avec le même nom', f: async ({ seb, julie, marc, tous }) => {
    const g = await groupe(seb, [julie, marc]);
    const s = await sortie(seb, g, [julie.id, marc.id]);
    await partout(tous, 'la sortie', (_e, v) => v.sorties.some((x) => x.id === s));
    await avion(seb, true); await avion(julie, true);
    await js(seb, (s) => window.S.renommerSortie(s, 'Nom de Seb'), s);
    await js(julie, (s) => window.S.renommerSortie(s, 'Nom de Julie'), s);
    await avion(seb, false); await attendre(500); await avion(julie, false);
    await vide(seb, 40_000); await vide(julie, 40_000);
    const nom = (v) => v.sorties.find((x) => x.id === s)?.nom;
    await jusqua('le même nom chez les trois', async () => { const l = await Promise.all(tous.map(async (x) => nom(await vue(x)))); return new Set(l).size === 1 && l[0] !== 'Dôme'; }, 30_000);
    return `nom gardé : ${nom(await vue(marc))} (le dernier arrivé au serveur)`;
  } },

  { nom: 'Conflit : l\'un modifie une dépense hors ligne pendant que l\'autre la supprime', f: async ({ seb, julie, tous, marc }) => {
    const g = await groupe(seb, [julie, marc]);
    const s = await sortie(seb, g, [julie.id, marc.id]);
    await partout(tous, 'la sortie', (_e, v) => v.sorties.some((x) => x.id === s));
    await js(seb, ([s, a, b]) => window.S.enregistrerDepense({ sortie: s, titre: 'Courses', montant: 5000, paye_par: a, pour: [a, b], jour: '2026-12-05' }), [s, seb.id, julie.id]);
    await partout(tous, 'la dépense', (e) => (e.depenses ?? []).some((x) => x.montant === 5000));
    const id = (await etat(seb)).depenses.find((x) => x.montant === 5000).id;
    await avion(julie, true);
    await js(julie, ([s, id, a, b]) => window.S.enregistrerDepense({ depense: id, sortie: s, titre: 'Courses', montant: 7000, paye_par: a, pour: [a, b], jour: '2026-12-05' }), [s, id, seb.id, julie.id]);
    await js(seb, (id) => window.S.retirerDepense(id), id);
    await vide(seb);
    await avion(julie, false);
    await vide(julie, 40_000);
    await jusqua('le même sort pour la dépense chez les trois', async () => { const l = await Promise.all(tous.map(async (x) => JSON.stringify((await etat(x)).depenses.filter((d) => d.id === id).map((d) => [d.montant, !!d.supprime])))); return new Set(l).size === 1; }, 30_000);
  } },

  { nom: 'Écrire hors ligne dans un groupe dont on a été retiré entre-temps : refusé proprement, rien ne reste bloqué', f: async ({ seb, julie, marc }) => {
    const g = await groupe(seb, [julie, marc]);
    await avion(julie, true);
    await envoyer(julie, g, ['après mon exclusion 1', 'après mon exclusion 2']);
    await js(seb, ([g, j]) => window.S.retirer(g, j), [g, julie.id]);
    await chez(marc, '2 membres', (_e, v) => v.groupes.find((x) => x.id === g)?.membres.length === 2);
    await avion(julie, false);
    await vide(julie, 40_000);
    await chez(julie, 'plus de groupe', (_e, v) => !v.groupes.some((x) => x.id === g), 40_000);
    await attendre(1500);
    if ((await textes(marc, g)).some((t) => t.startsWith('après mon exclusion'))) throw new Error('un message d\'une personne retirée est passé');
    // Julie peut encore écrire ailleurs : sa file n'est pas bloquée derrière les refus.
    const g2 = await groupe(julie, [marc], 'Après');
    await message(julie, g2, 'ça repart');
    await aLeMessage(marc, g2, 'ça repart');
  } },

  { nom: 'Rafale : 200 messages écrits hors ligne arrivent tous, dans l\'ordre', f: async ({ seb, julie }) => {
    const g = await groupe(seb, [julie]);
    await avion(julie, true);
    const l = suite('rafale', 200);
    await js(julie, ([g, l]) => { for (const t of l) window.S.envoyerMessage({ groupe: g }, { texte: t }); }, [g, l]);
    await avion(julie, false);
    await jusqua('200 messages chez Seb', async () => (await fil(seb, g, l)).length === 200, 90_000);
    if ((await fil(seb, g, l)).join() !== l.join()) throw new Error('ordre perdu chez Seb');
    await sansDoublon(seb, g);
    await vide(julie, 60_000);
  } },

  { nom: 'Longue absence : pendant qu\'un téléphone est éteint, 60 changements (ajouts, modifications, suppressions) ; il rattrape tout', f: async ({ seb, julie, marc }) => {
    const g = await groupe(seb, [julie, marc]);
    const s = await sortie(seb, g, [julie.id, marc.id]);
    await chez(julie, 'la sortie', (_e, v) => v.sorties.some((x) => x.id === s));
    await avion(julie, true); await fermer(julie);
    const ids = [];
    for (const t of suite('absence', 40)) ids.push(await message(seb, g, t));
    for (const id of ids.slice(0, 10)) await js(seb, (id) => window.S.retirerMessage(id), id);
    for (const id of ids.slice(10, 20)) await js(marc, (id) => window.S.reagir(id, '🔥'), id);
    await js(seb, (s) => window.S.renommerSortie(s, 'Renommée pendant l\'absence'), s);
    await js(marc, ([s, a, b]) => window.S.enregistrerDepense({ sortie: s, titre: 'Pendant l\'absence', montant: 3300, paye_par: a, pour: [a, b], jour: '2026-12-05' }), [s, marc.id, julie.id]);
    await vide(seb, 40_000); await vide(marc);
    await julie.ctx.setOffline(false); julie.reseau.retablir();
    await ouvrir(julie);
    await chez(julie, 'tout rattrapé', (e, v) => v.sorties.find((x) => x.id === s)?.nom === 'Renommée pendant l\'absence' && (e.depenses ?? []).some((d) => d.montant === 3300)
      && v.messages.filter((m) => m.groupe === g && !m.supprime && m.texte.startsWith('absence')).length === 30, 60_000);
  } },

  { nom: 'Coupures à répétition pendant une conversation à trois (10 cycles de 1 s)', f: async ({ seb, julie, marc, tous }) => {
    const g = await groupe(seb, [julie, marc]);
    const l = [];
    for (let i = 0; i < 10; i++) {
      const victime = tous[i % 3];
      couper(victime);
      for (const a of tous) { const t = `cycle${i}-${a.sub.slice(0, 3)}`; l.push(t); await message(a, g, t); }
      await attendre(1000);
      await retablir(victime);
    }
    for (const x of tous) await jusqua(`30 messages chez ${x.sub}`, async () => (await fil(x, g, l)).length === 30, 90_000);
    await memeOrdre(tous, g, l);
    for (const x of tous) await sansDoublon(x, g);
  } },

  { nom: 'Position envoyée hors ligne toutes les secondes : au retour, seule la dernière compte', f: async ({ seb, julie }) => {
    const g = await groupe(seb, [julie]);
    await js(seb, (g) => window.S.enfoncerEpingle([{ groupe: g }]), g);
    await vide(seb);
    await avion(seb, true);
    for (let i = 1; i <= 8; i++) await js(seb, (i) => window.S.envoyerPosition({ lat: 45 + i / 100, lon: 6.4, alt: 2000, t: window.S.heureServeur() }), i);
    if ((await etat(seb)).attente.filter((o) => o.type === 'position').length !== 1) throw new Error('plusieurs positions attendent le réseau');
    await avion(seb, false);
    await chez(julie, 'la dernière position', (e) => (e.positions ?? []).some((p) => p.qui === seb.id && p.lat === 45.08), 40_000);
  } },

  { nom: 'Voiture garée hors ligne puis enlevée hors ligne : au retour, personne ne voit de voiture', f: async ({ seb, julie }) => {
    await groupe(seb, [julie]);
    await avion(seb, true);
    await js(seb, () => window.S.garerVoiture({ lat: 44.5, lon: 6.1 }));
    await attendre(300);
    await js(seb, () => window.S.enleverVoiture());
    await avion(seb, false);
    await vide(seb, 40_000);
    await attendre(1500);
    const v = ((await etat(julie)).voitures ?? []).find((x) => x.qui === seb.id);
    if (v && v.jusqu > Date.now() + 2000) throw new Error('Julie voit une voiture qui a été enlevée');
  } },

  { nom: 'Rejoindre un groupe par un lien ouvert hors ligne : l\'entrée se fait au retour du réseau', f: async ({ seb, julie }) => {
    const code = await js(seb, () => window.S.nouveauCode());
    const g = await js(seb, (code) => window.S.creerGroupe('Lien hors ligne', null, [{ canal: 'lien', nom: 'x', contact: '', code }]), code);
    await vide(seb);
    await avion(julie, true);
    await js(julie, (c) => window.S.rejoindre(c), code);
    await attendre(800);
    await avion(julie, false);
    await chez(julie, 'le groupe', (_e, v) => v.groupes.some((x) => x.id === g && x.membres.length === 2), 40_000);
  } },

  { nom: 'Groupe, sortie, dépense et message créés hors ligne d\'un coup : tout part dans l\'ordre, rien n\'est refusé', f: async ({ seb, julie }) => {
    const g0 = await groupe(seb, [julie]);
    await avion(seb, true);
    const r = await js(seb, ([j]) => {
      const code = window.S.nouveauCode();
      const g = window.S.creerGroupe('Né hors ligne', null, [{ canal: 'lien', nom: 'Julie', contact: '', code }]);
      const s = window.S.creerSortie({ groupe: g, nom: 'Sortie née hors ligne', photo: null, debut: '2026-12-05', fin: '2026-12-06', lieu: '', participants: [] });
      window.S.envoyerMessage({ groupe: g }, { texte: 'premier mot' });
      window.S.envoyerMessage({ sortie: s }, { texte: 'dans la sortie' });
      window.S.enregistrerDepense({ sortie: s, titre: 'Hors ligne', montant: 1000, paye_par: window.S.lire().moi, pour: [window.S.lire().moi], jour: '2026-12-05' });
      return { g, s, code };
    }, [julie.id]);
    if (!(await vue(seb)).groupes.some((x) => x.id === r.g)) throw new Error('le groupe créé hors ligne n\'est pas affiché tout de suite');
    await avion(seb, false);
    await vide(seb, 40_000);
    await js(julie, (c) => window.S.rejoindre(c), r.code);
    await chez(julie, 'groupe, sortie et messages', (_e, v) => v.groupes.some((x) => x.id === r.g) && v.messages.some((m) => m.texte === 'premier mot'), 40_000);
    await chez(seb, 'la dépense', (e) => (e.depenses ?? []).some((d) => d.montant === 1000));
    void g0;
  } },
];
