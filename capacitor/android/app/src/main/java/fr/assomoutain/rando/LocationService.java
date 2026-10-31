package fr.assomoutain.rando;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import com.getcapacitor.PluginCall;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Service de premier plan (notification obligatoire) qui garde le GPS actif écran éteint.
 * Chaque lot de positions est envoyé au JS et ajouté à un fichier de secours,
 * relu si le système tue l'appli pendant la sortie.
 */
public class LocationService extends Service {

    interface Listener { void onFixes(JSONArray fixes); }

    static volatile Listener listener;
    static volatile LocationService instance;

    private static final String TAG = "EcoLocation";
    private static final String CHANNEL = "tracking";
    private static final String BUFFER = "gps-buffer.jsonl";

    private FusedLocationProviderClient client;
    private Settings current;

    private final LocationCallback callback = new LocationCallback() {
        @Override
        public void onLocationResult(@NonNull LocationResult result) {
            JSONArray batch = new JSONArray();
            for (Location l : result.getLocations()) batch.put(toJson(l));
            appendBuffer(batch);
            Listener li = listener;
            if (li != null) li.onFixes(batch);
        }
    };

    static class Settings {
        int priority; long intervalMs; long minIntervalMs; float minDistanceM; long maxDelayMs;

        static Settings from(PluginCall call) {
            Settings s = new Settings();
            String p = call.getString("priority", "high");
            s.priority = "low".equals(p) ? Priority.PRIORITY_LOW_POWER
                : "balanced".equals(p) ? Priority.PRIORITY_BALANCED_POWER_ACCURACY
                : Priority.PRIORITY_HIGH_ACCURACY;
            s.intervalMs = call.getLong("intervalMs", 5000L);
            s.minIntervalMs = call.getLong("minIntervalMs", s.intervalMs / 2);
            s.minDistanceM = call.getFloat("minDistanceM", 10f);
            s.maxDelayMs = call.getLong("maxDelayMs", 0L);
            return s;
        }

        Bundle toBundle() {
            Bundle b = new Bundle();
            b.putInt("priority", priority);
            b.putLong("intervalMs", intervalMs);
            b.putLong("minIntervalMs", minIntervalMs);
            b.putFloat("minDistanceM", minDistanceM);
            b.putLong("maxDelayMs", maxDelayMs);
            return b;
        }

        static Settings fromBundle(Bundle b) {
            Settings s = new Settings();
            s.priority = b.getInt("priority");
            s.intervalMs = b.getLong("intervalMs");
            s.minIntervalMs = b.getLong("minIntervalMs");
            s.minDistanceM = b.getFloat("minDistanceM");
            s.maxDelayMs = b.getLong("maxDelayMs");
            return s;
        }

        LocationRequest toRequest() {
            return new LocationRequest.Builder(priority, intervalMs)
                .setMinUpdateIntervalMillis(minIntervalMs)
                .setMinUpdateDistanceMeters(minDistanceM)
                // Regroupement : le GPS garde les positions et ne réveille l'appli qu'une fois par lot.
                .setMaxUpdateDelayMillis(maxDelayMs)
                .setWaitForAccurateLocation(false)
                .build();
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        client = LocationServices.getFusedLocationProviderClient(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            // Redémarrage par le système sans réglages : on s'arrête proprement.
            stopSelf();
            return START_NOT_STICKY;
        }
        ServiceCompat.startForeground(this, 1, buildNotification(intent.getStringExtra("title"), intent.getStringExtra("text")),
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : 0);
        Bundle b = intent.getBundleExtra("settings");
        if (b != null) apply(Settings.fromBundle(b));
        return START_NOT_STICKY;
    }

    void apply(Settings s) {
        current = s;
        client.removeLocationUpdates(callback);
        try {
            client.requestLocationUpdates(s.toRequest(), callback, Looper.getMainLooper());
            Log.i(TAG, "réglages: prio=" + s.priority + " interval=" + s.intervalMs + " dist=" + s.minDistanceM + " lot=" + s.maxDelayMs);
        } catch (SecurityException e) {
            Log.e(TAG, "permission manquante", e);
            stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        client.removeLocationUpdates(callback);
        instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private Notification buildNotification(String title, String text) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Suivi de sortie", NotificationManager.IMPORTANCE_LOW));
        }
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentIntent(pi)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private static JSONObject toJson(Location l) {
        JSONObject o = new JSONObject();
        try {
            o.put("lat", l.getLatitude());
            o.put("lon", l.getLongitude());
            o.put("alt", l.hasAltitude() ? l.getAltitude() : JSONObject.NULL);
            o.put("accuracy", l.hasAccuracy() ? l.getAccuracy() : 999);
            o.put("speed", l.hasSpeed() ? l.getSpeed() : JSONObject.NULL);
            o.put("time", l.getTime());
        } catch (Exception ignored) { }
        return o;
    }

    private void appendBuffer(JSONArray batch) {
        try (FileWriter w = new FileWriter(new File(getFilesDir(), BUFFER), true)) {
            for (int i = 0; i < batch.length(); i++) w.write(batch.getJSONObject(i).toString() + "\n");
        } catch (Exception e) {
            Log.w(TAG, "tampon GPS non écrit", e);
        }
    }

    static List<JSONObject> drainBuffer(Context ctx) throws Exception {
        File f = new File(ctx.getFilesDir(), BUFFER);
        List<JSONObject> out = new ArrayList<>();
        if (!f.exists()) return out;
        try (BufferedReader r = new BufferedReader(new FileReader(f))) {
            String line;
            while ((line = r.readLine()) != null) if (!line.isEmpty()) out.add(new JSONObject(line));
        }
        f.delete();
        return out;
    }

    static void clearBuffer(Context ctx) {
        new File(ctx.getFilesDir(), BUFFER).delete();
    }
}
