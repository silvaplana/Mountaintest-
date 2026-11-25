/**
 * Poubelle dessinée au trait fin, même style que le micro (Seb, 25/11 : « plus stylisée », plus d'emoji 🗑) :
 * couvercle arrondi avec sa poignée, cuve qui s'affine, deux rayures. Couleur : celle du texte (currentColor).
 */
const TRASH_PATHS = '<path d="M4 6.5h16"/><path d="M9.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v1.5"/>'
  + '<path d="M6 6.5l.9 12.1A2 2 0 0 0 8.9 20.5h6.2a2 2 0 0 0 2-1.9L18 6.5"/><path d="M10.2 10.5v6M13.8 10.5v6"/>';

export function TrashIcon({ size = 24 }: { size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: TRASH_PATHS }} />;
}

/** Même poubelle, en texte SVG pour les éléments posés directement sur la carte (épingles). */
export const TRASH_SVG = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${TRASH_PATHS}</svg>`;

/** Crayon au même trait que la poubelle : changer un nom. */
export function PencilIcon({ size = 24 }: { size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z" /><path d="M13.5 7l3 3" /></svg>;
}
