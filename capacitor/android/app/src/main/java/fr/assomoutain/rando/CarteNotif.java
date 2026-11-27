package fr.assomoutain.rando;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import java.util.Map;
import org.json.JSONObject;

/**
 * 🗺 « Sébastien partage sa carte », appli fermée ou en arrière-plan (Seb, 27/11). Une notification simple, sans
 * boutons : la toucher ouvre l'appli sur la même fenêtre que appli ouverte (Non merci / Suivre, ou Rejoindre pendant
 * un appel). Appli à l'écran, pas de notification : AppelService passe la proposition à l'appli.
 */
final class CarteNotif {
    static final String CANAL = "cartes";

    private CarteNotif() { }

    static void montrer(Context c, Map<String, String> d) {
        boolean appel = "carte_appel".equals(d.get("type"));
        String cle = appel ? d.get("appel") : d.get("message");
        if (cle == null || cle.isEmpty()) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CANAL) == null) {
            nm.createNotificationChannel(new NotificationChannel(CANAL, "Cartes partagées", NotificationManager.IMPORTANCE_HIGH));
        }
        int id = ("carte" + cle).hashCode();
        String de = d.get("de") != null ? d.get("de") : "";
        Intent i = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("carteProposee", new JSONObject(d).toString()).putExtra("carteNotif", id);
        PendingIntent ouvrir = PendingIntent.getActivity(c, id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder n = new NotificationCompat.Builder(c, CANAL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(d.get("titre"))
            .setContentText(appel ? de + " partage sa carte pendant l'appel" : de + " partage sa carte")
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setTimeoutAfter(appel ? 10 * 60_000 : 4 * 3600_000)
            .setContentIntent(ouvrir);
        try { nm.notify(id, n.build()); } catch (SecurityException ignored) { } // notifications refusées
    }

    /** L'appli s'ouvre par la notification : elle s'efface. */
    static void effacer(Context c, int id) {
        if (id != 0) ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(id);
    }
}
