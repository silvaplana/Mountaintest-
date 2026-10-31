package fr.assomoutain.rando;

import android.util.Log;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Écrit les mesures sous le tag logcat ASSO_BENCH, comme le prototype Kotlin : adb logcat -s ASSO_BENCH */
@CapacitorPlugin(name = "BenchLog")
public class BenchLogPlugin extends Plugin {
    @PluginMethod
    public void log(PluginCall call) {
        Log.i("ASSO_BENCH", call.getString("message", ""));
        call.resolve();
    }
}
