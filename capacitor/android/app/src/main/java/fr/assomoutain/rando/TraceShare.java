package fr.assomoutain.rando;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * Mes traces en fichiers GPX visibles dans le téléphone (demande de Seb) : un fichier par trace dans
 * Téléchargements/Mountain Buddies, et 📤 Partager (mail, WhatsApp…) par la feuille de partage d'Android.
 * Copie identique dans les deux prototypes (voir shared/).
 */
public final class TraceShare {
    private TraceShare() {}

    public static final String FOLDER = "Mountain Buddies";
    /** Dossier tel que l'utilisateur le voit dans l'appli Fichiers. */
    public static final String SHOWN_FOLDER = "Téléchargements/" + FOLDER;

    /** Nom de fichier lisible : le nom de la trace sans les caractères interdits. */
    public static String fileName(String name) {
        String n = name.replaceAll("[\\\\/:*?\"<>|\\n\\r\\t]+", "-").trim();
        if (n.isEmpty()) n = "trace";
        if (n.length() > 80) n = n.substring(0, 80);
        return n + ".gpx";
    }

    private static String esc(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    /** GPX 1.1 d'une trace : lonlat = lon, lat, lon, lat… */
    public static String gpx(String name, double[] lonlat) {
        StringBuilder b = new StringBuilder();
        b.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
            .append("<gpx version=\"1.1\" creator=\"Mountain Buddies\" xmlns=\"http://www.topografix.com/GPX/1/1\">\n")
            .append("  <metadata><name>").append(esc(name)).append("</name></metadata>\n")
            .append("  <trk>\n    <name>").append(esc(name)).append("</name>\n    <trkseg>\n");
        for (int i = 0; i + 1 < lonlat.length; i += 2)
            b.append(String.format(Locale.US, "      <trkpt lat=\"%.6f\" lon=\"%.6f\"/>\n", lonlat[i + 1], lonlat[i]));
        b.append("    </trkseg>\n  </trk>\n</gpx>\n");
        return b.toString();
    }

    /** Fichier déjà présent dans Téléchargements/Mountain Buddies (Android 10 et plus) ? */
    private static Uri find(ContentResolver cr, String file) {
        if (Build.VERSION.SDK_INT < 29) return null;
        try (Cursor c = cr.query(MediaStore.Downloads.EXTERNAL_CONTENT_URI, new String[]{MediaStore.MediaColumns._ID},
                MediaStore.MediaColumns.DISPLAY_NAME + "=? AND " + MediaStore.MediaColumns.RELATIVE_PATH + "=?",
                new String[]{file, Environment.DIRECTORY_DOWNLOADS + "/" + FOLDER + "/"}, null)) {
            if (c != null && c.moveToFirst()) return Uri.withAppendedPath(MediaStore.Downloads.EXTERNAL_CONTENT_URI, String.valueOf(c.getLong(0)));
        } catch (Exception ignored) { }
        return null;
    }

    /**
     * Écrit (ou réécrit si replace) la trace dans Téléchargements/Mountain Buddies. Renvoie le chemin affiché.
     * Avant Android 10, le dossier Téléchargements demande une permission : on écrit dans le dossier de l'appli.
     */
    public static String save(Context ctx, String name, double[] lonlat, boolean replace) throws Exception {
        String file = fileName(name);
        byte[] data = gpx(name, lonlat).getBytes(StandardCharsets.UTF_8);
        if (Build.VERSION.SDK_INT >= 29) {
            ContentResolver cr = ctx.getContentResolver();
            Uri old = find(cr, file);
            if (old != null && !replace) return SHOWN_FOLDER + "/" + file;
            if (old != null) cr.delete(old, null, null);
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, file);
            v.put(MediaStore.MediaColumns.MIME_TYPE, "application/gpx+xml");
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + FOLDER + "/");
            Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new IllegalStateException("Téléchargements inaccessible");
            try (OutputStream o = cr.openOutputStream(uri)) { o.write(data); }
            return SHOWN_FOLDER + "/" + file;
        }
        File dir = new File(ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), FOLDER);
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("dossier impossible à créer");
        File f = new File(dir, file);
        if (f.exists() && !replace) return f.getAbsolutePath();
        try (FileOutputStream o = new FileOutputStream(f)) { o.write(data); }
        return f.getAbsolutePath();
    }

    /** Efface le fichier de la trace (trace effacée du téléphone). */
    public static void remove(Context ctx, String name) {
        String file = fileName(name);
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                Uri u = find(ctx.getContentResolver(), file);
                if (u != null) ctx.getContentResolver().delete(u, null, null);
            } else {
                File f = new File(new File(ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), FOLDER), file);
                if (f.exists()) f.delete();
            }
        } catch (Exception ignored) { }
    }

    /** 📤 Partager : feuille de partage d'Android avec le fichier GPX (mail, WhatsApp, Drive…). */
    public static void share(Activity a, String name, double[] lonlat) throws Exception {
        File dir = new File(a.getCacheDir(), "partage");
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("dossier impossible à créer");
        File f = new File(dir, fileName(name));
        try (FileOutputStream o = new FileOutputStream(f)) { o.write(gpx(name, lonlat).getBytes(StandardCharsets.UTF_8)); }
        Uri uri = FileProvider.getUriForFile(a, a.getPackageName() + ".fileprovider", f);
        Intent send = new Intent(Intent.ACTION_SEND)
            .setType("application/gpx+xml")
            .putExtra(Intent.EXTRA_STREAM, uri)
            .putExtra(Intent.EXTRA_SUBJECT, "Trace « " + name + " »")
            .putExtra(Intent.EXTRA_TEXT, "Trace « " + name + " » (fichier GPX, à ouvrir avec Mountain Buddies ou une appli de rando).")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        a.startActivity(Intent.createChooser(send, "Partager la trace"));
    }
}
