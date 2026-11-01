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
}
