package fr.assomoutain.rando;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Expose StorageUsage au JavaScript : StorageUsage.measure() → { appli, donnees, cache, detail: [{ nom, octets, fichiers }] }. */
@CapacitorPlugin(name = "StorageUsage")
public class StorageUsagePlugin extends Plugin {
    @PluginMethod
    public void measure(PluginCall call) {
        new Thread(() -> {
            try {
                call.resolve(JSObject.fromJSONObject(StorageUsage.measure(getContext())));
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        }).start();
    }
}
