package fr.assomoutain.rando;

import android.Manifest;
import android.content.Intent;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONArray;

/**
 * Pont JS <-> LocationService. Les réglages (priorité, intervalle, distance, regroupement)
 * sont passés tels quels à FusedLocationProviderClient.
 */
@CapacitorPlugin(
    name = "EcoLocation",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" })
    }
)
public class EcoLocationPlugin extends Plugin {

    @Override
    public void load() {
        LocationService.listener = this::deliver;
    }

    @Override
    protected void handleOnDestroy() {
        LocationService.listener = null;
    }

    void deliver(JSONArray fixes) {
        JSObject ev = new JSObject();
        ev.put("fixes", fixes);
        notifyListeners("fixes", ev);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "afterPermission");
            return;
        }
        doStart(call);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) doStart(call);
        else call.reject("Autorisation de localisation refusée");
    }

    private void doStart(PluginCall call) {
        LocationService.clearBuffer(getContext());
        Intent i = new Intent(getContext(), LocationService.class);
        i.putExtra("settings", LocationService.Settings.from(call).toBundle());
        i.putExtra("title", call.getString("title", "Enregistrement"));
        i.putExtra("text", call.getString("text", ""));
        ContextCompat.startForegroundService(getContext(), i);
        call.resolve();
    }

    @PluginMethod
    public void update(PluginCall call) {
        LocationService s = LocationService.instance;
        if (s == null) {
            call.reject("Service GPS arrêté");
            return;
        }
        s.apply(LocationService.Settings.from(call));
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), LocationService.class));
        call.resolve();
    }

    @PluginMethod
    public void drainBuffer(PluginCall call) {
        JSObject res = new JSObject();
        try {
            res.put("fixes", JSArray.from(LocationService.drainBuffer(getContext()).toArray()));
        } catch (Exception e) {
            res.put("fixes", new JSArray());
        }
        call.resolve(res);
    }
}
