package PACKAGE_NAME;

import android.app.Activity;
import android.app.Application;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;

/**
 * Mode poche (copie identique dans les deux prototypes, voir shared/).
 *
 * Téléphone debout et capteur de proximité couvert (dans la poche) pendant 3 s : écran noir, luminosité au minimum, appuis ignorés,
 * puis Android éteint vraiment l'écran au bout de sa mise en veille habituelle.
 * Téléphone tenu à plat (écran vers le haut) ou deux secousses : l'écran se rallume sur la carte,
 * par-dessus l'écran de verrouillage, sans toucher aucun bouton.
 *
 * Android n'autorise pas une appli ordinaire à éteindre l'écran instantanément (il faudrait les droits
 * « administrateur de l'appareil », et le code PIN serait alors redemandé à chaque fois). D'où l'écran noir
 * immédiat puis l'extinction par la mise en veille normale. Pour continuer à lire l'accéléromètre écran
 * éteint, on garde le processeur éveillé (verrou partiel), ce qui consomme un peu, bien moins que l'écran.
 */
public final class PocketMode implements SensorEventListener {
    private static final String PREFS = "poche";
    private static final long POCKET_AFTER_MS = 3_000;
    private static final long FLAT_AFTER_MS = 500;
    private static final long SHAKE_WINDOW_MS = 1_200;

    private static PocketMode instance;

    private final Activity activity;
    private final SensorManager sensors;
    private final PowerManager power;
    private PowerManager.WakeLock cpuLock;
    private boolean enabled, listening, black;
    private View overlay;
    private Sensor proximity;
    private boolean covered = true; // sans capteur de proximité, on se fie à l'orientation seule
    private long uprightSince, flatSince, lastShake, firstShake;

    private PocketMode(Activity a) {
        activity = a;
        sensors = (SensorManager) a.getSystemService(Context.SENSOR_SERVICE);
        power = (PowerManager) a.getSystemService(Context.POWER_SERVICE);
        enabled = prefs(a).getBoolean("actif", false);
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** À appeler dans onCreate() de l'activité principale. */
    public static void init(Activity a) {
        instance = new PocketMode(a);
        a.getApplication().registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks() {
            @Override public void onActivityStarted(Activity x) { if (x == a && instance != null) instance.sync(); }
            @Override public void onActivityStopped(Activity x) {
                // Écran éteint : on continue d'écouter. L'utilisateur est passé à une autre appli : on arrête.
                if (x == a && instance != null && instance.power.isInteractive()) instance.stopListening();
            }
            @Override public void onActivityDestroyed(Activity x) {
                if (x == a && instance != null) { instance.stopListening(); instance = null; a.getApplication().unregisterActivityLifecycleCallbacks(this); }
            }
            @Override public void onActivityCreated(Activity x, Bundle b) {}
            @Override public void onActivityResumed(Activity x) {}
            @Override public void onActivityPaused(Activity x) {}
            @Override public void onActivitySaveInstanceState(Activity x, Bundle b) {}
        });
    }

    public static boolean isEnabled(Context c) {
        return prefs(c).getBoolean("actif", false);
    }

    public static void setEnabled(Activity a, boolean on) {
        prefs(a).edit().putBoolean("actif", on).apply();
        if (instance == null) init(a);
        instance.enabled = on;
        instance.sync();
    }

    private void sync() {
        // Mode actif : l'activité peut rallumer l'écran et s'afficher par-dessus le verrouillage
        // (comme une appli de navigation) ; les autres applis restent verrouillées.
        if (Build.VERSION.SDK_INT >= 27) {
            activity.setShowWhenLocked(enabled);
            activity.setTurnScreenOn(enabled);
        } else {
            int f = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON;
            if (enabled) activity.getWindow().addFlags(f); else activity.getWindow().clearFlags(f);
        }
        if (enabled) startListening(); else stopListening();
    }

