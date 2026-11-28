/** Les fonctions partagées, réseau normal : ce que l'un fait, les autres le voient, et le juge compare au serveur. */
const B = require('./banc.cjs');
const { js, etat, vue, jusqua, vide, groupe, message, textes, aLeMessage } = B;

const chez = (a, quoi, cond, delai) => jusqua(`${quoi} chez ${a.sub}`, async () => cond(await etat(a), await vue(a)), delai);
const partout = (tous, quoi, cond) => Promise.all(tous.map((a) => chez(a, quoi, cond)));
const sortie = (a, g, participants, nom = 'Dôme') => js(a, ([g, p, nom]) => window.S.creerSortie({ groupe: g, nom, photo: null, debut: '2026-12-05', fin: '2026-12-06', lieu: 'Ailefroide', participants: p }), [g, participants, nom]);

module.exports = [
  { nom: 'Groupe créé, rejoint par deux personnes avec le même lien', f: async ({ seb, julie, marc, tous }) => {
    const g = await groupe(seb, [julie, marc]);
    await partout(tous, '3 membres', (_e, v) => v.groupes.find((x) => x.id === g)?.membres.length === 3);
  } },

  { nom: 'Invitation « un admin accepte » : demande, refus pour l\'un, accord pour l\'autre', f: async ({ seb, julie, marc }) => {
    const code = await js(seb, () => window.S.nouveauCode());
    const g = await js(seb, (code) => window.S.creerGroupe('Sur accord', null, [{ canal: 'qr', nom: 'x', contact: '', code, approbation: true }]), code);
    await vide(seb);
    await js(julie, (c) => window.S.rejoindre(c), code); await js(marc, (c) => window.S.rejoindre(c), code);
    await chez(seb, '2 demandes', (_e, v) => (v.groupes.find((x) => x.id === g)?.demandes ?? []).length === 2);
    julie.id ??= (await etat(julie)).moi; marc.id ??= (await etat(marc)).moi;
    await js(seb, ([g, j, k]) => { window.S.accepterDemande(g, j, true); window.S.accepterDemande(g, k, false); }, [g, julie.id, marc.id]);
    await chez(julie, 'le groupe', (_e, v) => v.groupes.some((x) => x.id === g));
    await chez(seb, '2 membres, plus de demande', (_e, v) => { const x = v.groupes.find((y) => y.id === g); return x?.membres.length === 2 && !(x.demandes ?? []).length; });
    if ((await vue(marc)).groupes.some((x) => x.id === g)) throw new Error('Marc, refusé, voit le groupe');
  } },

  { nom: 'Rôles : nommer admin, retirer admin, transmettre le groupe, renommer', f: async ({ seb, julie, marc, tous }) => {
    const g = await groupe(seb, [julie, marc]);
    const role = (v, qui) => v.groupes.find((x) => x.id === g)?.membres.find((b) => b.id === qui.id)?.role;
    await js(seb, ([g, j]) => window.S.nommerAdmin(g, j), [g, julie.id]);
    await partout(tous, 'Julie admin', (_e, v) => role(v, julie) === 'admin');
    await js(julie, ([g]) => window.S.renommerGroupe(g, 'Les chamois'), [g]);
    await partout(tous, 'nouveau nom', (_e, v) => v.groupes.find((x) => x.id === g)?.nom === 'Les chamois');
    await js(seb, ([g, j]) => window.S.retirerAdmin(g, j), [g, julie.id]);
    await partout(tous, 'Julie membre', (_e, v) => role(v, julie) === 'membre');
    await js(seb, ([g, k]) => window.S.transmettre(g, k), [g, marc.id]);
    await partout(tous, 'Marc admin principal', (_e, v) => role(v, marc) === 'admin_principal' && role(v, seb) !== 'admin_principal');
  } },

  { nom: 'Messagerie : texte, réponse, réaction, modification, suppression', f: async ({ seb, julie, marc, tous }) => {
    const g = await groupe(seb, [julie, marc]);
    const id = await message(seb, g, 'Qui vient samedi ?');
    await aLeMessage(julie, g, 'Qui vient samedi ?'); await aLeMessage(marc, g, 'Qui vient samedi ?');
    await message(julie, g, 'Moi', { repond_a: id });
    await js(marc, (id) => window.S.reagir(id, '👍'), id);
    await partout(tous, 'réponse et réaction', (_e, v) => v.messages.find((x) => x.id === id)?.reactions?.length === 1 && v.messages.some((x) => x.repond_a === id));
    await js(seb, (id) => window.S.modifierMessage(id, 'Qui vient dimanche ?'), id);
    await partout(tous, 'texte modifié', (_e, v) => v.messages.find((x) => x.id === id)?.texte === 'Qui vient dimanche ?');
    await js(marc, (id) => window.S.reagir(id, null), id);
    await js(seb, (id) => window.S.retirerMessage(id), id);
    await partout(tous, 'message retiré, réaction enlevée', (_e, v) => { const x = v.messages.find((y) => y.id === id); return !x || (x.supprime && !(x.reactions ?? []).length); });
  } },

  { nom: 'Sondage : chacun vote, change son vote', f: async ({ seb, julie, marc, tous }) => {
    const g = await groupe(seb, [julie, marc]);
    const id = await js(seb, (g) => window.S.envoyerMessage({ groupe: g }, { nature: 'sondage', sondage: { question: 'Où ?', multiple: true, options: ['Écrins', 'Vanoise', 'Queyras'] } }), g);
    await partout(tous, 'le sondage', (_e, v) => v.messages.some((x) => x.id === id));
    await js(julie, (id) => window.S.voter(id, [0, 1]), id); await js(marc, (id) => window.S.voter(id, [2]), id); await js(seb, (id) => window.S.voter(id, [0]), id);
    await partout(tous, '4 votes', (_e, v) => v.messages.find((x) => x.id === id)?.sondage?.votes.length === 4);
    await js(julie, (id) => window.S.voter(id, [2]), id);
    await partout(tous, '3 votes après changement', (_e, v) => { const s = v.messages.find((x) => x.id === id)?.sondage; return s?.votes.length === 3 && s.votes.filter((x) => x.option === 2).length === 2; });
  } },

  { nom: 'Lu : quand Julie lit, Seb le voit', f: async ({ seb, julie }) => {
    const g = await groupe(seb, [julie]);
    await message(seb, g, 'Tu as vu ?');
    await aLeMessage(julie, g, 'Tu as vu ?');
    await js(julie, (g) => window.S.marquerLu(g, window.S.vue(window.S.lire()).messages.filter((m) => m.groupe === g).at(-1).cree_le), g);
    await chez(seb, 'la lecture de Julie', (e) => (e.lectures ?? []).some((l) => l.qui === julie.id && l.lus[g]));
  } },

  { nom: 'Discussion à deux : le troisième ne voit rien', f: async ({ seb, julie, marc }) => {
    const g = await groupe(seb, [julie, marc]);
    const duo = await js(seb, ([g, j]) => window.S.ouvrirDuo(window.S.appliquer(window.S.lire()).find((x) => x.id === g).membres.find((b) => b.id === j)), [g, julie.id]);
    await js(seb, (d) => window.S.envoyerMessage({ groupe: d }, { texte: 'Entre nous' }), duo);
    await chez(julie, 'le message à deux', (_e, v) => v.messages.some((x) => x.texte === 'Entre nous'));
    await message(seb, g, 'Pour tous');
    await aLeMessage(marc, g, 'Pour tous');
    const v = await vue(marc);
    if (v.messages.some((x) => x.texte === 'Entre nous') || v.groupes.some((x) => x.id === duo)) throw new Error('Marc voit la discussion à deux');
  } },

  { nom: 'Transférer un message vers un autre groupe', f: async ({ seb, julie, marc }) => {
    const g1 = await groupe(seb, [julie], 'Un'), g2 = await groupe(seb, [marc], 'Deux');
    const id = await message(seb, g1, 'À faire suivre');
    await vide(seb);
    await js(seb, ([id, g2]) => window.S.transferer(window.S.vue(window.S.lire()).messages.filter((x) => x.id === id), [{ groupe: g2 }]), [id, g2]);
    await aLeMessage(marc, g2, 'À faire suivre');
    if ((await textes(marc, g1)).length) throw new Error('Marc voit le premier groupe');
  } },

  { nom: 'Sortie : créée, renommée, supprimée puis remise', f: async ({ seb, julie, marc, tous }) => {
    const g = await groupe(seb, [julie, marc]);
    const s = await sortie(seb, g, [julie.id, marc.id]);
    await partout(tous, 'la sortie à 3', (_e, v) => v.sorties.find((x) => x.id === s)?.participants.length === 3);
    await js(julie, (s) => window.S.renommerSortie(s, 'Barre des Écrins'), s);
    await partout(tous, 'le nouveau nom', (_e, v) => v.sorties.find((x) => x.id === s)?.nom === 'Barre des Écrins');
    const copie = (await vue(seb)).sorties.find((x) => x.id === s);
    await js(seb, (s) => window.S.supprimerSortie(s), s);
    await partout(tous, 'plus de sortie', (_e, v) => !v.sorties.some((x) => x.id === s));
    await js(seb, (c) => window.S.remettreSortie(c), copie);
    await partout([seb, julie], 'la sortie revenue', (_e, v) => v.sorties.some((x) => x.id === s));
  } },

  { nom: 'Sortie avec un invité hors du groupe : il voit la sortie, pas le groupe', f: async ({ seb, julie, marc }) => {
    const g = await groupe(seb, [julie]);
    const s = await sortie(seb, g, [julie.id]);
    await message(seb, g, 'Du groupe');
    const code = await js(seb, () => window.S.nouveauCode());
    await js(seb, ([s, code]) => window.S.inviterSortie(s, { canal: 'lien', nom: 'Marc', contact: '', code }), [s, code]);
    await vide(seb);
    await js(marc, (c) => window.S.rejoindre(c), code);
    await chez(marc, 'la sortie', (_e, v) => v.sorties.some((x) => x.id === s));
    await js(seb, (s) => window.S.envoyerMessage({ sortie: s }, { texte: 'De la sortie' }), s);
    await chez(marc, 'le message de la sortie', (_e, v) => v.messages.some((x) => x.texte === 'De la sortie'));
    const v = await vue(marc);
    if (v.messages.some((x) => x.texte === 'Du groupe')) throw new Error('l\'invité voit les messages du groupe');
  } },

  { nom: 'Planning de saison : trois réponses, une modifiée', f: async ({ seb, julie, marc, tous }) => {
    const g = await groupe(seb, [julie, marc]);
    const p = await js(seb, (g) => window.S.creerPlanning({ groupe: g, nom: 'Hiver', dates: [['2026-12-12', '2026-12-13'], ['2026-12-19', '2026-12-20']], limite: '2026-12-10' }), g);
    await partout(tous, 'le planning', (e) => e.plannings.some((x) => x.id === p));
    await js(seb, (p) => window.S.repondre(p, '2026-12-12', 'oui'), p); await js(julie, (p) => window.S.repondre(p, '2026-12-12', 'peut', 'À voir'), p); await js(marc, (p) => window.S.repondre(p, '2026-12-19', 'non'), p);
    await partout(tous, '3 réponses', (e) => e.plannings.find((x) => x.id === p)?.dispos.length === 3);
    await js(julie, (p) => window.S.repondre(p, '2026-12-12', 'oui', 'Finalement oui'), p);
    await partout(tous, 'réponse modifiée', (e) => e.plannings.find((x) => x.id === p)?.dispos.some((d) => d.qui === julie.id && d.etat === 'oui'));
  } },

  { nom: 'Dépenses : ajoutée, modifiée, remboursée (« j\'ai payé », « reçu »), retirée', f: async ({ seb, julie, marc, tous }) => {
    const g = await groupe(seb, [julie, marc]);
    const s = await sortie(seb, g, [julie.id, marc.id]);
    await partout(tous, 'la sortie', (_e, v) => v.sorties.some((x) => x.id === s));
    const d = await js(seb, ([s, a, b, c]) => window.S.enregistrerDepense({ sortie: s, titre: 'Refuge', montant: 9000, paye_par: a, pour: [a, b, c], jour: '2026-12-05' }), [s, seb.id, julie.id, marc.id]);
    await partout(tous, 'la dépense', (e) => (e.depenses ?? []).some((x) => x.montant === 9000));
    const id = d ?? (await etat(seb)).depenses.find((x) => x.montant === 9000).id;
    await js(julie, ([s, id, a, b]) => window.S.enregistrerDepense({ depense: id, sortie: s, titre: 'Refuge et repas', montant: 12000, paye_par: a, pour: [a, b], jour: '2026-12-05' }), [s, id, seb.id, julie.id]);
    await partout(tous, 'la dépense modifiée', (e) => (e.depenses ?? []).some((x) => x.id === id && x.montant === 12000 && x.pour.length === 2));
    await js(julie, ([s, a]) => window.S.annoncerPaiement({ sortie: s, a, montant: 6000, moyen: 'virement' }), [s, seb.id]);
    await chez(seb, 'le remboursement annoncé', (e) => (e.depenses ?? []).some((x) => x.remb));
    const r = (await etat(seb)).depenses.find((x) => x.remb).id;
    await js(seb, (r) => window.S.confirmerRecu(r, true), r);
    await partout(tous, 'le reçu', (e) => (e.depenses ?? []).some((x) => x.id === r && x.remb === 'recu'));
    await js(seb, (id) => window.S.retirerDepense(id), id);
    await partout(tous, 'la dépense retirée', (e) => !(e.depenses ?? []).some((x) => x.id === id && !x.supprime));
  } },

  { nom: 'Buddy count de groupe : créé, renommé, une dépense dedans', f: async ({ seb, julie, tous }) => {
    const g = await groupe(seb, [julie]);
    const c = await js(seb, (g) => window.S.creerCount(g, 'Courses'), g);
    await chez(julie, 'le Buddy count', (e) => (e.counts ?? []).some((x) => x.id === c));
    await js(julie, ([c, a, b]) => window.S.enregistrerDepense({ sortie: c, titre: 'Fromage', montant: 1500, paye_par: b, pour: [a, b], jour: '2026-12-01' }), [c, seb.id, julie.id]);
    await js(seb, (c) => window.S.changerCount(c, { nom: 'Courses du refuge' }), c);
    await partout([seb, julie], 'dépense et nom', (e) => (e.depenses ?? []).some((x) => x.montant === 1500) && (e.counts ?? []).find((x) => x.id === c)?.nom === 'Courses du refuge');
  } },

  { nom: 'Hébergement : proposé, deux cœurs, retenu, retiré', f: async ({ seb, julie, marc, tous }) => {
    const g = await groupe(seb, [julie, marc]);
    const s = await sortie(seb, g, [julie.id, marc.id]);
    await partout(tous, 'la sortie', (_e, v) => v.sorties.some((x) => x.id === s));
    await js(julie, (s) => window.S.proposerHebergement([s], { nom: 'Refuge du Glacier Blanc', nature: 'refuge', prix_nuit: 30, adresse: 'Pelvoux', url: '', resume: '', lon: 6.4, lat: 44.9 }), s);
    await partout(tous, 'l\'hébergement', (e) => (e.hebergements ?? []).length >= 1 && (e.hebergements ?? []).some((h) => h.sortie === s));
    const h = (await etat(seb)).hebergements.find((x) => x.sortie === s).id;
    await js(seb, (h) => window.S.mettreCoeur(h, true), h); await js(marc, (h) => window.S.mettreCoeur(h, true), h);
    await partout(tous, '2 cœurs', (e) => e.hebergements.find((x) => x.id === h)?.coeurs.length === 2);
    await js(marc, (h) => window.S.mettreCoeur(h, false), h);
    await js(seb, (h) => window.S.retenirHebergement(h, true), h);
    await partout(tous, 'retenu, 1 cœur', (e) => { const x = e.hebergements.find((y) => y.id === h); return x?.retenu && x.coeurs.length === 1; });
    await js(julie, (h) => window.S.retirerHebergement(h), h);
    await partout(tous, 'retiré', (e) => !(e.hebergements ?? []).some((x) => x.id === h));
  } },

  { nom: 'Carnet : deux récits, des fiches de jour, les conditions', f: async ({ seb, julie, tous }) => {
    const g = await groupe(seb, [julie]);
    const s = await sortie(seb, g, [julie.id]);
    await chez(julie, 'la sortie', (_e, v) => v.sorties.some((x) => x.id === s));
    await js(seb, (s) => window.S.enregistrerCarnet(s, { recit: 'Départ à la frontale.', fiches: [{ jour: '2026-12-05', nom: 'Montée au refuge', depart: '06:30', duree: 180, distance: 6500, denivele: 700 }], carnet: { difficulte: 'PD', meteo: 'Grand beau', conditions: 'Poudreuse' } }), s);
    await js(julie, (s) => window.S.enregistrerCarnet(s, { recit: 'Froid mais beau.' }), s);
    await partout([seb, julie], 'le carnet complet', (_e, v) => { const c = v.sorties.find((x) => x.id === s)?.carnet; return c?.recits.length === 2 && c.fiches.length === 1 && c.meteo === 'Grand beau'; })
      .catch(async (x) => { throw new Error(x.message + ' ; carnet : ' + JSON.stringify((await vue(seb)).sorties.find((y) => y.id === s)?.carnet) + ' ; attente ' + JSON.stringify((await etat(seb)).attente)); });
    await js(julie, (s) => window.S.enregistrerCarnet(s, { recit: '' }), s);
    await partout([seb, julie], 'un récit effacé', (_e, v) => v.sorties.find((x) => x.id === s)?.carnet?.recits.length === 1);
  } },

  { nom: 'Trace partagée avec un groupe et avec une sortie', f: async ({ seb, julie, marc, tous }) => {
    const g = await groupe(seb, [julie, marc]);
    const s = await sortie(seb, g, [julie.id]);
    await chez(julie, 'la sortie', (_e, v) => v.sorties.some((x) => x.id === s));
    const ligne = Array.from({ length: 300 }, (_x, i) => [6.4 + i * 1e-4, 44.9 + i * 1e-4]);
    await js(seb, ([g, s, l]) => { window.S.partagerTrace('Vers le groupe', l, '', { sorties: [], groupes: [g] }); window.S.partagerTrace('Vers la sortie', l, 'Par le glacier', { sorties: [s], groupes: [] }); }, [g, s, ligne]);
    await partout(tous, 'les traces', (e) => e.traces.filter((t) => t.groupe === g || t.sortie === s).length === 2);
  } },

  { nom: 'Voiture : garée, déplacée, enlevée', f: async ({ seb, julie, marc }) => {
    await groupe(seb, [julie, marc]);
    const voit = (e) => (e.voitures ?? []).find((v) => v.qui === seb.id);
    await js(seb, () => window.S.garerVoiture({ lat: 44.92, lon: 6.41 }));
    await partout([julie, marc], 'la voiture', (e) => voit(e)?.lat === 44.92);
    await js(seb, () => window.S.garerVoiture({ lat: 45.01, lon: 6.5 }));
    await partout([julie, marc], 'la voiture déplacée', (e) => voit(e)?.lat === 45.01);
    await js(seb, () => window.S.enleverVoiture());
    await partout([julie, marc], 'plus de voiture', (e) => { const v = voit(e); return !v || v.jusqu <= Date.now() + 2000; });
  } },

  { nom: 'Position : épingle sur un groupe, 5 points, puis relevée', f: async ({ seb, julie, marc }) => {
    const g = await groupe(seb, [julie, marc]);
    const pos = (e) => (e.positions ?? []).find((p) => p.qui === seb.id && p.groupe === g);
    await js(seb, (g) => window.S.enfoncerEpingle([{ groupe: g }]), g);
    for (let i = 1; i <= 5; i++) await js(seb, (i) => window.S.envoyerPosition({ lat: 44.9 + i / 100, lon: 6.4, alt: 1800 + i, t: window.S.heureServeur() }), i);
    await partout([julie, marc], 'la dernière position', (e) => pos(e)?.lat === 44.95);
    await js(seb, () => window.S.releverEpingle());
    await vide(seb);
    await partout([julie, marc], 'épingle relevée', (e) => { const p = pos(e); return !p || p.jusqu <= Date.now() + 5000; });
  } },

  { nom: 'Position sur une sortie : vue des participants, pas du reste du groupe', f: async ({ seb, julie, marc }) => {
    const g = await groupe(seb, [julie, marc]);
    const s = await sortie(seb, g, [julie.id]);
    await chez(julie, 'la sortie', (_e, v) => v.sorties.some((x) => x.id === s));
    await js(seb, (s) => { window.S.enfoncerEpingle([{ sortie: s }]); window.S.envoyerPosition({ lat: 44.77, lon: 6.3, alt: 2000, t: window.S.heureServeur() }); }, s);
    await chez(julie, 'la position', (e) => (e.positions ?? []).some((p) => p.sortie === s && p.lat === 44.77));
  } },

  { nom: 'Photos : trois déposées, une étoile, une placée, une retirée', f: async ({ seb, julie, tous }) => {
    const g = await groupe(seb, [julie]);
    const s = await sortie(seb, g, [julie.id]);
    await chez(julie, 'la sortie', (_e, v) => v.sorties.some((x) => x.id === s));
    const ids = await js(seb, (s) => { const ids = [1, 2, 3].map(() => window.S.uuid()); window.S.deposerPhotos(s, ids.map((photo, i) => ({ photo, prise_le: `2026-12-05T10:0${i}:00`, lon: null, lat: null }))); return ids; }, s);
    await chez(julie, '3 photos', (e) => e.photos.filter((p) => p.sortie === s).length === 3);
    await js(julie, (id) => window.S.mettreEtoile(id, true), ids[0]);
    await js(seb, (id) => window.S.placerPhoto(id, 6.4, 44.9), ids[1]);
    await js(seb, (id) => window.S.retirerPhoto(id), ids[2]);
    await partout([seb, julie], 'étoile, place, retrait', (e) => { const l = e.photos.filter((p) => p.sortie === s); return l.length === 2 && l.find((p) => p.id === ids[0])?.etoile && l.find((p) => p.id === ids[1])?.lat === 44.9; });
  } },

  { nom: 'Message « je suis ici » (point sur la carte) et message de 2 000 caractères avec accents et émojis', f: async ({ seb, julie }) => {
    const g = await groupe(seb, [julie]);
    const long = 'Été à l\'aiguille 🏔️ — « ça passe » ! '.repeat(60).slice(0, 2000).trim();
    await js(seb, ([g, long]) => { window.S.envoyerMessage({ groupe: g }, { texte: long }); window.S.envoyerMessage({ groupe: g }, { nature: 'point', lon: 6.4, lat: 44.9, texte: 'Rendez-vous ici' }); }, [g, long]);
    await chez(julie, 'texte long et point', (_e, v) => v.messages.some((m) => m.texte === long) && v.messages.some((m) => m.nature === 'point' && m.lat === 44.9));
  } },

  { nom: 'Groupe supprimé par son admin : il disparaît chez tous', f: async ({ seb, julie, marc, tous }) => {
    const g = await groupe(seb, [julie, marc]);
    await message(julie, g, 'Avant la fin');
    await aLeMessage(seb, g, 'Avant la fin');
    await js(seb, (g) => window.S.supprimerGroupe(g), g);
    await partout(tous, 'plus de groupe ni de message', (_e, v) => !v.groupes.some((x) => x.id === g) && !v.messages.some((x) => x.groupe === g));
  } },
];
