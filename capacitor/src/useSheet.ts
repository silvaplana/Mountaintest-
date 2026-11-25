import { useRef, useState, type PointerEvent } from 'react';

/** Crans d'un panneau du bas : 0 réduit (titre seul), 1 moyen (moitié de l'écran), 2 plein ; une hauteur libre glissée les remplace. */
export type Cran = 0 | 1 | 2;

function lire(cle: string, defaut: Cran): Cran {
  try { const v = localStorage.getItem(`cran:${cle}`); return v === '0' || v === '1' || v === '2' ? (Number(v) as Cran) : defaut; }
  catch { return defaut; }
}

function lireHauteur(cle: string): number | null {
  try { const v = Number(localStorage.getItem(`hauteur:${cle}`)); return v > 0 && v <= 1 ? v : null; }
  catch { return null; }
}

/**
 * Poignée des panneaux du bas (maquettes/poignee, Seb 25/11) : on glisse la poignée fine ou toute la
 * barre de titre, et le panneau reste à la hauteur où on le lâche (Seb : pas de cran imposé), entre
 * réduit (titre seul) et plein. Lâché tout en bas, il se réduit. Un simple appui réduit ou rouvre.
 * Chaque panneau garde son état et sa hauteur (`cle`) ; tant qu'on ne l'a jamais glissé, le cran
 * 1 (moitié de l'écran) ou 2 (plein) donne sa hauteur.
 * `masque` : au cran réduit, la feuille de style cache tout sauf la prise (sinon le panneau s'en charge).
 */
export function useSheet(cle: string, { defaut = 1 as Cran, masque = true, depart = undefined as Cran | undefined } = {}) {
  // `depart` : cran à l'ouverture qui ne tient pas compte du dernier choix (le menu de l'appli démarre fermé).
  const [cran, setCranBrut] = useState<Cran>(() => depart ?? lire(cle, defaut));
  // Hauteur libre choisie à la poignée, en part de l'écran (null : jamais glissé).
  const [hauteur, setHauteur] = useState<number | null>(() => lireHauteur(cle));
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
    g.panneau.style.setProperty('max-height', 'none', 'important');
    g.panneau.style.setProperty('height', `${Math.max(e.currentTarget.offsetHeight, Math.min(haut - 72, g.h0 + dy))}px`, 'important');
  };
  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const g = glisse.current;
    glisse.current = null;
    if (!g) return;
    if (!g.bouge) { setCran((c) => (c === 0 ? (defaut || 1) as Cran : 0)); return; }
    const haut = g.panneau.parentElement?.clientHeight ?? window.innerHeight;
    const h = g.panneau.offsetHeight;
    g.panneau.classList.remove('glisse');
    g.panneau.style.removeProperty('height');
    g.panneau.style.removeProperty('max-height');
    // Lâché tout près du titre : réduit (la hauteur choisie avant est gardée pour la réouverture).
    if (h < e.currentTarget.offsetHeight + 40) { setCran(0); return; }
    const part = Math.min(1, h / haut);
    setHauteur(part);
    try { localStorage.setItem(`hauteur:${cle}`, part.toFixed(4)); } catch { /* ignoré */ }
    setCran(h > haut * 0.5 ? 2 : 1);
  };

  return {
    cran, setCran,
    /** Classes à ajouter au panneau. */
    classe: ` cran-${cran}${masque ? ' cran-masque' : ''}${hauteur ? ' sheet-libre' : ''}`,
    /** À poser sur la zone de prise (poignée + barre de titre), premier enfant du panneau. */
    prise: {
      className: 'sheet-grip', onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp,
      ref: (el: HTMLDivElement | null) => { if (el && hauteur) el.parentElement?.style.setProperty('--sheet-h', `${(hauteur * 100).toFixed(2)}%`); },
    },
  };
}
