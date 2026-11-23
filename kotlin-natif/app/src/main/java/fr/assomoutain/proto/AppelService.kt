package fr.assomoutain.proto

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject

/**
 * 📞 Sonnerie des appels de groupe (spec/buddies.md §5.7, écran 10), même appli fermée : le serveur des comptes
 * envoie un message Firebase prioritaire ; ici le téléphone sonne (notification plein écran, Répondre / Refuser).
 * Appli à l'écran : pas de notification, l'écran 10 s'affiche (Appel.sonner). Un message « fin » arrête la sonnerie.
 * Même rôle côté React (android/…/AppelService.java).
 */
class AppelService : FirebaseMessagingService() {
    companion object {
        const val CANAL = "appels"
        const val NOTIF = 4242
        private const val PREFS = "appel"
        /** Vrai tant que MainActivity est à l'écran. */
        @Volatile var premierPlan = false
        private val principal = Handler(Looper.getMainLooper())

        fun sonner(c: Context, s: JSONObject) {
            val nm = c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CANAL) == null) {
                nm.createNotificationChannel(NotificationChannel(CANAL, "Appels des buddies", NotificationManager.IMPORTANCE_HIGH).apply {
                    setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                        AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build())
                    enableVibration(true)
                    vibrationPattern = longArrayOf(0, 800, 600, 800, 600)
                })
            }
            val n = NotificationCompat.Builder(c, CANAL)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("${s.optString("de")} t'appelle")
                .setContentText(s.optString("nom"))
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setOngoing(true)
                .setAutoCancel(true)
                .setTimeoutAfter(45_000)
                .setFullScreenIntent(ouvrir(c, s, "sonne", 1), true)
                .setContentIntent(ouvrir(c, s, "sonne", 1))
                .addAction(0, "Refuser", PendingIntent.getBroadcast(c, 3, Intent(c, Refus::class.java),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
                .addAction(0, "Répondre", ouvrir(c, s, "decrocher", 2))
                .build()
            n.flags = n.flags or Notification.FLAG_INSISTENT // la sonnerie continue jusqu'à la réponse
            try { nm.notify(NOTIF, n) } catch (_: SecurityException) { } // notifications refusées
            c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("appel", s.optString("appel")).apply()
        }

        private fun ouvrir(c: Context, s: JSONObject, action: String, code: Int): PendingIntent {
            val i = Intent(c, MainActivity::class.java).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra("appel", s.toString()).putExtra("appelAction", action)
            return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }

        /** L'appel ne sonne plus : notification retirée, l'écran 10 se ferme. null : celui qui sonne, quel qu'il soit. */
        fun arreter(c: Context, appel: String?) {
            val sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            if (appel == null || sp.getString("appel", null) == appel) {
                (c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(NOTIF)
                sp.edit().remove("appel").apply()
            }
            if (appel != null) principal.post { Appel.finSonnerie(appel) }
        }
    }

    override fun onMessageReceived(m: RemoteMessage) {
        val d = m.data
        when (d["type"]) {
            "fin" -> arreter(this, d["appel"])
            "appel" -> {
                // Arrivé en retard (téléphone hors réseau) : l'appel ne sonne plus.
                val envoye = d["envoye_le"]?.toLongOrNull()
                if (envoye != null && System.currentTimeMillis() - envoye > 45_000) return
                val s = JSONObject()
                for (k in listOf("appel", "de", "nom", "groupe", "sortie")) s.put(k, d[k] ?: "")
                if (premierPlan) principal.post { Appel.sonner(s) } else sonner(this, s)
            }
        }
    }

    // Nouveau jeton : l'appli le relit et l'envoie au serveur à chaque retour à l'écran (MainActivity.enregistrerAppareil).
    override fun onNewToken(jeton: String) = Unit

    /** « Refuser » sur la notification. */
    class Refus : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) = arreter(c, null)
    }
}
