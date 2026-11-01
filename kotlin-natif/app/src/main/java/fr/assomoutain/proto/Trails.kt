package fr.assomoutain.proto

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.Locale
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Randos libres d'une zone : itinéraires balisés d'OpenStreetMap (relations route=hiking / foot), lus par
 * l'API Overpass, licence ODbL (libre en citant « © contributeurs OpenStreetMap »). Altitudes : service
 * d'altimétrie IGN (RGE ALTI, gratuit, sans clé). Mêmes serveurs, requête et règles que
 * src/trails/osmTrails.ts et src/trails/elevation.ts côté Capacitor.
 */
data class LonLat(val lon: Double, val lat: Double)

/** Zone : ouest, sud, est, nord (même ordre que Bbox côté Capacitor). */
data class Zone(val west: Double, val south: Double, val east: Double, val north: Double)

data class Trail(
    val id: Long,
    val name: String,
    val kind: String,
    val rank: Int,
    val color: String,
    val segments: List<List<LonLat>>,
    val distanceM: Double,
)

data class ElevatedTrail(val segments: List<List<Pair<LonLat, Double?>>>, val gainM: Double, val lossM: Double)

object Trails {
    const val OSM_ATTRIBUTION = "© contributeurs OpenStreetMap (licence ODbL)"
    /** Serveurs Overpass publics : le second sert de secours si le premier est saturé. */
    val OVERPASS_URLS = listOf("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter")
    /** Au-delà (environ 40 km de côté), la réponse serait trop lourde pour un téléphone. */
    const val MAX_ZONE_DEG = 0.4

    private const val URL_ALTI = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json"
    const val ALTI_CHUNK = 100
    const val MAX_SAMPLES = 1500
    const val DEM_THRESHOLD_M = 5.0

    private data class Kind(val kind: String, val rank: Int, val color: String)
    private val KINDS = mapOf(
        "iwn" to Kind("GR (international)", 0, "#d62828"),
        "nwn" to Kind("GR", 0, "#d62828"),
        "rwn" to Kind("GR de Pays / régional", 1, "#e67e00"),
        "lwn" to Kind("PR / local", 2, "#1d6fe0"),
    )
    private val OTHER = Kind("Sentier", 3, "#2f6f4f")

    fun zoneTooBig(z: Zone) = z.east - z.west > MAX_ZONE_DEG || z.north - z.south > MAX_ZONE_DEG

    /** Géométrie coupée à la zone agrandie d'une demi-zone de chaque côté : une boucle locale arrive entière, un GR de 500 km non. */
    fun overpassQuery(z: Zone): String {
        val dx = (z.east - z.west) / 2; val dy = (z.north - z.south) / 2
        fun f(v: Double) = String.format(Locale.US, "%.5f", v)
        return "[out:json][timeout:60];relation[\"type\"=\"route\"][\"route\"~\"^(hiking|foot)$\"](${f(z.south)},${f(z.west)},${f(z.north)},${f(z.east)});" +
            "out tags geom(${f(z.south - dy)},${f(z.west - dx)},${f(z.north + dy)},${f(z.east + dx)});"
    }

    fun distanceM(a: LonLat, b: LonLat): Double {
        val r = 6_371_000.0
        val dLat = Math.toRadians(b.lat - a.lat); val dLon = Math.toRadians(b.lon - a.lon)
        val h = sin(dLat / 2).let { it * it } + cos(Math.toRadians(a.lat)) * cos(Math.toRadians(b.lat)) * sin(dLon / 2).let { it * it }
        return 2 * r * asin(min(1.0, sqrt(h)))
    }

    private fun same(a: LonLat, b: LonLat) = abs(a.lat - b.lat) < 1e-7 && abs(a.lon - b.lon) < 1e-7

    /** Met bout à bout les chemins d'une relation (dans l'ordre des membres, en retournant ceux qui sont à l'envers). */
    fun assemble(ways: List<List<LonLat?>>): List<List<LonLat>> {
        val out = ArrayList<List<LonLat>>()
        var cur: ArrayList<LonLat>? = null
        var single = false
        for (way in ways) {
            // Un point absent (hors zone) coupe le chemin en morceaux.
            val runs = arrayListOf(ArrayList<LonLat>())
            for (p in way) if (p != null) runs.last().add(p) else runs.add(ArrayList())
            for (run in runs) {
                if (run.size < 2) continue
                val c = cur
                if (c == null) { cur = ArrayList(run); single = true; continue }
                val end = c.last()
                when {
                    same(end, run.first()) -> c.addAll(run.drop(1))
                    same(end, run.last()) -> c.addAll(run.dropLast(1).reversed())
                    single && same(c.first(), run.first()) -> { c.reverse(); c.addAll(run.drop(1)) }
                    single && same(c.first(), run.last()) -> { c.reverse(); c.addAll(run.dropLast(1).reversed()) }
                    else -> { out.add(c); cur = ArrayList(run); single = true; continue }
                }
                single = false
            }
        }
        cur?.let { out.add(it) }
        return out
    }

