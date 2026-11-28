/** Page d'essai (essai-powersync.html?sub=seb) : un « appareil » par onglet, piloté par deploy/essai-powersync/essai.mjs. */
import * as ps from '../buddies/powersync';

const q = new URLSearchParams(location.search);
const sub = q.get('sub') ?? 'seb', appareil = q.get('appareil') ?? '1', API = q.get('api') ?? 'http://localhost:8000';

let jetonLogto = localStorage.getItem('essai-jeton:' + sub) ?? '';
async function appel<T>(methode: string, chemin: string, corps?: unknown): Promise<T> {
  for (let essai = 0; ; essai++) {
    if (!jetonLogto) { jetonLogto = (await (await fetch(`${API}/essai/jeton?sub=${sub}`)).json()).jeton; localStorage.setItem('essai-jeton:' + sub, jetonLogto); }
    const r = await fetch(API + chemin, { method: methode, headers: { Authorization: 'Bearer ' + jetonLogto, 'Content-Type': 'application/json' }, body: corps ? JSON.stringify(corps) : undefined });
    if (r.status === 401 && essai === 0) { jetonLogto = ''; continue; }
    if (r.status === 422) throw new ps.Definitif(await r.text());
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.json() as T;
  }
}
const serveur: ps.Serveur = {
  jeton: () => appel('GET', '/powersync/jeton'),
  ecrire: async (ops) => { await appel('POST', '/powersync/ecrire', { ops, appareil }); },
};

const vu: { t: number; voitures: unknown[]; positions: unknown[] } = { t: 0, voitures: [], positions: [] };
const base = await ps.demarrer(serveur, `essai-${sub}-${appareil}.db`, { flags: { useWebWorker: q.get('worker') === '1', enableMultiTabs: false } });
ps.suivre((v, p) => {
  Object.assign(vu, { t: Date.now(), voitures: v, positions: p });
  document.getElementById('etat')!.textContent = JSON.stringify({ sub, appareil, moi: ps.quiSuisJe(), statut: base.currentStatus, voitures: v, positions: p }, null, 1);
});
Object.assign(window, { essai: { ps, base, vu, appel,
  statut: () => ({ connecte: base.currentStatus.connected, aSynchronise: base.currentStatus.hasSynced, envoi: base.currentStatus.dataFlowStatus?.uploading }),
  enAttente: async () => (await base.getAll<{ n: number }>('SELECT count(*) AS n FROM ps_crud'))[0].n } });
document.title = 'pret';
