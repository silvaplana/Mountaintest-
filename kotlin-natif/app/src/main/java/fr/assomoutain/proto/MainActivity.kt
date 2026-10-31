package fr.assomoutain.proto

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.os.SystemClock
import android.util.Log
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.launch
import org.maplibre.android.MapLibre
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.PropertyFactory.circleColor
import org.maplibre.android.style.layers.PropertyFactory.circleRadius
import org.maplibre.android.style.layers.PropertyFactory.circleStrokeColor
import org.maplibre.android.style.layers.PropertyFactory.circleStrokeWidth
import org.maplibre.android.style.layers.PropertyFactory.lineColor
import org.maplibre.android.style.layers.PropertyFactory.lineWidth
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point

class MainActivity : AppCompatActivity() {

    private lateinit var mapView: MapView
    private lateinit var stats: TextView
    private var map: MapLibreMap? = null
    private var layer = IgnLayer.SCAN25
    private var mode = GpsMode.RANDO
    private var online = true
    private var gpsRunning = false
    private var startupLogged = false
    private var drawnPoints = -1
    private var offlineInfo = ""
    private var benchInfo = ""
    private val replay by lazy { GpxReplay(this) }

    private val askPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted[Manifest.permission.ACCESS_FINE_LOCATION] == true) startGps()
        else Toast.makeText(this, "Permission de localisation refusée", Toast.LENGTH_LONG).show()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        stats = findViewById(R.id.stats)
        mapView = findViewById(R.id.mapView)
        mapView.onCreate(savedInstanceState)
        mapView.getMapAsync { m ->
            map = m
            m.setMaxZoomPreference(Scenario.MAX_DISPLAY_ZOOM)
            loadStyle()
        }

        val btnLayer = findViewById<Button>(R.id.btnLayer)
        val btnNetwork = findViewById<Button>(R.id.btnNetwork)
        val btnMode = findViewById<Button>(R.id.btnMode)
        val btnGps = findViewById<Button>(R.id.btnGps)
        fun labels() {
            btnLayer.text = "Couche : ${layer.label}"
            btnNetwork.text = if (online) "Réseau : actif" else "Réseau : coupé (cache seul)"
            btnMode.text = "Mode GPS : ${mode.label}"
            btnGps.text = if (gpsRunning) "Arrêter GPS" else "Démarrer GPS"
        }
        labels()

        btnLayer.setOnClickListener {
            layer = IgnLayer.entries[(layer.ordinal + 1) % IgnLayer.entries.size]
            labels(); loadStyle()
        }
        // Simule le mode avion pour la carte seulement (le GPS n'utilise pas le réseau).
        btnNetwork.setOnClickListener {
            online = !online
            MapLibre.setConnected(online)
            labels()
        }
        btnMode.setOnClickListener {
            if (!gpsRunning) { mode = mode.next(); labels() }
        }
        btnGps.setOnClickListener {
            if (gpsRunning) stopGps() else requestGps()
            labels()
        }
        findViewById<Button>(R.id.btnOffline).setOnClickListener {
            OfflineDownloader(this).download(layer) { msg -> runOnUiThread { offlineInfo = msg; render() } }
        }
        findViewById<Button>(R.id.btnReplay).setOnClickListener {
            if (replay.running) replay.stop() else replay.start(lifecycleScope, mode)
        }
        findViewById<Button>(R.id.btnBench).setOnClickListener {
            val m = map ?: return@setOnClickListener
            benchInfo = "bench en cours…"; render()
            CameraBench(mapView, m).run { json -> benchInfo = json; render() }
        }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                TrackRecorder.state.collect { render() }
            }
        }
    }

    private fun loadStyle() {
        val m = map ?: return
        drawnPoints = -1
        m.setStyle(Style.Builder().fromUri(layer.styleUri(this))) { style ->
            style.addSource(GeoJsonSource(SRC_TRACK))
            style.addSource(GeoJsonSource(SRC_POS))
            style.addLayer(LineLayer("track", SRC_TRACK).withProperties(lineColor("#d7263d"), lineWidth(4f)))
            style.addLayer(CircleLayer("pos", SRC_POS).withProperties(
                circleRadius(7f), circleColor("#1e88e5"), circleStrokeColor("#ffffff"), circleStrokeWidth(2f)))
            render()
            if (!startupLogged) {
                mapView.addOnDidBecomeIdleListener(object : MapView.OnDidBecomeIdleListener {
                    override fun onDidBecomeIdle() {
                        mapView.removeOnDidBecomeIdleListener(this)
                        startupLogged = true
                        // Démarrage à froid : du lancement du processus à la première carte complète.
                        val ms = SystemClock.elapsedRealtime() - Process.getStartElapsedRealtime()
                        Log.i(Scenario.BENCH_TAG, """{"startup":"map_idle","ms":$ms,"online":$online}""")
                        benchInfo = "démarrage carte : $ms ms"; render()
                    }
                })
            }
        }
    }

    private fun render() {
        val s = TrackRecorder.state.value
        stats.text = buildString {
            append("${layer.label}  zoom ${map?.cameraPosition?.zoom?.let { "%.1f".format(it) } ?: "-"}\n")
            append("trace ${s.source}  ${s.points.size} pts / ${s.received} reçus\n")
            append("%.2f km  D+ %.0f m%s\n".format(s.distanceM / 1000, s.gainM, if (s.stationary) "  (à l'arrêt)" else ""))
            if (offlineInfo.isNotEmpty()) append("$offlineInfo\n")
            if (benchInfo.isNotEmpty()) append(benchInfo)
        }
        val style = map?.style ?: return
        if (!style.isFullyLoaded || s.points.size == drawnPoints) return
        drawnPoints = s.points.size
        val pts = s.points.map { Point.fromLngLat(it.lon, it.lat) }
        if (pts.size >= 2) style.getSourceAs<GeoJsonSource>(SRC_TRACK)?.setGeoJson(LineString.fromLngLats(pts))
        pts.lastOrNull()?.let { style.getSourceAs<GeoJsonSource>(SRC_POS)?.setGeoJson(it) }
    }

    private fun requestGps() {
        val perms = buildList {
            add(Manifest.permission.ACCESS_FINE_LOCATION)
            add(Manifest.permission.ACCESS_COARSE_LOCATION)
            if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
        }
        askPermissions.launch(perms.toTypedArray())
    }

    private fun startGps() {
        ContextCompat.startForegroundService(this,
            Intent(this, TrackingService::class.java).putExtra(TrackingService.EXTRA_MODE, mode.name))
        gpsRunning = true
        findViewById<Button>(R.id.btnGps).text = "Arrêter GPS"
    }

    private fun stopGps() {
        stopService(Intent(this, TrackingService::class.java))
        gpsRunning = false
    }

    override fun onStart() { super.onStart(); mapView.onStart() }
    override fun onResume() { super.onResume(); mapView.onResume() }
    override fun onPause() { mapView.onPause(); super.onPause() }
    override fun onStop() { mapView.onStop(); super.onStop() }
    override fun onLowMemory() { super.onLowMemory(); mapView.onLowMemory() }
    override fun onDestroy() { mapView.onDestroy(); super.onDestroy() }
    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); mapView.onSaveInstanceState(outState) }

    companion object {
        private const val SRC_TRACK = "track-src"
        private const val SRC_POS = "pos-src"
    }
}
