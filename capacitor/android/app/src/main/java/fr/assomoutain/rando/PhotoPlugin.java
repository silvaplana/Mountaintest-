package fr.assomoutain.rando;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Expose PhotoCapture au JavaScript : Photo.open() ouvre l'application Appareil photo. */
@CapacitorPlugin(name = "Photo")
public class PhotoPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        if (PhotoCapture.open(getActivity())) call.resolve();
        else call.reject("Pas d'appareil photo disponible");
    }
}
