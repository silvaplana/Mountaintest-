package fr.assomoutain.proto

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Météo posée sur la carte : prévisions des modèles Météo-France (AROME France HD 1,5 km jusqu'à 2 jours,
 * puis ARPEGE jusqu'à 4 jours) redistribuées par Open-Meteo (sans clé, gratuit en usage non commercial,
 * données CC BY 4.0, 10 000 appels par jour). Même code côté Capacitor (src/weather/openMeteo.ts).
 */
object OpenMeteo {
    private const val URL_BASE = "https://api.open-meteo.com/v1/forecast"
    const val ATTRIBUTION = "Météo-France (AROME, ARPEGE) via Open-Meteo"
    /** Jours de prévision demandés (AROME couvre 2 jours, ARPEGE prend le relais). */
    const val DAYS = 4
    /** Au-delà, on redemande au serveur (les modèles sortent toutes les 3 h). */
    const val FRESH_MS = 60L * 60 * 1000
    /** Nombre maximal de points demandés d'un coup (une seule requête). */
    const val MAX_POINTS = 30
    private const val CACHE_MAX = 200

    data class Pt(val lat: Double, val lon: Double) { val key get() = String.format(Locale.ROOT, "%.4f,%.4f", lat, lon) }

    /** Prévision horaire en un point : une case par heure à partir de `start` (ms). */
    class Forecast(val lat: Double, val lon: Double, val start: Long, val fetched: Long,
                   val code: IntArray, val temp: DoubleArray, val wind: DoubleArray, val gust: DoubleArray,
                   val dir: DoubleArray, val day: BooleanArray, val rain: DoubleArray) {
        val key get() = Pt(lat, lon).key
        /** Index de l'heure `t` (ms), −1 hors plage. */
        fun hourIndex(t: Long): Int { val i = ((t - start) / 3_600_000L).toInt(); return if (i in code.indices) i else -1 }
        fun toJson(): JSONObject = JSONObject().put("lat", lat).put("lon", lon).put("start", start).put("fetched", fetched)
            .put("code", JSONArray(code.toList())).put("temp", JSONArray(temp.toList())).put("wind", JSONArray(wind.toList()))
            .put("gust", JSONArray(gust.toList())).put("dir", JSONArray(dir.toList())).put("day", JSONArray(day.toList())).put("rain", JSONArray(rain.toList()))
        companion object {
            fun fromJson(o: JSONObject): Forecast {
                fun d(k: String) = o.getJSONArray(k).let { a -> DoubleArray(a.length()) { a.optDouble(it, 0.0) } }
                val c = o.getJSONArray("code"); val dy = o.getJSONArray("day")
                return Forecast(o.getDouble("lat"), o.getDouble("lon"), o.getLong("start"), o.getLong("fetched"),
                    IntArray(c.length()) { c.optInt(it) }, d("temp"), d("wind"), d("gust"), d("dir"), BooleanArray(dy.length()) { dy.optBoolean(it) }, d("rain"))
            }
        }
    }

    private val STEPS = doubleArrayOf(0.02, 0.05, 0.1, 0.2, 0.5, 1.0, 2.0, 4.0)
    /** Pas de la grille (degrés) : environ 4 colonnes d'icônes à l'écran, jamais plus fin que 2 km. */
    fun gridStep(w: Double, s: Double, e: Double, n: Double): Double {
        val want = max(e - w, (n - s) * 0.75) / 4
        return STEPS.firstOrNull { it >= want } ?: STEPS.last()
    }

    /** Points de la grille, alignés sur des multiples du pas (stables quand on fait glisser la carte). */
    fun gridPoints(w: Double, s: Double, e: Double, n: Double): List<Pt> {
        val step = gridStep(w, s, e, n)
        fun r(v: Double) = (v * 1e4).roundToInt() / 1e4
        val out = ArrayList<Pt>()
        var lat = ceil(s / step) * step
        while (lat <= n + 1e-9 && out.size < MAX_POINTS * 4) {
            var lon = ceil(w / step) * step
            while (lon <= e + 1e-9) { out.add(Pt(r(lat), r(lon))); lon += step }
            lat += step
        }
        if (out.size > MAX_POINTS) {
            val cx = (w + e) / 2; val cy = (s + n) / 2
            out.sortBy { hypot(it.lon - cx, (it.lat - cy) / 0.75) }
            return out.take(MAX_POINTS)
        }
        return out
    }

