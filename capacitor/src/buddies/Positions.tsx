import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';
import { Capacitor } from '@capacitor/core';
import { EcoLocation } from '../gps/ecoLocation';
import { couleur, Natif, useBuddies, Visage } from './Buddies';
import { detail, etiquette, heureCourte, opacite, pendant, reperes, reperesTous, type Repere } from './positions';
import {
  appliquer, aujourdhui, autreDuDuo, enfoncerEpingle, envoyerPosition, memeCible, mesEpingles, monEpingle, positions, releverEpingle, vue,
  type CiblePosition, type Groupe, type Sortie,
} from './store';

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
  return <VisagesSurCarte map={map} rs={useReperes(x)} />;
}

function VisagesSurCarte({ map, rs }: { map: MlMap | null; rs: Repere[] }) {
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
  const ici = mesEpingles(e).find((p) => p.sortie === x.id);
  const enfoncer = async () => {
    if (!(await autoriser(onToast))) return;
    enfoncerEpingle([{ sortie: x.id }]);
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
      <button onClick={() => { releverEpingle({ sortie: x.id }); onToast('📍 Épingle relevée : tes buddies ne te voient plus'); }}>Arrêter</button>
    </div> : <button className="primary bd-grand" onClick={() => void enfoncer()}>📍 Mes buddies peuvent me voir</button>}
    <p className="hint">{ici ? 'Sans réseau, tes positions sont gardées avec leur heure et partent au retour.'
      : 'Ta position part toutes les 5 minutes, jusqu\'à ce soir, seulement vers les buddies de ce Buddy Time.'}</p>
  </>;
}

async function autoriser(onToast: (m: string) => void) {
  if (!Capacitor.isNativePlatform()) return true;
  const p = await EcoLocation.requestPermissions().catch(() => null);
  if (p?.location !== 'granted') onToast('Autorise la localisation pour que tes buddies te voient');
  return p?.location === 'granted';
}

/** Tous les buddies que je connais (membres de mes Buddy Groups, participants de mes Buddy Times). */
function useTous() {
  const e = useBuddies();
  const gens = [...appliquer(e).flatMap((g) => g.membres), ...vue(e).sorties.flatMap((x) => x.participants)];
  return reperesTous(positions(e), gens, e.moi ?? 'moi');
}

