package fr.assomoutain.proto

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.BatteryManager
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

/**
 * Suivi GPS économe :
 * - Fused Location Provider, avec filtre de distance et intervalle minimal du mode choisi ;
 * - écran éteint : les positions sont regroupées (batching) et livrées toutes les 60 s,
 *   ce qui laisse le processeur dormir entre deux livraisons (max(60 s, 4 × intervalle du mode)) ;
 * - batterie sous 20 % : bascule automatique en mode eco ;
 * - à l'arrêt (aucune position livrée pendant 2 min, donc moins que le filtre de distance) :
 *   passage en priorité « équilibrée » toutes les 60 s, la puce GPS se coupe ; retour en haute
 *   précision dès qu'on s'est éloigné de plus de 50 m (ou de la précision annoncée) du point d'arrêt.
 */
class TrackingService : Service() {

    private lateinit var fused: FusedLocationProviderClient
    private var mode = GpsMode.RANDO
    private var screenOn = true
    private var stationary = false
    private var last: Location? = null
    private var anchor: Location? = null
    private val handler = Handler(Looper.getMainLooper())
    private val stationaryTimeout = Runnable {
        if (!stationary && last != null) { stationary = true; anchor = last; switch() }
    }

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            for (loc in result.locations) onFix(loc)
        }
    }

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            screenOn = intent.action == Intent.ACTION_SCREEN_ON
            fused.removeLocationUpdates(callback)
            requestUpdates()
        }
    }

    private val batteryReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
            val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
            if (level >= 0 && level * 100 / scale < LOW_BATTERY_PCT && mode != GpsMode.ECO) {
                mode = GpsMode.ECO
                TrackRecorder.setMode(mode)
                fused.removeLocationUpdates(callback)
                requestUpdates()
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        fused = LocationServices.getFusedLocationProviderClient(this)
        registerReceiver(screenReceiver, IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON); addAction(Intent.ACTION_SCREEN_OFF)
        })
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        mode = GpsMode.valueOf(intent?.getStringExtra(EXTRA_MODE) ?: GpsMode.RANDO.name)
        ServiceCompat.startForeground(this, 1, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        TrackRecorder.start("gps-${mode.label}", mode)
        requestUpdates()
        handler.postDelayed(stationaryTimeout, STATIONARY_AFTER_MS)
        registerReceiver(batteryReceiver, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        return START_STICKY
    }

    @SuppressLint("MissingPermission") // demandée par MainActivity avant de démarrer le service
    private fun requestUpdates() {
        val request = if (stationary) {
            LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, 60_000)
                .setMinUpdateIntervalMillis(30_000)
                .setMaxUpdateDelayMillis(if (screenOn) 0 else 120_000)
                .build()
        } else {
            LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, mode.minIntervalMs)
                .setMinUpdateIntervalMillis(mode.minIntervalMs)
                .setMinUpdateDistanceMeters(mode.minDistanceM)
                .setMaxUpdateDelayMillis(if (screenOn) 0 else maxOf(60_000L, 4 * mode.minIntervalMs))
                .build()
        }
        fused.requestLocationUpdates(request, callback, Looper.getMainLooper())
        Log.i(Scenario.BENCH_TAG, """{"gps":"request","mode":"${mode.label}","stationary":$stationary,"screenOn":$screenOn}""")
    }

    private fun onFix(loc: Location) {
        TrackRecorder.add(Fix(loc.latitude, loc.longitude, if (loc.hasAltitude()) loc.altitude else null, loc.accuracy, loc.time))
        last = loc
        if (!stationary) {
            handler.removeCallbacks(stationaryTimeout)
            handler.postDelayed(stationaryTimeout, STATIONARY_AFTER_MS)
        } else if (anchor!!.distanceTo(loc) > maxOf(50f, loc.accuracy)) {
            stationary = false; switch()
        }
    }

    private fun switch() {
        TrackRecorder.setStationary(stationary)
        fused.removeLocationUpdates(callback)
        requestUpdates()
        if (!stationary) handler.postDelayed(stationaryTimeout, STATIONARY_AFTER_MS)
    }

    override fun onDestroy() {
        handler.removeCallbacks(stationaryTimeout)
        fused.removeLocationUpdates(callback)
        unregisterReceiver(screenReceiver)
        runCatching { unregisterReceiver(batteryReceiver) }
        TrackRecorder.stop(getExternalFilesDir("traces")!!)
        super.onDestroy()
    }

    private fun notification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("gps", "Enregistrement GPS", NotificationManager.IMPORTANCE_LOW))
        return NotificationCompat.Builder(this, "gps")
            .setContentTitle("Enregistrement de la trace")
            .setContentText("Mode ${mode.label}")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .build()
    }

    companion object {
        const val EXTRA_MODE = "mode"
        private const val STATIONARY_AFTER_MS = 120_000L
        private const val LOW_BATTERY_PCT = 20
    }
}
