package fr.assomoutain.rando;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;
import android.speech.RecognizerIntent;
import java.util.ArrayList;
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
 * - dicter() : la dictée d'Android (hors ligne quand le téléphone le permet), pour le récit du carnet (§5.8).
 * - partager({titre, texte}) : le carnet en texte, vers l'appli choisie.
 * - epingler({jusqu}) / relever() : 📍 la position part toutes les 5 minutes (EpingleService, §5.9) ; chaque
 *   position arrive en événement « position » ; derniere() rend celle reçue appli fermée (et l'oublie).
 * - 📞 jetonPush() : le jeton Firebase de ce téléphone (vide sans google-services.json) ; appelEnAttente() : l'appel
 *   dont la notification a ouvert l'appli ; événements « appel » et « finAppel » (AppelService, §5.7).
 */
@CapacitorPlugin(name = "Buddies")
public class BuddiesPlugin extends Plugin {
    @Override
    public void load() {
        EpingleService.ecouteur = p -> {
            try { notifyListeners("position", JSObject.fromJSONObject(p)); } catch (Exception ignored) { }
        };
        AppelService.ecouteur = new AppelService.Ecouteur() {
            @Override public void appel(org.json.JSONObject s) {
                try { notifyListeners("appel", JSObject.fromJSONObject(s)); } catch (Exception ignored) { }
            }
            @Override public void fin(String appel) {
                JSObject o = new JSObject();
                o.put("appel", appel);
                notifyListeners("finAppel", o);
            }
        };
        AppelService.premierPlan = true;
    }

    @Override
    protected void handleOnResume() { AppelService.premierPlan = true; }

    @Override
    protected void handleOnPause() { AppelService.premierPlan = false; }

    /** Appli déjà ouverte, touchée depuis la notification d'appel. */
    @Override
    protected void handleOnNewIntent(Intent i) {
        JSObject a = appelDe(i);
        if (a != null) notifyListeners("appel", a);
    }

    private JSObject appelDe(Intent i) {
        String s = i != null ? i.getStringExtra("appel") : null;
        if (s == null) return null;
        String action = i.getStringExtra("appelAction");
        i.removeExtra("appel");
        i.removeExtra("appelAction");
        ((android.app.NotificationManager) getContext().getSystemService(android.content.Context.NOTIFICATION_SERVICE)).cancel(AppelService.NOTIF);
        try {
            JSObject a = JSObject.fromJSONObject(new org.json.JSONObject(s));
            a.put("action", action);
            return a;
        } catch (Exception e) {
            return null;
        }
    }

    @PluginMethod
    public void appelEnAttente(PluginCall call) {
        JSObject r = new JSObject();
        JSObject a = appelDe(getActivity().getIntent());
        if (a != null) r.put("appel", a);
        call.resolve(r);
    }

    /** L'écran 10 est fermé (réponse, refus) : la sonnerie s'arrête. */
    @PluginMethod
    public void arreterSonnerie(PluginCall call) {
        AppelService.arreterSonnerie();
        call.resolve();
    }

    @PluginMethod
    public void jetonPush(PluginCall call) {
        JSObject r = new JSObject();
        r.put("jeton", "");
        // Sans google-services.json, Firebase n'est pas démarré : l'appli marche, elle ne sonne pas appli fermée.
        if (com.google.firebase.FirebaseApp.getApps(getContext()).isEmpty()) { call.resolve(r); return; }
        com.google.firebase.messaging.FirebaseMessaging.getInstance().getToken().addOnCompleteListener(t -> {
            if (t.isSuccessful() && t.getResult() != null) r.put("jeton", t.getResult());
            call.resolve(r);
        });
    }

    @PluginMethod
    public void epingler(PluginCall call) {
        EpingleService.demarrer(getContext(), call.getData().optLong("jusqu", 0L));
        call.resolve();
    }

    @PluginMethod
    public void relever(PluginCall call) {
        getContext().stopService(new Intent(getContext(), EpingleService.class));
        call.resolve();
    }

    @PluginMethod
    public void derniere(PluginCall call) {
        android.content.SharedPreferences sp = getContext().getSharedPreferences(EpingleService.PREFS, android.content.Context.MODE_PRIVATE);
        String s = sp.getString("derniere", null);
        sp.edit().remove("derniere").apply();
        JSObject r = new JSObject();
        try { if (s != null) r.put("position", JSObject.fromJSONObject(new org.json.JSONObject(s))); } catch (Exception ignored) { }
        call.resolve(r);
    }

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

    @PluginMethod
    public void dicter(PluginCall call) {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "fr-FR");
        i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        i.putExtra(RecognizerIntent.EXTRA_PROMPT, "Raconte, je t'écoute");
        try {
            startActivityForResult(call, i, "dicte");
        } catch (Exception e) {
            call.reject("Dictée indisponible");
        }
    }

    @ActivityCallback
    private void dicte(PluginCall call, ActivityResult result) {
        if (call == null) return;
        ArrayList<String> l = result.getData() != null ? result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS) : null;
        JSObject r = new JSObject();
        r.put("texte", l != null && !l.isEmpty() ? l.get(0) : "");
        call.resolve(r);
    }

    @PluginMethod
    public void partager(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_SEND);
        i.setType("text/plain");
        i.putExtra(Intent.EXTRA_SUBJECT, call.getString("titre", ""));
        i.putExtra(Intent.EXTRA_TEXT, call.getString("texte", ""));
        ouvrir(call, Intent.createChooser(i, call.getString("titre", "")));
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
