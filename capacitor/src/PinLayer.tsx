import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import type { Pin } from './trails/edit';
import { decalage } from './doigt';
import { TRASH_SVG } from './icones';
import type { Trail } from './trails/osmTrails';
import { longueurVoiturePx } from './buddies/voitureDessin';

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
 * Une épingle rouge toute simple avec son étiquette au-dessus (positions des buddies, point d'un message) : même
 * dessin que les épingles des traces (Seb, 27/11 : « juste une épingle, comme pour les autres »). La pointe de
 * l'aiguille est le point exact.
 */
/** `visage` : la petite photo ou les initiales (« SR ») devant le nom, dans l'étiquette (Seb, 27/11). */
export function epingleSurCarte(map: MlMap, lon: number, lat: number, texte: string, classe = '',
  visage?: { photo: string | null; initiales: string; couleur: string }) {
  const el = document.createElement('div');
  el.className = 'bd-pin';
  // Au-dessus des voitures : la pointe reste visible.
  el.style.zIndex = '2';
  el.innerHTML = PIN_SVG;
  el.querySelectorAll('circle')[0].setAttribute('fill', '#d32f2f');
  const b = document.createElement('b');
  if (classe) b.className = classe;
  if (visage) {
    const v = document.createElement('i');
    v.style.background = visage.couleur;
    if (visage.photo) {
      const img = document.createElement('img');
      img.src = visage.photo; img.alt = ''; img.referrerPolicy = 'no-referrer';
      img.onerror = () => { img.remove(); v.textContent = visage.initiales; };
      v.appendChild(img);
    } else v.textContent = visage.initiales;
    b.appendChild(v);
  }
  b.append(texte);
  el.appendChild(b);
  el.dataset.lon = String(lon);
  el.dataset.lat = String(lat);
  return new maplibregl.Marker({ element: el, anchor: 'bottom-left', offset: [-2, 2] }).setLngLat([lon, lat]).addTo(map);
}

const rangees = new WeakSet<MlMap>();
type Boite = { l: number; r: number; t: number; b: number };
const boite = (x: Element): Boite => { const r = x.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
const touche = (a: Boite, b: Boite, m = 3) => a.l < b.r + m && a.r > b.l - m && a.t < b.b + m && a.b > b.t - m;
const decale = (a: Boite, dx: number, dy = 0): Boite => ({ l: a.l + dx, r: a.r + dx, t: a.t + dy, b: a.b + dy });

/**
 * Rien ne se superpose (Seb, 27/11 : noms et voitures illisibles l'un sur l'autre) : 1. les épingles et les
 * voitures au même endroit s'écartent juste autour de leur endroit, reliées à lui par un fin trait (propriété CSS `translate`, qui s'ajoute au placement de
 * MapLibre), sans couvrir mon point bleu ; 2. leurs étiquettes s'empilent vers le haut, au-dessus des icônes.
 * Refait après chaque zoom et à chaque nouvelle épingle ou voiture.
 */
/**
 * Une icône écartée de son endroit : un fin trait la relie à son vrai point, marqué d'un rond (Seb, 27/11 : « on ne
 * sait pas où est vraiment la voiture »).
 */
function relier(map: MlMap, m: HTMLElement, dx: number, dy: number) {
  const lon = Number(m.dataset.lon), lat = Number(m.dataset.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
  const p = map.project([lon, lat]);
  const r = m.getBoundingClientRect(), c = map.getContainer().getBoundingClientRect();
  const x = p.x + c.left - r.left, y = p.y + c.top - r.top; // le vrai point, dans l'icône déplacée
  const l = document.createElement('span');
  l.className = 'bd-relie';
  Object.assign(l.style, { left: `${x}px`, top: `${y - 1}px`, width: `${Math.hypot(dx, dy)}px`, transform: `rotate(${Math.atan2(dy, dx)}rad)` });
  m.appendChild(l);
}

const prevus = new WeakSet<MlMap>();
export function rangerEtiquettes(map: MlMap) {
  // Pendant le zoom aussi, à chaque image (Seb, 27/11 : les voitures « ne suivaient pas le zoom »).
  if (!rangees.has(map)) { rangees.add(map); map.on('zoom', () => rangerEtiquettes(map)); }
  if (prevus.has(map)) return;
  prevus.add(map);
  requestAnimationFrame(() => {
    prevus.delete(map);
    const c = map.getContainer();
    // La taille des voitures suit le zoom (bornée) : silhouettes de 96 px de large à l'échelle 1 (styles.css).
    c.style.setProperty('--k-voiture', (longueurVoiturePx(map.getZoom()) / 96).toFixed(3));
    const marques = [...c.querySelectorAll<HTMLElement>('.bd-pin, .bd-voiture-carte')];
    marques.forEach((m) => { m.style.translate = ''; m.querySelector(':scope > .bd-relie')?.remove(); });
    const icone = (m: HTMLElement) => m.querySelector('svg, .bd-auto') ?? m;
    const fixes = [...c.querySelectorAll('.maplibregl-user-location-dot')].map(boite);
    const placees: Boite[] = [...fixes];
    for (const m of marques.map((m) => ({ m, x: boite(icone(m)) })).sort((a, b) => a.x.l - b.x.l)) {
      // Au plus près de son endroit : des cercles de plus en plus grands autour de lui, la première place libre.
      const pas = Math.max(m.x.r - m.x.l, m.x.b - m.x.t) * 0.7 + 6;
      let d = [0, 0];
      for (let k = 1; k <= 6 && placees.some((p) => touche(decale(m.x, d[0], d[1]), p)); k++) {
        const essais = Array.from({ length: 8 * k }, (_, i) => -Math.PI / 2 + (i / (8 * k)) * 2 * Math.PI).map((t) => [Math.round(Math.cos(t) * k * pas), Math.round(Math.sin(t) * k * pas)]);
        const libre = essais.find(([dx, dy]) => !placees.some((p) => touche(decale(m.x, dx, dy), p)));
        if (libre) d = libre; else if (k === 6) d = essais[0];
      }
      const [dx, dy] = d;
      if (dx || dy) m.m.style.translate = `${dx}px ${dy}px`;
      placees.push(decale(m.x, dx, dy));
      if (dx || dy) relier(map, m.m, dx, dy);
    }
    const ls = [...map.getContainer().querySelectorAll<HTMLElement>('.bd-pin b, .bd-voiture-carte b')];
    ls.forEach((b) => b.style.setProperty('--dy', '0px'));
    const rs = ls.map((b) => ({ b, r: b.getBoundingClientRect() })).sort((x, y) => y.r.bottom - x.r.bottom);
    // Les étiquettes passent au-dessus des icônes (déjà écartées) et de mon point, sans les cacher.
    const poses = [...placees];
    for (const { b, r } of rs) {
      let dy = 0;
      for (let n = 0; n < 12; n++) {
        const gene = poses.find((p) => r.left < p.r && r.right > p.l && r.top + dy < p.b && r.bottom + dy > p.t);
        if (!gene) break;
        dy = gene.t - 3 - r.bottom;
      }
      b.style.setProperty('--dy', `${dy}px`);
      poses.push({ l: r.left, r: r.right, t: r.top + dy, b: r.bottom + dy });
    }
  });
}

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
