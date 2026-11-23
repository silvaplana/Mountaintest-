package fr.assomoutain.proto

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.atan
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.roundToLong
import kotlin.math.tan

/**
 * 🥾 / 🚵 Itinéraires Camptocamp (camptocamp.org, contenu sous licence CC BY-SA) : API ouverte, sans clé.
 * Contrairement aux sorties ski (où la date compte, à cause de la neige), en rando et en VTT on veut TOUS
 * les itinéraires de l'écran, sans limite de date, du plus proche au plus loin. Même code que src/topos/c2c.ts.
 */
object Camptocamp {
    const val API = "https://api.camptocamp.org"
    const val ATTRIBUTION = "© contributeurs Camptocamp (CC BY-SA)"
    /** Itinéraires dessinés sur la carte (façon Komoot) : les plus proches seulement. */
    const val MAP_LINES = 40

    data class Route(val id: Long, val title: String, val summary: String, val lon: Double, val lat: Double, val rating: String,
                     val heightUpM: Int?, val elevMaxM: Int?, val lengthM: Double?, val durations: List<String>)
    class Sheet(val route: Route, val description: String, val line: List<LonLat>)

    private const val R = 6378137.0
    fun toMercator(lon: Double, lat: Double) = Pair(R * Math.toRadians(lon), R * ln(tan(Math.PI / 4 + Math.toRadians(lat) / 2)))
    fun fromMercator(x: Double, y: Double) = LonLat(Math.toDegrees(x / R), Math.toDegrees(2 * atan(exp(y / R)) - Math.PI / 2))

    /** act : « hiking » ou « mountain_biking ». Cadre en lon/lat : ouest, sud, est, nord. */
    fun routesUrl(z: Zone, act: String, offset: Int = 0): String {
        val (x1, y1) = toMercator(z.west, z.south); val (x2, y2) = toMercator(z.east, z.north)
        return "$API/routes?bbox=${x1.roundToLong()},${y1.roundToLong()},${x2.roundToLong()},${y2.roundToLong()}&act=$act&pl=fr&limit=100&offset=$offset"
    }

    /** Texte Camptocamp (markdown léger, balises [[lien|texte]]) en texte simple. */
    fun plainText(s: String?): String = (s ?: "")
        .replace(Regex("\\[\\[[^|\\]]*\\|([^\\]]*)\\]\\]"), "$1")
        .replace(Regex("\\[\\[([^\\]]*)\\]\\]"), "$1")
        .replace(Regex("\\[(/)?[a-zA-Z0-9_]+(=[^\\]]*)?\\]"), "")
        .replace(Regex("(?m)^#+\\s*"), "")
        .replace(Regex("\\*\\*([^*]+)\\*\\*"), "$1")
        .replace("\r", "")
        .replace(Regex("\n{3,}"), "\n\n")
        .trim()

    private fun locale(d: JSONObject): JSONObject {
        val ls = d.optJSONArray("locales") ?: return JSONObject()
        for (i in 0 until ls.length()) ls.optJSONObject(i)?.let { if (it.optString("lang") == "fr") return it }
        return ls.optJSONObject(0) ?: JSONObject()
    }
    private fun JSONObject.str(k: String) = if (isNull(k)) "" else optString(k)
    private fun JSONObject.int(k: String) = if (isNull(k) || !has(k)) null else optInt(k)

    fun parseRoute(d: JSONObject): Route? {
        val g = runCatching { JSONObject(d.optJSONObject("geometry")?.str("geom") ?: "").getJSONArray("coordinates") }.getOrNull() ?: return null
        val p = fromMercator(g.getDouble(0), g.getDouble(1))
        val l = locale(d)
        val id = d.getLong("document_id")
        val title = listOf(l.str("title_prefix"), l.str("title")).filter { it.isNotEmpty() }.joinToString(" : ").ifEmpty { "Itinéraire $id" }
        val rating = d.str("hiking_rating").ifEmpty { listOf(d.str("mtb_up_rating"), d.str("mtb_down_rating")).filter { it.isNotEmpty() }.joinToString(" / ") }
        val dur = d.optJSONArray("durations")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList()
        return Route(id, title, plainText(l.str("summary")), p.lon, p.lat, rating, d.int("height_diff_up"), d.int("elevation_max"),
            d.int("route_length")?.toDouble(), dur)
    }

