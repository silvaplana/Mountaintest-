import { useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import type { BaseMode } from '../config';
import type { Trail } from '../trails/osmTrails';
import { saveTrace } from '../trails/savedTraces';
import { appelEnCours, envoyerCarte, suivreCartes, type Calques } from './appel';
import type { LonLat } from '../trails/osmTrails';
import { useAppel } from './Appel';
import { tracesAEnvoyer, tracesAMontrer, tracesInvitees, type TraceEnvoyee } from './carteSuivie';
import { isMine } from '../trails/route';
import { noterDetail } from './journal';

const FONDS: string[] = ['auto', 'scan25', 'planign'];
/** Identifiants des traces invitées à part : le trait en direct et la trace du profil. */
const ID_TRAIT = 9e12 + 500, ID_PROFIL = 9e12 + 900;
const CALQUE_TRAIT = 'suivie-trait';
const r5 = (l: LonLat[]) => l.map((p) => [+p.lon.toFixed(5), +p.lat.toFixed(5)] as [number, number]);

/** ✏ Le trait que je dessine part en direct (4 fois par seconde au plus) quand je montre ma carte. */
let traitT = 0, traitFin: ReturnType<typeof setTimeout> | undefined;
/** Le dernier trait envoyé : renvoyé avec le reste toutes les 4 s, pour qu'un buddy qui a raté un message se rattrape. */
let dernierTrait: [number, number][] = [];
export function envoyerTrait(line: LonLat[]) {
  if (!appelEnCours()?.jeMontre) return;
  clearTimeout(traitFin);
  const envoi = () => {
    traitT = Date.now();
    dernierTrait = r5(tracesAEnvoyer([{ id: 0, name: '', kind: '', rank: 0, color: '', distanceM: 0, segments: [line] }], 300)[0]?.ligne.map(([lon, lat]) => ({ lon, lat })) ?? []);
    envoyerCarte({ trait: dernierTrait });
  };
  if (!line.length || Date.now() - traitT > 250) envoi(); else traitFin = setTimeout(envoi, 250);
}

/**
 * 🗺 « Suis ma carte » (spec/buddies.md §7.10) : celui qui montre envoie sa vue (centre, zoom, fond) et ses traces ;
 * chez les autres, la carte suit et ses traces arrivent en invitées, avec « Garder ».
 */
export function CarteSuivie({ map, fond, onFond, calques, onCalques, profil, onProfil, mes, onInvitees, onToast }: {
  map: MlMap | null; fond: BaseMode; onFond: (f: BaseMode) => void;
  /** Pentes, ombres, drones, météo : mêmes calques chez ceux qui suivent. */
  calques: Calques; onCalques: (c: Calques) => void;
  /** La trace dont le profil est ouvert ; chez ceux qui suivent, le même profil s'ouvre (null : fermé). */
  profil: Trail | null; onProfil: (t: Trail | null) => void;
  /** Les traces affichées sur ma carte (les miennes et les randos) : celles de l'écran partent chez ceux qui suivent. */
  mes: Trail[];
  onInvitees: (t: Trail[]) => void; onToast: (m: string) => void;
}) {
  const e = useAppel();
  const jeMontre = !!e?.jeMontre;
  const suit = e?.suit ?? null;
  const [recues, setRecues] = useState<TraceEnvoyee[]>([]);
  /** Quand je ne suis plus (« Reprendre ma carte », fin d'appel) : garder ses traces ? */
  const [proposer, setProposer] = useState<{ de: string; traces: TraceEnvoyee[] } | null>(null);
  const recuesRef = useRef(recues); recuesRef.current = recues;
  const tracesRecuesCle = useRef('');
  const suitRef = useRef(suit);
  const fondRef = useRef(fond); fondRef.current = fond;
  const mesRef = useRef(mes); mesRef.current = mes;
  const onFondRef = useRef(onFond); onFondRef.current = onFond;
  const calquesRef = useRef(calques); calquesRef.current = calques;
  const onCalquesRef = useRef(onCalques); onCalquesRef.current = onCalques;
  const profilRef = useRef(profil); profilRef.current = profil;
  const onProfilRef = useRef(onProfil); onProfilRef.current = onProfil;
  const [trait, setTrait] = useState<[number, number][]>([]);
  const ecran = (): [number, number, number, number] => {
    const b = map?.getBounds();
    return b ? [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] : [-180, -90, 180, 90];
  };
  const tracesEnvoyees = () => tracesAEnvoyer(tracesAMontrer(mesRef.current, ecran(), isMine));
  const profilEnvoye = (t: Trail | null) => (t && t.id < ID_TRAIT - 1 ? tracesAEnvoyer([t], 400)[0] : null);

  // Je montre : ma vue à chaque mouvement (4 fois par seconde au plus), mes traces au début et quand un buddy arrive.
  useEffect(() => {
    if (!map || !jeMontre) return;
    const vue = () => {
      const c = map.getCenter();
      envoyerCarte({ carte: { c: [+c.lng.toFixed(5), +c.lat.toFixed(5)], z: +map.getZoom().toFixed(2),
        b: Math.round(map.getBearing()), p: Math.round(map.getPitch()), fond: fondRef.current, cq: calquesRef.current } });
    };
    const tout = () => { vue(); envoyerCarte({ traces: tracesEnvoyees() }); envoyerCarte({ profil: profilEnvoye(profilRef.current) }); };
    let t = 0;
    const bouge = () => { const n = Date.now(); if (n - t > 250) { t = n; vue(); } };
    tout();
    map.on('move', bouge); map.on('moveend', vue);
    const stop = suivreCartes(() => undefined, tout);
    // Tout l'état repart toutes les 4 s (vue, traces, trait, profil) : un message perdu se rattrape tout seul.
    const rattrape = setInterval(() => { tout(); envoyerCarte({ trait: dernierTrait }); }, 4000);
    return () => { map.off('move', bouge); map.off('moveend', vue); stop(); clearInterval(rattrape); dernierTrait = []; };
  }, [map, jeMontre]);
  useEffect(() => {
    if (!map || !jeMontre) return;
    const c = map.getCenter();
    envoyerCarte({ carte: { c: [c.lng, c.lat], z: map.getZoom(), b: map.getBearing(), p: map.getPitch(), fond, cq: calques } });
  }, [fond, calques.pente, calques.ombres, calques.drones, calques.meteo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (jeMontre) envoyerCarte({ profil: profilEnvoye(profil) }); }, [profil?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (jeMontre) envoyerCarte({ traces: tracesEnvoyees() }); }, [mes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Je suis : ma carte va où va la sienne.
  useEffect(() => {
    if (!map) return;
    return suivreCartes((m) => {
      if ('carte' in m) {
        const k = m.carte;
        map.easeTo({ center: k.c, zoom: k.z, bearing: k.b, pitch: k.p, duration: 300 });
        if (k.fond !== fondRef.current && FONDS.includes(k.fond)) onFondRef.current(k.fond as BaseMode);
        const cq = k.cq, mien = calquesRef.current;
        if (cq && (cq.pente !== mien.pente || cq.ombres !== mien.ombres || cq.drones !== mien.drones || cq.meteo !== mien.meteo)) onCalquesRef.current(cq);
      } else if ('traces' in m) {
        // Le rattrapage renvoie les mêmes traces toutes les 4 s : ne tout redessiner que si elles ont changé.
        const k = JSON.stringify(m.traces);
        if (k !== tracesRecuesCle.current) { tracesRecuesCle.current = k; setRecues(m.traces); noterDetail('traces reçues changées', m.traces.length, `${m.traces.reduce((a, t) => a + t.ligne.length, 0)} pts`); }
      }
      else if ('trait' in m) setTrait(m.trait);
      else if ('profil' in m) {
        const p = m.profil;
        if (p && p.ligne.length >= 2) onProfilRef.current({ ...tracesInvitees([p], suitRef.current?.pseudo ?? '')[0], id: ID_PROFIL });
        else if (profilRef.current?.id === ID_PROFIL) onProfilRef.current(null);
      } else { setRecues([]); setTrait([]); }
    }, () => undefined);
  }, [map]);
  useEffect(() => {
    const avant = suitRef.current;
    suitRef.current = suit;
    if (avant && avant.id !== suit?.id) {
      const ts = recuesRef.current.filter((t) => t.ligne.length >= 2);
      if (ts.length) setProposer({ de: avant.pseudo, traces: ts });
      setRecues([]); setTrait([]); tracesRecuesCle.current = '';
      if (profilRef.current?.id === ID_PROFIL) onProfilRef.current(null);
    }
  }, [suit?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!suit) { onInvitees([]); return; }
    onInvitees(tracesInvitees(recues, suit.pseudo));
  }, [recues, suit?.pseudo]); // eslint-disable-line react-hooks/exhaustive-deps
  /**
   * ✏ Le trait en direct (Seb, 27/11 : « ça s'écroule quand on trace ») : il arrivait 4 fois par seconde dans les
   * traces de l'appli, qui redessinait alors TOUTES les traces de la carte (flèches, départs, arrivées) et tout
   * l'écran. Il a maintenant son propre petit calque : seule sa ligne change.
   */
  useEffect(() => {
    if (!map) return;
    const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: trait.length >= 2
      ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: trait } }] : [] };
    try {
      const src = map.getSource(CALQUE_TRAIT) as GeoJSONSource | undefined;
      if (src) { src.setData(data); return; }
      if (!trait.length) return;
      map.addSource(CALQUE_TRAIT, { type: 'geojson', data });
      map.addLayer({ id: CALQUE_TRAIT, type: 'line', source: CALQUE_TRAIT, layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#e8590c', 'line-width': 5, 'line-opacity': 0.9 } });
    } catch { /* style en cours de chargement : le prochain envoi (4 s au plus) le pose */ }
  }, [map, trait]);

  if (proposer) {
    const garder = async () => {
      for (const t of proposer.traces) await saveTrace(t.nom, t.ligne.map(([lon, lat]) => ({ lon, lat })), false);
      setProposer(null);
      onToast(proposer.traces.length > 1 ? `${proposer.traces.length} traces ajoutées à Mes traces` : `« ${proposer.traces[0].nom} » est dans Mes traces`);
    };
    return <div className="cs-bandeau">
      <div className="cs-titre">Garder les traces de {proposer.de} ?</div>
      {proposer.traces.slice(0, 4).map((t) => <div key={t.id} className="cs-ligne">
        <span className="cs-trait" style={{ background: t.couleur }} /><span className="cs-nom">{t.nom}</span></div>)}
      {proposer.traces.length > 4 && <div className="cs-ligne"><span className="cs-nom">et {proposer.traces.length - 4} autres</span></div>}
      <div className="cs-ligne cs-choix">
        <button className="cs-reprendre" onClick={() => setProposer(null)}>Non merci</button>
        <button className="cs-garder" onClick={() => void garder()}>Garder</button>
      </div>
    </div>;
  }
  // Pendant le suivi, tout est dans la barre d'appel (BarreSuivie).
  return null;
}
