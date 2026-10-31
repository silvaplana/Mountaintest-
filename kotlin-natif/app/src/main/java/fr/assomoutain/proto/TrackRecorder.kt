package fr.assomoutain.proto

import android.location.Location
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File
import java.time.Instant

data class Fix(val lat: Double, val lon: Double, val ele: Double?, val accuracyM: Float, val timeMs: Long)

data class TrackState(
    val recording: Boolean = false,
    val source: String = "",
    val points: List<Fix> = emptyList(),
    val received: Int = 0,
    val distanceM: Double = 0.0,
    val gainM: Double = 0.0,
    val stationary: Boolean = false,
)

/**
 * Point d'entrée unique des positions (vrai GPS ou rejeu GPX) : mêmes filtres des deux côtés,
 * pour que le nombre de points enregistrés soit comparable avec le prototype Capacitor.
 */
object TrackRecorder {
    private const val MAX_ACCURACY_M = 30f
    private const val GAIN_HYSTERESIS_M = 10.0

    private val _state = MutableStateFlow(TrackState())
    val state: StateFlow<TrackState> = _state.asStateFlow()

    private var mode = GpsMode.RANDO
    private var eleRef: Double? = null

    fun start(source: String, mode: GpsMode) {
        this.mode = mode
        eleRef = null
        _state.value = TrackState(recording = true, source = source)
    }

    fun setMode(mode: GpsMode) { this.mode = mode }

    fun setStationary(stationary: Boolean) {
        _state.value = _state.value.copy(stationary = stationary)
    }

    @Synchronized
    fun add(fix: Fix) {
        val s = _state.value
        if (!s.recording) return
        val received = s.received + 1
        val last = s.points.lastOrNull()
        if (fix.accuracyM > MAX_ACCURACY_M && last != null) {
            _state.value = s.copy(received = received); return
        }
        val step = if (last == null) 0.0 else distance(last, fix)
        if (last != null && (step < mode.minDistanceM || fix.timeMs - last.timeMs < mode.minIntervalMs)) {
            _state.value = s.copy(received = received); return
        }
        var gain = s.gainM
        fix.ele?.let { e ->
            val ref = eleRef
            if (ref == null) eleRef = e
            else if (e - ref >= GAIN_HYSTERESIS_M) { gain += e - ref; eleRef = e }
            else if (ref - e >= GAIN_HYSTERESIS_M) eleRef = e
        }
        _state.value = s.copy(points = s.points + fix, received = received, distanceM = s.distanceM + step, gainM = gain)
    }

    fun stop(dir: File): File? {
        val s = _state.value
        _state.value = s.copy(recording = false)
        if (s.points.isEmpty()) return null
        dir.mkdirs()
        val file = File(dir, "trace-${s.source}-${System.currentTimeMillis()}.gpx")
        file.bufferedWriter().use { w ->
            w.write("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
            w.write("<gpx version=\"1.1\" creator=\"assomoutain-kotlin\" xmlns=\"http://www.topografix.com/GPX/1/1\"><trk><trkseg>\n")
            for (p in s.points) {
                w.write("<trkpt lat=\"${p.lat}\" lon=\"${p.lon}\">")
                p.ele?.let { w.write("<ele>$it</ele>") }
                w.write("<time>${Instant.ofEpochMilli(p.timeMs)}</time></trkpt>\n")
            }
            w.write("</trkseg></trk></gpx>\n")
        }
        return file
    }

    private fun distance(a: Fix, b: Fix): Double {
        val out = FloatArray(1)
        Location.distanceBetween(a.lat, a.lon, b.lat, b.lon, out)
        return out[0].toDouble()
    }
}
