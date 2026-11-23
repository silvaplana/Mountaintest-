package fr.assomoutain.rando;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Buddies (src/buddies/) : inviter des copains depuis le téléphone (spec/buddies.md §5.3).
 * - pickContact() : choisir un copain dans les contacts. Le sélecteur d'Android donne seulement le contact
 *   choisi : pas de permission « lire tous les contacts ».
 * - sms({numero, texte}) / mail({adresse, sujet, texte}) : ouvre Messages ou l'appli mail, prêts à envoyer.
 */
@CapacitorPlugin(name = "Buddies")
public class BuddiesPlugin extends Plugin {
    @PluginMethod
    public void pickContact(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI);
        startActivityForResult(call, i, "contactChoisi");
    }

    @ActivityCallback
    private void contactChoisi(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Uri uri = result.getData() != null ? result.getData().getData() : null;
        if (uri == null) { call.reject("annulé"); return; }
        String[] cols = { ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER };
        try (Cursor c = getContext().getContentResolver().query(uri, cols, null, null, null)) {
            if (c == null || !c.moveToFirst()) { call.reject("Contact illisible"); return; }
            JSObject r = new JSObject();
            r.put("nom", c.getString(0));
            r.put("telephone", c.getString(1));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Contact illisible");
        }
    }

    @PluginMethod
    public void sms(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(call.getString("numero", ""))));
        i.putExtra("sms_body", call.getString("texte", ""));
        ouvrir(call, i);
    }

    @PluginMethod
    public void mail(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:" + Uri.encode(call.getString("adresse", ""))));
        i.putExtra(Intent.EXTRA_SUBJECT, call.getString("sujet", ""));
        i.putExtra(Intent.EXTRA_TEXT, call.getString("texte", ""));
        ouvrir(call, i);
    }

    private void ouvrir(PluginCall call, Intent i) {
        try {
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Aucune appli pour envoyer");
        }
    }
}
