package fr.assomoutain.proto

import android.app.DatePickerDialog
import android.graphics.Bitmap
import android.os.SystemClock
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
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngQuad
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.style.layers.PropertyFactory.rasterFadeDuration
import org.maplibre.android.style.layers.RasterLayer
import org.maplibre.android.style.sources.ImageSource
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

/**
 * Film des ombres du relief, de 8 h à midi toutes les 30 min, calculé sur le téléphone
 * (relief IGN gardé sur le disque) et affiché par-dessus la carte avec l'heure en gros.
 * Même fonctionnement que capacitor/src/ShadeFilm.tsx.
 */
class ShadeFilm(
    private val activity: AppCompatActivity,
    private val mapProvider: () -> MapLibreMap?,
    /** Couche sous laquelle placer les ombres (forêts, tracés au-dessus). */
    private val belowLayer: String,
) {
    /** bits : ombre maille par maille (ShadeCalc.pack), null la nuit. */
    private class Frame(val time: LocalDateTime, val sun: SunPos, val bits: ByteArray?)

    private val bar: View = activity.findViewById(R.id.shadeBar)
    private val timeTxt: TextView = activity.findViewById(R.id.shadeTime)
    private val sunTxt: TextView = activity.findViewById(R.id.shadeSun)
    private val msgTxt: TextView = activity.findViewById(R.id.shadeMsg)
    private val play: Button = activity.findViewById(R.id.shadePlay)
    private val seek: SeekBar = activity.findViewById(R.id.shadeSeek)
    private val dateBtn: Button = activity.findViewById(R.id.shadeDate)

    var active = false; private set
    var onClose: (() -> Unit)? = null
    private var day: LocalDate = LocalDate.now()
    private var grid: Dem.Grid? = null
    private var frames: List<Frame> = emptyList()
    private var idx = 0
    private var gridJob: Job? = null
    private var filmJob: Job? = null
    private var playJob: Job? = null
    private var bitmap: Bitmap? = null
    private var pixels = IntArray(0)
    private var shownKey = ""
    private var pendingMove: Job? = null
    private val onIdle = MapLibreMap.OnCameraIdleListener {
        pendingMove?.cancel()
        pendingMove = activity.lifecycleScope.launch { delay(700); refreshGrid() }
    }

    init {
        activity.findViewById<Button>(R.id.shadeClose).setOnClickListener { onClose?.invoke() }
        play.setOnClickListener { if (playJob != null) stopPlaying() else startPlaying() }
        // − / + : une image, soit 30 min.
        activity.findViewById<Button>(R.id.shadeMinus).setOnClickListener {
            if (frames.isNotEmpty()) { stopPlaying(); show((minOf(idx, frames.size - 1) - 1).coerceAtLeast(0)) }
        }
        activity.findViewById<Button>(R.id.shadePlus).setOnClickListener {
            if (frames.isNotEmpty()) { stopPlaying(); show((idx + 1).coerceAtMost(frames.size - 1)) }
        }
        seek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar?, p: Int, fromUser: Boolean) { if (fromUser) { stopPlaying(); show(p) } }
            override fun onStartTrackingTouch(sb: SeekBar?) {}
            override fun onStopTrackingTouch(sb: SeekBar?) {}
        })
        dateBtn.setOnClickListener {
            DatePickerDialog(activity, { _, y, m, d -> day = LocalDate.of(y, m + 1, d); refreshDate(); computeFilm() },
                day.year, day.monthValue - 1, day.dayOfMonth).show()
        }
        refreshDate()
    }

    private fun refreshDate() { dateBtn.text = day.format(DateTimeFormatter.ofPattern("d MMM yyyy", Locale.FRANCE)) }

    fun start() {
        if (active) return
        active = true
        bar.visibility = View.VISIBLE
        mapProvider()?.addOnCameraIdleListener(onIdle)
        refreshGrid()
    }

    fun stop() {
        if (!active) return
        active = false
        bar.visibility = View.GONE
        mapProvider()?.removeOnCameraIdleListener(onIdle)
        pendingMove?.cancel(); gridJob?.cancel(); filmJob?.cancel(); stopPlaying()
        mapProvider()?.style?.let { st -> st.removeLayer(LAYER); st.removeSource(SRC) }
        grid = null; frames = emptyList(); bitmap = null; pixels = IntArray(0); shownKey = ""
    }

    /** Masqué en mode nature ou pendant un tracé ; le film continue. */
    fun setBarVisible(v: Boolean) { if (active) bar.visibility = if (v) View.VISIBLE else View.GONE }

    /** Le style est rechargé (changement de fond) : on remet l'image courante. */
    fun onStyleLoaded() { shownKey = ""; if (active) show(idx) }

    private fun msg(t: String) { msgTxt.text = t; msgTxt.visibility = if (t.isEmpty()) View.GONE else View.VISIBLE }

    private fun refreshGrid() {
        val m = mapProvider() ?: return
        if (!active) return
        val b = m.projection.visibleRegion.latLngBounds
        val need = Dem.gridFor(b.longitudeWest, b.latitudeSouth, b.longitudeEast, b.latitudeNorth, m.cameraPosition.zoom)
        val cur = grid
        if (cur != null && Dem.covers(cur.spec, need)) return
        gridJob?.cancel()
        msg("Relief : chargement…")
        gridJob = activity.lifecycleScope.launch {
            val g = Dem.loadGrid(activity, need) { d, t -> activity.runOnUiThread { if (active) msg("Relief : $d/$t tuiles") } }
            if (!isActive || !active) return@launch
            if (g.missing == need.nx * need.ny) { msg("Relief indisponible ici (hors ligne ? télécharge la zone d'abord)."); return@launch }
            grid = g
            computeFilm()
        }
    }

    private fun computeFilm() {
        val g = grid ?: return
        filmJob?.cancel()
        filmJob = activity.lifecycleScope.launch {
            val t0 = SystemClock.elapsedRealtime()
            val b = Dem.bbox(g.spec)
            val lat = (b[1] + b[3]) / 2; val lon = (b[0] + b[2]) / 2
            val cell = Dem.cellMeters(g.spec)
            val made = ArrayList<Frame>()
            val times = Film.times(day)
            // Les images arrivent une à une : le film se regarde pendant le calcul.
            frames = emptyList(); shownKey = ""
            val target = Film.startIndex(day)
            idx = 0
            for ((i, t) in times.withIndex()) {
                msg("Ombres : ${i + 1}/${times.size}")
                val f = withContext(Dispatchers.Default) {
                    val sun = Sun.position(Film.epochMs(t), lat, lon)
                    if (sun.altitude <= 0) Frame(t, sun, null)
                    else Frame(t, sun, ShadeCalc.pack(ShadeCalc.compute(g.dem, g.spec.w, g.spec.h, cell, sun.azimuth, sun.altitude)))
                }
                if (!isActive) return@launch
                made += f
                frames = made.toList()
                seek.max = (made.size - 1).coerceAtLeast(0)
                // Jusqu'à l'heure de départ (maintenant, ou 8 h un autre jour), on suit le calcul.
                if (playJob == null && i <= target) show(i)
            }
            val s = (SystemClock.elapsedRealtime() - t0) / 100 / 10.0
            msg(if (g.missing > 0) "${g.missing} tuile(s) de relief manquante(s) : ombres incomplètes."
                else "Calculé en ${s.toString().replace('.', ',')} s sur le téléphone.")
        }
    }

    private fun show(i: Int) {
        val f = frames.getOrNull(i) ?: return
        val g = grid ?: return
        idx = i
        seek.progress = i
        timeTxt.text = f.time.format(DateTimeFormatter.ofPattern("HH:mm"))
        sunTxt.text = if (f.sun.altitude > 0)
            "☀ ${f.sun.altitude.roundToInt()}° · ${Sun.compass(f.sun.azimuth)} (${f.sun.azimuth.roundToInt()}°)"
            else "☾ soleil couché"
        val key = "${g.spec}|${f.time}"
        if (key == shownKey) return
        val style = mapProvider()?.style ?: return
        if (!style.isFullyLoaded) return
        val w = g.spec.w; val h = g.spec.h
        if (pixels.size != w * h) pixels = IntArray(w * h)
        ShadeCalc.pixels(f.bits, pixels)
        val bmp = bitmap?.takeIf { it.width == w && it.height == h } ?: Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        bmp.setPixels(pixels, 0, w, 0, 0, w, h)
        bitmap = bmp
        val b = Dem.bbox(g.spec)
        val quad = LatLngQuad(LatLng(b[3], b[0]), LatLng(b[3], b[2]), LatLng(b[1], b[2]), LatLng(b[1], b[0]))
        val src = style.getSourceAs<ImageSource>(SRC)
        if (src == null) {
            style.addSource(ImageSource(SRC, quad, bmp))
            val layer = RasterLayer(LAYER, SRC).withProperties(rasterFadeDuration(0f))
            if (style.getLayer(belowLayer) != null) style.addLayerBelow(layer, belowLayer) else style.addLayer(layer)
        } else {
            src.setCoordinates(quad)
            src.setImage(bmp)
        }
        shownKey = key
    }

    private fun startPlaying() {
        if (frames.size < 2) return
        play.text = "⏸"
        playJob = activity.lifecycleScope.launch {
            while (isActive) {
                delay(FRAME_MS)
                show((idx + 1) % frames.size)
            }
        }
    }

    private fun stopPlaying() { playJob?.cancel(); playJob = null; play.text = "▶" }

    companion object {
        private const val SRC = "shade-src"
        private const val LAYER = "shade"
        private const val FRAME_MS = 900L
    }
}
