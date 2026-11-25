import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import type { Pin } from './trails/edit';
import { decalage } from './doigt';
import { TRASH_SVG } from './icones';
import type { Trail } from './trails/osmTrails';

/** Appui long : le point se déplace ; très long : 🗑 propose de l'enlever (règle de Seb, 25/11). */
const LONG_MS = 450, TRES_LONG_MS = 1400;

/** Une vraie épingle : aiguille et tête ronde (même dessin que le bouton 📍 du menu de la trace). */
export function PinIcon({ size = 26, color = '#d32f2f' }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" strokeLinecap="round">
      <path d="M13.3 10.7 4 20.5" stroke="#555" strokeWidth="1.8" />
      <path d="M11.6 9.8l2.6 2.6" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="16.3" cy="7.7" r="5.4" fill={color} stroke="currentColor" strokeWidth="1.6" />
      <circle cx="14.8" cy="6.2" r="1.3" fill="#fff" />
    </svg>
  );
}

const PIN_SVG = '<svg viewBox="0 0 30 30" width="30" height="30" aria-hidden="true"><path d="M2 28 17 13" stroke="#444" stroke-width="2.2" stroke-linecap="round"/>'
  + '<circle cx="20" cy="10" r="7.5" stroke="#1d2421" stroke-width="1.6"/><circle cx="17.5" cy="7.5" r="2.2" fill="#fff"/></svg>';

/**
 * 📍 Épingles de mes traces sur la carte (maquette validée le 25/11). Un appui choisit l'épingle (son mot à modifier),
 * appui long : on la fait glisser, très long : une 🗑 apparaît au-dessus. Quand 📍 est allumé dans le
 * menu de la trace, toucher la carte pique un nouveau point sur cette trace.
 */
export function PinLayer({ map, trails, pique, targetId, editing, onEditing, onPins, onSelect }: {
  map: MlMap; trails: Trail[];
  /** 📍 allumé : toucher la carte pique un point sur la trace `targetId`. */
  pique: boolean; targetId: number | null;
  /** Point dont on écrit le mot dans le menu de la trace (tête verte). */
  editing: { id: number; i: number } | null; onEditing: (v: { id: number; i: number } | null) => void;
  onPins: (id: number, pins: Pin[]) => void;
  /** Un appui sur une épingle : on ouvre sa trace et on écrit son mot. */
  onSelect: (id: number, i: number) => void;
}) {
  const [del, setDel] = useState<{ id: number; i: number } | null>(null);
  const cb = useRef({ onPins, onEditing, onSelect, targetId, pique });
  cb.current = { onPins, onEditing, onSelect, targetId, pique };

  // Toucher la carte : 📍 allumé, on pique un point ; sinon on range la 🗑.
  useEffect(() => {
    const click = (e: maplibregl.MapMouseEvent) => {
      setDel(null);
      const { pique: on, targetId: id } = cb.current;
      if (!on || id == null) return;
      const t = trails.find((x) => x.id === id);
      if (!t) return;
      const pins = [...(t.pins ?? []), { lon: e.lngLat.lng, lat: e.lngLat.lat, txt: '', vu: true }];
      cb.current.onPins(id, pins);
      cb.current.onEditing({ id, i: pins.length - 1 });
    };
    map.on('click', click);
    return () => { map.off('click', click); };
  }, [map, trails]);

  useEffect(() => {
    const markers: maplibregl.Marker[] = [];
    for (const t of trails) (t.pins ?? []).forEach((p, i) => {
      const el = document.createElement('div');
      const sel = editing?.id === t.id && editing.i === i;
      el.className = `pin${sel ? ' sel' : ''}`;
      el.innerHTML = PIN_SVG;
      el.style.color = sel ? '#2f9e5f' : '#d32f2f';
      el.querySelectorAll('circle')[0].setAttribute('fill', sel ? '#2f9e5f' : '#d32f2f');
      if (p.vu && p.txt) { const s = document.createElement('span'); s.className = 'pin-mot'; s.textContent = p.txt; el.appendChild(s); }
      const mk = new maplibregl.Marker({ element: el, anchor: 'bottom-left', offset: [-2, 2] }).setLngLat([p.lon, p.lat]).addTo(map);
      markers.push(mk);
      const set = (patch: Partial<Pin> | null) => {
        const pins = (t.pins ?? []).slice();
        if (patch) pins[i] = { ...pins[i], ...patch }; else pins.splice(i, 1);
        cb.current.onPins(t.id, pins);
      };
      if (del?.id === t.id && del.i === i) {
        const b = document.createElement('button');
        b.className = 'pin-del'; b.innerHTML = TRASH_SVG; b.setAttribute('aria-label', 'Enlever ce point');
        b.addEventListener('pointerdown', (e) => e.stopPropagation());
        b.addEventListener('click', (e) => { e.stopPropagation(); setDel(null); cb.current.onEditing(null); set(null); });
        el.appendChild(b);
      }
      // Le doigt sur l'épingle ne fait pas bouger la carte.
      for (const ev of ['mousedown', 'touchstart', 'click', 'dblclick']) el.addEventListener(ev, (e) => e.stopPropagation());
      // L'appui long sur un point ne doit pas aussi poser le gros repère « Point choisi sur la carte » (Seb, 25/11).
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
      let t0: { x: number; y: number } | null = null, mode: 'tap' | 'move' | 'del' = 'tap', bouge = false;
      const timers: ReturnType<typeof setTimeout>[] = [];
      const stop = () => { timers.forEach(clearTimeout); timers.length = 0; };
      el.addEventListener('pointerdown', (e) => {
        if ((e.target as HTMLElement).closest('.pin-del')) return;
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);
        t0 = { x: e.clientX, y: e.clientY }; mode = 'tap'; bouge = false;
        timers.push(setTimeout(() => { mode = 'move'; el.classList.add('leve'); navigator.vibrate?.(30); }, LONG_MS));
        timers.push(setTimeout(() => { if (!bouge) { mode = 'del'; el.classList.remove('leve'); navigator.vibrate?.([30, 60, 30]); setDel({ id: t.id, i }); } }, TRES_LONG_MS));
      });
      el.addEventListener('pointermove', (e) => {
        if (!t0) return;
        if (Math.hypot(e.clientX - t0.x, e.clientY - t0.y) > 6) {
          bouge = true;
          if (mode === 'tap') stop();
          if (timers.length && mode === 'move') stop();
        }
        if (mode === 'move' && bouge) {
          const r = map.getContainer().getBoundingClientRect();
          // La pointe de l'épingle 1 cm au-dessus du doigt, pour voir où elle se pique.
          const [dx, dy] = decalage();
          mk.setLngLat(map.unproject([e.clientX - r.left + dx, e.clientY - r.top + dy]));
        }
      });
      const up = () => {
        if (!t0) return;
        stop(); t0 = null; el.classList.remove('leve');
        if (mode === 'move' && bouge) { const ll = mk.getLngLat(); set({ lon: ll.lng, lat: ll.lat }); return; }
        if (mode !== 'tap' || bouge) return;
        // Un appui (sur la tête ou sur le mot) : l'épingle est choisie et son mot s'écrit dans le menu de sa trace
        // (Seb, 25/11 : « sélectionner les épingles… cliquer sur le texte pour le modifier »).
        if (!p.vu) set({ vu: true });
        cb.current.onSelect(t.id, i);
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    return () => markers.forEach((m) => m.remove());
  }, [map, trails, editing, del]);

  return null;
}
