import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';
import { Capacitor } from '@capacitor/core';
import { EcoLocation } from '../gps/ecoLocation';
import { Natif, useBuddies, Visage } from './Buddies';
import { detail, etiquette, heureCourte, opacite, pendant, reperes, reperesTous, type Repere } from './positions';
import {
  appliquer, aujourdhui, autreDuDuo, enfoncerEpingle, envoyerPosition, finEpingle, memeCible, mesEpingles, monEpingle, positions, releverEpingle, vue,
  type CiblePosition, type Etat, type Groupe, type Sortie,
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

/** « Marc Dupont » → « MD », « Seb » → « S ». */
export const initiales = (pseudo: string) => pseudo.trim().split(/\s+/).slice(0, 2).map((m) => m[0] ?? '').join('').toUpperCase();

/** Les buddies sur la carte : une tête d'épingle à leurs initiales et l'heure de leur dernière position. */
export function PositionsSurCarte({ map, x }: { map: MlMap | null; x: Sortie }) {
  return <VisagesSurCarte map={map} rs={useReperes(x)} />;
}

function VisagesSurCarte({ map, rs }: { map: MlMap | null; rs: Repere[] }) {
  const cle = rs.map((r) => `${r.b.id}${r.p.lat}${r.p.lon}${etiquette(r)}${r.actif}`).join();
  useEffect(() => {
    if (!map || !rs.length) return;
    const ms = rs.map((r) => {
      // Tête d'épingle aux initiales, piquée sur son aiguille, et l'heure de la dernière position (Seb, 26/11).
      const el = document.createElement('div');
      el.className = 'bd-pos-carte';
      el.style.opacity = String(opacite(r));
      const t = document.createElement('span');
      t.className = 'bd-tete';
      t.textContent = initiales(r.b.pseudo);
      const b = document.createElement('b');
      b.className = r.moi ? 'moi' : r.actif ? '' : 'vieux';
      b.textContent = r.moi ? 'toi' : heureCourte(r.p.prise_le);
      el.append(t, document.createElement('i'), b);
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
    onToast(messagePartage(x.nom));
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
      <button onClick={() => { releverEpingle({ sortie: x.id }); onToast(MESSAGE_ARRET); }}>Arrêter</button>
    </div> : <button className="primary bd-grand" onClick={() => void enfoncer()}>📍 Mes buddies peuvent me voir</button>}
    <p className="hint">{ici ? 'Sans réseau, tes positions sont gardées avec leur heure et partent au retour.'
      : 'Ta position part toutes les 5 minutes, jusqu\'à 19 h, seulement vers les buddies de cette sortie.'}</p>
  </>;
}

/** « 19 h », « 23 h 59 ». */
const heureRonde = (ms: number) => heureCourte(ms).replace(/ h 00$/, ' h');

/** Le message de 3 secondes quand ma position part (Seb, 26/11). */
export const messagePartage = (nom: string, jusqu = finEpingle()) =>
  `Ta position est partagée : les buddies de ${nom} te voient jusqu'à ${heureRonde(jusqu)}, s'il y a du réseau.`;
const MESSAGE_ARRET = "Ta position n'est plus partagée : plus personne ne te voit.";

/**
 * Le bouton de la colonne, un interrupteur (Seb, 26/11) : allumée, on l'éteint partout ; éteinte, on partage avec
 * le groupe ou la sortie ouverte. Hors groupe et hors sortie, on ouvre l'écran pour choisir qui.
 */
export async function basculerPosition(e: Etat, ici: { cible: CiblePosition; nom: string } | undefined, onToast: (m: string) => void, choisir: () => void) {
  if (mesEpingles(e).length) { releverEpingle(); onToast(MESSAGE_ARRET); return; }
  if (!ici) { choisir(); return; }
  if (!(await autoriser(onToast))) return;
  enfoncerEpingle([ici.cible]);
  onToast(messagePartage(ici.nom));
}

async function autoriser(onToast: (m: string) => void) {
  if (!Capacitor.isNativePlatform()) return true;
  const p = await EcoLocation.requestPermissions().catch(() => null);
  if (p?.location !== 'granted') onToast('Autorise la localisation pour que tes buddies te voient');
  return p?.location === 'granted';
}

/** Tous les buddies que je connais (membres de mes groupes, participants de mes sorties). */
function useTous() {
  const e = useBuddies();
  const gens = [...appliquer(e).flatMap((g) => g.membres), ...vue(e).sorties.flatMap((x) => x.participants)];
  return reperesTous(positions(e), gens, e.moi ?? 'moi');
}

/**
 * Ma position dans la colonne (choix 4 de Seb, 26/11) : un buddy au trait ; allumée, des ondes de chaque côté battent
 * doucement (animation CSS `.bd-ondes`, presque rien pour la batterie : c'est le GPS qui coûte).
 */
export function BuddyOndesIcon({ on, size = 30 }: { on: boolean; size?: number }) {
  return <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor"
    strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" overflow="visible">
    <circle cx="24" cy="17" r="5.5" />
    <path d="M14 38a10 10 0 0 1 20 0" />
    {on && <g className="bd-ondes">
      <path d="M10 14a16 16 0 0 0 0 16M38 14a16 16 0 0 1 0 16" />
      <path d="M5 10a22 22 0 0 0 0 24M43 10a22 22 0 0 1 0 24" />
    </g>}
  </svg>;
}

/**
 * 📍 de la colonne de Buddies (spec §7.14) : partager ma position avec un ou plusieurs groupes, même hors
 * Sortie (même épingle : toutes les 5 minutes, jusqu'à ce soir), et voir les buddies qui se montrent.
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
  // Avec qui : mes bandes, les sorties d'aujourd'hui, puis les buddies de mes discussions à deux.
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
    const l = choix.filter((o) => qui.has(cle(o.c)));
    enfoncerEpingle(l.map((o) => o.c));
    onToast(messagePartage(l.map((o) => o.nom).join(', ')));
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
      <button onClick={() => { releverEpingle(); onToast(MESSAGE_ARRET); }}>Arrêter</button>
    </div> : <>
      <h3 className="bd-section">Qui peut me voir ?</h3>
      {choix.length ? <div className="bd-qui bd-qui-noms">
        {choix.map((o) => <button key={cle(o.c)} className={qui.has(cle(o.c)) ? 'oui' : ''}
          onClick={() => setQui((q) => { const n = new Set(q); if (n.has(cle(o.c))) n.delete(cle(o.c)); else n.add(cle(o.c)); return n; })}>
          <Visage b={o.visage} taille={48} /><small>{qui.has(cle(o.c)) ? '✓ ' : ''}{o.nom}</small></button>)}
      </div> : <p className="hint">Crée d'abord un groupe avec tes copains.</p>}
      <span style={{ flex: 1 }} />
      <button className="primary bd-grand" disabled={!qui.size} onClick={() => void enfoncer()}>📍 Mes buddies peuvent me voir</button>
    </>}
    <p className="hint">{mes.length ? 'Sans réseau, tes positions sont gardées avec leur heure et partent au retour.'
      : 'Ta position part toutes les 5 minutes, jusqu\'à 19 h, seulement vers les buddies choisis.'}</p>
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
