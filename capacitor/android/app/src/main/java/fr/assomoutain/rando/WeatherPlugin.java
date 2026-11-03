package fr.assomoutain.rando;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Expose Weather au JavaScript : Weather.open({ mountain }) ouvre Météo-France. */
@CapacitorPlugin(name = "Weather")
public class WeatherPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        if (Weather.open(getActivity(), Boolean.TRUE.equals(call.getBoolean("mountain", false)))) call.resolve();
        else call.reject("Impossible d'ouvrir Météo-France");
    }
}
