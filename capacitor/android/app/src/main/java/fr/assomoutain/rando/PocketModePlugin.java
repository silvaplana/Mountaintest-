package fr.assomoutain.rando;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Expose PocketMode au JavaScript : PocketMode.get() → { on }, PocketMode.set({ on }). */
@CapacitorPlugin(name = "PocketMode")
public class PocketModePlugin extends Plugin {
    /** Écran noir / rallumé : prévient le JavaScript (événement « pocket », { black }). */
    @Override
    public void load() {
        PocketMode.setListener(black -> {
            JSObject r = new JSObject();
            r.put("black", black);
            notifyListeners("pocket", r);
        });
    }

    @PluginMethod
    public void get(PluginCall call) {
        JSObject r = new JSObject();
        r.put("on", PocketMode.isEnabled(getContext()));
        call.resolve(r);
    }

    @PluginMethod
    public void set(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> PocketMode.setEnabled(getActivity(), on));
        JSObject r = new JSObject();
        r.put("on", on);
        call.resolve(r);
    }
}
