/** Les quatre écrans du ski : sorties (texte), carte des sorties, topos (texte), carte des topos. */
export type SkiMode = 'sorties' | 'carte' | 'topos' | 'carteTopos';
export const SKI_TABS: [SkiMode, string][] = [['sorties', '⛷ Sorties'], ['carte', '🗺 Carte sorties'], ['topos', '📖 Topos'], ['carteTopos', '🗺 Carte topos']];

/** Onglets en haut des écrans ski (et en tête du panneau du bas sur les cartes). */
export function SkiTabs({ mode, onMode, onClose }: { mode: SkiMode; onMode: (m: SkiMode) => void; onClose?: () => void }) {
  return (
    <div className="ski-tabs" role="tablist">
      {SKI_TABS.map(([m, t]) => (
        <button key={m} role="tab" aria-selected={m === mode} className={m === mode ? 'on' : ''} onClick={() => m !== mode && onMode(m)}>{t}</button>))}
      {onClose && <button className="ski-tabs-close" onClick={onClose} aria-label="Fermer">✕</button>}
    </div>
  );
}
