package fr.assomoutain.proto

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.FillLayer
import org.maplibre.android.style.layers.PropertyFactory.fillColor
import org.maplibre.android.style.layers.PropertyFactory.fillOpacity
import org.maplibre.android.style.layers.PropertyFactory.iconAllowOverlap
import org.maplibre.android.style.layers.PropertyFactory.iconAnchor
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory.iconIgnorePlacement
import org.maplibre.android.style.layers.PropertyFactory.iconImage
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.Point
import org.maplibre.geojson.Polygon
import java.time.Instant
import java.time.ZoneId
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

/**
 * Météo posée sur la carte : une grille d'icônes (temps, température, vent) par-dessus la carte,
 * et un bandeau avec un curseur d'heure sur 4 jours. Données Météo-France (AROME, ARPEGE) via Open-Meteo.
 * Même comportement que WeatherLayer.tsx côté Capacitor.
 */
class WeatherLayer(
    private val activity: AppCompatActivity,
    private val mapProvider: () -> MapLibreMap?,
    /** Vrai quand le bandeau des ombres est affiché : le nôtre se place dessous. */
    private val below: () -> Boolean,
    /** Couche sous laquelle poser le voile de la carte simplifiée (forêts, tracés au-dessus). */
    private val belowLayer: String,
) {
    private val bar: View = activity.findViewById(R.id.weatherBar)
    private val timeTxt: TextView = activity.findViewById(R.id.weatherTime)
    private val stateTxt: TextView = activity.findViewById(R.id.weatherState)
    private val msgTxt: TextView = activity.findViewById(R.id.weatherMsg)
    private val dayLabel: TextView = activity.findViewById(R.id.weatherDayLabel)
    private val prevDay: Button = activity.findViewById(R.id.weatherPrevDay)
    private val nextDay: Button = activity.findViewById(R.id.weatherNextDay)
    private val momentBtns = listOf(R.id.weatherMoment0, R.id.weatherMoment1, R.id.weatherMoment2, R.id.weatherMoment3).map { activity.findViewById<Button>(it) }
    private val modeTemps: Button = activity.findViewById(R.id.weatherModeTemps)
    private val modeVent: Button = activity.findViewById(R.id.weatherModeVent)
    private val simpleChk: CheckBox = activity.findViewById(R.id.weatherSimple)
    private val windHint: TextView = activity.findViewById(R.id.weatherWindHint)
    private val prefs by lazy { activity.getSharedPreferences("meteo", android.content.Context.MODE_PRIVATE) }
    /** Ce que montrent les icônes : le temps (soleil, pluie…) ou le vent (flèche colorée, vitesse / rafales). */
    private var windMode = false
    private var simple = true

    var active = false; private set
    var onClose: (() -> Unit)? = null
    /** Moment choisi : jour (0 = aujourd'hui) et moment de la journée, comme dans l'appli Météo-France. */
    private var day = 0
    private var moment = 0
    private var points: List<OpenMeteo.Forecast> = emptyList()
    private var job: Job? = null
    private var pendingMove: Job? = null
    private val onIdle = MapLibreMap.OnCameraIdleListener {
        pendingMove?.cancel()
        pendingMove = activity.lifecycleScope.launch { delay(600); refresh() }
    }

    init {
        activity.findViewById<Button>(R.id.weatherClose).setOnClickListener { onClose?.invoke() }
        prevDay.setOnClickListener { goDay(day - 1) }
        nextDay.setOnClickListener { goDay(day + 1) }
        momentBtns.forEachIndexed { i, b -> b.text = OpenMeteo.MOMENTS[i].label; b.setOnClickListener { moment = i; show() } }
    }

    fun start() {
        if (active) return
        active = true
        day = if (firstMoment(0) < 0) 1 else 0
        moment = firstMoment(day).coerceAtLeast(0)
        placeBar()
        bar.visibility = View.VISIBLE
        ensureLayer()
        applySimple()
        refreshModeButtons()
        mapProvider()?.addOnCameraIdleListener(onIdle)
        show()
        refresh()
    }

    fun stop() {
        if (!active) return
        active = false
        bar.visibility = View.GONE
        mapProvider()?.removeOnCameraIdleListener(onIdle)
        pendingMove?.cancel(); job?.cancel()
        points = emptyList()
        mapProvider()?.style?.let { st -> st.removeLayer(LAYER); st.removeSource(SRC); removeSimple(st) }
    }

    /** Masqué en mode nature ou pendant un tracé. */
    fun setBarVisible(v: Boolean) { if (active) { placeBar(); bar.visibility = if (v) View.VISIBLE else View.GONE } }

    /** Sous le bandeau des ombres s'il est ouvert, sinon à sa place. */
    fun placeBar() {
        val d = activity.resources.displayMetrics.density
        (bar.layoutParams as? android.widget.FrameLayout.LayoutParams)?.let { lp -> lp.topMargin = ((if (below()) 236 else 64) * d).toInt(); bar.layoutParams = lp }
    }

    /** Le style est rechargé (changement de fond) : on remet la couche et les icônes. */
    fun onStyleLoaded() { if (active) { ensureLayer(); applySimple(); draw() } }

    private fun setWind(on: Boolean) {
        windMode = on; prefs.edit().putBoolean("vent", on).apply()
        refreshModeButtons(); draw()
    }

    private fun refreshModeButtons() {
        fun paint(b: Button, on: Boolean) {
            b.backgroundTintList = if (on) android.content.res.ColorStateList.valueOf(Color.parseColor("#2F6F4F")) else null
            b.setTextColor(if (on) Color.WHITE else Color.parseColor("#1D2421"))
        }
        paint(modeTemps, !windMode); paint(modeVent, windMode)
        windHint.visibility = if (windMode) View.VISIBLE else View.GONE
    }

    // ---------- Carte simplifiée : voile clair sur le fond (sous les forêts) et quelques villes ----------
    private fun applySimple() {
        val st = mapProvider()?.style ?: return
        if (!active || !simple) { removeSimple(st); return }
        if (st.getSource(SRC_VEIL) == null) st.addSource(GeoJsonSource(SRC_VEIL, Polygon.fromLngLats(listOf(listOf(
            Point.fromLngLat(-180.0, -85.0), Point.fromLngLat(180.0, -85.0), Point.fromLngLat(180.0, 85.0), Point.fromLngLat(-180.0, 85.0), Point.fromLngLat(-180.0, -85.0))))))
        if (st.getLayer(LAYER_VEIL) == null) {
            val veil = FillLayer(LAYER_VEIL, SRC_VEIL).withProperties(fillColor("#f6f4ee"), fillOpacity(0.8f))
            if (st.getLayer(belowLayer) != null) st.addLayerBelow(veil, belowLayer) else st.addLayer(veil)
        }
        if (st.getSource(SRC_CITIES) == null) st.addSource(GeoJsonSource(SRC_CITIES, FeatureCollection.fromFeatures(Cities.ALL.map { c ->
            val img = "ville:${c.rank}:${c.name}"
            if (st.getImage(img) == null) st.addImage(img, cityBitmap(c))
            Feature.fromGeometry(Point.fromLngLat(c.lon, c.lat)).apply { addStringProperty("img", img); addNumberProperty("rang", c.rank) }
        })))
        for (rank in 1..3) {
            val id = "$LAYER_CITIES$rank"
            if (st.getLayer(id) != null) continue
            st.addLayerBelow(SymbolLayer(id, SRC_CITIES).withProperties(
                iconImage(Expression.get("img")), iconAllowOverlap(true), iconIgnorePlacement(true), iconAnchor(Property.ICON_ANCHOR_LEFT))
                .withFilter(Expression.eq(Expression.get("rang"), rank)).apply { minZoom = Cities.MIN_ZOOM[rank] ?: 5f }, LAYER)
        }
    }

    private fun removeSimple(st: org.maplibre.android.maps.Style) {
        for (rank in 1..3) st.removeLayer("$LAYER_CITIES$rank")
        st.removeSource(SRC_CITIES)
        st.removeLayer(LAYER_VEIL); st.removeSource(SRC_VEIL)
    }

    /** Point noir cerclé de blanc + nom de la ville (plus gros pour les grandes villes). */
    private fun cityBitmap(c: City): Bitmap {
        val d = activity.resources.displayMetrics.density
        val size = when (c.rank) { 1 -> 15f; 2 -> 13f; else -> 12f } * d
        val txt = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = size; color = Color.parseColor("#1D2421"); isFakeBoldText = c.rank < 3 }
        val halo = Paint(txt).apply { style = Paint.Style.STROKE; strokeWidth = 3 * d; color = Color.WHITE }
        val dot = if (c.rank == 3) 6 * d else 8 * d
        val w = (dot + 6 * d + txt.measureText(c.name) + 4 * d).toInt() + 2
        val h = (size * 1.6f).toInt().coerceAtLeast((dot + 6 * d).toInt()) + 2
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val cv = Canvas(bmp)
        val cy = h / 2f
        cv.drawCircle(1 + dot / 2 + d, cy, dot / 2 + d, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE })
        cv.drawCircle(1 + dot / 2 + d, cy, dot / 2, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#1D2421") })
        val x = 1 + dot + 6 * d; val y = cy - (txt.descent() + txt.ascent()) / 2
        cv.drawText(c.name, x, y, halo); cv.drawText(c.name, x, y, txt)
        return bmp
    }

    /** Détail d'un point touché (toast), à partir de la propriété « info » de la feature. */
    fun describe(f: Feature): String? = f.getStringProperty("info")

    private fun ensureLayer() {
        val st = mapProvider()?.style ?: return
        if (st.getSource(SRC) == null) st.addSource(GeoJsonSource(SRC))
        if (st.getLayer(LAYER) == null) st.addLayer(SymbolLayer(LAYER, SRC).withProperties(
            iconImage(Expression.get("img")), iconAllowOverlap(true), iconIgnorePlacement(true)))
    }

    private fun msg(t: String) { msgTxt.text = t; msgTxt.visibility = if (t.isEmpty()) View.GONE else View.VISIBLE }
    private fun fmtTime(ms: Long) = Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("HH:mm"))

    /** Points de la vue (cache 1 h ; sans réseau, la dernière météo reçue). */
    private fun refresh() {
        val m = mapProvider() ?: return
        if (!active) return
        val b = m.projection.visibleRegion.latLngBounds
        val pts = OpenMeteo.gridPoints(b.longitudeWest, b.latitudeSouth, b.longitudeEast, b.latitudeNorth)
        job?.cancel()
        stateTxt.text = "Météo…"
        job = activity.lifecycleScope.launch {
            val r = withContext(Dispatchers.IO) { runCatching { OpenMeteo.forecastFor(activity, pts) } }
            if (!isActive || !active) return@launch
            stateTxt.text = ""
            r.onFailure { msg("Météo indisponible : ${it.message}") }.onSuccess { res ->
                points = res.list
                val newest = res.list.maxOfOrNull { it.fetched } ?: 0L
                msg(when {
                    res.error != null && res.list.isNotEmpty() -> "Sans réseau : météo reçue à ${fmtTime(newest)}"
                    res.error != null -> "Météo indisponible : ${res.error}"
                    res.list.isEmpty() -> "Aucune prévision ici (modèles Météo-France : France et Europe proche)"
                    else -> "Prévision reçue à ${fmtTime(newest)} · ${OpenMeteo.ATTRIBUTION}"
                })
                draw()
            }
        }
    }

    private fun firstMoment(d: Int) = OpenMeteo.MOMENTS.indexOfFirst { OpenMeteo.momentAvailable(d, it.hour) }

    private fun goDay(d: Int) {
        day = d.coerceIn(0, OpenMeteo.DAYS - 1)
        // Si le moment choisi n'existe pas ce jour-là (déjà passé, ou au-delà de la prévision), on prend le premier possible.
        if (!OpenMeteo.momentAvailable(day, OpenMeteo.MOMENTS[moment].hour)) moment = firstMoment(day).coerceAtLeast(0)
        show()
    }

    private fun current(): LocalDateTime = OpenMeteo.momentTime(day, OpenMeteo.MOMENTS[moment].hour)

    private fun show() {
        timeTxt.text = OpenMeteo.hourLabel(current())
        dayLabel.text = OpenMeteo.dayLabel(day)
        prevDay.isEnabled = day > 0; nextDay.isEnabled = day < OpenMeteo.DAYS - 1
        momentBtns.forEachIndexed { i, b ->
            val on = i == moment
            b.isEnabled = OpenMeteo.momentAvailable(day, OpenMeteo.MOMENTS[i].hour)
            b.alpha = if (b.isEnabled) 1f else 0.4f
            b.backgroundTintList = if (on) android.content.res.ColorStateList.valueOf(Color.parseColor("#2F6F4F")) else null
            b.setTextColor(if (on) Color.WHITE else Color.parseColor("#1D2421"))
        }
        draw()
    }

    /** Une image par combinaison icône + texte (générée au besoin), posée en symbole sur chaque point. */
    private fun draw() {
        val st = mapProvider()?.style ?: return
        if (!active || st.getSource(SRC) == null) return
        val t = OpenMeteo.millis(current())
        val label = OpenMeteo.hourLabel(current())
        val features = points.mapNotNull { p ->
            val i = p.hourIndex(t)
            if (i < 0) return@mapNotNull null
            val strong = p.gust[i] >= 60
            val img: String
            if (windMode) {
                val rot = (OpenMeteo.windRotation(p.dir[i]) / 5).roundToInt() * 5
                val txt = "${p.wind[i].roundToInt()} (${p.gust[i].roundToInt()}) km/h"
                img = "wind:$rot|${OpenMeteo.windColor(p.wind[i])}|$txt|$strong"
                if (st.getImage(img) == null) st.addImage(img, windBitmap(rot.toFloat(), OpenMeteo.windColor(p.wind[i]), txt, strong))
            } else {
                val ico = OpenMeteo.icon(p.code[i], p.day[i])
                val txt = "${p.temp[i].roundToInt()} °C"
                img = "wx:$ico|$txt|$strong"
                if (st.getImage(img) == null) st.addImage(img, bitmap(ico, txt, strong))
            }
            val rain = if (p.rain[i] >= 0.1) " · ${String.format(Locale.FRANCE, "%.1f", p.rain[i])} mm/h" else ""
            Feature.fromGeometry(Point.fromLngLat(p.lon, p.lat)).apply {
                addStringProperty("img", img)
                addStringProperty("info", "$label : ${OpenMeteo.text(p.code[i])}, ${p.temp[i].roundToInt()} °C, vent ${p.wind[i].roundToInt()} km/h " +
                    "${OpenMeteo.windArrow(p.dir[i])} (rafales ${p.gust[i].roundToInt()})$rain")
            }
        }
        st.getSourceAs<GeoJsonSource>(SRC)?.setGeoJson(FeatureCollection.fromFeatures(features))
    }

    /** Icône emoji avec, dessous, une pastille « 12° 25↗ » (rouge si rafales ≥ 60 km/h). */
    private fun bitmap(ico: String, txt: String, strong: Boolean): Bitmap {
        val d = activity.resources.displayMetrics.density
        val icoPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 46 * d; textAlign = Paint.Align.CENTER }
        val txtPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            textSize = 13 * d; textAlign = Paint.Align.CENTER; isFakeBoldText = true
            color = if (strong) Color.WHITE else Color.parseColor("#1D2421")
        }
        val icoH = 52 * d; val pillH = 18 * d
        val w = maxOf(icoPaint.measureText(ico), txtPaint.measureText(txt) + 8 * d) + 4 * d
        val bmp = Bitmap.createBitmap(w.toInt() + 2, (icoH + pillH + 2 * d).toInt() + 2, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val cx = bmp.width / 2f
        c.drawText(ico, cx, icoH - 6 * d, icoPaint)
        val pw = txtPaint.measureText(txt) + 8 * d
        val r = RectF(cx - pw / 2, icoH + d, cx + pw / 2, icoH + d + pillH)
        c.drawRoundRect(r, 6 * d, 6 * d, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor(if (strong) "#E4572E" else "#DDFFFFFF") })
        c.drawText(txt, cx, r.centerY() - (txtPaint.descent() + txtPaint.ascent()) / 2, txtPaint)
        return bmp
    }

    /** Flèche colorée (vers où va le vent) avec, dessous, « vitesse / rafales ». */
    private fun windBitmap(rotation: Float, color: Int, txt: String, strong: Boolean): Bitmap {
        val d = activity.resources.displayMetrics.density
        val txtPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            textSize = 13 * d; textAlign = Paint.Align.CENTER; isFakeBoldText = true
            this.color = if (strong) Color.WHITE else Color.parseColor("#1D2421")
        }
        val icoH = 46 * d; val pillH = 18 * d
        val w = maxOf(icoH, txtPaint.measureText(txt) + 8 * d) + 4 * d
        val bmp = Bitmap.createBitmap(w.toInt() + 2, (icoH + pillH + 2 * d).toInt() + 2, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val cx = bmp.width / 2f; val cy = icoH / 2
        // Flèche qui pointe vers le haut, tournée dans le sens du vent.
        val r = 19 * d
        val path = Path().apply {
            moveTo(0f, -r); lineTo(r * 0.7f, r * 0.35f); lineTo(0f, r * 0.05f); lineTo(-r * 0.7f, r * 0.35f); close()
        }
        c.save(); c.translate(cx, cy); c.rotate(rotation)
        c.drawPath(path, Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 3 * d; this.color = Color.WHITE; strokeJoin = Paint.Join.ROUND })
        c.drawPath(path, Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color })
        c.restore()
        val pw = txtPaint.measureText(txt) + 8 * d
        val rect = RectF(cx - pw / 2, icoH + d, cx + pw / 2, icoH + d + pillH)
        c.drawRoundRect(rect, 6 * d, 6 * d, Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = Color.parseColor(if (strong) "#E4572E" else "#DDFFFFFF") })
        c.drawText(txt, cx, rect.centerY() - (txtPaint.descent() + txtPaint.ascent()) / 2, txtPaint)
        return bmp
    }

    companion object {
        const val SRC = "wx-src"
        const val LAYER = "wx"
        private const val SRC_VEIL = "wx-veil-src"
        private const val LAYER_VEIL = "wx-veil"
        private const val SRC_CITIES = "wx-villes-src"
        private const val LAYER_CITIES = "wx-villes-"
    }
}
