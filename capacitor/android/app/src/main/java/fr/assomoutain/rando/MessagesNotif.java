package fr.assomoutain.rando;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import java.util.Map;
import org.json.JSONArray;

/**
 * 🔔 Nouveaux messages (spec/buddies.md §7.13, étape 4), appli fermée ou en arrière-plan : une notification par
 * conversation, avec ses derniers messages. La toucher ouvre la conversation. Elle s'efface quand on l'ouvre.
 */
final class MessagesNotif {
    static final String CANAL = "messages";
    private static final String PREFS = "notifsMessages";

    private MessagesNotif() { }

    static void montrer(Context c, Map<String, String> d) {
        String cle = d.get("cle");
        if (cle == null || cle.isEmpty()) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CANAL) == null) {
            nm.createNotificationChannel(new NotificationChannel(CANAL, "Messages des buddies", NotificationManager.IMPORTANCE_HIGH));
        }
        boolean aDeux = "1".equals(d.get("duo"));
        String ligne = aDeux ? d.get("texte") : d.get("de") + " : " + d.get("texte");
        // Les derniers messages de la conversation (6 au plus), gardés jusqu'à ce qu'on l'ouvre.
        SharedPreferences sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONArray l;
        try { l = new JSONArray(sp.getString(cle, "[]")); } catch (Exception e) { l = new JSONArray(); }
        l.put(ligne);
        while (l.length() > 6) l.remove(0);
        sp.edit().putString(cle, l.toString()).apply();
        // À expliquer dans une fenêtre à la prochaine ouverture de l'appli (Seb, 26/11).
        JSONArray ax;
        try { ax = new JSONArray(sp.getString(A_EXPLIQUER, "[]")); } catch (Exception e) { ax = new JSONArray(); }
        try { ax.put(new org.json.JSONObject().put("titre", d.get("titre")).put("ligne", ligne)); } catch (Exception ignored) { }
        while (ax.length() > 20) ax.remove(0);
        sp.edit().putString(A_EXPLIQUER, ax.toString()).apply();
        NotificationCompat.InboxStyle style = new NotificationCompat.InboxStyle();
        for (int i = 0; i < l.length(); i++) style.addLine(l.optString(i));
        if (l.length() > 1) style.setSummaryText(l.length() + " nouveaux messages");
        Intent i = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("conversation", cle).putExtra("groupe", d.get("groupe")).putExtra("sortie", d.get("sortie"));
        NotificationCompat.Builder n = new NotificationCompat.Builder(c, CANAL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(d.get("titre"))
            .setContentText(ligne)
            .setStyle(style)
            .setNumber(l.length())
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(PendingIntent.getActivity(c, cle.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        try { nm.notify(cle, 1, n.build()); } catch (SecurityException ignored) { } // notifications refusées
    }

    private static final String A_EXPLIQUER = "_aExpliquer";

    /** Les notifications arrivées appli fermée, pour la fenêtre d'explication ; la liste est vidée, les notifications effacées. */
    static JSONArray aExpliquer(Context c) {
        SharedPreferences sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONArray l;
        try { l = new JSONArray(sp.getString(A_EXPLIQUER, "[]")); } catch (Exception e) { l = new JSONArray(); }
        if (l.length() > 0) {
            sp.edit().clear().apply();
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            for (android.service.notification.StatusBarNotification n : nm.getActiveNotifications()) {
                if (n.getId() == 1 && n.getTag() != null) nm.cancel(n.getTag(), 1);
            }
        }
        return l;
    }

    /** La conversation est ouverte : sa notification s'efface. */
    static void effacer(Context c, String cle) {
        ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(cle, 1);
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(cle).apply();
    }
}
