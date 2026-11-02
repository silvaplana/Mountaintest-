package fr.assomoutain.rando;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Expose PhotoCapture au JavaScript : Photo.take() → { saved }. */
@CapacitorPlugin(name = "Photo")
public class PhotoPlugin extends Plugin {
    @PluginMethod
    public void take(PluginCall call) {
        Intent i = PhotoCapture.prepare(getContext());
        if (i == null) { call.reject("Photo impossible sur ce téléphone (Android 10 minimum)"); return; }
        try {
            startActivityForResult(call, i, "photoDone");
        } catch (Exception e) {
            PhotoCapture.finish(getContext(), false);
            call.reject("Pas d'appareil photo disponible");
        }
    }

    @ActivityCallback
    private void photoDone(PluginCall call, ActivityResult result) {
        if (call == null) return;
        boolean saved = PhotoCapture.finish(getContext(), result.getResultCode() == Activity.RESULT_OK);
        JSObject r = new JSObject();
        r.put("saved", saved);
        call.resolve(r);
    }
}
