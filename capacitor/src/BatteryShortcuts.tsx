import { useEffect, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';

/** Plugin natif (android/.../BatterySettingsPlugin.java) : ouvre le réglage, Android interdit de couper soi-même. */
const BatterySettings = registerPlugin<{ open(o: { what: string }): Promise<void> }>('BatterySettings');

/** Plugin natif (android/.../PocketMode.java, identique côté Kotlin) : écran noir dans la poche. */
const PocketMode = registerPlugin<{ get(): Promise<{ on: boolean }>; set(o: { on: boolean }): Promise<{ on: boolean }> }>('PocketMode');

const SHORTCUTS: [string, string][] = [['avion', '✈ Avion'], ['wifi', 'Wi-Fi'], ['donnees', 'Données'], ['bluetooth', 'Bluetooth']];

/** Raccourcis « Économie batterie » (même chose côté Kotlin, BatterySettings.java). */
export function BatteryShortcuts() {
  const native = Capacitor.isNativePlatform();
  const [pocket, setPocket] = useState(false);
  useEffect(() => { if (native) PocketMode.get().then((r) => setPocket(r.on)).catch(() => {}); }, [native]);
  return (
    <div className="battery">
      <p className="hint"><b>Économie batterie</b> : le mode avion coupe tout, le GPS et les cartes téléchargées continuent de marcher.</p>
      <div className="row">
        {SHORTCUTS.map(([what, label]) => (
          <button key={what} disabled={!native} onClick={() => void BatterySettings.open({ what })}>{label}</button>
        ))}
      </div>
      <label className="row">
        <input type="checkbox" checked={pocket} disabled={!native}
          onChange={(e) => { const on = e.target.checked; setPocket(on); void PocketMode.set({ on }); }} />
        Mode poche : écran noir dès que le téléphone est vertical 3 s, rallumé à plat ou par 2 secousses
      </label>
      {!native && <p className="hint">(Disponible dans l'appli Android seulement.)</p>}
    </div>
  );
}
