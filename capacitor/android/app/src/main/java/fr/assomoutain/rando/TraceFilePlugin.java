package fr.assomoutain.rando;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * 📥 Charger une trace : ouvre le sélecteur de fichiers d'Android dans le dernier dossier utilisé,
 * ou dans Téléchargements la première fois, et rend le texte du fichier choisi (GPX, KML, GeoJSON).
 * Même comportement côté Kotlin (TraceFile.kt).
 */
@CapacitorPlugin(name = "TraceFile")
public class TraceFilePlugin extends Plugin {
    private static final String PREFS = "traceFile";
    private static final String LAST = "dernierDossier";
    private static final int MAX_BYTES = 30 * 1024 * 1024;

    @PluginMethod
    public void pick(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        // Beaucoup de téléphones ne connaissent pas le type « GPX » : on accepte tout, la lecture trie.
        i.setType("*/*");
        if (Build.VERSION.SDK_INT >= 26) i.putExtra(DocumentsContract.EXTRA_INITIAL_URI, initialUri(getContext()));
        startActivityForResult(call, i, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Uri uri = result.getData() != null ? result.getData().getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            JSObject r = new JSObject();
            r.put("cancelled", true);
            call.resolve(r);
            return;
        }
        Context ctx = getContext();
        try (InputStream in = ctx.getContentResolver().openInputStream(uri)) {
            if (in == null) throw new Exception("fichier inaccessible");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > MAX_BYTES) throw new Exception("fichier trop gros");
            }
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(LAST, uri.toString()).apply();
            JSObject r = new JSObject();
            r.put("name", displayName(ctx, uri));
            r.put("text", new String(out.toByteArray(), StandardCharsets.UTF_8));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Lecture impossible : " + e.getMessage());
        }
    }

    /** Dossier du dernier fichier choisi, sinon Téléchargements. */
    static Uri initialUri(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String last = p.getString(LAST, null);
        if (last != null) {
            Uri u = Uri.parse(last);
            // Stockage interne : on remonte au dossier du fichier. Ailleurs, Android ouvre le dossier du fichier donné.
            if ("com.android.externalstorage.documents".equals(u.getAuthority())) {
                try {
                    String id = DocumentsContract.getDocumentId(u);
                    int cut = id.lastIndexOf('/');
                    String parent = cut > 0 ? id.substring(0, cut) : id.substring(0, id.indexOf(':') + 1);
                    return DocumentsContract.buildDocumentUri(u.getAuthority(), parent);
                } catch (Exception ignored) { /* on garde l'URI du fichier */ }
            }
            return u;
        }
        return DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:Download");
    }

    static String displayName(Context ctx, Uri uri) {
        try (Cursor c = ctx.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) { }
        String s = uri.getLastPathSegment();
        return s != null ? s : "";
    }
}
