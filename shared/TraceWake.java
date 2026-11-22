package PACKAGE_NAME;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.BroadcastReceiver;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.WindowManager;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import java.lang.ref.WeakReference;

/**
 * ⑂ Écran rallumé avant les carrefours (copie identique dans les deux prototypes, voir shared/).
 *
 * Pendant « ▶ Suivre la trace », ce service de premier plan garde le GPS actif écran éteint et :
 * - écran allumé : une position toutes les 2 s ; écran éteint : toutes les 5 s, et de nouveau toutes les 2 s
 *   à l'approche d'un carrefour (moins de 300 m, ou 30 s à la vitesse du moment) pour le prévenir à temps ;
 * - rallume l'écran à l'approche de chaque carrefour de la trace (50 m à pied, jusqu'à 200 m à vélo :
 *   environ 20 s avant d'y être), le garde allumé jusqu'à ce qu'on l'ait passé, puis laisse Android
 *   l'éteindre à sa mise en veille habituelle ;
 * - rallume l'écran et vibre quand on quitte la trace (plus de 50 m).
 * L'appli s'affiche par-dessus l'écran de verrouillage pendant le suivi (comme une appli de navigation).
 * Les carrefours sont calculés par l'appli (chemins OpenStreetMap croisés avec la trace) et gardés hors ligne.
 */
public class TraceWake extends Service {
    private static final String CHANNEL = "trace";
    private static final double OFF_TRACK_M = 50;
    /** Distance d'alerte : environ 20 s avant le carrefour, entre 50 m et 200 m. */
    private static final double LEAD_S = 20, MIN_LEAD_M = 50, MAX_LEAD_M = 200;
    /** Écran gardé allumé au plus 90 s pour un carrefour (si on s'arrête juste avant). */
    private static final long MAX_ON_MS = 90_000;
    /** Fréquence GPS : 2 s écran allumé ou près d'un carrefour, 5 s écran éteint sinon. */
    private static final long FAST_MS = 2_000, SLOW_MS = 5_000;
    private static final double NEAR_JUNCTION_M = 300, NEAR_JUNCTION_S = 30;

    private static volatile double[] line = new double[0];      // lon, lat, lon, lat…
    private static volatile double[] junctions = new double[0]; // idem
    private static volatile boolean active;
    /** Bouton ⑂ : rallumer l'écran (sinon le service garde seulement le GPS et la vibration hors trace). */
    private static volatile boolean wakeScreen = true;
    /** Bouton vibration hors trace. */
    private static volatile boolean vibrateOff = true;
    private static WeakReference<Activity> activityRef = new WeakReference<>(null);

    /** Service en marche et écran à rallumer : l'appli doit pouvoir passer devant l'écran de verrouillage. */
    public static boolean isActive() { return active && wakeScreen; }
    public static boolean isRunning() { return active; }

    /** Démarre le suivi (depuis l'activité visible) avec la trace et ses carrefours. */
    public static void start(Activity a, double[] lineLonLat, double[] junctionsLonLat, boolean wake, boolean vibrate) {
        wakeScreen = wake;
        vibrateOff = vibrate;
        line = lineLonLat != null ? lineLonLat : new double[0];
        junctions = junctionsLonLat != null ? junctionsLonLat : new double[0];
        active = true;
        activityRef = new WeakReference<>(a);
        showOverLock(a, wake || PocketMode.isEnabled(a));
        Intent i = new Intent(a, TraceWake.class);
        if (Build.VERSION.SDK_INT >= 26) a.startForegroundService(i); else a.startService(i);
        if (instance != null) instance.reset();
    }

    public static void stop(Activity a) {
        active = false;
        a.stopService(new Intent(a, TraceWake.class));
        showOverLock(a, PocketMode.isEnabled(a));
    }

    @SuppressWarnings("deprecation")
    private static void showOverLock(Activity a, boolean on) {
        if (Build.VERSION.SDK_INT >= 27) { a.setShowWhenLocked(on); a.setTurnScreenOn(on); }
        else {
            int f = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON;
            if (on) a.getWindow().addFlags(f); else a.getWindow().clearFlags(f);
        }
    }

    private static TraceWake instance;
    private FusedLocationProviderClient fused;
    private PowerManager power;
    private PowerManager.WakeLock screenLock;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable release = this::releaseScreen;
    /** Carrefour en cours (-1 : aucun), sa distance la plus courte, et ceux à ne pas réannoncer tout de suite. */
    private int current = -1;
    private double currentMin;
    private boolean[] done = new boolean[0];
    private boolean wasOff;
    private Location prev;
    private long intervalMs;
    private boolean nearJunction;