    private void startListening() {
        if (listening) return;
        Sensor acc = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        if (acc == null) return;
        sensors.registerListener(this, acc, SensorManager.SENSOR_DELAY_NORMAL);
        // Capteur de proximité (près de l'écouteur) : couvert = dans la poche, pas dans la main.
        proximity = sensors.getDefaultSensor(Sensor.TYPE_PROXIMITY);
        if (proximity != null) sensors.registerListener(this, proximity, SensorManager.SENSOR_DELAY_NORMAL);
        covered = proximity == null;
        listening = true;
        uprightSince = flatSince = 0;
        if (cpuLock == null) {
            cpuLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "assomoutain:poche");
            cpuLock.setReferenceCounted(false);
        }
        cpuLock.acquire(6 * 60 * 60 * 1000L); // au plus 6 h, par sécurité
    }

    private void stopListening() {
        if (listening) sensors.unregisterListener(this);
        listening = false;
        if (cpuLock != null && cpuLock.isHeld()) cpuLock.release();
        wake();
    }

    @Override
    public void onSensorChanged(SensorEvent e) {
        if (e.sensor.getType() == Sensor.TYPE_PROXIMITY) {
            covered = e.values[0] < Math.min(e.sensor.getMaximumRange(), 5f);
            return;
        }
        float x = e.values[0], y = e.values[1], z = e.values[2];
        long now = SystemClock.elapsedRealtime();
        double g = Math.sqrt(x * x + y * y + z * z);

        // Secousse : pic d'accélération ; deux pics rapprochés = « réveille-toi ».
        if (g > 19 && now - lastShake > 250) {
            if (now - firstShake < SHAKE_WINDOW_MS && firstShake != 0) { firstShake = 0; if (black) wake(); }
            else firstShake = now;
            lastShake = now;
        }
        if (g < 7 || g > 13) return; // en mouvement brusque : on ne juge pas l'orientation

        boolean upright = covered && Math.abs(y) > 7.5 && Math.abs(z) < 5;  // debout et couvert : dans la poche
        boolean flat = z > 6.5;                                    // écran vers le ciel (jusqu'à ~45°)

        uprightSince = upright ? (uprightSince == 0 ? now : uprightSince) : 0;
        flatSince = flat ? (flatSince == 0 ? now : flatSince) : 0;

        if (!black && upright && now - uprightSince > POCKET_AFTER_MS) goBlack();
        else if (black && flat && now - flatSince > FLAT_AFTER_MS) wake();
    }

    @Override public void onAccuracyChanged(Sensor s, int a) {}

    private void goBlack() {
        black = true;
        if (overlay == null) {
            FrameLayout f = new FrameLayout(activity);
            f.setBackgroundColor(Color.BLACK);
            f.setClickable(true);   // avale les appuis faits dans la poche
            f.setFocusable(true);
            TextView t = new TextView(activity);
            t.setText("Mode poche\nTiens le téléphone à plat ou secoue-le deux fois");
            t.setTextColor(Color.rgb(70, 70, 70));
            t.setGravity(Gravity.CENTER);
            f.addView(t, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            overlay = f;
        }
        ViewGroup decor = (ViewGroup) activity.getWindow().getDecorView();
        if (overlay.getParent() == null) decor.addView(overlay, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        overlay.bringToFront();
        WindowManager.LayoutParams lp = activity.getWindow().getAttributes();
        lp.screenBrightness = 0.01f;
        activity.getWindow().setAttributes(lp);
        // Laisse Android éteindre l'écran à la mise en veille normale.
        activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    @SuppressWarnings("deprecation")
    private void wake() {
        if (!black) return;
        black = false;
        uprightSince = 0;
        if (overlay != null && overlay.getParent() != null) ((ViewGroup) overlay.getParent()).removeView(overlay);
        WindowManager.LayoutParams lp = activity.getWindow().getAttributes();
        lp.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
        activity.getWindow().setAttributes(lp);
        if (!power.isInteractive()) {
            // Rallume l'écran ; l'activité (setShowWhenLocked) passe devant le verrouillage.
            PowerManager.WakeLock on = power.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE,
                "assomoutain:reveil");
            on.acquire(3_000);
        }
    }
}
