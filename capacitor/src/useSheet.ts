import { useRef, useState, type PointerEvent } from 'react';

/** Crans d'un panneau du bas : 0 réduit (titre seul), 1 moyen (moitié de l'écran), 2 plein. */
export type Cran = 0 | 1 | 2;

function lire(cle: string, defaut: Cran): Cran {
  try { const v = localStorage.getItem(`cran:${cle}`); return v === '0' || v === '1' || v === '2' ? (Number(v) as Cran) : defaut; }
  catch { return defaut; }
}

/**
 * Poignée des panneaux du bas (maquettes/poignee, Seb 25/11) : on glisse la poignée fine ou toute la
 * barre de titre pour régler la hauteur, le panneau se cale sur le cran le plus proche ; un simple appui
 * passe au cran suivant. Chaque panneau garde son dernier cran (`cle`).
 * `masque` : au cran réduit, la feuille de style cache tout sauf la prise (sinon le panneau s'en charge).
 */
export function useSheet(cle: string, { defaut = 1 as Cran, masque = true, depart = undefined as Cran | undefined } = {}) {
  // `depart` : cran à l'ouverture qui ne tient pas compte du dernier choix (le menu de l'appli démarre fermé).
  const [cran, setCranBrut] = useState<Cran>(() => depart ?? lire(cle, defaut));
  const glisse = useRef<{ y0: number; h0: number; bouge: boolean; panneau: HTMLElement } | null>(null);

  const setCran = (c: Cran | ((avant: Cran) => Cran)) => setCranBrut((avant) => {
    const n = typeof c === 'function' ? c(avant) : c;
    try { localStorage.setItem(`cran:${cle}`, String(n)); } catch { /* ignoré */ }
    return n;
  });

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button, input, select, textarea, a, label')) return;
    const panneau = e.currentTarget.parentElement;
    if (!panneau) return;
    glisse.current = { y0: e.clientY, h0: panneau.offsetHeight, bouge: false, panneau };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const g = glisse.current;
    if (!g) return;
    const dy = g.y0 - e.clientY;
    if (!g.bouge && Math.abs(dy) < 8) return;
    g.bouge = true;
    const haut = g.panneau.parentElement?.clientHeight ?? window.innerHeight;
    g.panneau.classList.add('glisse');
    g.panneau.style.maxHeight = 'none';
    g.panneau.style.height = `${Math.max(e.currentTarget.offsetHeight, Math.min(haut - 72, g.h0 + dy))}px`;
  };
  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const g = glisse.current;
    glisse.current = null;
    if (!g) return;
    if (!g.bouge) { setCran((c) => ((c + 1) % 3) as Cran); return; }
    const haut = g.panneau.parentElement?.clientHeight ?? window.innerHeight;
    const h = g.panneau.offsetHeight;
    const crans = [e.currentTarget.offsetHeight, haut * 0.5, haut - 72];
    let c = crans.reduce((m, x, i) => (Math.abs(x - h) < Math.abs(crans[m] - h) ? i : m), 0) as Cran;
    // Un geste franc passe au cran voisin même s'il s'arrête avant la moitié du chemin.
    const dy = g.y0 - e.clientY;
    if (c === cran && Math.abs(dy) > 60) c = Math.max(0, Math.min(2, cran + Math.sign(dy))) as Cran;
    g.panneau.classList.remove('glisse');
    g.panneau.style.height = '';
    g.panneau.style.maxHeight = '';
    setCran(c);
  };

  return {
    cran, setCran,
    /** Classes à ajouter au panneau. */
    classe: ` cran-${cran}${masque ? ' cran-masque' : ''}`,
    /** À poser sur la zone de prise (poignée + barre de titre), premier enfant du panneau. */
    prise: { className: 'sheet-grip', onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}