    private final BroadcastReceiver screen = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { requestUpdates(); }
    };

    private final LocationCallback callback = new LocationCallback() {
        @Override public void onLocationResult(@NonNull LocationResult r) { for (Location l : r.getLocations()) onFix(l); }
    };

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        fused = LocationServices.getFusedLocationProviderClient(this);
        power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        IntentFilter f = new IntentFilter(Intent.ACTION_SCREEN_ON);
        f.addAction(Intent.ACTION_SCREEN_OFF);
        registerReceiver(screen, f);
    }

    @SuppressLint("MissingPermission") // la position est déjà autorisée : le suivi l'utilise
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ServiceCompat.startForeground(this, 7, notification(), Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : 0);
        reset();
        intervalMs = 0;
        requestUpdates();
        return START_NOT_STICKY;
    }

    /** (Re)demande le GPS à la fréquence voulue, seulement si elle change. */
    @SuppressLint("MissingPermission")
    private void requestUpdates() {
        long want = power.isInteractive() || nearJunction ? FAST_MS : SLOW_MS;
        if (want == intervalMs) return;
        intervalMs = want;
        fused.removeLocationUpdates(callback);
        try {
            fused.requestLocationUpdates(new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, want)
                .setMinUpdateIntervalMillis(want / 2).setMaxUpdateDelayMillis(0).build(), callback, Looper.getMainLooper());
        } catch (SecurityException e) { stopSelf(); }
    }

    private void reset() {
        done = new boolean[junctions.length / 2];
        current = -1; wasOff = false; prev = null;
    }

    private static double dist(double lon1, double lat1, double lon2, double lat2) {
        double k = Math.cos(Math.toRadians((lat1 + lat2) / 2));
        return Math.hypot((lon2 - lon1) * k, lat2 - lat1) * 111_320;
    }

    /** Distance de la position à la trace (plan local). */
    private static double offTrack(double[] l, double lon, double lat) {
        if (l.length < 4) return 0;
        double k = Math.cos(Math.toRadians(lat)) * 111_320, m = 111_320, best = Double.MAX_VALUE;
        for (int i = 2; i + 1 < l.length; i += 2) {
            double ax = (l[i - 2] - lon) * k, ay = (l[i - 1] - lat) * m, dx = (l[i] - lon) * k - ax, dy = (l[i + 1] - lat) * m - ay;
            double l2 = dx * dx + dy * dy, t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
            best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
        }
        return best;
    }

    private void onFix(Location loc) {
        double lon = loc.getLongitude(), lat = loc.getLatitude();
        double speed = loc.hasSpeed() ? loc.getSpeed()
            : prev != null ? prev.distanceTo(loc) / Math.max(1, (loc.getTime() - prev.getTime()) / 1000.0) : 1.2;
        prev = loc;
        double lead = Math.max(MIN_LEAD_M, Math.min(MAX_LEAD_M, speed * LEAD_S));

        // Hors trace : écran rallumé 20 s et double vibration, une fois par sortie.
        boolean off = offTrack(line, lon, lat) > OFF_TRACK_M + (loc.hasAccuracy() ? loc.getAccuracy() / 2 : 0);
        if (off && !wasOff) { if (wakeScreen) wake(20_000); if (vibrateOff) vibrate(new long[]{0, 200, 100, 200}); }
        wasOff = off;

        double[] j = junctions;
        if (done.length != j.length / 2) done = new boolean[j.length / 2];
        // Carrefour en cours : passé dès qu'on s'en éloigne (25 m de plus que le plus près atteint).
        if (current >= 0 && current < done.length) {
            double d = dist(lon, lat, j[2 * current], j[2 * current + 1]);
            currentMin = Math.min(currentMin, d);
            if (d > currentMin + 25 && d > 25) { current = -1; handler.removeCallbacks(release); handler.postDelayed(release, 4_000); }
        }
        double nearest = Double.MAX_VALUE;
        for (int i = 0; i < done.length; i++) {
            double d = dist(lon, lat, j[2 * i], j[2 * i + 1]);
            nearest = Math.min(nearest, d);
            if (done[i]) { if (d > lead + 100) done[i] = false; continue; } // réarmé une fois bien loin
            if (d <= lead && !off && wakeScreen) {
                done[i] = true;
                boolean wasOn = power.isInteractive();
                current = i; currentMin = d;
                wake(MAX_ON_MS);
                if (!wasOn) vibrate(new long[]{0, 120});
            }
        }
        // Écran éteint : GPS plus lent, sauf à l'approche d'un carrefour.
        nearJunction = nearest < Math.max(NEAR_JUNCTION_M, speed * NEAR_JUNCTION_S);
        requestUpdates();
    }

    /** Écran allumé (et gardé allumé) pendant au plus ms ; ensuite la mise en veille normale reprend. */
    @SuppressWarnings("deprecation")
    private void wake(long ms) {
        handler.removeCallbacks(release);
        if (screenLock == null) {
            screenLock = power.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP
                | PowerManager.ON_AFTER_RELEASE, "assomoutain:carrefour");
            screenLock.setReferenceCounted(false);
        }
        Activity a = activityRef.get();
        if (a != null) a.runOnUiThread(() -> showOverLock(a, true));
        screenLock.acquire(ms);
        handler.postDelayed(release, ms);
    }

    private void releaseScreen() {
        if (screenLock != null && screenLock.isHeld()) screenLock.release();
    }

    private void vibrate(long[] pattern) {
        try {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null) v.vibrate(VibrationEffect.createWaveform(pattern, -1));
        } catch (Exception ignored) { }
    }

    private Notification notification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Suivi de la trace", NotificationManager.IMPORTANCE_LOW));
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pi = open == null ? null : PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle("Suivi de la trace")
            .setContentText(!wakeScreen ? "Le GPS continue écran éteint ; vibration si tu quittes la trace."
                : junctions.length > 0 ? "L'écran se rallume avant les carrefours et si tu quittes la trace."
                : "L'écran se rallume si tu quittes la trace.")
            .setSmallIcon(android.R.drawable.ic_menu_directions)
            .setContentIntent(pi)
            .setOngoing(true)
            .build();
    }

    @Override
    public void onDestroy() {
        fused.removeLocationUpdates(callback);
        try { unregisterReceiver(screen); } catch (Exception ignored) { }
        handler.removeCallbacksAndMessages(null);
        releaseScreen();
        if (instance == this) instance = null;
        super.onDestroy();
    }
}
