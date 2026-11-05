import { useCallback, useEffect, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { RELAIS_URL } from './trails/webHikes';

/** Plugin natif (shared/StorageUsage.java, identique côté Kotlin) : place prise par l'appli et ses données. */
interface Storage { appli: number; donnees: number; cache: number; detail: { nom: string; octets: number; fichiers: number }[] }
const StorageUsage = registerPlugin<{ measure(): Promise<Storage> }>('StorageUsage');

/** Cumuls tenus par le relais IA du VPS (deploy/ia/relais.py, journal couts.jsonl) : toutes les requêtes, tous téléphones. */
interface IaUsage {
  cumul_total_usd: number; cumul_mois_usd: number; recherches_payantes: number;
  par_type?: Record<string, { cout_usd: number; requetes: number; premiere?: string }>;
  donnees_serveur_octets?: number; modele?: string;
}

/** Libellés des usages notés par le relais (le même tableau côté Kotlin : UsagePanel.kt). */
export const IA_TYPES: Record<string, string> = {
  randos: 'Randos trouvées sur le web',
  voiture: 'Voiture (modèle, consommation)',
  voyage: 'Coût des trajets',
  hebergement: 'Hébergements',
  facture: 'Lecture des factures',
};

const KEY = 'usageIa';

export function formatBytes(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2).replace('.', ',')} Go`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.', ',')} Mo`;
  return `${Math.round(n / 1e3)} ko`;
}
export function formatUsd(n: number) { return `${n.toFixed(2).replace('.', ',')} $`; }

/** Burger ☰ → 📊 : coût cumulé de l'IA et place prise par l'appli, surtout par ses données. */
export function Usage() {
  const [ia, setIa] = useState<{ u: IaUsage; at: string } | null>(() => {
    try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; }
  });
  const [iaErr, setIaErr] = useState('');
  const [mem, setMem] = useState<Storage | null>(null);
  const [memErr, setMemErr] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true); setIaErr(''); setMemErr('');
    const iaP = fetch(RELAIS_URL.replace(/randos$/, ''), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((u: IaUsage) => {
        const v = { u, at: new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) };
        setIa(v);
        try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* ignoré */ }
      })
      .catch(() => setIaErr('Relais IA injoignable (pas de réseau ?) : derniers chiffres connus.'));
    const memP = (Capacitor.isNativePlatform()
      ? StorageUsage.measure()
      : navigator.storage?.estimate
        ? navigator.storage.estimate().then((e) => ({ appli: 0, donnees: e.usage ?? 0, cache: 0, detail: [] }))
        : Promise.reject(new Error('mesure indisponible')))
      .then(setMem)
      .catch((e) => setMemErr(String((e as Error).message ?? e)));
    await Promise.all([iaP, memP]);
    setBusy(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const types = Object.entries(ia?.u.par_type ?? {}).sort((a, b) => b[1].cout_usd - a[1].cout_usd);
  return (
    <div className="usage">
      <h4>🤖 Requêtes IA (Claude)</h4>
      {ia ? (
        <>
          <div className="stats">
            <div><b>{formatUsd(ia.u.cumul_total_usd)}</b><span>depuis le début</span></div>
            <div><b>{formatUsd(ia.u.cumul_mois_usd)}</b><span>ce mois-ci</span></div>
            <div><b>{ia.u.recherches_payantes}</b><span>requêtes</span></div>
          </div>
          {types.length > 0 && (
            <table>
              <tbody>
                {types.map(([t, d]) => (
                  <tr key={t}><td>{IA_TYPES[t] ?? t}</td><td>{d.requetes}×</td><td>{formatUsd(d.cout_usd)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="hint">Toutes les requêtes payantes, de tous les téléphones, comptées par le relais IA (réponses en cache gratuites). Chiffres du {ia.at}.</p>
        </>
      ) : !iaErr && <p className="hint">Chargement…</p>}
      {iaErr && <p className="hint">{iaErr}</p>}

      <h4>💾 Place sur le téléphone</h4>
      {mem ? (
        <>
          <div className="stats">
            <div><b>{formatBytes(mem.donnees)}</b><span>données</span></div>
            {mem.appli > 0 && <div><b>{formatBytes(mem.appli)}</b><span>appli</span></div>}
            {mem.cache > 0 && <div><b>{formatBytes(mem.cache)}</b><span>cache</span></div>}
            <div><b>{formatBytes(mem.donnees + mem.appli + mem.cache)}</b><span>total</span></div>
          </div>
          {mem.detail.length > 0 && (
            <table>
              <tbody>
                {mem.detail.filter((d) => d.octets > 0).map((d) => (
                  <tr key={d.nom}><td>{d.nom}</td><td>{d.fichiers} fich.</td><td>{formatBytes(d.octets)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="hint">Les données (tuiles hors ligne, sorties ski, traces…) restent après une mise à jour ; le cache peut être vidé par Android.</p>
        </>
      ) : !memErr && <p className="hint">Mesure en cours…</p>}
      {memErr && <p className="hint">Mesure impossible : {memErr}</p>}
      {ia?.u.donnees_serveur_octets != null && (
        <p className="hint">Sur le serveur (cache des recherches IA et des sorties ski, journal des coûts) : {formatBytes(ia.u.donnees_serveur_octets)}.</p>
      )}
      <button disabled={busy} onClick={() => void refresh()}>{busy ? 'Actualisation…' : 'Actualiser'}</button>
    </div>
  );
}
