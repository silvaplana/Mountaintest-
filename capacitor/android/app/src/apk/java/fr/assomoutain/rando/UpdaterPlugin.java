package fr.assomoutain.rando;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Expose Updater au JavaScript, qui choisit quand chercher (retour à l'écran, toutes les 10 min) et montre
 * un bandeau non bloquant : Updater.check() → { current, build? } ; Updater.install() télécharge et installe.
 */
@CapacitorPlugin(name = "Updater")
public class UpdaterPlugin extends Plugin {
    @PluginMethod
    public void check(PluginCall call) {
        new Thread(() -> {
            Updater.Release r = Updater.fetch("capacitor");
            JSObject o = new JSObject();
            o.put("current", Updater.versionCode(getContext()));
            if (r != null) o.put("build", r.build);
            call.resolve(o);
        }).start();
    }

    @PluginMethod
    public void install(PluginCall call) {
        new Thread(() -> {
            Updater.Release r = Updater.fetch("capacitor");
            if (r == null) { call.reject("pas de réseau"); return; }
            getActivity().runOnUiThread(() -> Updater.download(getActivity(), r));
            call.resolve();
        }).start();
    }
}
