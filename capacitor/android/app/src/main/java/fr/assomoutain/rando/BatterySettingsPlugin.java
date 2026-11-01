package fr.assomoutain.rando;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Expose BatterySettings au JavaScript : BatterySettings.open({ what: 'avion' | 'wifi' | 'donnees' | 'bluetooth' }). */
@CapacitorPlugin(name = "BatterySettings")
public class BatterySettingsPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        BatterySettings.open(getActivity(), call.getString("what", "avion"));
        call.resolve();
    }

    /** Le mode avion est-il activé ? (Android ne laisse pas une appli le basculer, seulement le lire.) */
    @PluginMethod
    public void airplane(PluginCall call) {
        com.getcapacitor.JSObject r = new com.getcapacitor.JSObject();
        r.put("on", android.provider.Settings.Global.getInt(getContext().getContentResolver(),
            android.provider.Settings.Global.AIRPLANE_MODE_ON, 0) == 1);
        call.resolve(r);
    }
}