    fun forecastUrl(points: List<Pt>): String {
        val q = listOf(
            "latitude" to points.joinToString(",") { it.lat.toString() }, "longitude" to points.joinToString(",") { it.lon.toString() },
            "hourly" to "weather_code,temperature_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,is_day,precipitation",
            "models" to "meteofrance_seamless", "forecast_days" to DAYS.toString(), "timezone" to "auto",
        ).joinToString("&") { (k, v) -> "$k=${URLEncoder.encode(v, "UTF-8")}" }
        return "$URL_BASE?$q"
    }

    /** Lit la réponse (un objet pour un point, un tableau sinon) ; les points reviennent dans l'ordre demandé. */
    fun parse(text: String, asked: List<Pt>, now: Long = System.currentTimeMillis()): List<Forecast> {
        val t = text.trim()
        val list = if (t.startsWith("[")) JSONArray(t).let { a -> (0 until a.length()).map { a.getJSONObject(it) } } else listOf(JSONObject(t))
        if (list.firstOrNull()?.optBoolean("error") == true) error(list.first().optString("reason", "Open-Meteo : erreur"))
        return list.mapIndexed { i, a ->
            val h = a.getJSONObject("hourly")
            fun d(k: String) = h.getJSONArray(k).let { x -> DoubleArray(x.length()) { x.optDouble(it, 0.0) } }
            val codes = h.getJSONArray("weather_code"); val isDay = h.getJSONArray("is_day")
            val start = LocalDateTime.parse(h.getJSONArray("time").getString(0)).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
            val p = asked.getOrNull(i)
            Forecast(p?.lat ?: a.getDouble("latitude"), p?.lon ?: a.getDouble("longitude"), start, now,
                IntArray(codes.length()) { codes.optInt(it) }, d("temperature_2m"), d("wind_speed_10m"), d("wind_gusts_10m"),
                d("wind_direction_10m"), BooleanArray(isDay.length()) { isDay.optInt(it) == 1 }, d("precipitation"))
        }
    }

    /** Hors fil principal. */
    fun fetch(points: List<Pt>): List<Forecast> {
        val c = URL(forecastUrl(points)).openConnection() as HttpURLConnection
        c.connectTimeout = 15_000; c.readTimeout = 30_000
        c.setRequestProperty("User-Agent", "Assomoutain")
        val code = c.responseCode
        val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
        if (code !in 200..299) error(runCatching { JSONObject(text).optString("reason") }.getOrNull()?.ifEmpty { null } ?: "Open-Meteo : HTTP $code")
        return parse(text, points)
    }

    // ---------- Cache (mémoire + préférences, pour afficher la dernière météo sans réseau) ----------
    private var cache: LinkedHashMap<String, Forecast>? = null
    private fun cache(ctx: Context): LinkedHashMap<String, Forecast> {
        cache?.let { return it }
        val m = LinkedHashMap<String, Forecast>()
        runCatching {
            val a = JSONArray(ctx.getSharedPreferences("meteo", Context.MODE_PRIVATE).getString("cache", "[]"))
            for (i in 0 until a.length()) runCatching { Forecast.fromJson(a.getJSONObject(i)) }.getOrNull()?.let { m[it.key] = it }
        }
        cache = m
        return m
    }
    private fun save(ctx: Context) {
        val m = cache ?: return
        val keep = m.values.sortedByDescending { it.fetched }.take(CACHE_MAX)
        m.clear(); keep.forEach { m[it.key] = it }
        ctx.getSharedPreferences("meteo", Context.MODE_PRIVATE).edit().putString("cache", JSONArray(keep.map { it.toJson() }).toString()).apply()
    }

    class Result(val list: List<Forecast>, val error: String?)