/** Icône 📍 au trait fin (comme le micro), pour la colonne de Buddies. */
export function PinIcon({ size = 26 }: { size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.4" />
  </svg>;
}

/**
 * 📍 de la colonne de Buddies (spec §7.14) : partager ma position avec un ou plusieurs Buddy Groups, même hors
 * Buddy Time (même épingle : toutes les 5 minutes, jusqu'à ce soir), et voir les buddies qui se montrent.
 */
export function MaPosition({ groupes, sorties, ici, onVoir, onRetour, onClose, onToast }: {
  groupes: Groupe[]; sorties: Sortie[]; ici?: CiblePosition; onVoir: (r: Repere) => void; onRetour: () => void; onClose: () => void;
  onToast: (m: string) => void;
}) {
  const e = useBuddies();
  const rs = useTous();
  const moi = rs.find((r) => r.moi);
  const autres = rs.filter((r) => !r.moi);
  const mes = mesEpingles(e);
  // Avec qui : mes bandes, les Buddy Times d'aujourd'hui, puis les buddies de mes discussions à deux.
  const choix = [
    ...groupes.filter((g) => g.nature === 'bande').map((g) => ({ c: { groupe: g.id } as CiblePosition, nom: g.nom, visage: { id: g.id, nom: g.nom, photo: g.photo } })),
    ...sorties.filter((x) => pendant(x, aujourdhui()) && x.participants.length > 1)
      .map((x) => ({ c: { sortie: x.id } as CiblePosition, nom: x.nom, visage: { id: x.id, nom: x.nom, photo: x.photo } })),
    ...groupes.filter((g) => g.nature === 'duo').flatMap((g) => {
      const a = autreDuDuo(g, e);
      return a ? [{ c: { groupe: g.id } as CiblePosition, nom: a.pseudo ?? '', visage: a }] : [];
    }),
  ];
  const cle = (c: CiblePosition) => c.groupe ? `g${c.groupe}` : `s${c.sortie}`;
  const [qui, setQui] = useState<Set<string>>(() => new Set(choix.filter((o, _i, l) => (ici ? memeCible(o.c, ici) : l.length === 1)).map((o) => cle(o.c))));
  const nomDe = (p: { sortie?: string; groupe?: string }) => choix.find((o) => memeCible(p, o.c))?.nom
    ?? groupes.find((g) => g.id === p.groupe)?.nom ?? sorties.find((x) => x.id === p.sortie)?.nom ?? '';
  const enfoncer = async () => {
    if (!(await autoriser(onToast))) return;
    enfoncerEpingle(choix.filter((o) => qui.has(cle(o.c))).map((o) => o.c));
    onToast('📍 Tes buddies te voient jusqu\'à ce soir');
  };
  return <div className="bd-corps">
    <div className="xp-head"><button onClick={onRetour} aria-label="Retour">‹</button><h2>📍 Position</h2><button onClick={onClose} aria-label="Fermer">✕</button></div>
    {autres.map((r) => <button key={r.b.id} className={`bd-ligne bd-pos-ligne${r.actif ? '' : ' vieux'}`} onClick={() => onVoir(r)}>
      <Visage b={r.b} taille={44} />
      <span className="bd-texte"><b>{r.b.pseudo}</b><small>{detail(r, moi) || ' '}</small></span>
      <b>{etiquette(r)}</b>
    </button>)}
    {!autres.length && <p className="hint">Personne n'est visible pour l'instant : chacun choisit d'enfoncer son épingle 📍.</p>}
    {mes.length ? <div className="bd-epingle oui">
      <span className="bd-epingle-icone">📍</span>
      <span className="bd-texte"><b>Mes buddies me voient</b>
        <small>{mes.map(nomDe).filter(Boolean).join(', ')} · depuis {heureCourte(mes[0].depuis)} · s'arrête seul à {heureCourte(mes[0].jusqu)}</small></span>
      <button onClick={() => { releverEpingle(); onToast('📍 Épingle relevée : tes buddies ne te voient plus'); }}>Arrêter</button>
    </div> : <>
      <h3 className="bd-section">Qui peut me voir ?</h3>
      {choix.length ? <div className="bd-qui bd-qui-noms">
        {choix.map((o) => <button key={cle(o.c)} className={qui.has(cle(o.c)) ? 'oui' : ''}
          onClick={() => setQui((q) => { const n = new Set(q); if (n.has(cle(o.c))) n.delete(cle(o.c)); else n.add(cle(o.c)); return n; })}>
          <Visage b={o.visage} taille={48} /><small>{qui.has(cle(o.c)) ? '✓ ' : ''}{o.nom}</small></button>)}
      </div> : <p className="hint">Crée d'abord un Buddy Group avec tes copains.</p>}
      <span style={{ flex: 1 }} />
      <button className="primary bd-grand" disabled={!qui.size} onClick={() => void enfoncer()}>📍 Mes buddies peuvent me voir</button>
    </>}
    <p className="hint">{mes.length ? 'Sans réseau, tes positions sont gardées avec leur heure et partent au retour.'
      : 'Ta position part toutes les 5 minutes, jusqu\'à ce soir, seulement vers les buddies choisis.'}</p>
  </div>;
}

/** Sur la carte, après un toucher dans la liste : tous les visages visibles, centrée sur celui choisi. */
export function PositionsBuddiesSurCarte({ map, centre }: { map: MlMap | null; centre: string }) {
  const rs = useTous();
  const fait = useRef(false);
  const r = rs.find((x) => x.b.id === centre);
  useEffect(() => {
    if (!map || !r || fait.current) return;
    fait.current = true;
    map.flyTo({ center: [r.p.lon, r.p.lat], zoom: Math.max(map.getZoom(), 14), duration: 600 });
  }, [map, r]);
  return <VisagesSurCarte map={map} rs={rs} />;
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
