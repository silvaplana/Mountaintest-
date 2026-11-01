package PACKAGE_NAME;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.FileProvider;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/**
 * Mises à jour sans Play Store (copie identique dans les deux prototypes, voir shared/Updater.java) :
 * - à l'ouverture de l'appli : si une version plus récente est publiée, on propose de l'installer ;
 * - en arrière-plan, deux fois par jour (WorkManager, seulement avec réseau) : notification « Nouvelle version ».
 * version.json est publié par GitHub Actions avec les APK : {"build": 12, "apk": {"capacitor": url, "kotlin": url}}.
 */
public final class Updater {
    private static final String TAG = "Updater";
    private static final String CHANNEL = "maj";
    private static final String[] VERSION_URLS = {
        "https://github.com/silvaplana/Mountaintest-/releases/latest/download/version.json",
        "https://silvaplana.cloud/mountaintest/apk/version.json",
    };

    private Updater() {}

    /** À appeler dans onCreate de l'activité principale. */
    public static void init(Activity activity, String appKey) {
        PeriodicWorkRequest work = new PeriodicWorkRequest.Builder(CheckWorker.class, 12, TimeUnit.HOURS)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build();
        WorkManager.getInstance(activity).enqueueUniquePeriodicWork("verif-maj", ExistingPeriodicWorkPolicy.KEEP, work);
        activity.getSharedPreferences("maj", Context.MODE_PRIVATE).edit().putString("app", appKey).apply();
        checkNow(activity, appKey, false);
    }

    /** Vérifie et propose l'installation. silent = false : dit aussi « à jour » si on l'a demandé à la main. */
    public static void checkNow(Activity activity, String appKey, boolean tellIfUpToDate) {
        new Thread(() -> {
            Release r = fetch(appKey);
            int current = versionCode(activity);
            new Handler(Looper.getMainLooper()).post(() -> {
                if (activity.isFinishing()) return;
                if (r == null) {
                    if (tellIfUpToDate) toastDialog(activity, "Impossible de vérifier les mises à jour (pas de réseau ?).");
                } else if (r.build > current) {
                    new AlertDialog.Builder(activity)
                        .setTitle("Nouvelle version disponible")
                        .setMessage("Version " + r.build + " (installée : " + current + ").\nL'installer maintenant ?")
                        .setPositiveButton("Installer", (d, w) -> download(activity, r))
                        .setNegativeButton("Plus tard", null)
                        .show();
                } else if (tellIfUpToDate) {
                    toastDialog(activity, "L'appli est à jour (version " + current + ").");
                }
            });
        }).start();
    }

    private static void toastDialog(Activity a, String msg) {
        new AlertDialog.Builder(a).setMessage(msg).setPositiveButton("OK", null).show();
    }

    static final class Release {
        final int build;
        final String apkUrl;
        Release(int build, String apkUrl) { this.build = build; this.apkUrl = apkUrl; }
    }

    static Release fetch(String appKey) {
        for (String u : VERSION_URLS) {
            try {
                JSONObject json = new JSONObject(new String(get(u), "UTF-8"));
                String apk = json.getJSONObject("apk").getString(appKey);
                return new Release(json.getInt("build"), apk);
            } catch (Exception e) {
                Log.i(TAG, "pas de version.json à " + u + " : " + e.getMessage());
            }
        }
        return null;
    }

    private static HttpURLConnection open(String u) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(60000);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("Cache-Control", "no-cache");
        if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
        return c;
    }

    private static byte[] get(String u) throws Exception {
        HttpURLConnection c = open(u);
        try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    private static int versionCode(Context c) {
        try {
            PackageInfo p = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            return (int) (Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode);
        } catch (Exception e) {
            return 0;
        }
    }

    /** Télécharge l'APK avec une barre de progression, puis ouvre l'installeur d'Android. */
    private static void download(Activity activity, Release r) {
        if (Build.VERSION.SDK_INT >= 26 && !activity.getPackageManager().canRequestPackageInstalls()) {
            new AlertDialog.Builder(activity)
                .setTitle("Une autorisation d'abord")
                .setMessage("Android va te demander d'autoriser cette appli à installer des mises à jour. Active l'option, puis reviens et appuie à nouveau sur « Installer ».")
                .setPositiveButton("Ouvrir le réglage", (d, w) -> activity.startActivity(
                    new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName()))))
                .setNegativeButton("Annuler", null)
                .show();
            return;
        }
        AlertDialog progress = new AlertDialog.Builder(activity)
            .setTitle("Téléchargement de la mise à jour")
            .setMessage("0 %")
            .setCancelable(false)
            .show();
        Handler ui = new Handler(Looper.getMainLooper());
        new Thread(() -> {
            File dir = new File(activity.getCacheDir(), "maj");
            dir.mkdirs();
            File apk = new File(dir, "mise-a-jour.apk");
            try {
                HttpURLConnection c = open(r.apkUrl);
                long total = c.getContentLengthLong();
                try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                    byte[] buf = new byte[65536];
                    long done = 0;
                    int n, lastPct = -1;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        done += n;
                        int pct = total > 0 ? (int) (done * 100 / total) : -1;
                        if (pct != lastPct) {
                            lastPct = pct;
                            final String msg = pct >= 0 ? pct + " %" : (done / 1_000_000) + " Mo";
                            ui.post(() -> progress.setMessage(msg));
                        }
                    }
                }
                ui.post(() -> {
                    progress.dismiss();
                    Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", apk);
                    Intent install = new Intent(Intent.ACTION_VIEW)
                        .setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    activity.startActivity(install);
                });
            } catch (Exception e) {
                ui.post(() -> {
                    progress.dismiss();
                    toastDialog(activity, "Téléchargement impossible : " + e.getMessage());
                });
            }
        }).start();
    }

    /** Vérification en arrière-plan : notification si une nouvelle version est publiée (une fois par version). */
    public static class CheckWorker extends Worker {
        public CheckWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }

        @NonNull
        @Override
        public Result doWork() {
            Context ctx = getApplicationContext();
            SharedPreferences prefs = ctx.getSharedPreferences("maj", Context.MODE_PRIVATE);
            Release r = fetch(prefs.getString("app", ""));
            if (r == null) return Result.success();
            if (r.build <= versionCode(ctx) || prefs.getInt("notifie", 0) >= r.build) return Result.success();
            prefs.edit().putInt("notifie", r.build).apply();
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            if (Build.VERSION.SDK_INT >= 26) {
                nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Mises à jour", NotificationManager.IMPORTANCE_DEFAULT));
            }
            Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
            PendingIntent pi = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            try {
                NotificationManagerCompat.from(ctx).notify(42, new NotificationCompat.Builder(ctx, CHANNEL)
                    .setSmallIcon(android.R.drawable.stat_sys_download_done)
                    .setContentTitle("Nouvelle version disponible")
                    .setContentText("Version " + r.build + " : ouvre l'appli pour l'installer.")
                    .setContentIntent(pi)
                    .setAutoCancel(true)
                    .build());
            } catch (SecurityException e) {
                Log.i(TAG, "notifications refusées");
            }
            return Result.success();
        }
    }
}
