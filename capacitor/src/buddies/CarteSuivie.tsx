import { useEffect, useRef, useState } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import type { BaseMode } from '../config';
import type { Trail } from '../trails/osmTrails';
import { saveTrace } from '../trails/savedTraces';
import { envoyerCarte, reprendreMaCarte, suivreCartes } from './appel';
import { useAppel } from './Appel';
import { tracesAEnvoyer, tracesInvitees, type TraceEnvoyee } from './carteSuivie';

const FONDS: string[] = ['auto', 'scan25', 'planign'];

/**
 * 🗺 « Suis ma carte » (spec/buddies.md §7.10) : celui qui montre envoie sa vue (centre, zoom, fond) et ses traces ;
 * chez les autres, la carte suit et ses traces arrivent en invitées, avec « Garder ».
 */
export function CarteSuivie({ map, fond, onFond, mes, onInvitees, onToast }: {
  map: MlMap | null; fond: BaseMode; onFond: (f: BaseMode) => void; mes: Trail[];
  onInvitees: (t: Trail[]) => void; onToast: (m: string) => void;
}) {
  const e = useAppel();
  const jeMontre = !!e?.jeMontre;
  const suit = e?.suit ?? null;
  const [recues, setRecues] = useState<TraceEnvoyee[]>([]);
  const [gardees, setGardees] = useState<Set<string>>(new Set());
  const fondRef = useRef(fond); fondRef.current = fond;
  const mesRef = useRef(mes); mesRef.current = mes;
  const onFondRef = useRef(onFond); onFondRef.current = onFond;

  // Je montre : ma vue à chaque mouvement (4 fois par seconde au plus), mes traces au début et quand un buddy arrive.
  useEffect(() => {
    if (!map || !jeMontre) return;
    const vue = () => {
      const c = map.getCenter();
      envoyerCarte({ carte: { c: [+c.lng.toFixed(5), +c.lat.toFixed(5)], z: +map.getZoom().toFixed(2),
        b: Math.round(map.getBearing()), p: Math.round(map.getPitch()), fond: fondRef.current } });
    };
    const tout = () => { vue(); envoyerCarte({ traces: tracesAEnvoyer(mesRef.current) }); };
    let t = 0;
    const bouge = () => { const n = Date.now(); if (n - t > 250) { t = n; vue(); } };
    tout();
    map.on('move', bouge); map.on('moveend', vue);
    const stop = suivreCartes(() => undefined, tout);
    return () => { map.off('move', bouge); map.off('moveend', vue); stop(); };
  }, [map, jeMontre]);
  useEffect(() => {
    if (!map || !jeMontre) return;
    const c = map.getCenter();
    envoyerCarte({ carte: { c: [c.lng, c.lat], z: map.getZoom(), b: map.getBearing(), p: map.getPitch(), fond } });
  }, [fond]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (jeMontre) envoyerCarte({ traces: tracesAEnvoyer(mes) }); }, [mes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Je suis : ma carte va où va la sienne.
  useEffect(() => {
    if (!map) return;
    return suivreCartes((m) => {
      if ('carte' in m) {
        const k = m.carte;
        map.easeTo({ center: k.c, zoom: k.z, bearing: k.b, pitch: k.p, duration: 300 });
        if (k.fond !== fondRef.current && FONDS.includes(k.fond)) onFondRef.current(k.fond as BaseMode);
      } else if ('traces' in m) setRecues(m.traces);
      else setRecues([]);
    }, () => undefined);
  }, [map]);
  useEffect(() => { if (!suit) setRecues([]); }, [suit?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onInvitees(suit ? tracesInvitees(recues, suit.pseudo) : []); }, [recues, suit?.pseudo]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!suit) return null;
  const cle = (t: TraceEnvoyee) => `${suit.id}:${t.id}`;
  const aGarder = recues.filter((t) => t.ligne.length >= 2 && !gardees.has(cle(t))).slice(0, 3);
  const garder = async (t: TraceEnvoyee) => {
    await saveTrace(t.nom, t.ligne.map(([lon, lat]) => ({ lon, lat })), false);
    setGardees((g) => new Set(g).add(cle(t)));
    onToast(`« ${t.nom} » est dans Mes traces`);
  };
  return <div className="cs-bandeau">
    {aGarder.map((t) => <div key={t.id} className="cs-ligne">
      <span className="cs-trait" style={{ background: t.couleur }} />
      <span className="cs-nom">{t.nom}</span>
      <button className="cs-garder" onClick={() => void garder(t)}>Garder</button>
    </div>)}
    <div className="cs-ligne">
      <span className="cs-nom">Tu suis la carte de {suit.pseudo}</span>
      <button className="cs-reprendre" onClick={reprendreMaCarte}>Reprendre ma carte</button>
    </div>
  </div>;
}
