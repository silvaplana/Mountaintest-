package fr.assomoutain.rando;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import java.util.Map;
import org.json.JSONObject;

/**
 * 🗺 « Seb partage sa carte » (Seb, 27/11, maquette notif-carte) : tout de suite, où qu'on soit, avec Non merci et
 * Suivre (depuis la messagerie : la conversation s'ouvre et la carte suit) ou Rejoindre (pendant un appel : on entre
 * dans l'appel, la carte suit d'elle-même).
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
        String ligne = appel ? de + " partage sa carte pendant l'appel" : de + " partage sa carte";
        PendingIntent oui;
        if (appel) {
            // Comme « Répondre » sur la sonnerie : l'appli s'ouvre et décroche.
            JSONObject s = new JSONObject();
            try { for (String k : new String[] { "appel", "de", "nom", "groupe", "sortie" }) s.put(k, d.containsKey(k) ? d.get(k) : ""); } catch (Exception ignored) { }
            Intent i = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra("appel", s.toString()).putExtra("appelAction", "decrocher").putExtra("carteNotif", id);
            oui = PendingIntent.getActivity(c, id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        } else {
            Intent i = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra("conversation", d.get("cle")).putExtra("groupe", d.get("groupe")).putExtra("sortie", d.get("sortie"))
                .putExtra("carte", cle).putExtra("carteDe", de).putExtra("carteNotif", id);
            oui = PendingIntent.getActivity(c, id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        }
        Intent non = new Intent(c, Non.class).putExtra("id", id);
        NotificationCompat.Builder n = new NotificationCompat.Builder(c, CANAL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle((appel ? "📞 " : "🗺 ") + d.get("titre"))
            .setContentText(ligne)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setTimeoutAfter(appel ? 10 * 60_000 : 4 * 3600_000)
            .setContentIntent(oui)
            .addAction(0, "Non merci", PendingIntent.getBroadcast(c, id + 1, non, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE))
            .addAction(0, appel ? "Rejoindre" : "Suivre", oui);
        try { nm.notify(id, n.build()); } catch (SecurityException ignored) { } // notifications refusées
    }

    /** L'appli s'ouvre par Suivre / Rejoindre : la notification s'efface. */
    static void effacer(Context c, int id) {
        if (id != 0) ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(id);
    }

    /** « Non merci » : la notification s'efface, rien d'autre. */
    public static class Non extends BroadcastReceiver {
        @Override
        public void onReceive(Context c, Intent i) { effacer(c, i.getIntExtra("id", 0)); }
    }
}
