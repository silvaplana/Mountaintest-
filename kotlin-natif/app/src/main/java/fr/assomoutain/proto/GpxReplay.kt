package fr.assomoutain.proto

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.xmlpull.v1.XmlPullParser
import android.util.Xml
import java.time.Instant

/** Rejoue la trace de référence (1 Hz) à vitesse x[speed], à travers les mêmes filtres que le vrai GPS. */
class GpxReplay(private val context: Context) {
    private var job: Job? = null
    val running get() = job?.isActive == true

    fun start(scope: CoroutineScope, mode: GpsMode, speed: Int = 10) {
        val fixes = parse()
        TrackRecorder.start("rejeu", mode)
        job = scope.launch(Dispatchers.Default) {
            var prev: Long? = null
            for (f in fixes) {
                if (!isActive) break
                prev?.let { delay((f.timeMs - it) / speed) }
                prev = f.timeMs
                TrackRecorder.add(f)
            }
        }
    }

    fun stop() { job?.cancel() }

    private fun parse(): List<Fix> {
        val out = ArrayList<Fix>(4000)
        context.assets.open("la-ciotat-rando.gpx").use { input ->
            val p = Xml.newPullParser()
            p.setInput(input, "UTF-8")
            var lat = 0.0; var lon = 0.0; var ele: Double? = null; var time = 0L
            var text = ""
            while (p.next() != XmlPullParser.END_DOCUMENT) {
                when (p.eventType) {
                    XmlPullParser.START_TAG -> if (p.name == "trkpt") {
                        lat = p.getAttributeValue(null, "lat").toDouble()
                        lon = p.getAttributeValue(null, "lon").toDouble()
                        ele = null
                    }
                    XmlPullParser.TEXT -> text = p.text
                    XmlPullParser.END_TAG -> when (p.name) {
                        "ele" -> ele = text.toDoubleOrNull()
                        "time" -> time = Instant.parse(text.trim()).toEpochMilli()
                        "trkpt" -> out += Fix(lat, lon, ele, 5f, time)
                    }
                }
            }
        }
        return out
    }
}
