import { useRef, useState, type PointerEvent } from 'react';

const CLE = 'buddies:coulisse';
/** Hauteur gardée en bas pour l'écran : son titre, le dernier message et la case Écrire. */
const RESTE = 220;

function lire(): number {
  try { const v = Number(localStorage.getItem(CLE)); return v > 0 && v < 1 ? v : 0; }
  catch { return 0; }
}

/** Les derniers messages restent en vue quand l'écran change de hauteur. */
export function enBas(ecran: HTMLElement | null) {
  if (!ecran) return;
  const fil = ecran.querySelector<HTMLElement>('.bd-fil');
  if (fil) fil.scrollTop = fil.scrollHeight;
}

/**
 * Messagerie de Buddies qui coulisse sur la carte (Seb, 27/11, maquettes/buddies-coulisse) : ouverte tout en haut,
 * on tire la poignée vers le bas et la carte apparaît au-dessus, utilisable. L'écran reste là où on le lâche et s'y
 * rouvre ; lâché tout près du haut, il remonte en plein écran. Un simple appui sur la poignée passe de l'un à l'autre.
 * `bas` : position du haut de l'écran, en part de la hauteur (0 = tout en haut).
 */
export function useCoulisse() {
  const [bas, setBasBrut] = useState(lire);
  // Dernière position choisie en bas, pour l'appui simple qui redescend.
  const dernier = useRef(lire() || 0.45);
  const glisse = useRef<{ y0: number; top0: number; haut: number; bouge: boolean; ecran: HTMLElement } | null>(null);
  const setBas = (v: number) => {
    setBasBrut(v);
    if (v) dernier.current = v;
    try { localStorage.setItem(CLE, v ? v.toFixed(4) : '0'); } catch { /* ignoré */ }
  };

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    const ecran = e.currentTarget.parentElement;
    const haut = ecran?.parentElement?.clientHeight;
    if (!ecran || !haut) return;
    glisse.current = { y0: e.clientY, top0: ecran.offsetTop, haut, bouge: false, ecran };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const g = glisse.current;
    if (!g) return;
    const dy = e.clientY - g.y0;
    if (!g.bouge && Math.abs(dy) < 8) return;
    g.bouge = true;
    g.ecran.classList.add('coulisse', 'glisse');
    g.ecran.style.top = `${Math.max(0, Math.min(g.haut - RESTE, g.top0 + dy))}px`;
    enBas(g.ecran);
  };
  const onPointerUp = () => {
    const g = glisse.current;
    glisse.current = null;
    if (!g) return;
    if (!g.bouge) { setBas(bas ? 0 : dernier.current); setTimeout(() => enBas(g.ecran), 300); return; }
    const top = g.ecran.offsetTop;
    g.ecran.classList.remove('glisse');
    g.ecran.style.top = '';
    if (!bas) g.ecran.classList.remove('coulisse');
    setBas(top < 60 ? 0 : Math.min(top, g.haut - RESTE) / g.haut);
    requestAnimationFrame(() => setTimeout(() => enBas(g.ecran), 260));
  };

  return {
    bas,
    /** Classe et position à poser sur l'écran de Buddies. */
    classe: bas ? ' coulisse' : '',
    style: bas ? { top: `min(${(bas * 100).toFixed(2)}%, calc(100% - ${RESTE}px))` } : undefined,
    /** La poignée, premier enfant de l'écran. */
    prise: { className: 'bd-poignee', 'aria-label': 'Faire coulisser sur la carte', 'data-help': 'Tirer vers le bas pour voir la carte', onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}
