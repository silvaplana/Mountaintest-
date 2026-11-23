package fr.assomoutain.rando;

import android.annotation.SuppressLint;
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
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import org.json.JSONObject;

/**
 * 📍 Position des buddies (spec/buddies.md §5.9) : tant que l'épingle est enfoncée, une position toutes les
 * cinq minutes environ, écran éteint compris (le GPS dort entre deux). S'arrête seul à l'heure prévue (ce soir).
 * Chaque position est gardée (la dernière seulement) et passée à l'appli (BuddiesPlugin), qui l'envoie aux buddies
 * à la synchro ; appli fermée, elle est relue au retour (derniere()).
 */
public class EpingleService extends Service {
    static final String PREFS = "epingle";
    private static final String CHANNEL = "buddies-position";
    private static final long INTERVALLE_MS = 5 * 60_000L;
    /** Appelé à chaque position (BuddiesPlugin, appli ouverte ou en arrière-plan). */
    static volatile Ecouteur ecouteur;
    interface Ecouteur { void position(JSONObject p); }

    private FusedLocationProviderClient fused;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable fin = this::stopSelf;
    private final LocationCallback callback = new LocationCallback() {
        @Override
        public void onLocationResult(@NonNull LocationResult result) {
            Location l = result.getLastLocation();
            if (l == null) return;
            JSONObject o = new JSONObject();
            try {
                o.put("lat", l.getLatitude()).put("lon", l.getLongitude()).put("t", l.getTime());
                if (l.hasAltitude()) o.put("alt", l.getAltitude());
            } catch (Exception ignored) { return; }
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("derniere", o.toString()).apply();
            Ecouteur e = ecouteur;
            if (e != null) e.position(o);
        }
    };

    static void demarrer(Context ctx, long jusqu) {
        androidx.core.content.ContextCompat.startForegroundService(ctx, new Intent(ctx, EpingleService.class).putExtra("jusqu", jusqu));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        fused = LocationServices.getFusedLocationProviderClient(this);
    }

    @SuppressLint("MissingPermission") // demandée par l'appli avant d'enfoncer l'épingle
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        long jusqu = intent != null ? intent.getLongExtra("jusqu", 0) : getSharedPreferences(PREFS, MODE_PRIVATE).getLong("jusqu", 0);
        long reste = jusqu - System.currentTimeMillis();
        ServiceCompat.startForeground(this, 7, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        if (reste <= 0) { stopSelf(); return START_NOT_STICKY; }
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putLong("jusqu", jusqu).apply();
        handler.removeCallbacks(fin);
        handler.postDelayed(fin, reste);
        fused.removeLocationUpdates(callback);
        LocationRequest r = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, INTERVALLE_MS)
            .setMinUpdateIntervalMillis(INTERVALLE_MS - 60_000L)
            .setMaxUpdateDelayMillis(0)
            .build();
        fused.requestLocationUpdates(r, callback, Looper.getMainLooper());
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(fin);
        fused.removeLocationUpdates(callback);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private Notification notification() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Position pour mes buddies", NotificationManager.IMPORTANCE_LOW));
        }
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle("📍 Mes buddies me voient")
            .setContentText("Ta position part toutes les 5 minutes, jusqu'à ce soir.")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentIntent(pi)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }
}
