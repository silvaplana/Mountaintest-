package fr.assomoutain.proto

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** Rejoue la trace de référence (1 Hz) à vitesse x[speed] (10 ou 60), à travers les mêmes filtres que le vrai GPS. */
class GpxReplay(private val context: Context) {
    private var job: Job? = null
    val running get() = job?.isActive == true

    fun start(scope: CoroutineScope, mode: GpsMode, speed: Int = 10) {
        val fixes = parse()
        TrackRecorder.start("rejeu-x$speed", mode)
        job = scope.launch(Dispatchers.Default) {
            var prev: Long? = null
            for (f in fixes) {
                if (!isActive) break
                prev?.let { delay((f.timeMs - it) / speed) }
                prev = f.timeMs
                TrackRecorder.add(f)
            }
            TrackRecorder.finish()
        }
    }

    fun stop() { job?.cancel(); TrackRecorder.finish() }

    private fun parse(): List<Fix> = context.assets.open("la-ciotat-rando.gpx").use { parseGpx(it).points }
}
