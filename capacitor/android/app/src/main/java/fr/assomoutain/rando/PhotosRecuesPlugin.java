package fr.assomoutain.rando;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Parcelable;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;

/**
 * 📸 Photos « partagées » vers l'appli depuis WhatsApp, la galerie… (Seb, 25/11) : elles sont recopiées dans le
 * cache de l'appli et leurs chemins partent vers le JavaScript (évènement « recues », gardé tant que la page
 * n'écoute pas), qui demande dans quel album les ranger.
 */
@CapacitorPlugin(name = "PhotosRecues")
public class PhotosRecuesPlugin extends Plugin {
    private static final String FAIT = "fr.assomoutain.photosTraitees";
    private static final int MAX = 50;

    @Override
    public void load() {
        Intent i = getActivity().getIntent();
        if (i != null) handleOnNewIntent(i);
    }

    /** Vrai pour un partage d'images (une ou plusieurs). */
    static boolean estPartagePhotos(Intent i) {
        String a = i.getAction(), t = i.getType();
        return (Intent.ACTION_SEND.equals(a) || Intent.ACTION_SEND_MULTIPLE.equals(a)) && t != null && t.startsWith("image/");
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void handleOnNewIntent(Intent intent) {
        if (!estPartagePhotos(intent) || intent.getBooleanExtra(FAIT, false)) return;
        intent.putExtra(FAIT, true);
        ArrayList<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            Object o = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (o instanceof Uri) uris.add((Uri) o);
        } else {
            ArrayList<Parcelable> l = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (l != null) for (Parcelable p : l) if (p instanceof Uri) uris.add((Uri) p);
        }
        if (uris.isEmpty()) return;
        Context ctx = getContext();
        new Thread(() -> {
            File dossier = new File(ctx.getCacheDir(), "photos-recues");
            dossier.mkdirs();
            File[] vieux = dossier.listFiles();
            if (vieux != null) for (File f : vieux) f.delete();
            JSArray chemins = new JSArray();
            long t = System.currentTimeMillis();
            for (int k = 0; k < uris.size() && k < MAX; k++) {
                File f = new File(dossier, t + "-" + k + ".jpg");
                try (InputStream in = ctx.getContentResolver().openInputStream(uris.get(k)); OutputStream out = new FileOutputStream(f)) {
                    if (in == null) continue;
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    chemins.put(f.getAbsolutePath());
                } catch (Exception ignored) { /* photo illisible : on passe à la suivante */ }
            }
            JSObject r = new JSObject();
            r.put("chemins", chemins);
            notifyListeners("recues", r, true);
        }).start();
    }
}
