package fr.assomoutain.proto

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.os.SystemClock
import android.text.Editable
import android.text.TextWatcher
import android.util.Log
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.ImageButton
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updateLayoutParams
import androidx.core.view.updatePadding
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.location.LocationComponentActivationOptions
import org.maplibre.android.location.engine.LocationEngineRequest
import org.maplibre.android.location.modes.CameraMode
import org.maplibre.android.location.modes.RenderMode
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory.circleColor
import org.maplibre.android.style.layers.PropertyFactory.circleRadius
import org.maplibre.android.style.layers.PropertyFactory.circleStrokeColor
import org.maplibre.android.style.layers.PropertyFactory.circleStrokeWidth
import org.maplibre.android.style.layers.PropertyFactory.lineColor
import org.maplibre.android.style.layers.PropertyFactory.lineOpacity
import org.maplibre.android.style.layers.PropertyFactory.lineWidth
import org.maplibre.android.style.layers.PropertyFactory.rasterOpacity
import org.maplibre.android.style.layers.PropertyFactory.visibility
import org.maplibre.android.style.layers.RasterLayer
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.android.style.sources.RasterSource
import org.maplibre.android.style.sources.TileSet
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Même écran que le prototype Capacitor : carte plein écran, fond de carte (Auto / SCAN 25 / Plan IGN)
 * et pentes en haut à gauche, zoom et « me localiser » à droite, panneau à trois onglets en bas.
 */
class MainActivity : AppCompatActivity() {

    private enum class Source(val label: String) { GPS("GPS réel"), SIM10("Simulation ×10"), SIM60("Simulation ×60") }
    private enum class Tab { SORTIE, OFFLINE, MESURES }

    private lateinit var mapView: MapView
    private var map: MapLibreMap? = null
    private var mapMode = MapMode.AUTO
    private var slopes = false
    private var mode = GpsMode.RANDO
    private var source = Source.GPS
    private var online = true
    private var gpsRunning = false
    private var follow = true
    private var locating = false
    private var sheetOpen = true
    private var tab = Tab.SORTIE
    private var startupMs: Long? = null
    private var drawnPoints = -1
    private var imported: List<Fix> = emptyList()
    private var benchInfo = "—"
    private var offlineSummary = "—"
    private val replay by lazy { GpxReplay(this) }
    private val offline by lazy { OfflineDownloader(this) }
    private val prefs by lazy { getSharedPreferences("reglages", MODE_PRIVATE) }
    private var apiKey = ""

