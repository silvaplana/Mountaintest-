package fr.assomoutain.proto;

import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;

/**
 * Prendre une photo sans quitter l'appli (copie identique dans les deux prototypes, voir shared/).
 * L'appareil photo du téléphone s'ouvre par-dessus, on déclenche, et on revient tout de suite sur la carte.
 * La photo va dans la galerie, album « Assomoutain » (Images/Assomoutain), sans autorisation de stockage.
 */
public final class PhotoCapture {
    private PhotoCapture() {}

    private static Uri pending;

    /** Intent à lancer (startActivityForResult), ou null si impossible (Android 9 et moins). */
    public static Intent prepare(Context c) {
        if (Build.VERSION.SDK_INT < 29) return null;
        ContentValues v = new ContentValues();
        v.put(MediaStore.Images.Media.DISPLAY_NAME, "rando_" + System.currentTimeMillis() + ".jpg");
        v.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
        v.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Assomoutain");
        v.put(MediaStore.Images.Media.IS_PENDING, 1);
        pending = c.getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
        if (pending == null) return null;
        Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        i.putExtra(MediaStore.EXTRA_OUTPUT, pending);
        i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        return i;
    }

    /** À appeler au retour de l'appareil photo : garde la photo (ok) ou efface l'emplacement vide. */
    public static boolean finish(Context c, boolean ok) {
        Uri u = pending;
        pending = null;
        if (u == null) return false;
        try {
            if (ok) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Images.Media.IS_PENDING, 0);
                c.getContentResolver().update(u, v, null, null);
                return true;
            }
            c.getContentResolver().delete(u, null, null);
        } catch (Exception ignored) {
            // emplacement déjà retiré
        }
        return false;
    }
}
