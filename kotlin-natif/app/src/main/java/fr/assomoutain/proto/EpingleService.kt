package fr.assomoutain.proto

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import org.json.JSONObject

/**
 * 📍 Position des buddies (spec/buddies.md §5.9) : tant que l'épingle est enfoncée, une position toutes les cinq
 * minutes environ, écran éteint compris (le GPS dort entre deux). S'arrête seul à l'heure prévue (ce soir).
 * Chaque position est gardée (la dernière seulement) et passée à l'appli (MainActivity), qui l'envoie aux buddies
 * à la synchro ; appli fermée, elle est relue au retour (derniere()). Même rôle que EpingleService.java côté Capacitor.
 */
class EpingleService : Service() {
    private lateinit var fused: FusedLocationProviderClient
    private val handler = Handler(Looper.getMainLooper())
    private val fin = Runnable { stopSelf() }
    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val l = result.lastLocation ?: return
            val o = JSONObject().put("lat", l.latitude).put("lon", l.longitude).put("t", l.time)
            if (l.hasAltitude()) o.put("alt", l.altitude)
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("derniere", o.toString()).apply()
            ecouteur?.invoke(o)
        }
    }

    override fun onCreate() { super.onCreate(); fused = LocationServices.getFusedLocationProviderClient(this) }

    @SuppressLint("MissingPermission") // demandée par MainActivity avant d'enfoncer l'épingle
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val sp = getSharedPreferences(PREFS, MODE_PRIVATE)
        val jusqu = intent?.getLongExtra("jusqu", 0L) ?: sp.getLong("jusqu", 0L)
        val reste = jusqu - System.currentTimeMillis()
        ServiceCompat.startForeground(this, 7, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        if (reste <= 0) { stopSelf(); return START_NOT_STICKY }
        sp.edit().putLong("jusqu", jusqu).apply()
        handler.removeCallbacks(fin); handler.postDelayed(fin, reste)
        fused.removeLocationUpdates(callback)
        fused.requestLocationUpdates(LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, INTERVALLE_MS)
            .setMinUpdateIntervalMillis(INTERVALLE_MS - 60_000L).setMaxUpdateDelayMillis(0).build(), callback, Looper.getMainLooper())
        return START_STICKY
    }

    override fun onDestroy() { handler.removeCallbacks(fin); fused.removeLocationUpdates(callback); super.onDestroy() }
    override fun onBind(intent: Intent?): IBinder? = null

    private fun notification(): Notification {
        getSystemService(NotificationManager::class.java)
            .createNotificationChannel(NotificationChannel(CANAL, "Position pour mes buddies", NotificationManager.IMPORTANCE_LOW))
        val pi = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CANAL)
            .setContentTitle("📍 Mes buddies me voient")
            .setContentText("Ta position part toutes les 5 minutes, jusqu'à ce soir.")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation).setContentIntent(pi).setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW).build()
    }

    companion object {
        private const val PREFS = "epingle"
        private const val CANAL = "buddies-position"
        private const val INTERVALLE_MS = 5 * 60_000L
        /** Appelé à chaque position (MainActivity, appli ouverte ou en arrière-plan). */
        @Volatile var ecouteur: ((JSONObject) -> Unit)? = null

        fun demarrer(ctx: Context, jusqu: Long) =
            ContextCompat.startForegroundService(ctx, Intent(ctx, EpingleService::class.java).putExtra("jusqu", jusqu))
        fun arreter(ctx: Context) { ctx.stopService(Intent(ctx, EpingleService::class.java)) }
        /** La position reçue appli fermée (et l'oublie). */
        fun derniere(ctx: Context): JSONObject? {
            val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val s = sp.getString("derniere", null) ?: return null
            sp.edit().remove("derniere").apply()
            return runCatching { JSONObject(s) }.getOrNull()
        }
    }
}