    private val askTrackPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted[Manifest.permission.ACCESS_FINE_LOCATION] == true) startGps()
        else toast("Permission de localisation refusée")
        refreshSortie()
    }
    private val askLocatePermission = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted.values.any { it }) startLocate() else toast("Permission de localisation refusée")
    }
    private val exportLauncher = registerForActivityResult(ActivityResultContracts.CreateDocument("application/gpx+xml")) { uri ->
        uri?.let { exportTo(it) }
    }
    private val importLauncher = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let { importFrom(it) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        apiKey = prefs.getString("apiKey", null) ?: Scenario.DEFAULT_SCAN_KEY
        mapMode = runCatching { MapMode.valueOf(prefs.getString("mapMode", null) ?: "") }.getOrDefault(MapMode.AUTO)
        applyInsets()

        mapView = findViewById(R.id.mapView)
        mapView.onCreate(savedInstanceState)
        mapView.getMapAsync { m ->
            map = m
            m.setMaxZoomPreference(Scenario.MAX_DISPLAY_ZOOM)
            m.uiSettings.isAttributionEnabled = true
            // Un glissement de carte arrête le suivi (comme côté Capacitor) ; la position reste affichée.
            m.addOnCameraMoveStartedListener { reason ->
                if (reason == MapLibreMap.OnCameraMoveStartedListener.REASON_API_GESTURE) {
                    if (follow && (gpsRunning || replay.running)) setFollow(false)
                    refreshLocateButton()
                }
            }
            loadStyle()
        }

        // Fond de carte et pentes
        val btnLayer = findViewById<Button>(R.id.btnLayer)
        btnLayer.text = "${mapMode.label} ▾"
        btnLayer.setOnClickListener {
            mapMode = mapMode.next()
            prefs.edit().putString("mapMode", mapMode.name).apply()
            btnLayer.text = "${mapMode.label} ▾"
            loadStyle(); refreshOffline()
        }
        findViewById<CheckBox>(R.id.chkSlopes).setOnCheckedChangeListener { _, checked -> slopes = checked; applySlopes() }

        // Boutons carte
        findViewById<Button>(R.id.btnZoomIn).setOnClickListener { map?.animateCamera(CameraUpdateFactory.zoomIn()) }
        findViewById<Button>(R.id.btnZoomOut).setOnClickListener { map?.animateCamera(CameraUpdateFactory.zoomOut()) }
        findViewById<ImageButton>(R.id.btnLocate).setOnClickListener { onLocateClicked() }

        // Panneau
        findViewById<View>(R.id.handle).setOnClickListener { sheetOpen = !sheetOpen; refreshTabs() }
        findViewById<Button>(R.id.tabSortie).setOnClickListener { showTab(Tab.SORTIE) }
        findViewById<Button>(R.id.tabOffline).setOnClickListener { showTab(Tab.OFFLINE) }
        findViewById<Button>(R.id.tabMesures).setOnClickListener { showTab(Tab.MESURES) }

        // Onglet Sortie
        findViewById<Button>(R.id.btnMode).setOnClickListener { if (!recording()) { mode = mode.next(); refreshSortie() } }
        findViewById<Button>(R.id.btnSource).setOnClickListener {
            if (!recording()) { source = Source.entries[(source.ordinal + 1) % Source.entries.size]; refreshSortie() }
        }
        findViewById<Button>(R.id.btnStart).setOnClickListener { if (recording()) stopRecording() else startRecording() }
        findViewById<CheckBox>(R.id.chkFollow).setOnCheckedChangeListener { _, c -> follow = c; if (c) drawnPoints = -1; render() }
        findViewById<Button>(R.id.btnExport).setOnClickListener {
            val stamp = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd'_'HH'h'mm"))
            exportLauncher.launch("sortie-$stamp.gpx")
        }
        findViewById<Button>(R.id.btnImport).setOnClickListener { importLauncher.launch(arrayOf("*/*")) }
        findViewById<Button>(R.id.btnClearImport).setOnClickListener { imported = emptyList(); drawImported(); refreshSortie() }

        // Onglet Hors ligne
        val editKey = findViewById<EditText>(R.id.editKey)
        editKey.setText(apiKey)
        editKey.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable?) {
                apiKey = s.toString().trim()
                prefs.edit().putString("apiKey", apiKey).apply()
            }
        })
        findViewById<Button>(R.id.btnTestKey).setOnClickListener { testKey() }
        // Simule le mode avion pour la carte seulement (le GPS n'utilise pas le réseau).
        findViewById<Button>(R.id.btnNetwork).setOnClickListener {
            online = !online
            MapLibre.setConnected(online)
            refreshOffline()
        }
        findViewById<Button>(R.id.btnDownload).setOnClickListener { downloadZone() }
        findViewById<Button>(R.id.btnCancel).setOnClickListener { offline.cancel(); setStatus("Téléchargement annulé.") }
        findViewById<Button>(R.id.btnClear).setOnClickListener {
            offline.clear { runOnUiThread { findViewById<ProgressBar>(R.id.progress).visibility = View.GONE; refreshOffline() } }
        }

        // Onglet Mesures
        findViewById<Button>(R.id.btnRefresh).setOnClickListener { refreshMesures() }
        findViewById<Button>(R.id.btnBench).setOnClickListener {
            val m = map ?: return@setOnClickListener
            benchInfo = "en cours…"
            sheetOpen = false; refreshTabs()
            CameraBench(mapView, m).run { json ->
                benchInfo = json
                sheetOpen = true; showTab(Tab.MESURES)
            }
        }

        refreshTabs(); refreshSortie(); refreshOffline()

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                TrackRecorder.state.collect { render(); refreshStats() }
            }
        }
    }

    /** Android 15 dessine sous les barres système : on décale le haut et le bas de l'interface. */
    private fun applyInsets() {
        val top = listOf(findViewById<View>(R.id.topBar), findViewById<View>(R.id.mapButtons))
        val sheet = findViewById<View>(R.id.sheet)
        val margin = (10 * resources.displayMetrics.density).toInt()
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.root)) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            top.forEach { v -> v.updateLayoutParams<android.widget.FrameLayout.LayoutParams> { topMargin = bars.top + margin } }
            sheet.updatePadding(bottom = bars.bottom + margin)
            insets
        }
    }

    // ---------- Carte ----------

    private fun loadStyle() {
        val m = map ?: return
        drawnPoints = -1
        m.setStyle(Style.Builder().fromUri(mapMode.styleUri(this, apiKey))) { style ->
            // Pentes : ajoutées ici et pas dans le fichier de style, pour ne pas être téléchargées hors ligne.
            val slopesLayer = IgnLayer.SLOPES
            style.addSource(RasterSource(SRC_SLOPES, TileSet("2.2.0", slopesLayer.tileUrl(apiKey)).apply {
                maxZoom = slopesLayer.maxNativeZoom.toFloat()
            }, 256))
            style.addLayer(RasterLayer(LAYER_SLOPES, SRC_SLOPES).withProperties(rasterOpacity(0.6f), visibility(Property.NONE)))
            style.addSource(GeoJsonSource(SRC_IMPORT))
            style.addSource(GeoJsonSource(SRC_TRACK))
            style.addSource(GeoJsonSource(SRC_POS))
            style.addLayer(LineLayer("import", SRC_IMPORT).withProperties(lineColor("#7b3fe4"), lineWidth(4f), lineOpacity(0.8f)))
            style.addLayer(LineLayer("track", SRC_TRACK).withProperties(lineColor("#e4572e"), lineWidth(4f)))
            style.addLayer(CircleLayer("pos", SRC_POS).withProperties(
                circleRadius(7f), circleColor("#1d6fe0"), circleStrokeColor("#ffffff"), circleStrokeWidth(3f)))
            applySlopes()
            drawImported(fit = false)
            render()
            if (locating) startLocate()
            if (startupMs == null) {
                mapView.addOnDidBecomeIdleListener(object : MapView.OnDidBecomeIdleListener {
                    override fun onDidBecomeIdle() {
                        mapView.removeOnDidBecomeIdleListener(this)
                        // Démarrage à froid : du lancement du processus à la première carte complète.
                        val ms = SystemClock.elapsedRealtime() - Process.getStartElapsedRealtime()
                        startupMs = ms
                        Log.i(Scenario.BENCH_TAG, """{"startup":"map_idle","ms":$ms,"online":$online}""")
                    }
                })
            }
        }
    }

    private fun applySlopes() {
        map?.style?.getLayer(LAYER_SLOPES)?.setProperties(visibility(if (slopes) Property.VISIBLE else Property.NONE))
    }

    private fun render() {
        val s = TrackRecorder.state.value
        val style = map?.style ?: return
        if (!style.isFullyLoaded || s.points.size == drawnPoints) return
        drawnPoints = s.points.size
        val pts = s.points.map { Point.fromLngLat(it.lon, it.lat) }
        style.getSourceAs<GeoJsonSource>(SRC_TRACK)?.setGeoJson(LineString.fromLngLats(if (pts.size >= 2) pts else emptyList()))
        val last = pts.lastOrNull()
        if (last != null) {
            style.getSourceAs<GeoJsonSource>(SRC_POS)?.setGeoJson(last)
            if (follow && s.recording && !locating) map?.moveCamera(CameraUpdateFactory.newLatLng(LatLng(last.latitude(), last.longitude())))
        }
    }

    private fun drawImported(fit: Boolean = true) {
        val style = map?.style ?: return
        val pts = imported.map { Point.fromLngLat(it.lon, it.lat) }
        style.getSourceAs<GeoJsonSource>(SRC_IMPORT)?.setGeoJson(LineString.fromLngLats(if (pts.size >= 2) pts else emptyList()))
        if (fit && imported.size >= 2) {
            val b = LatLngBounds.Builder()
            imported.forEach { b.include(LatLng(it.lat, it.lon)) }
            map?.moveCamera(CameraUpdateFactory.newLatLngBounds(b.build(), 80))
        }
    }

    // ---------- Me localiser ----------

    /** 1er appui : centre sur ma position et la suit. Appui suivant : recentre si on a bougé la carte, sinon arrête. */
    private fun onLocateClicked() {
        val lc = map?.locationComponent
        if (locating && lc != null && lc.isLocationComponentActivated && lc.cameraMode == CameraMode.NONE) {
            lc.cameraMode = CameraMode.TRACKING
            lc.zoomWhileTracking(maxOf(15.0, map?.cameraPosition?.zoom ?: 15.0))
            refreshLocateButton(); return
        }
        if (locating) { stopLocate(); return }
        val fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (fine || coarse) startLocate()
        else askLocatePermission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
    }

    @SuppressLint("MissingPermission") // vérifiée dans onLocateClicked
    private fun startLocate() {
        val m = map ?: return
        val style = m.style ?: return
        val lc = m.locationComponent
        if (!lc.isLocationComponentActivated) {
            // Le GPS ne tourne que tant que « me localiser » est actif, et s'arrête quand l'appli passe en arrière-plan.
            val request = LocationEngineRequest.Builder(2_000)
                .setPriority(LocationEngineRequest.PRIORITY_HIGH_ACCURACY)
                .setFastestInterval(1_000)
                .build()
            lc.activateLocationComponent(
                LocationComponentActivationOptions.builder(this, style)
                    .useDefaultLocationEngine(true)
                    .locationEngineRequest(request)
                    .build()
            )
        }
        lc.isLocationComponentEnabled = true
        lc.renderMode = RenderMode.COMPASS
        if (!locating) {
            lc.cameraMode = CameraMode.TRACKING
            lc.zoomWhileTracking(maxOf(15.0, m.cameraPosition.zoom))
        }
        locating = true
        refreshLocateButton()
    }

    @SuppressLint("MissingPermission")
    private fun stopLocate() {
        val lc = map?.locationComponent
        if (lc != null && lc.isLocationComponentActivated) lc.isLocationComponentEnabled = false
        locating = false
        refreshLocateButton()
    }

    private fun refreshLocateButton() {
        val lc = map?.locationComponent
        val tracking = locating && lc != null && lc.isLocationComponentActivated && lc.cameraMode != CameraMode.NONE
        val color = when {
            tracking -> Color.parseColor("#1d6fe0")
            locating -> Color.parseColor("#5F6B66")
            else -> Color.parseColor("#1D2421")
        }
        findViewById<ImageButton>(R.id.btnLocate).imageTintList = ColorStateList.valueOf(color)
    }

    // ---------- Panneau ----------

    private fun showTab(t: Tab) {
        tab = t; sheetOpen = true; refreshTabs()
        when (t) {
            Tab.SORTIE -> refreshSortie()
            Tab.OFFLINE -> refreshOffline()
            Tab.MESURES -> refreshMesures()
        }
    }

    private fun refreshTabs() {
        val accent = ContextCompat.getColor(this, R.color.accent)
        val muted = ContextCompat.getColor(this, R.color.muted)
        mapOf(Tab.SORTIE to R.id.tabSortie, Tab.OFFLINE to R.id.tabOffline, Tab.MESURES to R.id.tabMesures).forEach { (t, id) ->
            findViewById<Button>(id).setTextColor(if (t == tab && sheetOpen) accent else muted)
        }
        findViewById<View>(R.id.content).visibility = if (sheetOpen) View.VISIBLE else View.GONE
        findViewById<View>(R.id.paneSortie).visibility = if (tab == Tab.SORTIE) View.VISIBLE else View.GONE
        findViewById<View>(R.id.paneOffline).visibility = if (tab == Tab.OFFLINE) View.VISIBLE else View.GONE
        findViewById<View>(R.id.paneMesures).visibility = if (tab == Tab.MESURES) View.VISIBLE else View.GONE
        val status = findViewById<TextView>(R.id.status)
        status.visibility = if (sheetOpen && status.text.isNotEmpty()) View.VISIBLE else View.GONE
        // Panneau limité à 45 % de l'écran, comme côté Capacitor.
        val content = findViewById<View>(R.id.content)
        content.post {
            val max = (resources.displayMetrics.heightPixels * 0.45).toInt()
            if (content.height > max) content.updateLayoutParams { height = max }
        }
    }

    private fun setStatus(text: String) {
        val status = findViewById<TextView>(R.id.status)
        status.text = text
        status.visibility = if (sheetOpen && text.isNotEmpty()) View.VISIBLE else View.GONE
    }

    // ---------- Sortie ----------

    private fun recording() = gpsRunning || (replay.running && TrackRecorder.state.value.recording)

    private fun refreshSortie() {
        val rec = recording()
        findViewById<Button>(R.id.btnMode).apply {
            text = "Mode : ${mapOf(GpsMode.RANDO to "Rando (10 m)", GpsMode.VELO to "Vélo (20 m)", GpsMode.ECO to "Économie (50 m)")[mode]}"
            isEnabled = !rec
        }
        findViewById<Button>(R.id.btnSource).apply { text = source.label; isEnabled = !rec }
        findViewById<Button>(R.id.btnStart).apply {
            text = if (rec) "Arrêter" else "Démarrer"
            backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(this@MainActivity, if (rec) R.color.danger else R.color.accent))
            setTextColor(Color.WHITE)
        }
        findViewById<Button>(R.id.btnClearImport).visibility = if (imported.isNotEmpty()) View.VISIBLE else View.GONE
        refreshStats()
    }

    private fun refreshStats() {
        val s = TrackRecorder.state.value
        val durMs = (s.points.lastOrNull()?.timeMs ?: 0) - (s.points.firstOrNull()?.timeMs ?: 0)
        val min = durMs / 60_000
        findViewById<TextView>(R.id.statDist).text = stat(String.format(Locale.FRANCE, "%.2f km", s.distanceM / 1000), "distance")
        findViewById<TextView>(R.id.statGain).text = stat("${s.gainM.toInt()} m", "D+")
        findViewById<TextView>(R.id.statTime).text = stat(String.format(Locale.FRANCE, "%dh%02d", min / 60, min % 60), "durée")
        findViewById<TextView>(R.id.statPoints).text = stat("${s.points.size}", "points")
        findViewById<TextView>(R.id.gpsReasons).apply {
            visibility = if (s.recording && s.stationary) View.VISIBLE else View.GONE
            text = "Économie active : à l'arrêt"
        }
        // Fin d'une simulation : remettre le bouton sur « Démarrer ».
        if (findViewById<Button>(R.id.btnStart).text.toString() != (if (recording()) "Arrêter" else "Démarrer")) refreshSortie()
    }

    private fun stat(value: String, label: String): CharSequence {
        val text = "$value\n$label"
        return android.text.SpannableString(text).apply {
            setSpan(android.text.style.StyleSpan(android.graphics.Typeface.BOLD), 0, value.length, 0)
            setSpan(android.text.style.RelativeSizeSpan(1.35f), 0, value.length, 0)
            setSpan(android.text.style.ForegroundColorSpan(Color.parseColor("#1D2421")), 0, value.length, 0)
        }
    }

    private fun startRecording() {
        setStatus("")
        drawnPoints = -1
        when (source) {
            Source.GPS -> {
                val perms = buildList {
                    add(Manifest.permission.ACCESS_FINE_LOCATION)
                    add(Manifest.permission.ACCESS_COARSE_LOCATION)
                    if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
                }
                askTrackPermissions.launch(perms.toTypedArray())
            }
            Source.SIM10 -> replay.start(lifecycleScope, mode, 10)
            Source.SIM60 -> replay.start(lifecycleScope, mode, 60)
        }
        if (follow) TrackRecorder.state.value.points.firstOrNull()?.let {
            map?.moveCamera(CameraUpdateFactory.newLatLng(LatLng(it.lat, it.lon)))
        }
        refreshSortie()
    }

    private fun stopRecording() {
        if (gpsRunning) {
            stopService(Intent(this, TrackingService::class.java))
            gpsRunning = false
        }
        if (replay.running) replay.stop()
        refreshSortie()
    }

    private fun startGps() {
        ContextCompat.startForegroundService(this,
            Intent(this, TrackingService::class.java).putExtra(TrackingService.EXTRA_MODE, mode.name))
        gpsRunning = true
        refreshSortie()
    }

    private fun setFollow(on: Boolean) {
        follow = on
        findViewById<CheckBox>(R.id.chkFollow).isChecked = on
    }

    private fun exportTo(uri: Uri) {
        val pts = TrackRecorder.state.value.points
        if (pts.isEmpty()) { setStatus("Rien à exporter : aucune sortie enregistrée."); return }
        runCatching {
            contentResolver.openOutputStream(uri)!!.use { it.write(toGpx(pts).toByteArray()) }
        }.onSuccess { setStatus("GPX enregistré (${pts.size} points).") }
            .onFailure { setStatus("Export impossible : ${it.message}") }
    }

    private fun importFrom(uri: Uri) {
        runCatching { contentResolver.openInputStream(uri)!!.use { parseGpx(it) } }
            .onSuccess { t ->
                imported = t.points
                drawImported()
                val (d, gain) = trackStats(t.points)
                setStatus(String.format(Locale.FRANCE, "« %s » : %.2f km, D+ %d m", t.name, d / 1000, gain.toInt()))
                refreshSortie()
            }
            .onFailure { setStatus("Import impossible : ${it.message}") }
    }

    // ---------- Hors ligne ----------

    private fun refreshOffline() {
        findViewById<Button>(R.id.btnNetwork).text = if (online) "Réseau : actif" else "Réseau : coupé"
        offline.summary { s -> runOnUiThread {
            offlineSummary = s
            findViewById<TextView>(R.id.offlineHint).text =
                "Zone La Ciotat, fond affiché (${mapMode.label}) : ${mapMode.offlinePlan()}.\nEn stock : $s."
        } }
    }

    private fun downloadZone() {
        val bar = findViewById<ProgressBar>(R.id.progress)
        val info = findViewById<TextView>(R.id.offlineInfo)
        bar.visibility = View.VISIBLE; bar.progress = 0
        info.text = "Préparation…"
        offline.download(mapMode, apiKey) { p -> runOnUiThread {
            if (p.error != null) { info.text = "Erreur : ${p.error}"; return@runOnUiThread }
            bar.max = p.total.toInt().coerceAtLeast(1)
            bar.progress = p.done.toInt()
            info.text = "${p.done}/${p.total} éléments, ${p.bytes / 100_000 / 10.0} Mo, ${p.seconds} s" + if (p.finished) " : terminé" else ""
            if (p.finished) refreshOffline()
        } }
    }

    private fun testKey() {
        setStatus("Vérification de la clé…")
        val key = apiKey
        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val url = URL("https://data.geopf.fr/private/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetCapabilities&apikey=" +
                        java.net.URLEncoder.encode(key, "UTF-8"))
                    val c = url.openConnection() as HttpURLConnection
                    c.connectTimeout = 15_000; c.readTimeout = 30_000
                    if (c.responseCode != 200) error("GetCapabilities HTTP ${c.responseCode}")
                    c.inputStream.bufferedReader().use { it.readText() }
                }
            }
            result.onSuccess { xml -> setStatus(describeCapabilities(xml)) }
                .onFailure { setStatus("Échec : ${it.message}") }
        }
    }

    /** Même lecture que capabilities.ts côté Capacitor : couche présente et zooms servis en PM. */
    private fun describeCapabilities(xml: String): String {
        val layerName = IgnLayer.SCAN25.wmtsLayer
        val layer = Regex("<Layer>(.*?)</Layer>", RegexOption.DOT_MATCHES_ALL).findAll(xml)
            .map { it.groupValues[1] }
            .firstOrNull { Regex("<ows:Identifier>\\s*${Regex.escape(layerName)}\\s*</ows:Identifier>").containsMatchIn(it) }
            ?: return "La clé répond mais la couche SCAN25TOUR est absente : clé sans droits SCAN ?"
        val pm = Regex("<TileMatrixSetLink>(.*?)</TileMatrixSetLink>", RegexOption.DOT_MATCHES_ALL).findAll(layer)
            .map { it.groupValues[1] }.firstOrNull { Regex("<TileMatrixSet>\\s*PM\\s*</TileMatrixSet>").containsMatchIn(it) }
        val zooms = pm?.let { Regex("<TileMatrix>\\s*(\\d+)\\s*</TileMatrix>").findAll(it).map { m -> m.groupValues[1].toInt() }.toList() }.orEmpty()
        val formats = Regex("<Format>(.*?)</Format>").findAll(layer).map { it.groupValues[1] }.joinToString(", ")
        return if (zooms.isEmpty()) "Clé OK (zooms PM non lus, formats : $formats)."
        else "Clé OK. SCAN 25 servi en PM du zoom ${zooms.min()} au zoom ${zooms.max()} ($formats)."
    }

    // ---------- Mesures ----------

    private fun refreshMesures() {
        val s = TrackRecorder.state.value
        findViewById<TextView>(R.id.metrics).text = buildString {
            append("Plateforme : Android natif (Kotlin)\n")
            append("Première carte affichée : ${startupMs?.let { "$it ms" } ?: "—"}\n")
            append("Zoom : ${map?.cameraPosition?.zoom?.let { String.format(Locale.FRANCE, "%.1f", it) } ?: "—"}\n")
            append("Hors ligne en stock : $offlineSummary\n")
            append("Positions reçues / gardées : ${s.received} / ${s.points.size}\n")
            append("Source : ${s.source.ifEmpty { "—" }}${if (s.stationary) " (à l'arrêt)" else ""}\n")
            append("Bench caméra : $benchInfo")
        }
        offline.summary { r -> runOnUiThread { if (r != offlineSummary) { offlineSummary = r; refreshMesures() } } }
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()

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
        private const val SRC_IMPORT = "import-src"
        private const val SRC_SLOPES = "slopes-src"
        private const val LAYER_SLOPES = "slopes"
    }
}
