package fr.assomoutain.rando;

import android.Manifest;
import android.content.ContentUris;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Photo.open() ouvre l'application Appareil photo (PhotoCapture). Photo.recentes({ depuis }) rend les photos
 * arrivées dans la galerie depuis ce moment (millisecondes), recopiées dans le cache de l'appli : celles qu'on
 * vient de prendre, pour les ranger dans l'album d'une sortie (Seb, 25/11).
 */
@CapacitorPlugin(name = "Photo", permissions = {
    @Permission(alias = "photos", strings = { Manifest.permission.READ_MEDIA_IMAGES }),
    @Permission(alias = "photosAvant13", strings = { Manifest.permission.READ_EXTERNAL_STORAGE })
})
public class PhotoPlugin extends Plugin {
    private static final int MAX = 30;

    @PluginMethod
    public void open(PluginCall call) {
        if (PhotoCapture.open(getActivity())) call.resolve();
        else call.reject("Pas d'appareil photo disponible");
    }

    private static String alias() { return Build.VERSION.SDK_INT >= 33 ? "photos" : "photosAvant13"; }

    @PluginMethod
    public void recentes(PluginCall call) {
        if (getPermissionState(alias()) != PermissionState.GRANTED) requestPermissionForAlias(alias(), call, "apresDemande");
        else lire(call);
    }

    @PermissionCallback
    private void apresDemande(PluginCall call) {
        if (getPermissionState(alias()) == PermissionState.GRANTED) { lire(call); return; }
        JSObject r = new JSObject();
        r.put("refuse", true);
        r.put("chemins", new JSArray());
        call.resolve(r);
    }

    private void lire(PluginCall call) {
        Double depuis = call.getDouble("depuis", 0.0);
        long t = (long) (depuis / 1000);
        Context ctx = getContext();
        new Thread(() -> {
            JSArray chemins = new JSArray();
            File dossier = new File(ctx.getCacheDir(), "photos-prises");
            dossier.mkdirs();
            File[] vieux = dossier.listFiles();
            if (vieux != null) for (File f : vieux) f.delete();
            Uri table = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
            try (Cursor c = ctx.getContentResolver().query(table, new String[]{ MediaStore.Images.Media._ID },
                    MediaStore.Images.Media.DATE_ADDED + " >= ?", new String[]{ String.valueOf(t) }, MediaStore.Images.Media.DATE_ADDED + " ASC")) {
                int k = 0;
                while (c != null && c.moveToNext() && k < MAX) {
                    Uri uri = ContentUris.withAppendedId(table, c.getLong(0));
                    File f = new File(dossier, t + "-" + k + ".jpg");
                    try (InputStream in = ctx.getContentResolver().openInputStream(uri); OutputStream out = new FileOutputStream(f)) {
                        if (in == null) continue;
                        byte[] buf = new byte[64 * 1024];
                        int n;
                        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                        chemins.put(f.getAbsolutePath());
                        k++;
                    } catch (Exception ignored) { /* photo illisible : on passe à la suivante */ }
                }
            } catch (Exception ignored) { /* galerie illisible : rien à ranger */ }
            JSObject r = new JSObject();
            r.put("chemins", chemins);
            call.resolve(r);
        }).start();
    }
}
