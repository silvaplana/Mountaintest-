/** Les pannes du côté serveur (LOURD=1) : PowerSync ou Postgres redémarrent pendant que les téléphones travaillent. */
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const B = require('./banc.cjs');
const { jusqua, groupe, message, textes, attendre } = B;

const compose = (...args) => execFileSync('docker', ['compose', ...args], { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
const tousOnt = (tous, g, l, delai) => Promise.all(tous.map((a) => jusqua(`${l.length} messages chez ${a.sub}`, async () => { const t = await textes(a, g); return l.every((x) => t.includes(x)); }, delai)));

module.exports = [
  { nom: 'PowerSync redémarre pendant une conversation : rien n\'est perdu, la synchro reprend seule', lourd: true, seulement: 'powersync', f: async ({ seb, julie, marc, tous }) => {
    const g = await groupe(seb, [julie, marc]);
    const l = [];
    const ecrire = async (n) => { for (const a of tous) { const t = `ps-${n}-${a.sub.slice(0, 3)}`; l.push(t); await message(a, g, t); } };
    await ecrire(1);
    compose('restart', 'powersync');
    await ecrire(2);
    await attendre(3000);
    await ecrire(3);
    const t0 = Date.now();
    await tousOnt(tous, g, l, 150_000);
    return `tout est arrivé ${Math.round((Date.now() - t0) / 1000)} s après le dernier message`;
  } },

  { nom: 'Postgres redémarre pendant une conversation : rien n\'est perdu, la synchro reprend seule', lourd: true, f: async ({ seb, julie, marc, tous }) => {
    const g = await groupe(seb, [julie, marc]);
    const l = [];
    const ecrire = async (n) => { for (const a of tous) { const t = `pg-${n}-${a.sub.slice(0, 3)}`; l.push(t); await message(a, g, t); } };
    await ecrire(1);
    compose('restart', 'db');
    await ecrire(2);
    await attendre(5000);
    await ecrire(3);
    const t0 = Date.now();
    await tousOnt(tous, g, l, 170_000);
    return `tout est arrivé ${Math.round((Date.now() - t0) / 1000)} s après le dernier message`;
  } },
];
