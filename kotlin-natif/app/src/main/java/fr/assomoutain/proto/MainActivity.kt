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
import org.maplibre.android.style.layers.FillLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory.circleColor
import org.maplibre.android.style.layers.PropertyFactory.circleRadius
import org.maplibre.android.style.layers.PropertyFactory.circleStrokeColor
import org.maplibre.android.style.layers.PropertyFactory.circleStrokeWidth
import org.maplibre.android.style.layers.PropertyFactory.fillColor
import org.maplibre.android.style.layers.PropertyFactory.fillOpacity
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
import org.maplibre.geojson.MultiPolygon
import org.maplibre.geojson.Polygon
import org.maplibre.geojson.Point
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

/**
 * Même écran que le prototype Capacitor : carte plein écran, fond de carte (Auto / SCAN 25 / Plan IGN)
 * et pentes en haut à gauche, zoom et « me localiser » à droite, panneau à trois onglets en bas.
 */
class MainActivity : AppCompatActivity() {

    private enum class Source(val label: String) { GPS("GPS réel"), SIM10("Simulation ×10"), SIM60("Simulation ×60") }
    private enum class Tab { SORTIE, RANDOS, FORETS, OFFLINE, MESURES, VERSIONS }

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
    private var sheetOpen = false // l'appli démarre menu fermé
    private var tab = Tab.SORTIE
    private var startupMs: Long? = null
    private var drawnPoints = -1
    private var imported: List<Fix> = emptyList()
    private var benchInfo = "—"
    private var offlineSummary = "—"
    private val replay by lazy { GpxReplay(this) }
    private val offline by lazy { OfflineDownloader(this) }
    /** Film des ombres du relief (8 h → midi). */
    private val shade by lazy { ShadeFilm(this, { map }, LAYER_FORESTS) }
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
    /** Appareil photo du téléphone par-dessus l'appli, puis retour direct sur la carte. */
    private val photoLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val saved = PhotoCapture.finish(this, r.resultCode == RESULT_OK)
        toast(if (saved) "Photo enregistrée dans la galerie (album Assomoutain)" else "Photo annulée")
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
            // Carte toujours nord en haut : pas de rotation, donc pas de boussole (demande de Seb).
            m.uiSettings.isRotateGesturesEnabled = false
            m.uiSettings.isCompassEnabled = false
            findViewById<View>(R.id.quickButtons).let { qb ->
                m.uiSettings.setCompassMargins(0, qb.bottom + (8 * resources.displayMetrics.density).toInt(),
                    (10 * resources.displayMetrics.density).toInt(), 0)
            }
            // Rouvre la carte là où on l'avait laissée (sinon La Ciotat, valeur du layout).
            if (prefs.contains("vueLat")) m.moveCamera(CameraUpdateFactory.newLatLngZoom(
                LatLng(prefs.getFloat("vueLat", 43.172f).toDouble(), prefs.getFloat("vueLon", 5.6f).toDouble()),
                prefs.getFloat("vueZoom", 14f).toDouble()))
            m.addOnCameraIdleListener {
                val c = m.cameraPosition
                c.target?.let { t ->
                    prefs.edit().putFloat("vueLat", t.latitude.toFloat()).putFloat("vueLon", t.longitude.toFloat())
                        .putFloat("vueZoom", c.zoom.toFloat()).apply()
                }
            }
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
                val pt = m.projection.toScreenLocation(p)
                val r = 20 * resources.displayMetrics.density
                val box = android.graphics.RectF(pt.x - r, pt.y - r, pt.x + r, pt.y + r)
                // Point orange d'une rando trouvée sur le web : prioritaire sur les tracés.
                if (webHikes.isNotEmpty()) m.queryRenderedFeatures(box, LAYER_WEB_HIKES)
                    .firstOrNull()?.getNumberProperty("i")?.toInt()?.let { selectHike(it); return@addOnMapClickListener true }
                if (trails.isNotEmpty()) {
                    val id = m.queryRenderedFeatures(box, LAYER_TRAILS).firstOrNull()?.getNumberProperty("id")?.toLong()
                    if (id != null) {
                        // Toucher le tracé déjà ouvert : pente à cet endroit ; sinon, ouvrir cette rando.
                        val prof = findViewById<ProfileView>(R.id.trailProfile)
                        val pd = prof.profile
                        if (selectedTrail?.id == id && pd != null) {
                            prof.cursor = pd.nearestD(p.longitude, p.latitude)
                            sheetOpen = true; refreshTabs(); showSlopeCursor()
                        } else trails.firstOrNull { it.id == id }?.let { selectTrail(it) }
                        return@addOnMapClickListener true
                    }
                }
                // Appui sur une forêt : son essence, son type et sa surface (la rando passe avant).
                if (forests.isNotEmpty()) {
                    val f = m.queryRenderedFeatures(pt, LAYER_FORESTS).firstOrNull() ?: return@addOnMapClickListener false
                    val essence = f.getStringProperty("essence") ?: return@addOnMapClickListener false
                    val type = f.getStringProperty("type").orEmpty()
                    val ha = f.getNumberProperty("ha")?.toDouble() ?: 0.0
                    toast("🌲 $essence" + (if (type.isNotEmpty() && type != essence) " · $type" else "") + " · ${Forests.formatHa(ha)}")
                    return@addOnMapClickListener true
                }
                false
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
        findViewById<Button>(R.id.btnQuickLayer).setOnClickListener {
            btnLayer.performClick()
            toast("Fond de carte : ${mapMode.label}")
        }
        setupSearch()
        findViewById<CheckBox>(R.id.chkSlopes).setOnCheckedChangeListener { _, checked -> slopes = checked; applySlopes(); refreshQuickButtons() }
        val chkShade = findViewById<CheckBox>(R.id.chkShade)
        chkShade.setOnCheckedChangeListener { _, checked -> if (checked) shade.start() else shade.stop(); refreshQuickButtons() }
        shade.onClose = { chkShade.isChecked = false }

