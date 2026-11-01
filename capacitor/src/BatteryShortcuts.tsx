import { Capacitor, registerPlugin } from '@capacitor/core';

/** Plugin natif (android/.../BatterySettingsPlugin.java) : ouvre le réglage, Android interdit de couper soi-même. */
const BatterySettings = registerPlugin<{ open(o: { what: string }): Promise<void> }>('BatterySettings');

const SHORTCUTS: [string, string][] = [['avion', '✈ Avion'], ['wifi', 'Wi-Fi'], ['donnees', 'Données'], ['bluetooth', 'Bluetooth']];

/** Raccourcis « Économie batterie » (même chose côté Kotlin, BatterySettings.java). */
export function BatteryShortcuts() {
  const native = Capacitor.isNativePlatform();
  return (
    <div className="battery">
      <p className="hint"><b>Économie batterie</b> : le mode avion coupe tout, le GPS et les cartes téléchargées continuent de marcher.</p>
      <div className="row">
        {SHORTCUTS.map(([what, label]) => (
          <button key={what} disabled={!native} onClick={() => void BatterySettings.open({ what })}>{label}</button>
        ))}
      </div>
      {!native && <p className="hint">(Disponible dans l'appli Android seulement.)</p>}
    </div>
  );
}
