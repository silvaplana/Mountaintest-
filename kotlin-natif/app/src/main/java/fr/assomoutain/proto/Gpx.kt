package fr.assomoutain.proto

import android.util.Xml
import org.xmlpull.v1.XmlPullParser
import java.io.InputStream
import java.time.Instant

data class GpxTrack(val name: String, val points: List<Fix>)

/** Lecture GPX (trkpt et rtept), tolérante : points sans heure ni altitude acceptés. */
fun parseGpx(input: InputStream): GpxTrack {
    val out = ArrayList<Fix>(4000)
    var name = ""
    val p = Xml.newPullParser()
    p.setInput(input, null)
    var lat = 0.0; var lon = 0.0; var ele: Double? = null; var time = 0L
    var text = ""
    var inPoint = false
    while (p.next() != XmlPullParser.END_DOCUMENT) {
        when (p.eventType) {
            XmlPullParser.START_TAG -> if (p.name == "trkpt" || p.name == "rtept") {
                lat = p.getAttributeValue(null, "lat").toDouble()
                lon = p.getAttributeValue(null, "lon").toDouble()
                ele = null; time = 0L; inPoint = true
            }
            XmlPullParser.TEXT -> text = p.text
            XmlPullParser.END_TAG -> when (p.name) {
                "ele" -> ele = text.trim().toDoubleOrNull()
                "time" -> if (inPoint) time = runCatching { Instant.parse(text.trim()).toEpochMilli() }.getOrDefault(0L)
                "name" -> if (name.isEmpty() && !inPoint) name = text.trim()
                "trkpt", "rtept" -> { out += Fix(lat, lon, ele, 5f, time); inPoint = false }
            }
        }
    }
    return GpxTrack(name.ifEmpty { "trace" }, out)
}

fun toGpx(points: List<Fix>, name: String = "Sortie"): String = buildString {
    append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
    append("<gpx version=\"1.1\" creator=\"assomoutain-kotlin\" xmlns=\"http://www.topografix.com/GPX/1/1\">")
    append("<trk><name>$name</name><trkseg>\n")
    for (p in points) {
        append("<trkpt lat=\"${p.lat}\" lon=\"${p.lon}\">")
        p.ele?.let { append("<ele>$it</ele>") }
        append("<time>${Instant.ofEpochMilli(p.timeMs)}</time></trkpt>\n")
    }
    append("</trkseg></trk></gpx>\n")
}

/** Distance et D+ d'une trace importée (même hystérésis de 10 m que l'enregistrement). */
fun trackStats(points: List<Fix>): Pair<Double, Double> {
    var d = 0.0; var gain = 0.0; var ref: Double? = null
    val out = FloatArray(1)
    points.zipWithNext { a, b ->
        android.location.Location.distanceBetween(a.lat, a.lon, b.lat, b.lon, out); d += out[0]
    }
    for (p in points) p.ele?.let { e ->
        val r = ref
        if (r == null) ref = e else if (e - r >= 10) { gain += e - r; ref = e } else if (r - e >= 10) ref = e
    }
    return d to gain
}
