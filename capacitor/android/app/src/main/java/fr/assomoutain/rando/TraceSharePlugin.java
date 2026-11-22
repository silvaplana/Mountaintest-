package fr.assomoutain.rando;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONException;

/**
 * Expose TraceShare au JavaScript : save({ name, line, replace }) → { path }, remove({ name }), share({ name, line }),
 * folder() → { folder }. line = lon, lat, lon, lat…
 */
@CapacitorPlugin(name = "TraceShare")
public class TraceSharePlugin extends Plugin {
    private static double[] numbers(JSArray a) throws JSONException {
        if (a == null) return new double[0];
        double[] r = new double[a.length()];
        for (int i = 0; i < r.length; i++) r[i] = a.getDouble(i);
        return r;
    }

    @PluginMethod
    public void save(PluginCall call) {
        try {
            String path = TraceShare.save(getContext(), call.getString("name", "trace"), numbers(call.getArray("line")),
                Boolean.TRUE.equals(call.getBoolean("replace", true)));
            JSObject r = new JSObject();
            r.put("path", path);
            call.resolve(r);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        TraceShare.remove(getContext(), call.getString("name", "trace"));
        call.resolve();
    }

    @PluginMethod
    public void share(PluginCall call) {
        try {
            TraceShare.share(getActivity(), call.getString("name", "trace"), numbers(call.getArray("line")));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void folder(PluginCall call) {
        JSObject r = new JSObject();
        r.put("folder", TraceShare.SHOWN_FOLDER);
        call.resolve(r);
    }
}
