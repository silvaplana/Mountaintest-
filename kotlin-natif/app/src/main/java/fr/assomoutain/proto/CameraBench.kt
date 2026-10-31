package fr.assomoutain.proto

import android.util.Log
import java.util.Locale
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView

/**
 * Parcours caméra identique des deux côtés (section « Bench caméra » du scénario) :
 * 5 transitions de 3 s, jouées 2 fois = 30 s. On compte les images rendues par MapLibre
 * et l'intervalle entre deux images ; une image « en retard » dépasse 2 vsync (33,3 ms à 60 Hz).
 */
class CameraBench(private val mapView: MapView, private val map: MapLibreMap) :
    MapView.OnDidFinishRenderingFrameListener {

    private val keyframes = listOf(
        cam(43.180, 5.605, 12.0),
        cam(43.163, 5.597, 15.0), // Bec de l'Aigle
        cam(43.170, 5.588, 16.0), // Figuerolles
        cam(43.170, 5.588, 18.0), // sur-zoom
        cam(43.1745, 5.6075, 17.0), // port
        cam(43.180, 5.605, 12.0),
    )
    private val frameTimes = ArrayList<Long>(4000)
    private var running = false

    fun run(loops: Int = 2, onDone: (String) -> Unit) {
        map.moveCamera(CameraUpdateFactory.newCameraPosition(keyframes[0]))
        frameTimes.clear()
        running = true
        mapView.addOnDidFinishRenderingFrameListener(this)
        val steps = (0 until loops).flatMap { keyframes.drop(1) }
        fun next(i: Int) {
            if (i == steps.size) {
                running = false
                mapView.removeOnDidFinishRenderingFrameListener(this)
                onDone(report()); return
            }
            map.animateCamera(CameraUpdateFactory.newCameraPosition(steps[i]), 3000,
                object : MapLibreMap.CancelableCallback {
                    override fun onFinish() = next(i + 1)
                    override fun onCancel() = next(i + 1)
                })
        }
        next(0)
    }

    override fun onDidFinishRenderingFrame(fully: Boolean, frameEncodingTime: Double, frameRenderingTime: Double) {
        if (running) frameTimes += System.nanoTime()
    }

    private fun report(): String {
        val intervals = frameTimes.zipWithNext { a, b -> (b - a) / 1e6 }.sorted()
        if (intervals.isEmpty()) return "Aucune image"
        val durationS = (frameTimes.last() - frameTimes.first()) / 1e9
        val fps = intervals.size / durationS
        fun pct(p: Double) = intervals[((intervals.size - 1) * p).toInt()]
        val late = intervals.count { it > 33.3 }
        val json = """{"bench":"camera","frames":${frameTimes.size},"seconds":${f1(durationS)},""" +
            """"fps":${f1(fps)},"p50ms":${f1(pct(0.5))},"p95ms":${f1(pct(0.95))},""" +
            """"p99ms":${f1(pct(0.99))},"lateFrames":$late,"latePct":${f1(100.0 * late / intervals.size)}}"""
        Log.i(Scenario.BENCH_TAG, json)
        return json
    }

    private fun f1(v: Double) = String.format(Locale.US, "%.1f", v)

    private fun cam(lat: Double, lon: Double, zoom: Double) =
        CameraPosition.Builder().target(LatLng(lat, lon)).zoom(zoom).build()
}
