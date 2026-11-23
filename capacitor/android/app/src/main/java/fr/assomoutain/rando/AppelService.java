package fr.assomoutain.rando;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;
import org.json.JSONObject;

/**
 * 📞 Sonnerie des appels de groupe (spec/buddies.md §5.7, écran 10), même appli fermée : le serveur des comptes
 * envoie un message Firebase prioritaire ; ici le téléphone sonne (notification plein écran, Répondre / Refuser).
 * Appli au premier plan : pas de notification, l'écran 10 de l'appli s'affiche (événement « appel » du plugin).
 * Un message « fin » (l'appelant a raccroché) arrête la sonnerie.
 */
public class AppelService extends FirebaseMessagingService {
    static final String CANAL = "appels";
    static final int NOTIF = 4242;
    /** Branché par BuddiesPlugin tant que l'appli est à l'écran. */
    static volatile Ecouteur ecouteur;
    static volatile boolean premierPlan;

    interface Ecouteur { void appel(JSONObject sonnerie); void fin(String appel); }

    @Override
    public void onMessageReceived(RemoteMessage m) {
        Map<String, String> d = m.getData();
        String type = d.get("type");
        if ("fin".equals(type)) {
            arreter(this, d.get("appel"));
            return;
        }
        if (!"appel".equals(type)) return;
        // Arrivé en retard (téléphone hors réseau) : l'appel ne sonne plus.
        try {
            long envoye = Long.parseLong(d.get("envoye_le"));
            if (System.currentTimeMillis() - envoye > 45_000) return;
        } catch (Exception ignored) { }
        JSONObject s = new JSONObject();
        try {
            for (String k : new String[] { "appel", "de", "nom", "groupe", "sortie" }) s.put(k, d.containsKey(k) ? d.get(k) : "");
        } catch (Exception ignored) { }
        Ecouteur e = ecouteur;
        if (premierPlan && e != null) { e.appel(s); return; }
        sonner(this, s);
    }

    static void sonner(Context c, JSONObject s) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CANAL) == null) {
            NotificationChannel ch = new NotificationChannel(CANAL, "Appels des buddies", NotificationManager.IMPORTANCE_HIGH);
            ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build());
            ch.enableVibration(true);
            ch.setVibrationPattern(new long[] { 0, 800, 600, 800, 600 });
            nm.createNotificationChannel(ch);
        }
        String de = s.optString("de"), nom = s.optString("nom");
        NotificationCompat.Builder n = new NotificationCompat.Builder(c, CANAL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(de + " t'appelle")
            .setContentText(nom)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setAutoCancel(true)
            .setTimeoutAfter(45_000)
            .setFullScreenIntent(ouvrir(c, s, "sonne", 1), true)
            .setContentIntent(ouvrir(c, s, "sonne", 1))
            .addAction(0, "Refuser", PendingIntent.getBroadcast(c, 3, new Intent(c, Refus.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE))
            .addAction(0, "Répondre", ouvrir(c, s, "decrocher", 2));
        android.app.Notification notif = n.build();
        notif.flags |= android.app.Notification.FLAG_INSISTENT; // la sonnerie continue jusqu'à la réponse
        try { nm.notify(NOTIF, notif); } catch (SecurityException ignored) { } // notifications refusées
        c.getSharedPreferences(EpingleService.PREFS, Context.MODE_PRIVATE).edit().putString("appel", s.toString()).apply();
    }

    private static PendingIntent ouvrir(Context c, JSONObject s, String action, int code) {
        Intent i = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("appel", s.toString()).putExtra("appelAction", action);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** L'appel ne sonne plus : notification retirée, l'écran 10 de l'appli se ferme. */
    static void arreter(Context c, String appel) {
        android.content.SharedPreferences sp = c.getSharedPreferences(EpingleService.PREFS, Context.MODE_PRIVATE);
        String s = sp.getString("appel", null);
        if (appel == null || s == null || s.contains(appel)) {
            ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(NOTIF);
            sp.edit().remove("appel").apply();
        }
        Ecouteur e = ecouteur;
        if (e != null && appel != null) e.fin(appel);
    }

    @Override
    public void onNewToken(String jeton) {
        // Repris par l'appli à son prochain démarrage (jetonPush) et envoyé au serveur.
        getSharedPreferences(EpingleService.PREFS, MODE_PRIVATE).edit().putString("jetonPush", jeton).apply();
    }

    /** « Refuser » sur la notification. */
    public static class Refus extends BroadcastReceiver {
        @Override
        public void onReceive(Context c, Intent i) { arreter(c, null); }
    }
}