    /** Tracé (LineString ou MultiLineString), bout à bout. */
    fun parseLine(geomDetail: String?): List<LonLat> = runCatching {
        val g = JSONObject(geomDetail ?: return emptyList())
        val c = g.getJSONArray("coordinates")
        val lines = if (g.optString("type") == "MultiLineString") (0 until c.length()).map { c.getJSONArray(it) } else listOf(c)
        lines.flatMap { a -> (0 until a.length()).map { a.getJSONArray(it).let { p -> fromMercator(p.getDouble(0), p.getDouble(1)) } } }
    }.getOrDefault(emptyList())

    fun parseSheet(d: JSONObject): Sheet? {
        val r = parseRoute(d) ?: return null
        return Sheet(r, plainText(locale(d).str("description")), parseLine(d.optJSONObject("geometry")?.str("geom_detail")))
    }

    /** Itinéraires triés du plus proche au plus loin d'un point. */
    fun byDistance(routes: List<Route>, from: LonLat) = routes.map { it to Trails.distanceM(from, LonLat(it.lon, it.lat)) }.sortedBy { it.second }

    private fun get(url: String): String {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 15_000; c.readTimeout = 30_000
        c.setRequestProperty("Accept", "application/json")
        c.setRequestProperty("User-Agent", "Assomountain-proto (Android)")
        if (c.responseCode != 200) error("HTTP ${c.responseCode}")
        return c.inputStream.bufferedReader().use { it.readText() }
    }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("camptocamp", Context.MODE_PRIVATE)

    /** Tous les itinéraires du cadre (au plus 300). Réseau : hors du fil principal. La liste est gardée (hors ligne). */
    fun fetchRoutes(ctx: Context, z: Zone, act: String): List<Route> {
        val out = ArrayList<Route>(); val raw = JSONArray()
        var offset = 0
        while (offset < 300) {
            val j = JSONObject(get(routesUrl(z, act, offset)))
            val docs = j.optJSONArray("documents") ?: JSONArray()
            for (i in 0 until docs.length()) docs.optJSONObject(i)?.let { d -> parseRoute(d)?.let { out += it; raw.put(d) } }
            if (docs.length() == 0 || offset + 100 >= j.optInt("total")) break
            offset += 100
        }
        prefs(ctx).edit().putString("liste:$act", raw.toString()).apply()
        return out
    }

    /** Dernière liste chargée (hors ligne). */
    fun savedRoutes(ctx: Context, act: String): List<Route>? = runCatching {
        val a = JSONArray(prefs(ctx).getString("liste:$act", null) ?: return null)
        (0 until a.length()).mapNotNull { parseRoute(a.getJSONObject(it)) }
    }.getOrNull()

    fun savedSheet(ctx: Context, id: Long): Sheet? = runCatching {
        parseSheet(JSONObject(prefs(ctx).getString("fiche:$id", null) ?: return null))
    }.getOrNull()

    /** Fiche d'un itinéraire, gardée sur le téléphone (lisible hors ligne ensuite). Réseau : hors du fil principal. */
    fun fetchSheet(ctx: Context, id: Long): Sheet {
        return try {
            val txt = get("$API/routes/$id?l=fr")
            val s = parseSheet(JSONObject(txt)) ?: error("fiche vide")
            prefs(ctx).edit().putString("fiche:$id", txt).apply()
            s
        } catch (e: Exception) { savedSheet(ctx, id) ?: throw e }
    }

    fun link(id: Long) = "https://www.camptocamp.org/routes/$id/fr"

    fun km(m: Double) = String.format(java.util.Locale.FRANCE, "%.1f km", m / 1000)

    fun formatDurations(d: List<String>): String {
        val n = d.mapNotNull { it.toIntOrNull() }
        if (n.isEmpty()) return ""
        val lo = n.min(); val hi = n.max()
        fun j(v: Int) = "$v jour" + if (v > 1) "s" else ""
        return if (lo == hi) j(lo) else "$lo à ${j(hi)}"
    }

    /** Ligne d'infos : cotation, dénivelé, longueur, altitude max, durée. */
    fun info(r: Route) = listOf(r.rating, r.heightUpM?.let { "D+ $it m" } ?: "", r.lengthM?.takeIf { it > 0 }?.let { km(it) } ?: "",
        r.elevMaxM?.let { "$it m max" } ?: "", formatDurations(r.durations)).filter { it.isNotEmpty() }.joinToString(" · ")
}