        // Boutons carte
        findViewById<ImageButton>(R.id.btnLocate).setOnClickListener { onLocateClicked() }

        // Panneau
        findViewById<View>(R.id.handle).setOnClickListener { sheetOpen = !sheetOpen; refreshTabs() }
        findViewById<Button>(R.id.tabSortie).setOnClickListener { showTab(Tab.SORTIE) }
        findViewById<Button>(R.id.tabRandos).setOnClickListener { showTab(Tab.RANDOS) }
        findViewById<Button>(R.id.tabForets).setOnClickListener { showTab(Tab.FORETS) }
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
        // Flèche en haut à droite : affiche ou cache toutes les icônes (choix retenu).
        findViewById<Button>(R.id.btnQuickToggle).setOnClickListener {
            prefs.edit().putBoolean("iconesCachees", !prefs.getBoolean("iconesCachees", false)).apply()
            refreshQuickButtons()
        }
        findViewById<Button>(R.id.btnQuickSearch).setOnClickListener {
            setNature(false)
            findViewById<ImageButton>(R.id.btnSearch).performClick()
        }
        findViewById<Button>(R.id.btnQuickPhoto).setOnClickListener {
            val i = PhotoCapture.prepare(this)
            if (i == null) { toast("Photo impossible sur ce téléphone (Android 10 minimum)"); return@setOnClickListener }
            try { photoLauncher.launch(i) } catch (e: Exception) { PhotoCapture.finish(this, false); toast("Pas d'appareil photo disponible") }
        }
        findViewById<Button>(R.id.btnQuickSlopes).setOnClickListener {
            findViewById<CheckBox>(R.id.chkSlopes).apply { isChecked = !isChecked }
        }
        findViewById<Button>(R.id.btnQuickShade).setOnClickListener {
            findViewById<CheckBox>(R.id.chkShade).apply { isChecked = !isChecked }
        }
        // Boussole juste sous la colonne d'icônes, qu'elle soit ouverte ou repliée.
        findViewById<View>(R.id.quickButtons).addOnLayoutChangeListener { v, _, _, _, _, _, _, _, _ ->
            map?.uiSettings?.setCompassMargins(0, v.bottom + (8 * resources.displayMetrics.density).toInt(),
                (10 * resources.displayMetrics.density).toInt(), 0)
        }
        findViewById<Button>(R.id.btnQuickAvion).setOnClickListener {
            toast(if (airplaneOn()) "Désactive le mode avion" else "Active le mode avion : ni réseau, ni Wi-Fi, ni Bluetooth. Le GPS continue.")
            BatterySettings.open(this, "avion")
        }
        findViewById<Button>(R.id.btnPoche).setOnClickListener {
            val on = !PocketMode.isEnabled(this)
            PocketMode.setEnabled(this, on)
            toast(if (on) "Mode poche activé : téléphone vertical 3 s = écran noir ; à plat ou 2 secousses pour rallumer" else "Mode poche désactivé")
            refreshQuickButtons()
        }
        findViewById<Button>(R.id.btnClearImport).setOnClickListener { imported = emptyList(); drawImported(); refreshSortie() }