    fun lengthM(segments: List<List<LonLat>>) = segments.sumOf { s -> s.zipWithNext { a, b -> distanceM(a, b) }.sum() }

    fun parseOverpass(json: String): List<Trail> {
        val elements = JSONObject(json).optJSONArray("elements") ?: return emptyList()
        val trails = ArrayList<Trail>()
        for (i in 0 until elements.length()) {
            val el = elements.getJSONObject(i)
            if (el.optString("type") != "relation") continue
            val tags = el.optJSONObject("tags") ?: JSONObject()
            val members = el.optJSONArray("members") ?: JSONArray()
            val ways = (0 until members.length()).mapNotNull { k ->
                val m = members.getJSONObject(k)
                val g = m.optJSONArray("geometry")
                if (m.optString("type") != "way" || g == null) null
                else (0 until g.length()).map { j ->
                    val pt = g.optJSONObject(j)
                    if (pt == null || !pt.has("lat") || !pt.has("lon")) null else LonLat(pt.getDouble("lon"), pt.getDouble("lat"))
                }
            }
            val segments = assemble(ways)
            if (segments.isEmpty()) continue
            val k = KINDS[tags.optString("network")] ?: OTHER
            val ref = tags.optString("ref").trim()
            val base = tags.optString("name").trim().ifEmpty { tags.optString("name:fr").trim() }
            val id = el.getLong("id")
            val name = when {
                base.isNotEmpty() -> if (ref.isNotEmpty() && !base.contains(ref)) "$ref – $base" else base
                ref.isNotEmpty() -> ref
                else -> "Itinéraire OSM $id"
            }
            trails += Trail(id, name, k.kind, k.rank, k.color, segments, lengthM(segments))
        }
        val collator = java.text.Collator.getInstance(Locale.FRENCH)
        return trails.sortedWith(compareBy<Trail> { it.rank }.thenComparator { a, b -> collator.compare(a.name, b.name) })
    }

    /** Appel réseau : à lancer hors du fil principal. */
    fun fetchTrails(z: Zone): List<Trail> {
        val body = "data=" + URLEncoder.encode(overpassQuery(z), "UTF-8")
        var last: Exception? = null
        for (url in OVERPASS_URLS) {
            try {
                val c = URL(url).openConnection() as HttpURLConnection
                c.requestMethod = "POST"; c.doOutput = true
                c.connectTimeout = 15_000; c.readTimeout = 90_000
                c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
                c.setRequestProperty("User-Agent", "Assomountain-proto (Android)")
                c.outputStream.use { it.write(body.toByteArray()) }
                if (c.responseCode != 200) error("HTTP ${c.responseCode}")
                return parseOverpass(c.inputStream.bufferedReader().use { it.readText() })
            } catch (e: Exception) { last = e }
        }
        throw last ?: IllegalStateException("aucun serveur")
    }

    // ---------- Altitudes ----------

    /** Indices des points à interroger dans chaque segment (premier et dernier toujours compris). */
    fun sampleIndices(segments: List<List<LonLat>>, totalM: Double): List<List<Int>> {
        val step = max(10.0, totalM / MAX_SAMPLES)
        return segments.map { seg ->
            val idx = arrayListOf(0)
            var acc = 0.0
            for (i in 1 until seg.size) {
                acc += distanceM(seg[i - 1], seg[i])
                if (acc >= step || i == seg.size - 1) { idx.add(i); acc = 0.0 }
            }
            idx
        }
    }

    /** Altitudes de tous les points, par interpolation le long du chemin entre les points interrogés. */
    fun interpolate(seg: List<LonLat>, idx: List<Int>, z: List<Double?>): List<Double?> {
        val out = MutableList<Double?>(seg.size) { null }
        idx.forEachIndexed { k, i -> out[i] = z[k] }
        for (k in 1 until idx.size) {
            val a = idx[k - 1]; val b = idx[k]; val za = z[k - 1]; val zb = z[k]
            if (za == null || zb == null || b - a < 2) continue
            var total = 0.0
            for (i in a + 1..b) total += distanceM(seg[i - 1], seg[i])
            var acc = 0.0
            for (i in a + 1 until b) {
                acc += distanceM(seg[i - 1], seg[i])
                out[i] = za + (zb - za) * (if (total > 0) acc / total else 0.0)
            }
        }
        return out
    }

