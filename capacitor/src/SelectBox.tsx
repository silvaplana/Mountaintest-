import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { TrashIcon } from './icones';
import type { Trail } from './trails/osmTrails';
import type { SavedTrace } from './trails/savedTraces';
import { squareBbox, squaresInBbox } from './tiles/coverage';
import { formatBytes } from './Usage';

/** Calque « Hors ligne » allumé : le rectangle prend aussi les tuiles (carrés) et toutes mes traces (Seb, 26/11). */
export interface OfflineSel {
  saved: SavedTrace[];
  owned: Set<string>;
  squaresBytes: (sq: string[]) => Promise<number>;
  /** Poids moyen d'une tuile gardée, pour estimer celles à télécharger. */
  avg: number;
  onDeleteTraces: (ids: number[]) => () => void;
  onDeleteSquares: (sq: string[]) => () => void;
  onDownload: (sq: string[]) => void;
}

const boxPoly = ([w, s, e, n]: number[]) => [[[w, n], [e, n], [e, s], [w, s], [w, n]]];

type Pt = { x: number; y: number };
/** Ce que le rectangle attrape : des traces entières et des épingles (trace, numéro). */
export interface Prise { traces: number[]; pins: { id: number; i: number }[] }

/**
 * ⬚ Rectangle de sélection (Seb, 25/11) : un appui long sur la carte ouvre un rectangle qu'on étire du doigt ;
 * mes traces et les épingles dedans sont prises, puis la poubelle les efface (« ↶ Annuler » pendant quelques secondes).
 * Une trace est prise dès qu'un de ses points est dans le rectangle.
 */
