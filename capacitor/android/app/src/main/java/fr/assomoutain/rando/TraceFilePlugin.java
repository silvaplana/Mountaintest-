package fr.assomoutain.rando;

import android.app.Activity;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * 📥 Charger une trace : ouvre le sélecteur de fichiers d'Android dans le dernier dossier utilisé,
 * ou dans Téléchargements la première fois, et rend le texte des fichiers choisis (GPX, KML, GeoJSON).
 * Même comportement côté Kotlin (TraceFile.kt).
 */
@CapacitorPlugin(name = "TraceFile")
public class TraceFilePlugin extends Plugin {
    private static final String PREFS = "traceFile";
    private static final String LAST = "dernierDossier";
    private static final int MAX_BYTES = 30 * 1024 * 1024;

    /** Appli lancée par « Ouvrir avec » ou « Partager » un fichier de trace (Gmail, Fichiers…). */
    @Override
    public void load() {
        Intent i = getActivity().getIntent();
        if (i != null) handleOnNewIntent(i);
    }

    /**
     * Fichier ouvert depuis une autre appli : son texte part vers le JavaScript (évènement « opened »,
     * gardé tant que la page n'écoute pas encore). Même chose côté Kotlin (MainActivity.handleTraceIntent).
     */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        Uri uri = sharedUri(intent);
        // Un partage de photos n'est pas une trace : c'est PhotosRecuesPlugin qui le prend.
        if (uri == null || intent.getBooleanExtra(DONE, false) || PhotosRecuesPlugin.estPartagePhotos(intent)) return;
        intent.putExtra(DONE, true);
        Context ctx = getContext();
        new Thread(() -> {
            JSObject r = new JSObject();
            try {
                r.put("name", displayName(ctx, uri));
                r.put("text", readText(ctx, uri));
            } catch (Exception e) {
                r.put("error", String.valueOf(e.getMessage()));
            }
            notifyListeners("opened", r, true);
        }).start();
    }

    private static final String DONE = "fr.assomoutain.traceTraitee";

    @SuppressWarnings("deprecation")
    static Uri sharedUri(Intent intent) {
        if (Intent.ACTION_VIEW.equals(intent.getAction())) return intent.getData();
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            Object o = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            return o instanceof Uri ? (Uri) o : null;
        }
        return null;
    }

    static String readText(Context ctx, Uri uri) throws Exception {
        try (InputStream in = ctx.getContentResolver().openInputStream(uri)) {
            if (in == null) throw new Exception("fichier inaccessible");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > MAX_BYTES) throw new Exception("fichier trop gros");
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    @PluginMethod
    public void pick(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        // Beaucoup de téléphones ne connaissent pas le type « GPX » : on accepte tout, la lecture trie.
        i.setType("*/*");
        // Plusieurs fichiers d'un coup (Seb, 27/11 : reprendre toutes ses traces après une réinstallation).
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        if (Build.VERSION.SDK_INT >= 26) i.putExtra(DocumentsContract.EXTRA_INITIAL_URI, initialUri(getContext()));
        startActivityForResult(call, i, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        List<Uri> uris = new ArrayList<>();
        if (result.getResultCode() == Activity.RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null) for (int k = 0; k < clip.getItemCount(); k++) uris.add(clip.getItemAt(k).getUri());
            else if (data.getData() != null) uris.add(data.getData());
        }
        if (uris.isEmpty()) {
            JSObject r = new JSObject();
            r.put("cancelled", true);
            call.resolve(r);
            return;
        }
        Context ctx = getContext();
        new Thread(() -> {
            JSArray files = new JSArray();
            for (Uri uri : uris) {
                JSObject f = new JSObject();
                f.put("name", displayName(ctx, uri));
                try {
                    f.put("text", readText(ctx, uri));
                } catch (Exception e) {
                    f.put("error", String.valueOf(e.getMessage()));
                }
                files.put(f);
            }
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(LAST, uris.get(0).toString()).apply();
            JSObject r = new JSObject();
            r.put("files", files);
            call.resolve(r);
        }).start();
    }

    /**
     * 📁 Reprendre tout un dossier (Seb, 27/11 : après une réinstallation, les GPX de Téléchargements/Mountain Buddies
     * d'un coup). Android demande de choisir le dossier (ouvert sur Mountain Buddies) : c'est ce choix qui donne le droit de le lire.
     */
    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        if (Build.VERSION.SDK_INT >= 26) i.putExtra(DocumentsContract.EXTRA_INITIAL_URI,
                DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:Download/" + TraceShare.FOLDER));
        startActivityForResult(call, i, "folderPicked");
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Uri tree = result.getData() != null ? result.getData().getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || tree == null) {
            JSObject r = new JSObject();
            r.put("cancelled", true);
            call.resolve(r);
            return;
        }
        Context ctx = getContext();
        new Thread(() -> {
            JSArray files = new JSArray();
            Uri enfants = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            try (Cursor c = ctx.getContentResolver().query(enfants, new String[]{
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
                while (c != null && c.moveToNext()) {
                    String nom = c.getString(1);
                    if (nom == null || !nom.toLowerCase().matches(".*\\.(gpx|kml|geojson|json)$")) continue;
                    JSObject f = new JSObject();
                    f.put("name", nom);
                    try {
                        f.put("text", readText(ctx, DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0))));
                    } catch (Exception e) {
                        f.put("error", String.valueOf(e.getMessage()));
                    }
                    files.put(f);
                }
            } catch (Exception e) {
                call.reject("Lecture du dossier impossible : " + e.getMessage());
                return;
            }
            JSObject r = new JSObject();
            r.put("files", files);
            call.resolve(r);
        }).start();
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
