package fr.assomoutain.rando;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;
import android.Manifest;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import java.util.ArrayList;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PermissionState;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Buddies (src/buddies/) : inviter des copains depuis le téléphone (spec/buddies.md §5.3).
 * - pickContact() : choisir un copain dans les contacts. Le sélecteur d'Android donne seulement le contact
 *   choisi : pas de permission « lire tous les contacts ».
 * - sms({numero, texte}) / mail({adresse, sujet, texte}) : ouvre Messages ou l'appli mail, prêts à envoyer.
 * - 🎤 ecouter() / arreterEcoute() : la dictée d'Android dans l'appli, sans sa fenêtre (hors ligne quand le téléphone
 *   a le français) : événements « dictee » (phrase en cours ou finie), « dicteeNiveau » (son, pour l'onde), « dicteeFin ».
 * - partager({titre, texte}) : le carnet en texte, vers l'appli choisie.
 * - epingler({jusqu}) / relever() : 📍 la position part toutes les 5 minutes (EpingleService, §5.9) ; chaque
 *   position arrive en événement « position » ; derniere() rend celle reçue appli fermée (et l'oublie).
 * - 📞 jetonPush() : le jeton Firebase de ce téléphone (vide sans google-services.json) ; appelEnAttente() : l'appel
 *   dont la notification a ouvert l'appli ; événements « appel » et « finAppel » (AppelService, §5.7).
 */
@CapacitorPlugin(name = "Buddies", permissions = { @Permission(alias = "micro", strings = { Manifest.permission.RECORD_AUDIO }) })
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
            @Override public void message(String cle) {
                JSObject o = new JSObject();
                o.put("cle", cle);
                notifyListeners("message", o);
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
        JSObject c = conversationDe(i);
        if (c != null) notifyListeners("ouvrirConversation", c);
    }

    /** 🔔 Ouverte depuis la notification d'un message : la conversation à ouvrir. */
    private JSObject conversationDe(Intent i) {
        String cle = i != null ? i.getStringExtra("conversation") : null;
        if (cle == null) return null;
        JSObject c = new JSObject();
        c.put("cle", cle);
        c.put("groupe", i.getStringExtra("groupe"));
        c.put("sortie", i.getStringExtra("sortie"));
        i.removeExtra("conversation");
        return c;
    }

    @PluginMethod
    public void conversationEnAttente(PluginCall call) {
        JSObject r = new JSObject();
        JSObject c = conversationDe(getActivity().getIntent());
        if (c != null) r.put("conversation", c);
        call.resolve(r);
    }

    /** 🔔 Ce qui est arrivé appli fermée (messages, paiements, partages), pour la fenêtre d'explication (Seb, 26/11). */
    @PluginMethod
    public void notifsAExpliquer(PluginCall call) {
        JSObject r = new JSObject();
        try { r.put("liste", new com.getcapacitor.JSArray(MessagesNotif.aExpliquer(getContext()).toString())); } catch (Exception e) { r.put("liste", new com.getcapacitor.JSArray()); }
        call.resolve(r);
    }

    /** La conversation est ouverte : sa notification s'efface. */
    @PluginMethod
    public void effacerNotif(PluginCall call) {
        MessagesNotif.effacer(getContext(), call.getString("cle", ""));
        call.resolve();
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

    // ------------------------------------------------------------------ 🎤 dictée

    private SpeechRecognizer reco;
    /** On veut encore dicter : une phrase finie, l'écoute repart (Android s'arrête après chaque phrase). */
    private boolean voulue;
    private int silences;
    private static final int SILENCES_MAX = 2;

    @PluginMethod
    public void ecouter(PluginCall call) {
        if (getPermissionState("micro") != PermissionState.GRANTED) { requestPermissionForAlias("micro", call, "microAccorde"); return; }
        demarrerEcoute(call);
    }

    @PermissionCallback
    private void microAccorde(PluginCall call) {
        if (getPermissionState("micro") == PermissionState.GRANTED) demarrerEcoute(call); else call.reject("micro");
    }

    private void demarrerEcoute(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (!SpeechRecognizer.isRecognitionAvailable(getContext())) { call.reject("indisponible"); return; }
            if (reco == null) {
                reco = SpeechRecognizer.createSpeechRecognizer(getContext());
                reco.setRecognitionListener(ecouteur);
            }
            voulue = true;
            silences = 0;
            lancer();
            call.resolve();
        });
    }

    private void lancer() {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "fr-FR");
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        reco.startListening(i);
    }

    @PluginMethod
    public void arreterEcoute(PluginCall call) {
        voulue = false;
        getActivity().runOnUiThread(() -> { if (reco != null) reco.stopListening(); });
        call.resolve();
    }

    private void suite() {
        if (voulue && silences < SILENCES_MAX) { lancer(); return; }
        voulue = false;
        notifyListeners("dicteeFin", new JSObject());
    }

    private void phrase(Bundle b, boolean fini) {
        ArrayList<String> l = b != null ? b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) : null;
        JSObject o = new JSObject();
        o.put("texte", l != null && !l.isEmpty() ? l.get(0) : "");
        o.put("fini", fini);
        notifyListeners("dictee", o);
        if (fini) silences = o.getString("texte", "").isEmpty() ? silences + 1 : 0;
    }

    private final RecognitionListener ecouteur = new RecognitionListener() {
        @Override public void onReadyForSpeech(Bundle b) { }
        @Override public void onBeginningOfSpeech() { }
        @Override public void onRmsChanged(float db) {
            JSObject o = new JSObject();
            o.put("niveau", db);
            notifyListeners("dicteeNiveau", o);
        }
        @Override public void onBufferReceived(byte[] b) { }
        @Override public void onEndOfSpeech() { }
        @Override public void onPartialResults(Bundle b) { phrase(b, false); }
        @Override public void onEvent(int t, Bundle b) { }
        @Override public void onResults(Bundle b) { phrase(b, true); suite(); }
        @Override public void onError(int e) {
            if (e == SpeechRecognizer.ERROR_NO_MATCH || e == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) { silences++; suite(); return; }
            boolean arrete = !voulue;
            voulue = false;
            JSObject o = new JSObject();
            if (!arrete && e != SpeechRecognizer.ERROR_CLIENT) o.put("erreur", e);
            notifyListeners("dicteeFin", o);
        }
    };

    @Override
    protected void handleOnDestroy() {
        if (reco != null) { reco.destroy(); reco = null; }
    }

    /** Un fichier reçu dans la messagerie (écrit dans le cache par l'appli) : ouvert avec l'appli qui sait le lire. */
    @PluginMethod
    public void ouvrirFichier(PluginCall call) {
        try {
            java.io.File f = new java.io.File(getContext().getCacheDir(), call.getString("chemin", ""));
            Uri uri = androidx.core.content.FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, call.getString("mime", "*/*")).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            ouvrir(call, Intent.createChooser(i, f.getName()));
        } catch (Exception e) {
            call.reject("Fichier illisible");
        }
    }

    /** Partage un fichier du cache de l'appli (film du survol 3D) avec l'appli choisie : WhatsApp, mail… */
    @PluginMethod
    public void partagerFichier(PluginCall call) {
        try {
            java.io.File f = new java.io.File(getContext().getCacheDir(), call.getString("chemin", ""));
            Uri uri = androidx.core.content.FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_SEND).setType(call.getString("mime", "video/*"))
                .putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            ouvrir(call, Intent.createChooser(i, call.getString("titre", "")));
        } catch (Exception e) {
            call.reject("Fichier illisible");
        }
    }

    /**
     * ⬇ Enregistre un film du cache dans la galerie : Movies/Mountain Buddies (un album de la galerie).
     * Avant Android 10, écrire là demande une permission : le film va dans le dossier Movies de l'appli.
     */
    @PluginMethod
    public void enregistrerFilm(PluginCall call) {
        java.io.File f = new java.io.File(getContext().getCacheDir(), call.getString("chemin", ""));
        String nom = call.getString("nom", f.getName()), mime = call.getString("mime", "video/mp4");
        try (java.io.InputStream in = new java.io.FileInputStream(f)) {
            JSObject r = new JSObject();
            if (android.os.Build.VERSION.SDK_INT >= 29) {
                android.content.ContentValues v = new android.content.ContentValues();
                v.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, nom);
                v.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, mime);
                v.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_MOVIES + "/Mountain Buddies/");
                v.put(android.provider.MediaStore.MediaColumns.IS_PENDING, 1);
                android.content.ContentResolver cr = getContext().getContentResolver();
                Uri uri = cr.insert(android.provider.MediaStore.Video.Media.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new IllegalStateException("galerie inaccessible");
                try (java.io.OutputStream o = cr.openOutputStream(uri)) { copier(in, o); }
                v.clear();
                v.put(android.provider.MediaStore.MediaColumns.IS_PENDING, 0);
                cr.update(uri, v, null, null);
                r.put("dossier", "Galerie › Mountain Buddies");
            } else {
                java.io.File dir = new java.io.File(getContext().getExternalFilesDir(android.os.Environment.DIRECTORY_MOVIES), "Mountain Buddies");
                if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("dossier impossible à créer");
                try (java.io.OutputStream o = new java.io.FileOutputStream(new java.io.File(dir, nom))) { copier(in, o); }
                r.put("dossier", "Movies › Mountain Buddies (dossier de l'appli)");
            }
            call.resolve(r);
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "film illisible");
        }
    }

    private static void copier(java.io.InputStream in, java.io.OutputStream o) throws java.io.IOException {
        byte[] b = new byte[64 * 1024];
        for (int n; (n = in.read(b)) > 0; ) o.write(b, 0, n);
    }

    @PluginMethod
    /** Le texte du presse-papiers : l'invitation copiée par la page web avant le téléchargement (spec §7.29). */
    public void pressePapiers(PluginCall call) {
        JSObject r = new JSObject();
        try {
            android.content.ClipboardManager cm = (android.content.ClipboardManager) getContext().getSystemService(android.content.Context.CLIPBOARD_SERVICE);
            android.content.ClipData clip = cm != null ? cm.getPrimaryClip() : null;
            if (clip != null && clip.getItemCount() > 0) {
                CharSequence t = clip.getItemAt(0).coerceToText(getContext());
                if (t != null) r.put("texte", t.toString());
            }
        } catch (Exception ignored) { /* pas d'accès : rien */ }
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