    /** Prévisions des points : celles du cache si récentes, sinon une requête pour les manquants. Sans réseau : ce qu'on a, et l'erreur. Hors fil principal. */
    fun forecastFor(ctx: Context, points: List<Pt>): Result {
        val c = synchronized(this) { cache(ctx) }
        val now = System.currentTimeMillis()
        val missing = points.filter { p -> c[p.key]?.let { now - it.fetched > FRESH_MS } ?: true }
        var error: String? = null
        if (missing.isNotEmpty()) {
            try {
                val got = fetch(missing)
                synchronized(this) { got.forEach { c[it.key] = it }; save(ctx) }
            } catch (e: Exception) { error = e.message ?: e.toString() }
        }
        return synchronized(this) { Result(points.mapNotNull { c[it.key] }, error) }
    }

    // ---------- Icônes ----------
    /** Code temps OMM → icône. La nuit, ciel clair = lune. */
    fun icon(code: Int, day: Boolean = true): String = when {
        code == 0 -> if (day) "☀️" else "🌙"
        code == 1 -> if (day) "🌤️" else "🌙"
        code == 2 -> if (day) "⛅" else "☁️"
        code == 3 -> "☁️"
        code == 45 || code == 48 -> "🌫️"
        code in 51..57 -> "🌦️"
        code in 61..67 -> "🌧️"
        code in 71..77 -> "🌨️"
        code == 80 || code == 81 -> if (day) "🌦️" else "🌧️"
        code == 82 -> "🌧️"
        code == 85 || code == 86 -> "🌨️"
        code >= 95 -> "⛈️"
        else -> "❓"
    }

    fun text(code: Int): String = mapOf(
        0 to "Ciel dégagé", 1 to "Peu nuageux", 2 to "Partiellement nuageux", 3 to "Couvert", 45 to "Brouillard", 48 to "Brouillard givrant",
        51 to "Bruine faible", 53 to "Bruine", 55 to "Bruine forte", 56 to "Bruine verglaçante", 57 to "Bruine verglaçante forte",
        61 to "Pluie faible", 63 to "Pluie", 65 to "Pluie forte", 66 to "Pluie verglaçante", 67 to "Pluie verglaçante forte",
        71 to "Neige faible", 73 to "Neige", 75 to "Neige forte", 77 to "Grésil", 80 to "Averses faibles", 81 to "Averses", 82 to "Averses violentes",
        85 to "Averses de neige", 86 to "Fortes averses de neige", 95 to "Orage", 96 to "Orage avec grêle", 99 to "Orage avec forte grêle",
    )[code] ?: "Code $code"

    /** Flèche vers où va le vent (la direction météo dit d'où il vient). */
    fun windArrow(dirFrom: Double): String {
        val arrows = arrayOf("↓", "↙", "←", "↖", "↑", "↗", "→", "↘")
        val d = ((dirFrom % 360) + 360) % 360
        return arrows[(d / 45).roundToInt() % 8]
    }

    /** Couleur d'une flèche de vent selon la vitesse (km/h) : vert, orange, rouge, violet. */
    fun windColor(kmh: Double): Int = android.graphics.Color.parseColor(when {
        kmh >= 60 -> "#7b3fe4"; kmh >= 40 -> "#e4572e"; kmh >= 20 -> "#e0a100"; else -> "#2f9e44" })

    /** Rotation (degrés, sens horaire) d'une flèche qui pointe vers le haut, pour montrer où va le vent. */
    fun windRotation(dirFrom: Double): Float = ((((dirFrom + 180) % 360) + 360) % 360).toFloat()

    /** Heures du curseur : de l'heure courante jusqu'à la fin des prévisions. */
    fun sliderHours(now: LocalDateTime = LocalDateTime.now()): List<LocalDateTime> {
        val start = now.withMinute(0).withSecond(0).withNano(0)
        val end = start.toLocalDate().plusDays(DAYS.toLong()).atStartOfDay()
        val out = ArrayList<LocalDateTime>()
        var t = start
        while (t.isBefore(end)) { out.add(t); t = t.plusHours(1) }
        return out
    }

    fun millis(t: LocalDateTime): Long = t.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
    fun hourLabel(t: LocalDateTime): String = t.format(DateTimeFormatter.ofPattern("EEE d MMM", Locale.FRANCE)) + " ${t.hour} h"

}
