package fr.assomoutain.proto

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.View
import android.widget.Button
import android.widget.SeekBar
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
import org.maplibre.android.style.layers.PropertyFactory.iconAllowOverlap
import org.maplibre.android.style.layers.PropertyFactory.iconIgnorePlacement
import org.maplibre.android.style.layers.PropertyFactory.iconImage
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.Point
import java.time.Instant
import java.time.ZoneId
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
) {
    private val bar: View = activity.findViewById(R.id.weatherBar)
    private val timeTxt: TextView = activity.findViewById(R.id.weatherTime)
    private val stateTxt: TextView = activity.findViewById(R.id.weatherState)
    private val msgTxt: TextView = activity.findViewById(R.id.weatherMsg)
    private val seek: SeekBar = activity.findViewById(R.id.weatherSeek)
    private val dayBtns = listOf(R.id.weatherDay0, R.id.weatherDay1, R.id.weatherDay2, R.id.weatherDay3).map { activity.findViewById<Button>(it) }

    var active = false; private set
    var onClose: (() -> Unit)? = null
    private var hours = OpenMeteo.sliderHours()
    private var idx = 0
    private var points: List<OpenMeteo.Forecast> = emptyList()
    private var job: Job? = null
    private var pendingMove: Job? = null
    private val onIdle = MapLibreMap.OnCameraIdleListener {
        pendingMove?.cancel()
        pendingMove = activity.lifecycleScope.launch { delay(600); refresh() }
    }

    init {
        activity.findViewById<Button>(R.id.weatherClose).setOnClickListener { onClose?.invoke() }
        activity.findViewById<Button>(R.id.weatherMinus).setOnClickListener { show((idx - 1).coerceAtLeast(0)) }
        activity.findViewById<Button>(R.id.weatherPlus).setOnClickListener { show((idx + 1).coerceAtMost(hours.size - 1)) }
        seek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar?, p: Int, fromUser: Boolean) { if (fromUser) show(p) }
            override fun onStartTrackingTouch(sb: SeekBar?) {}
            override fun onStopTrackingTouch(sb: SeekBar?) {}
        })
        dayBtns.forEachIndexed { d, b ->
            b.setOnClickListener {
                val day = hours[0].toLocalDate().plusDays(d.toLong())
                val first = hours.indexOfFirst { !it.toLocalDate().isBefore(day) }
                val noon = hours.indexOfFirst { it.toLocalDate() == day && it.hour == 12 }
                if (first >= 0) show(maxOf(first, noon))
            }
        }
    }

    fun start() {
        if (active) return
        active = true
        hours = OpenMeteo.sliderHours(); idx = 0
        seek.max = hours.size - 1
        placeBar()
        bar.visibility = View.VISIBLE
        dayBtns.forEachIndexed { d, b -> b.text = if (d == 0) "Auj." else hours[0].toLocalDate().plusDays(d.toLong()).format(DateTimeFormatter.ofPattern("EEE", Locale.FRANCE)) }
        ensureLayer()
        mapProvider()?.addOnCameraIdleListener(onIdle)
        show(0)
        refresh()
    }

    fun stop() {
        if (!active) return
        active = false
        bar.visibility = View.GONE
        mapProvider()?.removeOnCameraIdleListener(onIdle)
        pendingMove?.cancel(); job?.cancel()
        points = emptyList()
        mapProvider()?.style?.let { st -> st.removeLayer(LAYER); st.removeSource(SRC) }
    }

    /** Masqué en mode nature ou pendant un tracé. */
    fun setBarVisible(v: Boolean) { if (active) { placeBar(); bar.visibility = if (v) View.VISIBLE else View.GONE } }

    /** Sous le bandeau des ombres s'il est ouvert, sinon à sa place. */
    fun placeBar() {
        val d = activity.resources.displayMetrics.density
        (bar.layoutParams as? android.widget.FrameLayout.LayoutParams)?.let { lp -> lp.topMargin = ((if (below()) 236 else 64) * d).toInt(); bar.layoutParams = lp }
    }

    /** Le style est rechargé (changement de fond) : on remet la couche et les icônes. */
    fun onStyleLoaded() { if (active) { ensureLayer(); draw() } }

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

    private fun show(i: Int) {
        idx = i.coerceIn(0, hours.size - 1)
        seek.progress = idx
        timeTxt.text = OpenMeteo.hourLabel(hours[idx])
        val day = hours[idx].toLocalDate()
        dayBtns.forEachIndexed { d, b ->
            val on = hours[0].toLocalDate().plusDays(d.toLong()) == day
            b.backgroundTintList = if (on) android.content.res.ColorStateList.valueOf(Color.parseColor("#2F6F4F")) else null
            b.setTextColor(if (on) Color.WHITE else Color.parseColor("#1D2421"))
        }
        draw()
    }

    /** Une image par combinaison icône + texte (générée au besoin), posée en symbole sur chaque point. */
    private fun draw() {
        val st = mapProvider()?.style ?: return
        if (!active || st.getSource(SRC) == null) return
        val t = OpenMeteo.millis(hours[idx])
        val label = OpenMeteo.hourLabel(hours[idx])
        val features = points.mapNotNull { p ->
            val i = p.hourIndex(t)
            if (i < 0) return@mapNotNull null
            val ico = OpenMeteo.icon(p.code[i], p.day[i])
            val txt = "${p.temp[i].roundToInt()}° ${p.wind[i].roundToInt()}${OpenMeteo.windArrow(p.dir[i])}"
            val strong = p.gust[i] >= 60
            val img = "wx:$ico|$txt|$strong"
            if (st.getImage(img) == null) st.addImage(img, bitmap(ico, txt, strong))
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
        val icoPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 30 * d; textAlign = Paint.Align.CENTER }
        val txtPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            textSize = 11 * d; textAlign = Paint.Align.CENTER; isFakeBoldText = true
            color = if (strong) Color.WHITE else Color.parseColor("#1D2421")
        }
        val icoH = 34 * d; val pillH = 16 * d
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

    companion object {
        const val SRC = "wx-src"
        const val LAYER = "wx"
    }
}
