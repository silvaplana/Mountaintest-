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
import org.maplibre.android.style.layers.PropertyFactory.lineCap
import org.maplibre.android.style.layers.PropertyFactory.lineColor
import org.maplibre.android.style.layers.PropertyFactory.lineDasharray
import org.maplibre.android.style.layers.PropertyFactory.lineOpacity
import org.maplibre.android.style.layers.PropertyFactory.lineWidth
import org.maplibre.android.style.layers.PropertyFactory.rasterOpacity
import org.maplibre.android.style.layers.PropertyFactory.visibility
import org.maplibre.android.style.layers.RasterLayer
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.android.style.sources.RasterSource
import org.maplibre.android.style.sources.TileSet
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.MultiLineString
import org.maplibre.geojson.Polygon
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
    private enum class Tab { SORTIE, RANDOS, OFFLINE, MESURES, VERSIONS }

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
    private val trailExportLauncher = registerForActivityResult(ActivityResultContracts.CreateDocument("application/gpx+xml")) { uri ->
        uri?.let { exportTrailTo(it) }
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
            // Appui long sur la carte : choisir un lieu où aller.
            m.addOnMapLongClickListener { p -> setTarget(p.latitude, p.longitude, "Point choisi sur la carte"); true }
            // Appui sur une rando affichée : on la choisit (zone de 20 dp autour du doigt).
            m.addOnMapClickListener { p ->
                if (trails.isEmpty()) return@addOnMapClickListener false
                val pt = m.projection.toScreenLocation(p)
                val r = 20 * resources.displayMetrics.density
                val hit = m.queryRenderedFeatures(android.graphics.RectF(pt.x - r, pt.y - r, pt.x + r, pt.y + r), LAYER_TRAILS)
                val id = hit.firstOrNull()?.getNumberProperty("id")?.toLong() ?: return@addOnMapClickListener false
                trails.firstOrNull { it.id == id }?.let { selectTrail(it) }
                true
            }
            loadStyle()
        }
        findViewById<Button>(R.id.btnGo).setOnClickListener { target?.let { openDirections(it.first, it.second) } }
        findViewById<Button>(R.id.btnTargetClear).setOnClickListener { setTarget(null, null, "") }

        // Fond de carte et pentes
        val btnLayer = findViewById<Button>(R.id.btnLayer)
        btnLayer.text = "${mapMode.label} ▾"
        btnLayer.setOnClickListener {
            mapMode = mapMode.next()
            prefs.edit().putString("mapMode", mapMode.name).apply()
            btnLayer.text = "${mapMode.label} ▾"
            loadStyle(); refreshOffline()
        }
        setupSearch()
        findViewById<CheckBox>(R.id.chkSlopes).setOnCheckedChangeListener { _, checked -> slopes = checked; applySlopes() }

        // Boutons carte
        findViewById<Button>(R.id.btnZoomIn).setOnClickListener { map?.animateCamera(CameraUpdateFactory.zoomIn()) }
        findViewById<Button>(R.id.btnZoomOut).setOnClickListener { map?.animateCamera(CameraUpdateFactory.zoomOut()) }
        findViewById<ImageButton>(R.id.btnLocate).setOnClickListener { onLocateClicked() }

        // Panneau
        findViewById<View>(R.id.handle).setOnClickListener { sheetOpen = !sheetOpen; refreshTabs() }
        findViewById<Button>(R.id.tabSortie).setOnClickListener { showTab(Tab.SORTIE) }
        findViewById<Button>(R.id.tabRandos).setOnClickListener { showTab(Tab.RANDOS) }
        findViewById<Button>(R.id.tabOffline).setOnClickListener { showTab(Tab.OFFLINE) }
        findViewById<Button>(R.id.tabMesures).setOnClickListener { showTab(Tab.MESURES) }
        findViewById<Button>(R.id.tabVersions).setOnClickListener { showTab(Tab.VERSIONS) }
        findViewById<Button>(R.id.btnNature).setOnClickListener { setNature(true) }
        findViewById<Button>(R.id.btnRestore).setOnClickListener { setNature(false) }

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
        mapOf(R.id.btnAvion to "avion", R.id.btnWifi to "wifi", R.id.btnDonnees to "donnees", R.id.btnBluetooth to "bluetooth")
            .forEach { (id, what) -> findViewById<Button>(id).setOnClickListener { BatterySettings.open(this, what) } }
        findViewById<CheckBox>(R.id.chkPoche).apply {
            isChecked = PocketMode.isEnabled(this@MainActivity)
            setOnCheckedChangeListener { _, on -> PocketMode.setEnabled(this@MainActivity, on) }
        }
        findViewById<Button>(R.id.btnClearImport).setOnClickListener { imported = emptyList(); drawImported(); refreshSortie() }

        setupTrails()

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
        findViewById<Button>(R.id.btnDownload).setOnClickListener { framingForOffline = true; setFraming(true) }
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
        setupCoords()
        // Propose les nouvelles versions publiées par GitHub Actions (et notifie en arrière-plan).
        Updater.init(this, "kotlin")
        // Mode poche : écran noir dans la poche, rallumage à plat ou par deux secousses.
        PocketMode.init(this)

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                TrackRecorder.state.collect { render(); refreshStats() }
            }
        }
    }

    /** Android 15 dessine sous les barres système : on décale le haut et le bas de l'interface. */
    private fun applyInsets() {
        val top = listOf(findViewById<View>(R.id.topBar), findViewById<View>(R.id.mapButtons), findViewById<View>(R.id.searchPanel),
            findViewById<View>(R.id.frameBanner))
        val sheet = findViewById<View>(R.id.sheet)
        val margin = (10 * resources.displayMetrics.density).toInt()
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.root)) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            top.forEach { v -> v.updateLayoutParams<android.widget.FrameLayout.LayoutParams> { topMargin = bars.top + margin } }
            barsTop = bars.top
            placeTopCards()
            sheet.updatePadding(bottom = bars.bottom + margin)
            findViewById<View>(R.id.btnRestore).updateLayoutParams<android.widget.FrameLayout.LayoutParams> { bottomMargin = bars.bottom + 3 * margin }
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
            style.addSource(GeoJsonSource(SRC_FRAME))
            style.addSource(GeoJsonSource(SRC_TRAILS))
            style.addSource(GeoJsonSource(SRC_TRAIL_SEL))
            style.addLayer(LineLayer("frame", SRC_FRAME).withProperties(lineColor("#1d2421"), lineWidth(2f), lineDasharray(arrayOf(3f, 2f))))
            style.addLayer(LineLayer(LAYER_TRAILS, SRC_TRAILS).withProperties(
                lineColor(Expression.get("color")), lineWidth(3f), lineOpacity(0.75f), lineCap(Property.LINE_CAP_ROUND)))
            style.addLayer(LineLayer("trail-sel-casing", SRC_TRAIL_SEL).withProperties(lineColor("#ffffff"), lineWidth(8f), lineCap(Property.LINE_CAP_ROUND)))
            style.addLayer(LineLayer("trail-sel", SRC_TRAIL_SEL).withProperties(lineColor("#7b3fe4"), lineWidth(5f), lineCap(Property.LINE_CAP_ROUND)))
            style.addSource(GeoJsonSource(SRC_IMPORT))
            style.addSource(GeoJsonSource(SRC_TRACK))
            style.addSource(GeoJsonSource(SRC_POS))
            style.addSource(GeoJsonSource(SRC_TARGET))
            style.addLayer(LineLayer("import", SRC_IMPORT).withProperties(lineColor("#7b3fe4"), lineWidth(4f), lineOpacity(0.8f)))
            style.addLayer(LineLayer("track", SRC_TRACK).withProperties(lineColor("#e4572e"), lineWidth(4f)))
            style.addLayer(CircleLayer("pos", SRC_POS).withProperties(
                circleRadius(7f), circleColor("#1d6fe0"), circleStrokeColor("#ffffff"), circleStrokeWidth(3f)))
            style.addLayer(CircleLayer("target", SRC_TARGET).withProperties(
                circleRadius(9f), circleColor("#c0392b"), circleStrokeColor("#ffffff"), circleStrokeWidth(3f)))
            applySlopes()
            drawImported(fit = false)
            drawTrails(fit = false)
            drawTarget()
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

    // ---------- Recherche de lieux ----------

    private val searchHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private var searchSeq = 0

    private fun setupSearch() {
        val panel = findViewById<View>(R.id.searchPanel)
        val topBar = findViewById<View>(R.id.topBar)
        val text = findViewById<EditText>(R.id.searchText)
        val imm = getSystemService(android.view.inputmethod.InputMethodManager::class.java)
        fun close() {
            imm.hideSoftInputFromWindow(text.windowToken, 0)
            panel.visibility = View.GONE; topBar.visibility = View.VISIBLE
            text.setText(""); findViewById<android.widget.LinearLayout>(R.id.searchResults).removeAllViews()
        }
        findViewById<ImageButton>(R.id.btnSearch).setOnClickListener {
            topBar.visibility = View.GONE; panel.visibility = View.VISIBLE
            text.requestFocus(); imm.showSoftInput(text, 0)
        }
        findViewById<Button>(R.id.btnSearchClose).setOnClickListener { close() }
        text.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable?) {
                searchHandler.removeCallbacksAndMessages(null)
                val q = s.toString().trim()
                val seq = ++searchSeq
                if (q.length < 2) { showResults(emptyList(), null, ::close); return }
                searchHandler.postDelayed({
                    lifecycleScope.launch {
                        val r = withContext(Dispatchers.IO) { runCatching { Search.search(q) } }
                        if (seq != searchSeq) return@launch
                        r.onSuccess { showResults(it, if (it.isEmpty()) "Aucun résultat" else null, ::close) }
                            .onFailure { showResults(emptyList(), "Recherche impossible (pas de réseau ?)", ::close) }
                    }
                }, 300)
            }
        })
        text.setOnEditorActionListener { _, _, _ ->
            findViewById<android.widget.LinearLayout>(R.id.searchResults).getChildAt(0)?.performClick(); true
        }
    }

    private fun showResults(places: List<Place>, message: String?, close: () -> Unit) {
        val list = findViewById<android.widget.LinearLayout>(R.id.searchResults)
        list.removeAllViews()
        val pad = (12 * resources.displayMetrics.density).toInt()
        places.forEach { p ->
            list.addView(TextView(this).apply {
                text = stat(p.label, p.detail)
                textSize = 14f
                setPadding(pad, pad, pad, pad)
                isClickable = true
                setBackgroundResource(android.R.drawable.list_selector_background)
                setOnClickListener {
                    close()
                    if (follow) setFollow(false)
                    if (locating) map?.locationComponent?.cameraMode = CameraMode.NONE
                    map?.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(p.lat, p.lon), p.zoom), 1500)
                    setTarget(p.lat, p.lon, p.label)
                    refreshLocateButton()
                }
            })
        }
        if (message != null) list.addView(TextView(this).apply {
            text = message; textSize = 13f; setPadding(pad, pad, pad, pad)
            setTextColor(ContextCompat.getColor(this@MainActivity, R.color.muted))
        })
        val maxH = (resources.displayMetrics.heightPixels * 0.5).toInt()
        val scroll = findViewById<View>(R.id.searchScroll)
        scroll.post { scroll.updateLayoutParams { height = if (list.height > maxH) maxH else android.view.ViewGroup.LayoutParams.WRAP_CONTENT } }
    }

    // ---------- Ma position en coordonnées ----------

    private var barsTop = 0
    private var coordsShown = true
    private var coordsCopy = ""
    private val coordsHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private val coordsTick = object : Runnable {
        override fun run() { refreshCoords(); coordsHandler.postDelayed(this, 2_000) }
    }

    /** Encadré des coordonnées sous la barre du haut ; le bandeau « Y aller » se place en dessous. */
    private fun placeTopCards() {
        val d = resources.displayMetrics.density
        val coords = findViewById<View>(R.id.coordsBar)
        coords.updateLayoutParams<android.widget.FrameLayout.LayoutParams> {
            topMargin = barsTop + ((if (nature) 10 else 66) * d).toInt()
            marginEnd = ((if (nature) 10 else 68) * d).toInt()
        }
        findViewById<View>(R.id.targetBar).updateLayoutParams<android.widget.FrameLayout.LayoutParams> {
            topMargin = barsTop + ((if (coords.visibility == View.VISIBLE) 122 else 66) * d).toInt()
        }
    }

    private fun setupCoords() {
        findViewById<TextView>(R.id.coordsText).setOnClickListener {
            if (coordsCopy.isEmpty()) return@setOnClickListener
            getSystemService(android.content.ClipboardManager::class.java)
                .setPrimaryClip(android.content.ClipData.newPlainText("Ma position", coordsCopy))
            toast("Coordonnées copiées : $coordsCopy")
        }
        findViewById<Button>(R.id.btnCoordsClose).setOnClickListener { coordsShown = false; refreshCoords() }
    }

    /** Position du bouton « me localiser », sinon dernier point de l'enregistrement en cours. */
    @SuppressLint("MissingPermission")
    private fun refreshCoords() {
        val bar = findViewById<View>(R.id.coordsBar)
        val lc = map?.locationComponent
        val loc = if (locating && lc != null && lc.isLocationComponentActivated) lc.lastKnownLocation else null
        val fix: Fix? = loc?.let { Fix(it.latitude, it.longitude, if (it.hasAltitude()) it.altitude else null, it.accuracy, it.time) }
            ?: TrackRecorder.state.value.let { st -> if (st.recording) st.points.lastOrNull() else null }
        val visible = fix != null && coordsShown && findViewById<View>(R.id.searchPanel).visibility != View.VISIBLE &&
            findViewById<View>(R.id.frameBanner).visibility != View.VISIBLE
        if (fix != null) {
            fun deg(v: Double, pos: String, neg: String) = String.format(Locale.FRANCE, "%.5f° %s", Math.abs(v), if (v >= 0) pos else neg)
            val extra = listOfNotNull(fix.ele?.let { "alt. ${it.toInt()} m" }, "± ${fix.accuracyM.toInt()} m").joinToString(" · ")
            coordsCopy = String.format(Locale.US, "%.6f, %.6f", fix.lat, fix.lon)
            findViewById<TextView>(R.id.coordsText).text = stat("📍 ${deg(fix.lat, "N", "S")}, ${deg(fix.lon, "E", "O")}", "$extra · appuie pour copier")
        }
        val now = if (visible) View.VISIBLE else View.GONE
        if (bar.visibility != now) { bar.visibility = now; placeTopCards() }
    }

    // ---------- Lieu choisi : Y aller ----------

    private var target: Pair<Double, Double>? = null
    private var targetLabel = ""

    private fun setTarget(lat: Double?, lon: Double?, label: String) {
        target = if (lat != null && lon != null) lat to lon else null
        targetLabel = label
        findViewById<View>(R.id.targetBar).visibility = if (target != null) View.VISIBLE else View.GONE
        findViewById<TextView>(R.id.targetLabel).text = "📍 $label"
        drawTarget()
    }

    private fun drawTarget() {
        val src = map?.style?.getSourceAs<GeoJsonSource>(SRC_TARGET) ?: return
        val t = target
        if (t == null) src.setGeoJson(org.maplibre.geojson.FeatureCollection.fromFeatures(emptyList()))
        else src.setGeoJson(Point.fromLngLat(t.second, t.first))
    }

    /** Ouvre Google Maps (appli si installée) en itinéraire voiture vers le point. */
    private fun openDirections(lat: Double, lon: Double) {
        val url = String.format(Locale.US, "https://www.google.com/maps/dir/?api=1&destination=%.6f,%.6f&travelmode=driving", lat, lon)
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
            .onFailure { toast("Impossible d'ouvrir Google Maps") }
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
        coordsShown = true
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
            Tab.RANDOS -> refreshTrails()
            Tab.OFFLINE -> refreshOffline()
            Tab.MESURES -> refreshMesures()
            Tab.VERSIONS -> showVersions()
        }
    }

    private fun refreshTabs() {
        val accent = ContextCompat.getColor(this, R.color.accent)
        val muted = ContextCompat.getColor(this, R.color.muted)
        mapOf(Tab.SORTIE to R.id.tabSortie, Tab.RANDOS to R.id.tabRandos, Tab.OFFLINE to R.id.tabOffline, Tab.MESURES to R.id.tabMesures,
            Tab.VERSIONS to R.id.tabVersions).forEach { (t, id) ->
            findViewById<Button>(id).setTextColor(if (t == tab && sheetOpen) accent else muted)
        }
        findViewById<View>(R.id.content).visibility = if (sheetOpen) View.VISIBLE else View.GONE
        findViewById<View>(R.id.paneSortie).visibility = if (tab == Tab.SORTIE) View.VISIBLE else View.GONE
        findViewById<View>(R.id.paneRandos).visibility = if (tab == Tab.RANDOS) View.VISIBLE else View.GONE
        findViewById<View>(R.id.paneOffline).visibility = if (tab == Tab.OFFLINE) View.VISIBLE else View.GONE
        findViewById<View>(R.id.paneMesures).visibility = if (tab == Tab.MESURES) View.VISIBLE else View.GONE
        findViewById<View>(R.id.paneVersions).visibility = if (tab == Tab.VERSIONS) View.VISIBLE else View.GONE
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

    // ---------- Mode nature ----------

    private var nature = false
    private val hiddenInNature = mutableMapOf<Int, Int>()

    /** Carte seule : toute l'interface est masquée, un petit bouton ☰ la fait revenir. */
    private fun setNature(on: Boolean) {
        if (on == nature) return
        nature = on
        val ids = listOf(R.id.topBar, R.id.searchPanel, R.id.targetBar, R.id.mapButtons, R.id.sheet)
        if (on) ids.forEach { id ->
            val v = findViewById<View>(id)
            hiddenInNature[id] = v.visibility
            v.visibility = View.GONE
        } else ids.forEach { id -> findViewById<View>(id).visibility = hiddenInNature[id] ?: View.VISIBLE }
        findViewById<View>(R.id.btnRestore).visibility = if (on) View.VISIBLE else View.GONE
        map?.uiSettings?.isCompassEnabled = !on
        placeTopCards()
    }

    // ---------- Versions ----------

    /** Historique généré par la CI (shared/changelog.py), le plus récent en haut. */
    private fun showVersions() {
        val pane = findViewById<android.widget.LinearLayout>(R.id.paneVersions)
        if (pane.childCount > 0) return
        val json = runCatching { assets.open("changelog.json").bufferedReader().use { it.readText() } }.getOrNull()
        fun hint(t: CharSequence) = TextView(this).apply {
            text = t; textSize = 13f; setTextColor(ContextCompat.getColor(this@MainActivity, R.color.muted))
        }
        if (json == null) { pane.addView(hint("Historique absent de cette version (il est ajouté par la compilation GitHub).")); return }
        val log = org.json.JSONObject(json)
        pane.addView(hint("Version installée : ${log.optInt("build")}. Les changements les plus récents sont en haut."))
        val entries = log.getJSONArray("entries")
        val pad = (8 * resources.displayMetrics.density).toInt()
        for (i in 0 until entries.length()) {
            val e = entries.getJSONObject(i)
            pane.addView(TextView(this).apply {
                text = e.getString("title"); textSize = 15f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                setTextColor(Color.parseColor("#1D2421"))
                setPadding(0, pad, 0, 0)
            })
            val (d, t) = e.getString("date").split(" ").let { it[0] to it.getOrElse(1) { "" } }
            val (y, m, day) = d.split("-")
            pane.addView(hint("$day/$m/$y à ${t.replace(":", "h")}"))
            val details = e.getJSONArray("details")
            for (j in 0 until details.length()) pane.addView(TextView(this).apply {
                text = "• ${details.getString(j)}"; textSize = 14f
                setTextColor(Color.parseColor("#1D2421"))
            })
            pane.addView(View(this).apply {
                setBackgroundColor(ContextCompat.getColor(this@MainActivity, R.color.line))
                layoutParams = android.widget.LinearLayout.LayoutParams(android.widget.LinearLayout.LayoutParams.MATCH_PARENT, 1).apply { topMargin = pad }
            })
        }
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
                t.points.firstOrNull()?.let { setTarget(it.lat, it.lon, "Départ de « ${t.name} »") }
                val (d, gain) = trackStats(t.points)
                setStatus(String.format(Locale.FRANCE, "« %s » : %.2f km, D+ %d m", t.name, d / 1000, gain.toInt()))
                refreshSortie()
            }
            .onFailure { setStatus("Import impossible : ${it.message}") }
    }

    // ---------- Randos libres (OpenStreetMap) d'une zone encadrée ----------

    private var trails: List<Trail> = emptyList()
    private var frame: Zone? = null
    private var selectedTrail: Trail? = null
    /** null : pas encore calculé ; échec : service d'altitude injoignable. */
    private var elevated: Result<ElevatedTrail>? = null
    private var trailsMessage = ""
    private var trailsJob: kotlinx.coroutines.Job? = null
    private var elevJob: kotlinx.coroutines.Job? = null

    private fun setupTrails() {
        findViewById<TextView>(R.id.trailsAttribution).text =
            "Randos balisées libres de droits (GR, PR, boucles locales) trouvées dans OpenStreetMap. ${Trails.OSM_ATTRIBUTION}."
        val draw = findViewById<FrameDrawView>(R.id.frameDraw)
        draw.onFrame = { a, b ->
            val proj = map?.projection
            if (proj != null) {
                val p = proj.fromScreenLocation(a); val q = proj.fromScreenLocation(b)
                if (framingForOffline) {
                    // Même outil rectangle que pour les randos : ici, on télécharge ses tuiles.
                    setFraming(false); framingForOffline = false
                    showTab(Tab.OFFLINE)
                    downloadZone(LatLngBounds.from(maxOf(p.latitude, q.latitude), maxOf(p.longitude, q.longitude),
                        minOf(p.latitude, q.latitude), minOf(p.longitude, q.longitude)))
                } else searchTrails(Zone(minOf(p.longitude, q.longitude), minOf(p.latitude, q.latitude),
                    maxOf(p.longitude, q.longitude), maxOf(p.latitude, q.latitude)))
            }
        }
        findViewById<Button>(R.id.btnFrame).setOnClickListener { framingForOffline = false; setFraming(true) }
        findViewById<Button>(R.id.btnFrameCancel).setOnClickListener { setFraming(false); framingForOffline = false; sheetOpen = true; refreshTabs() }
        findViewById<Button>(R.id.btnTrailsView).setOnClickListener {
            map?.projection?.visibleRegion?.latLngBounds?.let {
                searchTrails(Zone(it.longitudeWest, it.latitudeSouth, it.longitudeEast, it.latitudeNorth))
            }
        }
        findViewById<Button>(R.id.btnTrailExport).setOnClickListener {
            selectedTrail?.let { t -> trailExportLauncher.launch("${t.name.replace(Regex("[^\\p{L}\\p{N}-]+"), "_")}.gpx") }
        }
        findViewById<Button>(R.id.btnTrailClose).setOnClickListener { selectTrail(null) }
        findViewById<Button>(R.id.btnTrailsClear).setOnClickListener {
            trailsJob?.cancel()
            trails = emptyList(); frame = null; trailsMessage = ""
            selectTrail(null); drawTrails(fit = false)
        }
        refreshTrails()
    }

    /** Le rectangle tracé sert au hors ligne (true) ou aux randos OSM (false). */
    private var framingForOffline = false

    private fun setFraming(on: Boolean) {
        val draw = findViewById<FrameDrawView>(R.id.frameDraw)
        draw.reset()
        draw.visibility = if (on) View.VISIBLE else View.GONE
        findViewById<View>(R.id.frameBanner).visibility = if (on) View.VISIBLE else View.GONE
        findViewById<View>(R.id.topBar).visibility = if (on) View.GONE else View.VISIBLE
        findViewById<View>(R.id.targetBar).visibility = if (!on && target != null) View.VISIBLE else View.GONE
        if (on) { sheetOpen = false; refreshTabs() }
        refreshCoords()
    }

    private fun searchTrails(z: Zone) {
        setFraming(false)
        tab = Tab.RANDOS; sheetOpen = true; refreshTabs()
        if (Trails.zoneTooBig(z)) {
            trailsMessage = "Zone trop grande : encadre au plus ${(Trails.MAX_ZONE_DEG * 100).toInt()} km de côté environ."
            refreshTrails(); return
        }
        frame = z
        trails = emptyList(); selectedTrail = null; elevated = null; elevJob?.cancel()
        trailsMessage = "Recherche des randos dans OpenStreetMap…"
        drawTrails(fit = false); refreshTrails()
        trailsJob?.cancel()
        trailsJob = lifecycleScope.launch {
            val t0 = SystemClock.elapsedRealtime()
            val r = withContext(Dispatchers.IO) { runCatching { Trails.fetchTrails(z) } }
            r.onSuccess { found ->
                Log.i(Scenario.BENCH_TAG, "{\"event\":\"trails-search\",\"found\":${found.size},\"ms\":${SystemClock.elapsedRealtime() - t0}}")
                trails = found
                val n = found.size; val s = if (n > 1) "s" else ""
                trailsMessage = if (n > 0) "$n rando$s balisée$s trouvée$s. Touche-en une (liste ou carte)."
                    else "Aucune rando balisée dans OpenStreetMap sur cette zone."
            }.onFailure { e ->
                if (e is kotlinx.coroutines.CancellationException) return@launch
                trailsMessage = "Recherche impossible (pas de réseau ? serveur saturé ?) : ${e.message}"
            }
            drawTrails(fit = false); refreshTrails()
        }
    }

    private fun selectTrail(t: Trail?) {
        selectedTrail = t
        elevated = null
        elevJob?.cancel()
        if (t != null) { tab = Tab.RANDOS; sheetOpen = true; refreshTabs() }
        drawTrails(fit = t != null)
        refreshTrails()
        if (t == null) return
        if (follow) setFollow(false)
        if (locating) map?.locationComponent?.cameraMode = CameraMode.NONE
        val first = t.segments.first().first()
        setTarget(first.lat, first.lon, "Départ de « ${t.name} »")
        elevJob = lifecycleScope.launch {
            val r = withContext(Dispatchers.IO) { runCatching { Trails.elevate(t) } }
            if (r.exceptionOrNull() is kotlinx.coroutines.CancellationException || selectedTrail?.id != t.id) return@launch
            elevated = r
            refreshTrails()
        }
    }

    private fun trailFeature(t: Trail) = Feature.fromGeometry(
        MultiLineString.fromLngLats(t.segments.map { seg -> seg.map { Point.fromLngLat(it.lon, it.lat) } })
    ).apply { addNumberProperty("id", t.id); addStringProperty("color", t.color) }

    private fun drawTrails(fit: Boolean) {
        val style = map?.style ?: return
        if (!style.isFullyLoaded) return
        style.getSourceAs<GeoJsonSource>(SRC_TRAILS)?.setGeoJson(FeatureCollection.fromFeatures(trails.map { trailFeature(it) }))
        val sel = selectedTrail
        style.getSourceAs<GeoJsonSource>(SRC_TRAIL_SEL)?.setGeoJson(
            FeatureCollection.fromFeatures(if (sel != null) listOf(trailFeature(sel)) else emptyList()))
        val z = frame
        style.getSourceAs<GeoJsonSource>(SRC_FRAME)?.setGeoJson(
            if (z == null) FeatureCollection.fromFeatures(emptyList<Feature>())
            else FeatureCollection.fromFeature(Feature.fromGeometry(Polygon.fromLngLats(listOf(listOf(
                Point.fromLngLat(z.west, z.south), Point.fromLngLat(z.east, z.south), Point.fromLngLat(z.east, z.north),
                Point.fromLngLat(z.west, z.north), Point.fromLngLat(z.west, z.south)))))))
        if (fit && sel != null) {
            val b = LatLngBounds.Builder()
            sel.segments.forEach { seg -> seg.forEach { b.include(LatLng(it.lat, it.lon)) } }
            // Haut : barres « fond de carte » et « Y aller » ; bas : le panneau ouvert.
            val d = resources.displayMetrics.density
            val sheet = findViewById<View>(R.id.sheet)
            sheet.post {
                val h = mapView.height
                val bottom = (sheet.height + 20 * d).toInt().coerceAtMost(h - (200 * d).toInt()).coerceAtLeast((20 * d).toInt())
                runCatching {
                    map?.animateCamera(CameraUpdateFactory.newLatLngBounds(b.build(),
                        (30 * d).toInt(), (140 * d).toInt(), (70 * d).toInt(), bottom), 800)
                }
            }
        }
    }

    private fun refreshTrails() {
        findViewById<TextView>(R.id.trailsInfo).apply {
            text = trailsMessage; visibility = if (trailsMessage.isEmpty()) View.GONE else View.VISIBLE
        }
        val sel = selectedTrail
        findViewById<View>(R.id.trailCard).visibility = if (sel != null) View.VISIBLE else View.GONE
        if (sel != null) {
            findViewById<TextView>(R.id.trailName).text = sel.name
            findViewById<TextView>(R.id.trailKind).text = sel.kind +
                (if (sel.segments.size > 1) " · ${sel.segments.size} morceaux" else "") + " · openstreetmap.org/relation/${sel.id}"
            val e = elevated?.getOrNull()
            val wait = if (elevated == null) "…" else "—"
            findViewById<TextView>(R.id.trailDist).text = stat(String.format(Locale.FRANCE, "%.2f km", sel.distanceM / 1000), "distance")
            findViewById<TextView>(R.id.trailGain).text = stat(e?.let { "${it.gainM.toInt()} m" } ?: wait, "D+")
            findViewById<TextView>(R.id.trailLoss).text = stat(e?.let { "${it.lossM.toInt()} m" } ?: wait, "D−")
            findViewById<View>(R.id.trailAltError).visibility = if (elevated?.isFailure == true) View.VISIBLE else View.GONE
            findViewById<Button>(R.id.btnTrailExport).isEnabled = elevated != null
        }
        val list = findViewById<android.widget.LinearLayout>(R.id.trailList)
        list.removeAllViews()
        val d = resources.displayMetrics.density
        trails.forEach { t ->
            list.addView(android.widget.LinearLayout(this).apply {
                orientation = android.widget.LinearLayout.HORIZONTAL
                setPadding((4 * d).toInt(), (8 * d).toInt(), (4 * d).toInt(), (8 * d).toInt())
                isClickable = true
                if (t.id == sel?.id) setBackgroundColor(Color.parseColor("#1A7B3FE4"))
                else setBackgroundResource(android.R.drawable.list_selector_background)
                addView(View(this@MainActivity).apply { setBackgroundColor(Color.parseColor(t.color)) },
                    android.widget.LinearLayout.LayoutParams((6 * d).toInt(), android.view.ViewGroup.LayoutParams.MATCH_PARENT)
                        .apply { marginEnd = (10 * d).toInt() })
                addView(TextView(this@MainActivity).apply {
                    val sub = String.format(Locale.FRANCE, "%s · %.2f km", t.kind, t.distanceM / 1000)
                    text = android.text.SpannableString("${t.name}\n$sub").apply {
                        setSpan(android.text.style.StyleSpan(android.graphics.Typeface.BOLD), 0, t.name.length, 0)
                        setSpan(android.text.style.ForegroundColorSpan(Color.parseColor("#1D2421")), 0, t.name.length, 0)
                        setSpan(android.text.style.RelativeSizeSpan(0.85f), t.name.length + 1, t.name.length + 1 + sub.length, 0)
                    }
                    textSize = 15f
                    setTextColor(ContextCompat.getColor(this@MainActivity, R.color.muted))
                })
                setOnClickListener { selectTrail(t) }
            })
            list.addView(View(this).apply { setBackgroundColor(ContextCompat.getColor(this@MainActivity, R.color.line)) },
                android.widget.LinearLayout.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, 1))
        }
        findViewById<View>(R.id.btnTrailsClear).visibility = if (trails.isNotEmpty()) View.VISIBLE else View.GONE
    }

    private fun exportTrailTo(uri: Uri) {
        val t = selectedTrail ?: return
        val segs = elevated?.getOrNull()?.segments ?: t.segments.map { seg -> seg.map { it to null } }
        runCatching { contentResolver.openOutputStream(uri)!!.use { it.write(Trails.toGpx(t, segs).toByteArray()) } }
            .onSuccess { setStatus("GPX enregistré : « ${t.name} ».") }
            .onFailure { setStatus("Export impossible : ${it.message}") }
    }

    // ---------- Hors ligne ----------

    private fun refreshOffline() {
        findViewById<Button>(R.id.btnNetwork).text = if (online) "Réseau : actif" else "Réseau : coupé"
        offline.summary { s -> runOnUiThread {
            offlineSummary = s
            findViewById<TextView>(R.id.offlineHint).text =
                "« Tracer un rectangle » : trace du doigt le coin de la rando sur la carte, ses tuiles se téléchargent. Fond affiché (${mapMode.label}) : ${mapMode.offlinePlan()}.\nEn stock : $s.\n" +
                "Place prise sur le téléphone : ${mo(offline.databaseBytes())} (tuiles téléchargées + tuiles vues). " +
                "Les tuiles sont gardées quand l'appli se met à jour ; seule la désinstallation les efface."
        } }
    }

    /** Télécharge le rectangle tracé sur la carte, pour le fond affiché. */
    private fun downloadZone(bounds: LatLngBounds) {
        val n = OfflineDownloader.tileCount(mapMode, bounds)
        if (n > OfflineDownloader.MAX_ZONE_TILES) {
            setStatus("Zone trop grande ($n tuiles, maximum ${OfflineDownloader.MAX_ZONE_TILES}) : trace un rectangle plus petit.")
            return
        }
        setStatus("Rectangle : $n tuiles, environ ${mo(n * TILE_BYTES_ESTIMATE)}.")
        val bar = findViewById<ProgressBar>(R.id.progress)
        val info = findViewById<TextView>(R.id.offlineInfo)
        bar.visibility = View.VISIBLE; bar.progress = 0
        info.text = "Préparation…"
        offline.download(mapMode, apiKey, bounds) { p -> runOnUiThread {
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
            append("Place sur le téléphone : ${mo(offline.databaseBytes())}\n")
            append("Positions reçues / gardées : ${s.received} / ${s.points.size}\n")
            append("Source : ${s.source.ifEmpty { "—" }}${if (s.stationary) " (à l'arrêt)" else ""}\n")
            append("Bench caméra : $benchInfo")
        }
        offline.summary { r -> runOnUiThread { if (r != offlineSummary) { offlineSummary = r; refreshMesures() } } }
    }

    private fun mo(bytes: Long) = String.format(Locale.FRANCE, "%.1f Mo", bytes / 1e6)

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()

    override fun onStart() { super.onStart(); mapView.onStart() }
    override fun onResume() { super.onResume(); mapView.onResume(); coordsHandler.post(coordsTick) }
    override fun onPause() { coordsHandler.removeCallbacks(coordsTick); mapView.onPause(); super.onPause() }
    override fun onStop() { mapView.onStop(); super.onStop() }
    override fun onLowMemory() { super.onLowMemory(); mapView.onLowMemory() }
    override fun onDestroy() { mapView.onDestroy(); super.onDestroy() }
    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); mapView.onSaveInstanceState(outState) }

    companion object {
        private const val SRC_TRACK = "track-src"
        /** Taille moyenne d'une tuile IGN 256 px, pour l'estimation avant téléchargement (même valeur côté Capacitor). */
        private const val TILE_BYTES_ESTIMATE = 25_000L
        private const val SRC_POS = "pos-src"
        private const val SRC_IMPORT = "import-src"
        private const val SRC_TARGET = "target-src"
        private const val SRC_SLOPES = "slopes-src"
        private const val SRC_TRAILS = "trails-src"
        private const val SRC_TRAIL_SEL = "trail-sel-src"
        private const val SRC_FRAME = "frame-src"
        private const val LAYER_TRAILS = "trails"
        private const val LAYER_SLOPES = "slopes"
    }
}
