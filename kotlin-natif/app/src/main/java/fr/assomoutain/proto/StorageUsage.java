package fr.assomoutain.proto;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Place prise par l'appli sur le téléphone (copie identique dans les deux prototypes, voir shared/).
 * Appli = APK installé (avec le code compilé si Android le donne) ; Données = tous les fichiers de l'appli,
 * classés par usage (tuiles, sorties ski, traces…) ; Cache = fichiers temporaires qu'Android peut effacer.
 * Aucune permission : une appli peut toujours mesurer ses propres fichiers.
 */
public final class StorageUsage {
    private StorageUsage() {}

    /** Mesure (quelques centaines de ms avec beaucoup de tuiles) : à appeler hors du fil de l'interface. */
    public static JSONObject measure(Context ctx) throws JSONException {
        Map<String, long[]> cats = new LinkedHashMap<>();
        File data = ctx.getApplicationInfo().dataDir != null ? new File(ctx.getApplicationInfo().dataDir) : ctx.getFilesDir().getParentFile();
        if (data != null) walk(data, "", cats);
        File ext = ctx.getExternalFilesDir(null);
        if (ext != null) walk(ext, "externe/", cats);
        File extCache = ctx.getExternalCacheDir();
        if (extCache != null) walk(extCache, "cache/", cats);

        long donnees = 0, cache = 0;
        List<Map.Entry<String, long[]>> list = new ArrayList<>(cats.entrySet());
        list.sort((a, b) -> Long.compare(b.getValue()[0], a.getValue()[0]));
        JSONArray detail = new JSONArray();
        for (Map.Entry<String, long[]> e : list) {
            if (e.getKey().equals(CACHE)) cache += e.getValue()[0]; else donnees += e.getValue()[0];
            detail.put(new JSONObject().put("nom", e.getKey()).put("octets", e.getValue()[0]).put("fichiers", e.getValue()[1]));
        }

        long appli = apkSize(ctx.getApplicationInfo());
        if (Build.VERSION.SDK_INT >= 26) {
            try {
                android.app.usage.StorageStatsManager ssm = ctx.getSystemService(android.app.usage.StorageStatsManager.class);
                android.app.usage.StorageStats st = ssm.queryStatsForPackage(android.os.storage.StorageManager.UUID_DEFAULT,
                    ctx.getPackageName(), android.os.Process.myUserHandle());
                appli = Math.max(appli, st.getAppBytes());
            } catch (Exception ignored) {
                // Mesure officielle indisponible : on garde la taille de l'APK.
            }
        }
        return new JSONObject().put("appli", appli).put("donnees", donnees).put("cache", cache).put("detail", detail);
    }

    static final String CACHE = "Cache temporaire";

    /** Usage d'un fichier d'après son chemin (le même classement dans les deux applis). */
    static String category(String rel) {
        String n = rel.toLowerCase();
        if (n.startsWith("cache/") || n.startsWith("code_cache/")) return CACHE;
        if (n.startsWith("files/tiles/scan25")) return "Tuiles SCAN 25";
        if (n.startsWith("files/tiles/planign") || n.startsWith("files/tiles/plan")) return "Tuiles Plan IGN";
        if (n.startsWith("files/tiles/mnt")) return "Relief (ombres)";
        if (n.startsWith("files/tiles/slopes")) return "Tuiles des pentes";
        if (n.startsWith("files/tiles/")) return "Autres tuiles";
        if (n.startsWith("files/mbgl-offline") || n.contains("/mbgl-")) return "Cartes hors ligne (SCAN 25, Plan IGN)";
        if (n.contains("skitour")) return "Sorties ski (skitour)";
        if (n.contains("trace") || n.contains("track") || n.endsWith(".gpx")) return "Traces GPS";
        if (n.contains("photo") || n.endsWith(".jpg") || n.endsWith(".jpeg")) return "Photos";
        if (n.startsWith("app_webview/") || n.startsWith("app_textures/")) return "Stockage web (page de l'appli)";
        if (n.startsWith("shared_prefs/")) return "Réglages";
        if (n.startsWith("databases/")) return "Bases de données";
        if (n.startsWith("files/style-")) return "Styles de carte";
        return "Autres fichiers";
    }

    private static void walk(File root, String prefix, Map<String, long[]> cats) {
        File[] kids = root.listFiles();
        if (kids == null) return;
        for (File f : kids) {
            String rel = prefix + f.getName();
            // « lib » est un lien vers le code natif (compté avec l'appli) ; on ne suit aucun lien.
            if (prefix.isEmpty() && f.getName().equals("lib")) continue;
            if (f.isDirectory()) {
                if (isLink(f)) continue;
                walk(f, rel + "/", cats);
            } else {
                long[] c = cats.get(category(rel));
                if (c == null) { c = new long[2]; cats.put(category(rel), c); }
                c[0] += f.length(); c[1]++;
            }
        }
    }

    private static boolean isLink(File f) {
        try {
            File parent = f.getParentFile();
            File canon = parent == null ? f : new File(parent.getCanonicalFile(), f.getName());
            return !canon.getCanonicalFile().equals(canon.getAbsoluteFile());
        } catch (IOException e) {
            return true;
        }
    }

    private static long apkSize(ApplicationInfo ai) {
        long n = ai.sourceDir != null ? new File(ai.sourceDir).length() : 0;
        if (ai.splitSourceDirs != null) for (String s : ai.splitSourceDirs) n += new File(s).length();
        return n;
    }
}
