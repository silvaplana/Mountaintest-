import { useEffect } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';
import { Capacitor } from '@capacitor/core';
import { EcoLocation } from '../gps/ecoLocation';
import { couleur, Natif, useBuddies, Visage } from './Buddies';
import { detail, etiquette, heureCourte, opacite, reperes, type Repere } from './positions';
import { enfoncerEpingle, envoyerPosition, monEpingle, positions, releverEpingle, type Sortie } from './store';

/**
 * Position des buddies (spec/buddies.md §5.9, écran 15) : 📍 une épingle qu'on enfonce (« mes buddies me voient »),
 * les visages sur la carte avec l'heure de leur dernière position, et la liste en bas. Mêmes écrans côté Kotlin
 * (BandeauSortie.kt, MainActivity.kt).
 */

function useReperes(x: Sortie) {
  const e = useBuddies();
  return reperes(x, positions(e), e.moi ?? 'moi');
}

/** Les visages sur la carte, avec « toi », « il y a 4 min » ou l'heure. */
export function PositionsSurCarte({ map, x }: { map: MlMap | null; x: Sortie }) {
  const rs = useReperes(x);
  const cle = rs.map((r) => `${r.b.id}${r.p.lat}${r.p.lon}${etiquette(r)}${r.actif}`).join();
  useEffect(() => {
    if (!map || !rs.length) return;
    const ms = rs.map((r) => {
      const el = document.createElement('div');
      el.className = 'bd-pos-carte';
      el.style.opacity = String(opacite(r));
      const v = document.createElement('span');
      v.className = 'bd-visage';
      v.style.background = couleur(r.b.id);
      if (r.b.photo) { const i = document.createElement('img'); i.src = r.b.photo; i.alt = ''; v.appendChild(i); } else v.textContent = r.b.pseudo.slice(0, 1).toUpperCase();
      const b = document.createElement('b');
      b.className = r.moi ? 'moi' : r.actif ? '' : 'vieux';
      b.textContent = etiquette(r);
      el.append(v, b);
      return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([r.p.lon, r.p.lat]).addTo(map);
    });
    return () => ms.forEach((m) => m.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, cle]);
  return null;
}

/** Le bas de l'écran 15 : les buddies visibles, puis l'épingle (enfoncer ou « Arrêter »). */
export function BandePositions({ x, onToast }: { x: Sortie; onToast: (m: string) => void }) {
  const e = useBuddies();
  const rs = useReperes(x);
  const moi = rs.find((r) => r.moi);
  const autres = rs.filter((r) => !r.moi);
  const mienne = monEpingle(e);
  const ici = mienne?.sortie === x.id ? mienne : undefined;
  const enfoncer = async () => {
    if (Capacitor.isNativePlatform()) {
      const p = await EcoLocation.requestPermissions().catch(() => null);
      if (p?.location !== 'granted') { onToast('Autorise la localisation pour que tes buddies te voient'); return; }
    }
    enfoncerEpingle(x.id);
    onToast('📍 Tes buddies te voient jusqu\'à ce soir');
  };
  return <>
    {autres.map((r) => <div key={r.b.id} className={`bd-pos-ligne${r.actif ? '' : ' vieux'}`}>
      <Visage b={r.b} taille={44} />
      <span className="bd-texte"><b>{r.b.pseudo}</b><small>{detail(r, moi) || ' '}</small></span>
      <b>{etiquette(r)}</b>
    </div>)}
    {!autres.length && <p className="hint">Personne n'est visible pour l'instant : chacun choisit d'enfoncer son épingle 📍.</p>}
    {ici ? <div className="bd-epingle oui">
      <span className="bd-epingle-icone">📍</span>
      <span className="bd-texte"><b>Mes buddies me voient</b><small>depuis {heureCourte(ici.depuis)} · s'arrête seul à {heureCourte(ici.jusqu)}</small></span>
      <button onClick={() => { releverEpingle(x.id); onToast('📍 Épingle relevée : tes buddies ne te voient plus'); }}>Arrêter</button>
    </div> : <button className="primary bd-grand" onClick={() => void enfoncer()}>📍 Mes buddies peuvent me voir</button>}
    <p className="hint">{ici ? 'Sans réseau, tes positions sont gardées avec leur heure et partent au retour.'
      : 'Ta position part toutes les 5 minutes, jusqu\'à ce soir, seulement vers les buddies de ce Buddy Time.'}</p>
  </>;
}

export const nombreVisibles = (rs: Repere[]) => rs.filter((r) => r.actif && !r.moi).length;
export { useReperes };

/**
 * Tant que mon épingle est enfoncée : le service natif envoie une position toutes les 5 minutes, écran éteint
 * compris ; dans un navigateur, toutes les 5 minutes tant que la page est ouverte. À brancher une fois (App).
 */
export function useEpingle() {
  const e = useBuddies();
  const jusqu = monEpingle(e)?.jusqu;
  useEffect(() => {
    if (!jusqu) return;
    if (Capacitor.isNativePlatform()) {
      let h: { remove: () => Promise<void> } | undefined, fini = false;
      void (async () => {
        const d = await Natif.derniere().catch(() => ({ position: undefined }));
        if (d.position) envoyerPosition(d.position);
        await Natif.epingler({ jusqu });
        const l = await Natif.addListener('position', (p) => envoyerPosition(p));
        if (fini) void l.remove(); else h = l;
      })().catch(() => undefined);
      return () => { fini = true; void h?.remove(); void Natif.relever().catch(() => undefined); };
    }
    const prendre = () => navigator.geolocation?.getCurrentPosition(
      (p) => envoyerPosition({ lat: p.coords.latitude, lon: p.coords.longitude, alt: p.coords.altitude, t: p.timestamp }),
      () => undefined, { maximumAge: 60_000, timeout: 30_000 });
    prendre();
    const t = setInterval(prendre, 5 * 60_000);
    const fin = setTimeout(() => clearInterval(t), Math.max(0, jusqu - Date.now()));
    return () => { clearInterval(t); clearTimeout(fin); };
  }, [jusqu]);
}
