package fr.assomoutain.rando;

import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONException;

/** Expose TraceWake au JavaScript : TraceWake.start({ line, junctions, wake, vibrate }) (lon, lat, lon, lat…), TraceWake.stop(). */
@CapacitorPlugin(name = "TraceWake")
public class TraceWakePlugin extends Plugin {
    private static double[] numbers(JSArray a) throws JSONException {
        if (a == null) return new double[0];
        double[] r = new double[a.length()];
        for (int i = 0; i < r.length; i++) r[i] = a.getDouble(i);
        return r;
    }

    @PluginMethod
    public void start(PluginCall call) {
        try {
            double[] line = numbers(call.getArray("line"));
            double[] junctions = numbers(call.getArray("junctions"));
            boolean wake = Boolean.TRUE.equals(call.getBoolean("wake", true));
            boolean vibrate = Boolean.TRUE.equals(call.getBoolean("vibrate", true));
            getActivity().runOnUiThread(() -> {
                TraceWake.start(getActivity(), line, junctions, wake, vibrate);
                call.resolve();
            });
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            TraceWake.stop(getActivity());
            call.resolve();
        });
    }
}
