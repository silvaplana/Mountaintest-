// Étude « fonds de carte gratuits » : captures de page.html pour chaque fond, zone et zoom.
import { chromium } from 'playwright';
import fs from 'node:fs';
fs.mkdirSync('out', { recursive: true });

// Plan IGN HD : chercher une couche publique LiDAR / HD dans les capacités WMTS de l'IGN.
const hdListe = [];
const liste = [];
try {
  const cap = await (await fetch('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities')).text();
  for (const bloc of cap.split('<Layer>').slice(1)) {
    const id = (bloc.match(/<ows:Identifier>([^<]+)/) || [])[1] || '';
    const fmt = (bloc.match(/<Format>([^<]+)/) || [])[1] || '';
    const titre = (bloc.match(/<ows:Title>([^<]+)/) || [])[1] || '';
    if (/LIDAR|HD|PLAN/i.test(id + titre)) liste.push(`${id} | ${fmt} | ${titre}`);
    if (id === 'IGNF_PLAN-IGN-HD' || id === 'PLANIGN.LIDAR.TERRAIN') {
      fs.writeFileSync(`out/capacites-${id}.xml`, bloc.slice(0, 6000));
      const style = (bloc.match(/<Style[^>]*>\s*<ows:Identifier>([^<]+)/) || [])[1] || 'normal';
      const tms = (bloc.match(/<TileMatrixSet>([^<]+)/) || [])[1] || 'PM';
      hdListe.push({ nom: id === 'IGNF_PLAN-IGN-HD' ? 'hd' : 'lidar', id, fmt, style, tms });
    }
  }
} catch (e) { liste.push('erreur ' + e); }
fs.writeFileSync('out/couches-ign.txt', liste.join('\n') + `\nCHOISIES: ${JSON.stringify(hdListe)}\n`);

const navigateur = await chromium.launch();
const page = await navigateur.newPage({ viewport: { width: 400, height: 620 }, deviceScaleFactor: 2 });
page.on('console', (m) => console.log('[page]', m.text()));
// 2e passage : seulement les couches LiDAR / HD (les autres captures sont déjà faites).
for (const zone of ['ailefroide', 'laciotat']) for (const z of [13, 15, 16]) for (const h of hdListe) {
  const c = h.nom;
  const extra = `&layer=${h.id}&fmt=${encodeURIComponent(h.fmt)}&style=${h.style}&tms=${h.tms}`;
  await page.goto(`file://${process.cwd()}/page.html?map=hd&zone=${zone}&z=${z}${extra}`);
  await page.waitForFunction(() => window.pret, null, { timeout: 60000 }).catch(() => {});
  await page.screenshot({ path: `out/${zone}-z${z}-${c}.png` });
  console.log('fait', zone, z, c);
}
await navigateur.close();