export function SelectBox({ map, depart, trails, onFin, onEffacer, offline }: {
  map: MlMap; depart: Pt; trails: Trail[]; onFin: () => void; offline?: OfflineSel;
  /** Efface la prise ; rend de quoi annuler. */
  onEffacer: (p: Prise) => () => void;
}) {
  const [a, setA] = useState<Pt>(depart);
  const [b, setB] = useState<Pt>(depart);
  const [tire, setTire] = useState(true);
  const [annuler, setAnnuler] = useState<(() => void) | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = map.getContainer().getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // Le doigt de l'appui long est encore posé (sur la carte) : on suit ses déplacements sur toute la page.
  // Sur Android, le navigateur peut reprendre ce doigt pour faire défiler (pointercancel, puis plus aucun
  // pointermove) : on bloque ce défilement sur la carte et on suit aussi les événements tactiles, qui continuent.
  useEffect(() => {
    if (!tire) return;
    map.dragPan.disable();
    const zone = map.getCanvasContainer();
    const avant = zone.style.touchAction;
    zone.style.touchAction = 'none';
    const move = (e: PointerEvent) => setB(local(e));
    const touchMove = (e: TouchEvent) => { const t = e.touches[0]; if (t) { e.preventDefault(); setB(local(t)); } };
    const up = () => setTire(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('touchmove', touchMove, { passive: false });
    window.addEventListener('touchend', up);
    window.addEventListener('touchcancel', up);
    return () => {
      map.dragPan.enable();
      zone.style.touchAction = avant;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('touchmove', touchMove);
      window.removeEventListener('touchend', up);
      window.removeEventListener('touchcancel', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tire, map]);

  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const dedans = (lon: number, lat: number) => {
    const p = map.project([lon, lat]);
    return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
  };
  const prise: Prise = { traces: [], pins: [] };
  if (x1 - x0 > 8 && y1 - y0 > 8) for (const t of trails) {
    if (t.segments.some((s) => s.some((p) => dedans(p.lon, p.lat)))) prise.traces.push(t.id);
    else (t.pins ?? []).forEach((p, i) => { if (dedans(p.lon, p.lat)) prise.pins.push({ id: t.id, i }); });
  }
  const rien = !prise.traces.length && !prise.pins.length;

  // Calque « Hors ligne » : tuiles touchées (cadre toujours rectangulaire) et traces gardées touchées.
  const assez = x1 - x0 > 8 && y1 - y0 > 8;
  const sel = (() => {
    if (!offline || !assez) return null;
    const nw = map.unproject([x0, y0]), se = map.unproject([x1, y1]);
    const { squares, frame } = squaresInBbox([nw.lng, se.lat, se.lng, nw.lat]);
    return {
      frame, own: squares.filter((p) => offline.owned.has(p)), miss: squares.filter((p) => !offline.owned.has(p)),
      traces: offline.saved.filter((t) => t.line.some(([lon, lat]) => dedans(lon, lat))).map((t) => t.id),
    };
  })();
  const [effaceCadre, setEffaceCadre] = useState(false);
  const selKey = sel ? `${sel.own.join()}|${sel.miss.join()}` : '';
  const [ownBytes, setOwnBytes] = useState(0);
  useEffect(() => {
    if (!offline || !sel || effaceCadre) return;
    void offline.squaresBytes(sel.own).then(setOwnBytes);
    const src = map.getSource('offlineSel') as GeoJSONSource | undefined;
    src?.setData({ type: 'FeatureCollection', features: [
      ...sel.own.map((p) => ({ type: 'Feature' as const, properties: { k: 'own' }, geometry: { type: 'Polygon' as const, coordinates: boxPoly(squareBbox(p)) } })),
      ...sel.miss.map((p) => ({ type: 'Feature' as const, properties: { k: 'miss' }, geometry: { type: 'Polygon' as const, coordinates: boxPoly(squareBbox(p)) } })),
      { type: 'Feature', properties: { k: 'frame' }, geometry: { type: 'LineString', coordinates: sel.frame } },
    ] });
  }, [selKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Cadre des tuiles effacé à la fermeture, et dès qu'on a supprimé (pendant « Annuler », il ne veut plus rien dire).
  useEffect(() => {
    const vide = () => { (map.getSource('offlineSel') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [] }); };
    if (effaceCadre) vide();
    return vide;
  }, [map, effaceCadre]);

  // Les traces prises en surbrillance jaune, pendant qu'on étire.
  useEffect(() => {
    if (!map.getLayer('trails')) return;
    const ids = prise.traces;
    map.setPaintProperty('trails', 'line-width', ids.length ? ['case', ['in', ['get', 'id'], ['literal', ids]], 8, 4] : 4);
    return () => { if (map.getLayer('trails')) map.setPaintProperty('trails', 'line-width', 4); };
  }, [map, prise.traces.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const fin = useRef(onFin);
  fin.current = onFin;
  useEffect(() => {
    if (!annuler) return;
    const t = setTimeout(() => fin.current(), 6000);
    return () => clearTimeout(t);
  }, [annuler]);

  if (annuler) return (
    <div className={offline ? 'sel-barre sel-haut' : 'sel-barre'}>
      <span>Effacé</span>
      <button className="primary" onClick={() => { annuler(); onFin(); }}>↶ Annuler</button>
    </div>
  );

  return (
    <>
      <div ref={box} className="sel-voile"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const p = local(e); setA(p); setB(p); }}
        onPointerMove={(e) => { if (e.buttons || e.pointerType === 'touch') setB(local(e)); }}>
        <div className="sel-rect" style={{ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }} />
      </div>
      {/* Calque Hors ligne : petit encart en haut de l'écran, pour ne pas gêner le panneau du bas (Seb, 26/11). */}
      {offline ? (
        <div className="sel-panneau sel-haut">
          <div className="travel-head"><b>{sel ? 'Sélection' : 'Étire le rectangle'}</b>
            <span className="head-btns"><button onClick={onFin} aria-label="Fermer la sélection">✕</button></span></div>
          {sel && sel.traces.length > 0 && <div className="sel-ligne">
            <span><b>{sel.traces.length} trace{sel.traces.length > 1 ? 's' : ''}</b><small>retirée{sel.traces.length > 1 ? 's' : ''} du téléphone</small></span>
            <button className="sel-effacer" aria-label="Supprimer ces traces" onClick={() => { setEffaceCadre(true); setAnnuler(() => offline.onDeleteTraces(sel.traces)); }}><TrashIcon size={28} /></button>
          </div>}
          {/* Deux lignes pour les tuiles (Seb, 26/11) : celles gardées avec la poubelle, puis celles à télécharger. */}
          {sel && <div className="sel-ligne">
            <span><b>{sel.own.length} tuile{sel.own.length > 1 ? 's' : ''} téléchargée{sel.own.length > 1 ? 's' : ''}</b>
              <small>{sel.own.length ? formatBytes(ownBytes) : 'rien à enlever'}</small></span>
            {sel.own.length > 0 && <button className="sel-effacer" aria-label="Supprimer ces tuiles" onClick={() => { setEffaceCadre(true); setAnnuler(() => offline.onDeleteSquares(sel.own)); }}><TrashIcon size={28} /></button>}
          </div>}
          {sel && <div className="sel-ligne">
            <span><b>{sel.miss.length} tuile{sel.miss.length > 1 ? 's' : ''} à ajouter</b>
              <small>{sel.miss.length ? `≈ ${formatBytes(sel.miss.length * offline.avg)}` : 'tout est déjà là'}</small></span>
            {sel.miss.length > 0 && <button className="primary sel-telecharger" onClick={() => { offline.onDownload(sel.miss); onFin(); }}>Télécharger</button>}
          </div>}
        </div>
      ) : <div className="sel-barre">
        <span>{rien ? 'Étire le rectangle sur des traces ou des 📍'
          : [prise.traces.length && `${prise.traces.length} trace${prise.traces.length > 1 ? 's' : ''}`,
            prise.pins.length && `${prise.pins.length} 📍`].filter(Boolean).join(' · ')}</span>
        <button className="sel-effacer" disabled={rien} aria-label="Effacer la sélection"
          onClick={() => { const u = onEffacer(prise); setAnnuler(() => u); }}><TrashIcon size={28} /></button>
        <button onClick={onFin} aria-label="Fermer la sélection">✕</button>
      </div>}
    </>
  );
}