    /** D+ et D− avec hystérésis (même règle que l'enregistrement, seuil 5 m sur le modèle de terrain). */
    fun gainLoss(zs: List<Double?>, threshold: Double = DEM_THRESHOLD_M): Pair<Double, Double> {
        var gain = 0.0; var loss = 0.0; var ref: Double? = null
        for (z in zs) {
            if (z == null) continue
            val r = ref
            if (r == null) ref = z
            else if (z - r >= threshold) { gain += z - r; ref = z }
            else if (r - z >= threshold) { loss += r - z; ref = z }
        }
        return gain to loss
    }

    /** Réponse IGN : { elevations: [z…] } (zonly) ou { elevations: [{ z }…] } ; −99999 = pas de donnée. */
    fun parseElevations(json: String): List<Double?> {
        val a = JSONObject(json).optJSONArray("elevations") ?: return emptyList()
        return (0 until a.length()).map { i ->
            val z = when (val e = a.get(i)) {
                is Number -> e.toDouble()
                is JSONObject -> if (e.has("z")) e.getDouble("z") else null
                else -> null
            }
            if (z != null && z > -1000) z else null
        }
    }

    private fun fetchChunk(pts: List<LonLat>): List<Double?> {
        fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
        val lon = pts.joinToString("|") { String.format(Locale.US, "%.6f", it.lon) }
        val lat = pts.joinToString("|") { String.format(Locale.US, "%.6f", it.lat) }
        val url = URL("$URL_ALTI?lon=${enc(lon)}&lat=${enc(lat)}&resource=ign_rge_alti_wld&delimiter=${enc("|")}&indent=false&measures=false&zonly=true")
        val c = url.openConnection() as HttpURLConnection
        c.connectTimeout = 15_000; c.readTimeout = 30_000
        if (c.responseCode != 200) error("altitudes HTTP ${c.responseCode}")
        val z = parseElevations(c.inputStream.bufferedReader().use { it.readText() })
        return pts.indices.map { z.getOrNull(it) }
    }

    /** Appel réseau : à lancer hors du fil principal. */
    fun elevate(t: Trail): ElevatedTrail {
        val idx = sampleIndices(t.segments, t.distanceM)
        val pts = t.segments.flatMapIndexed { s, seg -> idx[s].map { seg[it] } }
        val zs = ArrayList<Double?>()
        for (i in pts.indices step ALTI_CHUNK) zs += fetchChunk(pts.subList(i, min(i + ALTI_CHUNK, pts.size)))
        var k = 0
        val segments = t.segments.mapIndexed { s, seg ->
            val z = idx[s].map { zs[k++] }
            val all = interpolate(seg, idx[s], z)
            seg.mapIndexed { i, p -> p to all[i] }
        }
        val (gain, loss) = gainLoss(zs)
        return ElevatedTrail(segments, gain, loss)
    }

    private fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")

    /** GPX d'une rando OSM : un segment par morceau continu, source et licence dans les métadonnées. */
    fun toGpx(t: Trail, segments: List<List<Pair<LonLat, Double?>>>): String = buildString {
        append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
        append("<gpx version=\"1.1\" creator=\"assomoutain-kotlin\" xmlns=\"http://www.topografix.com/GPX/1/1\">\n")
        append("  <metadata>\n    <name>${esc(t.name)}</name>\n")
        append("    <copyright author=\"OpenStreetMap contributors\"><license>https://opendatacommons.org/licenses/odbl/</license></copyright>\n")
        append("    <link href=\"https://www.openstreetmap.org/relation/${t.id}\"><text>${esc(OSM_ATTRIBUTION)}</text></link>\n")
        append("  </metadata>\n  <trk>\n    <name>${esc(t.name)}</name>\n")
        for (seg in segments) {
            append("    <trkseg>\n")
            for ((p, ele) in seg) {
                append(String.format(Locale.US, "      <trkpt lat=\"%.6f\" lon=\"%.6f\">", p.lat, p.lon))
                ele?.let { append(String.format(Locale.US, "<ele>%.1f</ele>", it)) }
                append("</trkpt>\n")
            }
            append("    </trkseg>\n")
        }
        append("  </trk>\n</gpx>\n")
    }
}