        setupTrails()
        setupForests()

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
        findViewById<Button>(R.id.btnDownload).setOnClickListener { framingForOffline = true; framingForForests = false; setFraming(true) }
        findViewById<Button>(R.id.btnCancel).setOnClickListener { offline.cancel(); setStatus("Téléchargement annulé.") }
        findViewById<Button>(R.id.btnClear).setOnClickListener {
            Dem.clear(this)
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
        val top = listOf(findViewById<View>(R.id.topBar), findViewById<View>(R.id.quickButtons), findViewById<View>(R.id.searchPanel),
            findViewById<View>(R.id.frameBanner))
        val target = findViewById<View>(R.id.targetBar)
        val targetTop = (10 * resources.displayMetrics.density).toInt()
        val sheet = findViewById<View>(R.id.sheet)
        val margin = (10 * resources.displayMetrics.density).toInt()
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.root)) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            top.forEach { v -> v.updateLayoutParams<android.widget.FrameLayout.LayoutParams> { topMargin = bars.top + margin } }
            target.updateLayoutParams<android.widget.FrameLayout.LayoutParams> { topMargin = bars.top + targetTop }
            findViewById<View>(R.id.shadeBar).updateLayoutParams<android.widget.FrameLayout.LayoutParams> {
                topMargin = bars.top + (64 * resources.displayMetrics.density).toInt()
            }
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
            // Forêts sous les randos : couleur par essence, contour plus soutenu.
            style.addSource(GeoJsonSource(SRC_FORESTS))
            style.addLayer(FillLayer(LAYER_FORESTS, SRC_FORESTS).withProperties(fillColor(Expression.get("color")), fillOpacity(0.45f)))
            style.addLayer(LineLayer("forests-line", SRC_FORESTS).withProperties(lineColor(Expression.get("color")), lineWidth(1.2f)))
            style.addSource(GeoJsonSource(SRC_FRAME))
            style.addSource(GeoJsonSource(SRC_TRAILS))
            style.addSource(GeoJsonSource(SRC_TRAIL_SEL))
            style.addLayer(LineLayer("frame", SRC_FRAME).withProperties(lineColor("#1d2421"), lineWidth(2f), lineDasharray(arrayOf(3f, 2f))))
            style.addLayer(LineLayer(LAYER_TRAILS, SRC_TRAILS).withProperties(
                lineColor(Expression.get("color")), lineWidth(3f), lineOpacity(0.75f), lineCap(Property.LINE_CAP_ROUND)))
            style.addLayer(LineLayer("trail-sel-casing", SRC_TRAIL_SEL).withProperties(lineColor("#ffffff"), lineWidth(8f), lineCap(Property.LINE_CAP_ROUND)))
            style.addLayer(LineLayer("trail-sel", SRC_TRAIL_SEL).withProperties(lineColor("#7b3fe4"), lineWidth(5f), lineCap(Property.LINE_CAP_ROUND)))
            // Point du profil sous le doigt (pente), sur le tracé.
            style.addSource(GeoJsonSource(SRC_SLOPE_CURSOR))
            style.addLayer(CircleLayer("slope-cursor", SRC_SLOPE_CURSOR).withProperties(
                circleRadius(7f), circleColor("#e4572e"), circleStrokeColor("#ffffff"), circleStrokeWidth(3f)))
            style.addSource(GeoJsonSource(SRC_WEB_HIKES))
            style.addLayer(CircleLayer(LAYER_WEB_HIKES, SRC_WEB_HIKES).withProperties(
                circleRadius(8f), circleColor(WebHikes.COLOR), circleStrokeColor("#ffffff"), circleStrokeWidth(3f)))
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
            shade.onStyleLoaded()
            drawImported(fit = false)
            drawTrails(fit = false)
            drawWebHikes()
            drawForests()
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
            panel.visibility = View.GONE // la barre du haut reste cachée (demande de Seb)
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
            Tab.FORETS -> refreshForests()
            Tab.OFFLINE -> refreshOffline()
            Tab.MESURES -> refreshMesures()
            Tab.VERSIONS -> showVersions()
        }
    }

    private fun refreshTabs() {
        val accent = ContextCompat.getColor(this, R.color.accent)
        val muted = ContextCompat.getColor(this, R.color.muted)
        mapOf(Tab.SORTIE to R.id.tabSortie, Tab.RANDOS to R.id.tabRandos, Tab.FORETS to R.id.tabForets, Tab.OFFLINE to R.id.tabOffline, Tab.MESURES to R.id.tabMesures,
            Tab.VERSIONS to R.id.tabVersions).forEach { (t, id) ->
            findViewById<Button>(id).setTextColor(if (t == tab && sheetOpen) accent else muted)
        }
        findViewById<View>(R.id.content).visibility = if (sheetOpen) View.VISIBLE else View.GONE
        findViewById<View>(R.id.paneSortie).visibility = if (tab == Tab.SORTIE) View.VISIBLE else View.GONE
        findViewById<View>(R.id.paneRandos).visibility = if (tab == Tab.RANDOS) View.VISIBLE else View.GONE
        findViewById<View>(R.id.paneForets).visibility = if (tab == Tab.FORETS) View.VISIBLE else View.GONE
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
        val ids = listOf(R.id.topBar, R.id.searchPanel, R.id.targetBar, R.id.sheet)
        if (on) ids.forEach { id ->
            val v = findViewById<View>(id)
            hiddenInNature[id] = v.visibility
            v.visibility = View.GONE
        } else ids.forEach { id -> findViewById<View>(id).visibility = hiddenInNature[id] ?: View.VISIBLE }
        findViewById<View>(R.id.btnRestore).visibility = if (on) View.VISIBLE else View.GONE
        map?.uiSettings?.isCompassEnabled = false
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
        findViewById<ProfileView>(R.id.trailProfile).onCursor = { showSlopeCursor() }
        findViewById<TextView>(R.id.trailsAttribution).text =
            "Encadre une zone : les randos balisées d'OpenStreetMap s'affichent en tracés (${Trails.OSM_ATTRIBUTION}), " +
            "et celles que Claude trouve sur le web en points orange, avec le lien de leur page."
        findViewById<EditText>(R.id.editIaPassword).apply {
            setText(prefs.getString("iaPassword", ""))
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun afterTextChanged(s: Editable?) { prefs.edit().putString("iaPassword", s.toString()).apply() }
            })
        }
        findViewById<Button>(R.id.btnHikeOpen).setOnClickListener {
            hikeSel?.let { webHikes.getOrNull(it) }?.let { h ->
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(h.url))) }.onFailure { toast("Impossible d'ouvrir la page") }
            }
        }
        findViewById<Button>(R.id.btnHikeGo).setOnClickListener {
            hikeSel?.let { webHikes.getOrNull(it) }?.let { h -> setTarget(h.lat, h.lon, "Départ de « ${h.nom} »") }
        }
        findViewById<Button>(R.id.btnHikeClose).setOnClickListener { selectHike(null) }
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
                } else if (framingForForests) {
                    framingForForests = false
                    searchForests(Zone(minOf(p.longitude, q.longitude), minOf(p.latitude, q.latitude),
                        maxOf(p.longitude, q.longitude), maxOf(p.latitude, q.latitude)))
                } else searchTrails(Zone(minOf(p.longitude, q.longitude), minOf(p.latitude, q.latitude),
                    maxOf(p.longitude, q.longitude), maxOf(p.latitude, q.latitude)))
            }
        }
        findViewById<Button>(R.id.btnFrame).setOnClickListener { framingForOffline = false; framingForForests = false; setFraming(true) }
        // Par défaut : ligne libre (le recalage peut dévier) ; le choix est retenu.
        findViewById<CheckBox>(R.id.chkOnPaths).apply {
            isChecked = prefs.getBoolean("recaler", false)
            setOnCheckedChangeListener { _, c -> prefs.edit().putBoolean("recaler", c).apply() }
        }
        val startDrawing = View.OnClickListener {
            // Nouveau tracé : l'ancien disparaît tout de suite.
            trails = trails.filter { it.id != Trails.DRAWN_ID }
            if (selectedTrail?.id == Trails.DRAWN_ID) selectTrail(null) else drawTrails(fit = false)
            framingForOffline = false; framingForForests = false; setFraming(true, freehand = true)
        }
        findViewById<Button>(R.id.btnDrawPath).setOnClickListener(startDrawing)
        findViewById<Button>(R.id.btnQuickDraw).setOnClickListener(startDrawing)
        draw.onLine = { pts ->
            val proj = map?.projection
            setFraming(false)
            if (proj != null) drawDone(pts.map { val ll = proj.fromScreenLocation(it); LonLat(ll.longitude, ll.latitude) })
        }
        findViewById<Button>(R.id.btnFrameCancel).setOnClickListener { setFraming(false); framingForOffline = false; framingForForests = false; sheetOpen = true; refreshTabs() }
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
            trailsJob?.cancel(); webJob?.cancel()
            webHikes = emptyList(); hikeSel = null; webMessage = ""; drawWebHikes()
            trails = emptyList(); frame = null; trailsMessage = ""
            selectTrail(null); drawTrails(fit = false)
        }
        refreshTrails()
    }

    /** Le rectangle tracé sert au hors ligne (true) ou aux randos OSM (false). */
    private var framingForOffline = false

    private fun setFraming(on: Boolean, freehand: Boolean = false) {
        val draw = findViewById<FrameDrawView>(R.id.frameDraw)
        draw.reset()
        draw.freehand = freehand
        findViewById<TextView>(R.id.frameText).text = if (freehand) "Trace ton parcours du doigt" else "Trace un rectangle du doigt sur la zone"
        findViewById<View>(R.id.chkOnPaths).visibility = if (freehand) View.VISIBLE else View.GONE
        findViewById<View>(R.id.quickButtons).visibility = if (on) View.GONE else View.VISIBLE
        draw.visibility = if (on) View.VISIBLE else View.GONE
        findViewById<View>(R.id.frameBanner).visibility = if (on) View.VISIBLE else View.GONE
        findViewById<View>(R.id.targetBar).visibility = if (!on && target != null) View.VISIBLE else View.GONE
        shade.setBarVisible(!on)
        if (on) { sheetOpen = false; refreshTabs() }
    }

    private fun searchTrails(z: Zone) {
        setFraming(false)
        tab = Tab.RANDOS; sheetOpen = true; refreshTabs()
        if (Trails.zoneTooBig(z)) {
            trailsMessage = "Zone trop grande : encadre au plus ${(Trails.MAX_ZONE_DEG * 100).toInt()} km de côté environ."
            refreshTrails(); return
        }
        frame = z
        searchWebHikes(z)
        trails = trails.filter { it.id == Trails.DRAWN_ID }
        if (selectedTrail?.id != Trails.DRAWN_ID) { selectedTrail = null; elevated = null; elevJob?.cancel() }
        trailsMessage = "Recherche des randos dans OpenStreetMap…"
        drawTrails(fit = false); refreshTrails()
        trailsJob?.cancel()
        trailsJob = lifecycleScope.launch {
            val t0 = SystemClock.elapsedRealtime()
            val r = withContext(Dispatchers.IO) { runCatching { Trails.fetchTrails(z) } }
            r.onSuccess { found ->
                Log.i(Scenario.BENCH_TAG, "{\"event\":\"trails-search\",\"found\":${found.size},\"ms\":${SystemClock.elapsedRealtime() - t0}}")
                trails = trails.filter { it.id == Trails.DRAWN_ID } + found
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

    // ---------- Randos trouvées sur le web par Claude (relais du VPS) ----------

    private var webHikes: List<WebHike> = emptyList()
    private var hikeSel: Int? = null
    private var webMessage = ""
    private var webJob: kotlinx.coroutines.Job? = null

    private fun searchWebHikes(z: Zone) {
        webJob?.cancel()
        webHikes = emptyList(); hikeSel = null; drawWebHikes()
        val password = prefs.getString("iaPassword", "").orEmpty()
        if (password.isEmpty()) {
            webMessage = "Pour ajouter les randos trouvées sur le web par Claude, saisis le mot de passe IA ci-dessous."
            refreshTrails(); return
        }
        webMessage = "Claude cherche des randos sur le web (1 à 2 minutes)…"
        refreshTrails()
        webJob = lifecycleScope.launch {
            val t0 = SystemClock.elapsedRealtime()
            val r = withContext(Dispatchers.IO) { runCatching { WebHikes.fetch(z, password) } }
            r.onSuccess { res ->
                Log.i(Scenario.BENCH_TAG, "{\"event\":\"web-hikes\",\"found\":${res.hikes.size},\"cache\":${res.cache},\"ms\":${SystemClock.elapsedRealtime() - t0}}")
                webHikes = res.hikes
                val n = res.hikes.size; val s = if (n > 1) "s" else ""
                webMessage = (if (n > 0) "$n rando$s trouvée$s sur le web (points orange). Touche un point pour ouvrir sa page."
                    else "Claude n'a trouvé aucune page de rando sur cette zone.") + " " + WebHikes.costLine(res.cost, res.cache)
            }.onFailure { e ->
                if (e is kotlinx.coroutines.CancellationException) return@launch
                webMessage = "Recherche web impossible : ${e.message}"
            }
            drawWebHikes(); refreshTrails()
        }
    }

    private fun selectHike(i: Int?) {
        hikeSel = i
        drawWebHikes(); refreshTrails()
        val h = i?.let { webHikes.getOrNull(it) } ?: return
        if (follow) setFollow(false)
        if (locating) map?.locationComponent?.cameraMode = CameraMode.NONE
        tab = Tab.RANDOS; sheetOpen = true; refreshTabs()
        map?.animateCamera(CameraUpdateFactory.newLatLng(LatLng(h.lat, h.lon)), 600)
    }

    private fun drawWebHikes() {
        val style = map?.style ?: return
        if (!style.isFullyLoaded) return
        style.getSourceAs<GeoJsonSource>(SRC_WEB_HIKES)?.setGeoJson(FeatureCollection.fromFeatures(webHikes.mapIndexed { i, h ->
            Feature.fromGeometry(Point.fromLngLat(h.lon, h.lat)).apply { addNumberProperty("i", i) }
        }))
        val sel = (hikeSel ?: -1).toDouble()
        style.getLayer(LAYER_WEB_HIKES)?.setProperties(
            circleColor(Expression.switchCase(Expression.eq(Expression.get("i"), Expression.literal(sel)),
                Expression.color(Color.parseColor("#7b3fe4")), Expression.color(Color.parseColor(WebHikes.COLOR)))),
            circleRadius(Expression.switchCase(Expression.eq(Expression.get("i"), Expression.literal(sel)),
                Expression.literal(11f), Expression.literal(8f))))
    }

    private fun refreshWebHikes() {
        findViewById<TextView>(R.id.webInfo).apply {
            text = webMessage; visibility = if (webMessage.isEmpty()) View.GONE else View.VISIBLE
        }
        val h = hikeSel?.let { webHikes.getOrNull(it) }
        findViewById<View>(R.id.hikeCard).visibility = if (h != null) View.VISIBLE else View.GONE
        if (h != null) {
            findViewById<TextView>(R.id.hikeName).text = h.nom
            findViewById<TextView>(R.id.hikeDetail).text = WebHikes.detail(h)
            findViewById<TextView>(R.id.hikeResume).apply { text = h.resume; visibility = if (h.resume.isEmpty()) View.GONE else View.VISIBLE }
        }
        val list = findViewById<android.widget.LinearLayout>(R.id.hikeList)
        list.removeAllViews()
        val d = resources.displayMetrics.density
        webHikes.forEachIndexed { i, w ->
            list.addView(android.widget.LinearLayout(this).apply {
                orientation = android.widget.LinearLayout.HORIZONTAL
                setPadding((4 * d).toInt(), (8 * d).toInt(), (4 * d).toInt(), (8 * d).toInt())
                isClickable = true
                if (i == hikeSel) setBackgroundColor(Color.parseColor("#1AF28C28"))
                else setBackgroundResource(android.R.drawable.list_selector_background)
                addView(View(this@MainActivity).apply { setBackgroundColor(Color.parseColor(WebHikes.COLOR)) },
                    android.widget.LinearLayout.LayoutParams((6 * d).toInt(), android.view.ViewGroup.LayoutParams.MATCH_PARENT)
                        .apply { marginEnd = (10 * d).toInt() })
                addView(TextView(this@MainActivity).apply {
                    val sub = WebHikes.detail(w)
                    text = android.text.SpannableString("${w.nom}\n$sub").apply {
                        setSpan(android.text.style.StyleSpan(android.graphics.Typeface.BOLD), 0, w.nom.length, 0)
                        setSpan(android.text.style.ForegroundColorSpan(Color.parseColor("#1D2421")), 0, w.nom.length, 0)
                        setSpan(android.text.style.RelativeSizeSpan(0.85f), w.nom.length + 1, w.nom.length + 1 + sub.length, 0)
                    }
                    textSize = 15f
                    setTextColor(ContextCompat.getColor(this@MainActivity, R.color.muted))
                })
                setOnClickListener { selectHike(i) }
            })
            list.addView(View(this).apply { setBackgroundColor(ContextCompat.getColor(this@MainActivity, R.color.line)) },
                android.widget.LinearLayout.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, 1))
        }
    }

    /** Ligne dessinée : recalée sur les chemins (IGN) si demandé et possible, puis mesurée comme une rando. */
    private fun drawDone(line: List<LonLat>) {
        tab = Tab.RANDOS; sheetOpen = true; refreshTabs()
        val onPaths = findViewById<CheckBox>(R.id.chkOnPaths).isChecked
        trailsMessage = if (onPaths) "Calcul du chemin sur les sentiers…" else ""
        refreshTrails()
        trailsJob?.cancel()
        trailsJob = lifecycleScope.launch {
            var used = onPaths
            val final = if (!onPaths) line else withContext(Dispatchers.IO) {
                runCatching { Trails.routeOnPaths(Trails.waypoints(line)) }.getOrNull()
            } ?: line.also { used = false }
            trailsMessage = if (onPaths && !used) "Chemins introuvables (pas de réseau ?) : la ligne dessinée est gardée telle quelle." else ""
            val t = Trails.drawnTrail(final, used)
            trails = listOf(t) + trails.filter { it.id != Trails.DRAWN_ID }
            selectTrail(t)
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

    /** Texte de pente et point sur la carte pour le curseur du profil. */
    private fun showSlopeCursor() {
        val prof = findViewById<ProfileView>(R.id.trailProfile)
        val pd = prof.profile
        val c = prof.cursor
        val txt = findViewById<TextView>(R.id.trailSlope)
        txt.visibility = if (pd != null) View.VISIBLE else View.GONE
        val at = if (pd != null && c != null) pd.pointAt(c) else null
        txt.text = if (pd != null && at != null) stat(ProfileData.format(pd.slopeAt(at.d)),
            String.format(Locale.FRANCE, "%.2f km · %d m", at.d / 1000, at.z.roundToInt()))
            else "Glisse le doigt sur le profil (ou touche le tracé) : pente moyenne sur ${ProfileData.SLOPE_WINDOW_M.toInt()} m."
        map?.style?.getSourceAs<GeoJsonSource>(SRC_SLOPE_CURSOR)?.setGeoJson(
            if (at == null) FeatureCollection.fromFeatures(emptyList<Feature>())
            else FeatureCollection.fromFeature(Feature.fromGeometry(Point.fromLngLat(at.lon, at.lat))))
    }

    private fun refreshTrails() {
        findViewById<TextView>(R.id.trailsInfo).apply {
            text = trailsMessage; visibility = if (trailsMessage.isEmpty()) View.GONE else View.VISIBLE
        }
        val sel = selectedTrail
        findViewById<View>(R.id.trailCard).visibility = if (sel != null) View.VISIBLE else View.GONE
        if (sel == null) { findViewById<ProfileView>(R.id.trailProfile).setData(null); showSlopeCursor() }
        if (sel != null) {
            findViewById<TextView>(R.id.trailName).text = sel.name
            findViewById<TextView>(R.id.trailKind).text = sel.kind +
                (if (sel.segments.size > 1) " · ${sel.segments.size} morceaux" else "") +
                (if (sel.id > 0) " · openstreetmap.org/relation/${sel.id}" else "")
            val e = elevated?.getOrNull()
            val wait = if (elevated == null) "…" else "—"
            findViewById<TextView>(R.id.trailDist).text = stat(String.format(Locale.FRANCE, "%.2f km", sel.distanceM / 1000), "distance")
            findViewById<TextView>(R.id.trailGain).text = stat(e?.let { "${it.gainM.toInt()} m" } ?: wait, "D+")
            findViewById<TextView>(R.id.trailLoss).text = stat(e?.let { "${it.lossM.toInt()} m" } ?: wait, "D−")
            findViewById<TextView>(R.id.trailTime).text = stat(e?.let {
                val min = Math.round(Trails.walkingHours(sel.distanceM, it.gainM, it.lossM) * 60).toInt()
                String.format(Locale.FRANCE, "%dh%02d", min / 60, min % 60)
            } ?: wait, "marche")
            findViewById<ProfileView>(R.id.trailProfile).apply {
                setData(e?.segments)
                visibility = if (e != null) View.VISIBLE else View.GONE
            }
            showSlopeCursor()
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
        findViewById<View>(R.id.btnTrailsClear).visibility = if (trails.isNotEmpty() || webHikes.isNotEmpty()) View.VISIBLE else View.GONE
        refreshWebHikes()
    }

    private fun exportTrailTo(uri: Uri) {
        val t = selectedTrail ?: return
        val segs = elevated?.getOrNull()?.segments ?: t.segments.map { seg -> seg.map { it to null } }
        runCatching { contentResolver.openOutputStream(uri)!!.use { it.write(Trails.toGpx(t, segs).toByteArray()) } }
            .onSuccess { setStatus("GPX enregistré : « ${t.name} ».") }
            .onFailure { setStatus("Export impossible : ${it.message}") }
    }

    // ---------- Forêts par essence (BD Forêt IGN) d'une zone ----------

    private var forests: List<Forest> = emptyList()
    /** Essences choisies dans la liste ; vide : toutes les forêts sont dessinées. */
    private val forestFilter = mutableSetOf<String>()
    private var forestsMessage = ""
    private var forestsJob: kotlinx.coroutines.Job? = null
    /** Le rectangle tracé sert aux forêts. */
    private var framingForForests = false

    private fun setupForests() {
        findViewById<TextView>(R.id.forestsAttribution).text =
            "Forêts par essence (hêtraies, pinèdes, chênaies…) de la carte forestière IGN. Touche une forêt sur la carte pour son détail. ${Forests.ATTRIBUTION}."
        findViewById<Button>(R.id.btnForestsView).setOnClickListener {
            map?.projection?.visibleRegion?.latLngBounds?.let {
                searchForests(Zone(it.longitudeWest, it.latitudeSouth, it.longitudeEast, it.latitudeNorth))
            }
        }
        findViewById<Button>(R.id.btnForestsFrame).setOnClickListener { framingForOffline = false; framingForForests = true; setFraming(true) }
        findViewById<Button>(R.id.btnForestsAll).setOnClickListener { forestFilter.clear(); drawForests(); refreshForests() }
        findViewById<Button>(R.id.btnForestsClear).setOnClickListener {
            forestsJob?.cancel()
            forests = emptyList(); forestFilter.clear(); forestsMessage = ""
            if (trails.isEmpty()) { frame = null; drawTrails(fit = false) }
            drawForests(); refreshForests()
        }
        refreshForests()
    }

    private fun searchForests(z: Zone) {
        setFraming(false)
        tab = Tab.FORETS; sheetOpen = true; refreshTabs()
        if (Forests.zoneTooBig(z)) {
            forestsMessage = "Zone trop grande : zoome ou encadre au plus ${(Forests.MAX_ZONE_DEG * 100).toInt()} km de côté environ."
            refreshForests(); return
        }
        frame = z; drawTrails(fit = false)
        forests = emptyList(); forestFilter.clear()
        forestsMessage = "Recherche des forêts dans la carte forestière IGN…"
        drawForests(); refreshForests()
        forestsJob?.cancel()
        forestsJob = lifecycleScope.launch {
            val t0 = SystemClock.elapsedRealtime()
            val r = withContext(Dispatchers.IO) { runCatching { Forests.fetchForests(z) } }
            r.onSuccess { found ->
                Log.i(Scenario.BENCH_TAG, "{\"event\":\"forests-search\",\"found\":${found.size},\"ms\":${SystemClock.elapsedRealtime() - t0}}")
                forests = found
                val n = Forests.groupByEssence(found).size
                forestsMessage = if (found.isEmpty()) "Aucune forêt dans la carte forestière IGN sur cette zone."
                    else "${found.size} massifs, $n essence${if (n > 1) "s" else ""}. Touche une essence pour ne voir qu'elle (plusieurs possibles)." +
                        (if (found.size >= Forests.MAX_FORESTS) " Zone très boisée : tout n'a pas pu être chargé, zoome pour être complet." else "")
            }.onFailure { e ->
                if (e is kotlinx.coroutines.CancellationException) return@launch
                forestsMessage = "Recherche impossible (pas de réseau ?) : ${e.message}"
            }
            drawForests(); refreshForests()
        }
    }

    /** Choisit ou retire une essence, puis cadre la carte sur les forêts choisies. */
    private fun toggleEssence(essence: String) {
        if (!forestFilter.remove(essence)) forestFilter.add(essence)
        drawForests(); refreshForests()
        if (forestFilter.isEmpty()) return
        val b = LatLngBounds.Builder()
        var any = false
        forests.filter { it.essence in forestFilter }.forEach { f -> f.polygons.forEach { p -> p[0].forEach { b.include(LatLng(it.lat, it.lon)); any = true } } }
        if (!any) return
        if (follow) setFollow(false)
        if (locating) map?.locationComponent?.cameraMode = CameraMode.NONE
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

    private fun drawForests() {
        val style = map?.style ?: return
        if (!style.isFullyLoaded) return
        val shown = forests.filter { forestFilter.isEmpty() || it.essence in forestFilter }
        style.getSourceAs<GeoJsonSource>(SRC_FORESTS)?.setGeoJson(FeatureCollection.fromFeatures(shown.map { f ->
            Feature.fromGeometry(MultiPolygon.fromLngLats(f.polygons.map { p -> p.map { r -> r.map { Point.fromLngLat(it.lon, it.lat) } } })).apply {
                addStringProperty("essence", f.essence); addStringProperty("type", f.type); addStringProperty("color", f.color)
                addNumberProperty("ha", Math.round(f.areaHa * 10) / 10.0)
            }
        }))
    }

    private fun refreshForests() {
        findViewById<TextView>(R.id.forestsInfo).apply {
            text = forestsMessage; visibility = if (forestsMessage.isEmpty()) View.GONE else View.VISIBLE
        }
        val list = findViewById<android.widget.LinearLayout>(R.id.forestList)
        list.removeAllViews()
        val d = resources.displayMetrics.density
        Forests.groupByEssence(forests).forEach { g ->
            val on = g.essence in forestFilter
            list.addView(android.widget.LinearLayout(this).apply {
                orientation = android.widget.LinearLayout.HORIZONTAL
                setPadding((4 * d).toInt(), (8 * d).toInt(), (4 * d).toInt(), (8 * d).toInt())
                isClickable = true
                if (on) setBackgroundColor(Color.parseColor("#1A7B3FE4"))
                else setBackgroundResource(android.R.drawable.list_selector_background)
                addView(View(this@MainActivity).apply { setBackgroundColor(Color.parseColor(g.color)) },
                    android.widget.LinearLayout.LayoutParams((6 * d).toInt(), android.view.ViewGroup.LayoutParams.MATCH_PARENT)
                        .apply { marginEnd = (10 * d).toInt() })
                addView(TextView(this@MainActivity).apply {
                    val name = (if (on) "✓ " else "") + g.essence
                    val sub = "${Forests.formatHa(g.areaHa)} · ${g.count} massif${if (g.count > 1) "s" else ""}"
                    text = android.text.SpannableString("$name\n$sub").apply {
                        setSpan(android.text.style.StyleSpan(android.graphics.Typeface.BOLD), 0, name.length, 0)
                        setSpan(android.text.style.ForegroundColorSpan(Color.parseColor("#1D2421")), 0, name.length, 0)
                        setSpan(android.text.style.RelativeSizeSpan(0.85f), name.length + 1, name.length + 1 + sub.length, 0)
                    }
                    textSize = 15f
                    setTextColor(ContextCompat.getColor(this@MainActivity, R.color.muted))
                })
                setOnClickListener { toggleEssence(g.essence) }
            })
            list.addView(View(this).apply { setBackgroundColor(ContextCompat.getColor(this@MainActivity, R.color.line)) },
                android.widget.LinearLayout.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, 1))
        }
        findViewById<View>(R.id.btnForestsAll).visibility = if (forestFilter.isNotEmpty()) View.VISIBLE else View.GONE
        findViewById<View>(R.id.btnForestsClear).visibility = if (forests.isNotEmpty()) View.VISIBLE else View.GONE
    }

    // ---------- Hors ligne ----------

    private fun refreshOffline() {
        findViewById<Button>(R.id.btnNetwork).text = if (online) "Réseau : actif" else "Réseau : coupé"
        val (mntTiles, mntBytes) = Dem.stored(this)
        offline.summary { s0 -> runOnUiThread {
            val s = "$s0 ; relief pour les ombres : $mntTiles tuiles, ${mo(mntBytes)}"
            offlineSummary = s
            findViewById<TextView>(R.id.offlineHint).text =
                "« Tracer un rectangle » : trace du doigt le coin de la rando sur la carte, ses tuiles se téléchargent. Fond affiché (${mapMode.label}) : ${mapMode.offlinePlan()}.\nEn stock : $s.\n" +
                "Place prise sur le téléphone : ${mo(offline.databaseBytes() + mntBytes)} (tuiles téléchargées + tuiles vues + relief). " +
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
        var reliefStarted = false
        offline.download(mapMode, apiKey, bounds) { p -> runOnUiThread {
            if (p.error != null) { info.text = "Erreur : ${p.error}"; return@runOnUiThread }
            bar.max = p.total.toInt().coerceAtLeast(1)
            bar.progress = p.done.toInt()
            info.text = "${p.done}/${p.total} éléments, ${p.bytes / 100_000 / 10.0} Mo, ${p.seconds} s" + if (p.finished) " : terminé" else ""
            if (p.finished && !reliefStarted) { reliefStarted = true; downloadRelief(bounds) }
        } }
    }

    /** Relief pour les ombres (zooms 10 à 14), pour calculer le film sans réseau. */
    private fun downloadRelief(b: LatLngBounds) {
        val info = findViewById<TextView>(R.id.offlineInfo)
        val bar = findViewById<ProgressBar>(R.id.progress)
        val tiles = Dem.tilesForZone(b.longitudeWest, b.latitudeSouth, b.longitudeEast, b.latitudeNorth)
        val before = info.text.toString()
        bar.max = tiles.size; bar.progress = 0
        lifecycleScope.launch {
            var failed = 0
            tiles.forEachIndexed { i, (z, x, y) ->
                val ok = withContext(Dispatchers.IO) { Dem.loadTile(this@MainActivity, z, x, y) != null }
                if (!ok) failed++
                bar.progress = i + 1
                info.text = "$before\nRelief pour les ombres : ${i + 1}/${tiles.size} tuiles" + if (failed > 0) ", $failed échecs" else ""
            }
            info.text = info.text.toString() + " : terminé"
            refreshOffline()
        }
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
    override fun onResume() { super.onResume(); mapView.onResume(); refreshQuickButtons() }

    /** Android interdit à une appli de basculer le mode avion : on lit son état et on ouvre le réglage. */
    private fun airplaneOn() =
        android.provider.Settings.Global.getInt(contentResolver, android.provider.Settings.Global.AIRPLANE_MODE_ON, 0) == 1

    /** Icône « allumée » (fond vert, symbole blanc) quand le mode est actif. */
    private fun refreshQuickButtons() {
        fun paint(id: Int, on: Boolean) = findViewById<Button>(id).apply {
            backgroundTintList = if (on) ColorStateList.valueOf(Color.parseColor("#2F6F4F")) else null
            setTextColor(if (on) Color.WHITE else Color.parseColor("#1D2421"))
        }
        paint(R.id.btnQuickAvion, airplaneOn())
        paint(R.id.btnQuickSlopes, slopes)
        paint(R.id.btnQuickShade, findViewById<CheckBox>(R.id.chkShade).isChecked)
        val hidden = prefs.getBoolean("iconesCachees", false)
        findViewById<View>(R.id.quickIcons).visibility = if (hidden) View.GONE else View.VISIBLE
        findViewById<Button>(R.id.btnQuickToggle).text = if (hidden) "◂" else "▸"
        paint(R.id.btnPoche, PocketMode.isEnabled(this))
    }
    override fun onPause() { mapView.onPause(); super.onPause() }
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
        private const val SRC_SLOPE_CURSOR = "slope-cursor-src"
        private const val SRC_FRAME = "frame-src"
        private const val SRC_FORESTS = "forests-src"
        private const val LAYER_FORESTS = "forests"
        private const val LAYER_TRAILS = "trails"
        private const val SRC_WEB_HIKES = "web-hikes-src"
        private const val LAYER_WEB_HIKES = "web-hikes"
        private const val LAYER_SLOPES = "slopes"
    }
}
