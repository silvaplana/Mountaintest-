// Étude « fonds de carte gratuits » : captures de page.html pour chaque fond, zone et zoom.
import { chromium } from 'playwright';
import fs from 'node:fs';
fs.mkdirSync('out', { recursive: true });

// Plan IGN HD : chercher une couche publique LiDAR / HD dans les capacités WMTS de l'IGN.
let hd = null;
const liste = [];
try {
  const cap = await (await fetch('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities')).text();
  for (const bloc of cap.split('<Layer>').slice(1)) {
    const id = (bloc.match(/<ows:Identifier>([^<]+)/) || [])[1] || '';
    const fmt = (bloc.match(/<Format>([^<]+)/) || [])[1] || '';
    const titre = (bloc.match(/<ows:Title>([^<]+)/) || [])[1] || '';
    if (/LIDAR|HD|PLAN/i.test(id + titre)) liste.push(`${id} | ${fmt} | ${titre}`);
    if (!hd && /LIDAR|PLAN.?IGN.?HD/i.test(id) && !/MNT|MNS|MNH|ELEVATION|NUAGE|DALLE|CLASS|ASSEMBLAGE/i.test(id)) hd = { id, fmt };
  }
} catch (e) { liste.push('erreur ' + e); }
fs.writeFileSync('out/couches-ign.txt', liste.join('\n') + `\nCHOISIE: ${JSON.stringify(hd)}\n`);

const navigateur = await chromium.launch();
const page = await navigateur.newPage({ viewport: { width: 400, height: 620 }, deviceScaleFactor: 2 });
page.on('console', (m) => console.log('[page]', m.text()));
const cartes = ['scan25', 'plan', 'piste1', 'otm'].concat(hd ? ['hd'] : []);
for (const zone of ['ailefroide', 'laciotat']) for (const z of [13, 15]) for (const c of cartes) {
  const extra = c === 'hd' ? `&layer=${hd.id}&fmt=${encodeURIComponent(hd.fmt)}` : '';
  await page.goto(`file://${process.cwd()}/page.html?map=${c}&zone=${zone}&z=${z}${extra}`);
  await page.waitForFunction(() => window.pret, null, { timeout: 60000 }).catch(() => {});
  await page.screenshot({ path: `out/${zone}-z${z}-${c}.png` });
  console.log('fait', zone, z, c);
}
await navigateur.close();
