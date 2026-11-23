package fr.assomoutain.proto

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot

/**
 * ⑂ Carrefours le long d'une de mes traces : on croise la trace avec les chemins et routes d'OpenStreetMap
 * (API Overpass). Un carrefour est un point OSM où se rejoignent au moins 3 bouts de chemin, à moins de
 * NEAR_M de la trace. Le résultat est gardé sur le téléphone : l'écran peut se rallumer avant chaque
 * carrefour même sans réseau (TraceWake.java). Même calcul que src/trails/junctions.ts côté Capacitor.
 */
object Junctions {
    const val NEAR_M = 20.0
    const val MERGE_M = 30.0
    private const val AROUND_M = 25
    private const val CHUNK = 300
    /** Le prochain carrefour s'affiche dans le bandeau à moins de cette distance. */
    const val SHOW_M = 500.0

    private val BAD_HIGHWAY = Regex("^(proposed|construction|abandoned|razed|disused|platform|bus_stop|elevator|corridor|raceway|rest_area|services)$")

    /** Chemins sans intérêt pour s'orienter : allées privées, trottoirs, chantiers… */
    fun usefulWay(tags: JSONObject): Boolean {
        val hw = tags.optString("highway")
        if (hw.isEmpty() || BAD_HIGHWAY.matches(hw)) return false
        if (tags.optString("area") == "yes") return false
        if (hw == "service" && tags.optString("service") in setOf("driveway", "parking_aisle", "drive-through")) return false
        if (tags.optString("footway") in setOf("sidewalk", "crossing")) return false
        if (tags.optString("access") in setOf("private", "no")) return false
        return true
    }

    /** Simplification de Douglas-Peucker (tolérance en mètres). */
    fun simplify(line: List<LonLat>, tolM: Double = 5.0): List<LonLat> {
        if (line.size < 3) return line
        val k = cos(Math.toRadians(line[0].lat)) * 111_320
        val xs = line.map { it.lon * k }; val ys = line.map { it.lat * 111_320 }
        val keep = BooleanArray(line.size).also { it[0] = true; it[line.size - 1] = true }
        val stack = ArrayDeque<Pair<Int, Int>>().apply { add(0 to line.size - 1) }
        while (stack.isNotEmpty()) {
            val (a, b) = stack.removeLast()
            val dx = xs[b] - xs[a]; val dy = ys[b] - ys[a]; val l = hypot(dx, dy)
            var far = -1; var best = tolM
            for (i in a + 1 until b) {
                val d = if (l > 0) abs(dy * (xs[i] - xs[a]) - dx * (ys[i] - ys[a])) / l else hypot(xs[i] - xs[a], ys[i] - ys[a])
                if (d > best) { best = d; far = i }
            }
            if (far > 0) { keep[far] = true; stack.add(a to far); stack.add(far to b) }
        }
        return line.filterIndexed { i, _ -> keep[i] }
    }

    /** Requêtes Overpass : chemins (highway) à moins de 25 m de la trace, par morceaux de 300 points. */
    fun queries(line: List<LonLat>): List<String> {
        val pts = simplify(line)
        val out = ArrayList<String>()
        var i = 0
        while (pts.isNotEmpty()) {
            val part = pts.subList(i, minOf(pts.size, i + CHUNK))
            val coords = part.joinToString(",") { String.format(java.util.Locale.US, "%.5f,%.5f", it.lat, it.lon) }
            // + les relations GR / GR de Pays de ces chemins (🚵 type de chemin : portions sur GR).
            out += "[out:json][timeout:90];way[\"highway\"](around:$AROUND_M,$coords)->.w;.w out body geom qt;" +
                "rel(bw.w)[\"route\"~\"^(hiking|foot)$\"][\"network\"~\"^(iwn|nwn|rwn)$\"];out body qt;"
            if (i + CHUNK >= pts.size) break
            i += CHUNK - 1
        }
        return out
    }

    /** Carrefours : nœuds partagés par au moins 3 bouts de chemin, près de la trace, regroupés, dans l'ordre de la trace. */
    fun parse(elements: List<JSONObject>, line: List<LonLat>): List<LonLat> {
        val deg = HashMap<Long, Int>(); val pos = HashMap<Long, LonLat>(); val seen = HashSet<Long>()
        for (w in elements) {
            val nodes = w.optJSONArray("nodes") ?: continue
            val id = w.optLong("id")
            if (w.optString("type") != "way" || nodes.length() < 2 || !seen.add(id) || !usefulWay(w.optJSONObject("tags") ?: JSONObject())) continue
            val geom = w.optJSONArray("geometry")
            val n = nodes.length()
            for (k in 0 until n) {
                val nid = nodes.getLong(k)
                deg[nid] = (deg[nid] ?: 0) + if (k == 0 || k == n - 1) 1 else 2
                geom?.optJSONObject(k)?.let { g -> pos[nid] = LonLat(g.getDouble("lon"), g.getDouble("lat")) }
            }
        }
        val cands = ArrayList<Pair<LonLat, Double>>()
        for ((nid, d) in deg) {
            val p = pos[nid] ?: continue
            if (d < 3) continue
            val r = Navigation.locateOnLine(line, p)
            if (r.offM <= NEAR_M) cands += p to r.alongM
        }
        cands.sortBy { it.second }
        val kept = ArrayList<LonLat>()
        for ((p, _) in cands) if (kept.none { Trails.distanceM(it, p) < MERGE_M }) kept += p
        return kept
    }

    /** Appel réseau (hors du fil principal) : chemins autour de la trace. */
    private fun fetchElements(line: List<LonLat>): List<JSONObject> {
        val elements = ArrayList<JSONObject>()
        for (q in queries(line)) {
            val body = "data=" + URLEncoder.encode(q, "UTF-8")
            var last: Exception? = null; var ok = false
            for (url in Trails.OVERPASS_URLS) {
                try {
                    val c = URL(url).openConnection() as HttpURLConnection
                    c.requestMethod = "POST"; c.doOutput = true
                    c.connectTimeout = 15_000; c.readTimeout = 90_000
                    c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
                    c.setRequestProperty("User-Agent", "Assomountain-proto (Android)")
                    c.outputStream.use { it.write(body.toByteArray()) }
                    if (c.responseCode != 200) error("HTTP ${c.responseCode}")
                    val arr = JSONObject(c.inputStream.bufferedReader().use { it.readText() }).optJSONArray("elements") ?: JSONArray()
                    for (i in 0 until arr.length()) elements += arr.getJSONObject(i)
                    ok = true; break
                } catch (e: Exception) { last = e }
            }
            if (!ok) throw last ?: IllegalStateException("aucun serveur")
        }
        return elements
    }

    /** Empreinte de la trace (comme le méta du hors ligne). */
    private fun key(line: List<LonLat>): String {
        val h = line.fold(17L) { acc, p -> acc * 31 + Math.round(p.lon * 1e5) * 7 + Math.round(p.lat * 1e5) }
        return java.lang.Long.toHexString(h)
    }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("carrefours", Context.MODE_PRIVATE)

    /** Carrefours déjà gardés sur le téléphone pour cette trace (null : jamais cherchés). */
    fun cached(ctx: Context, line: List<LonLat>): List<LonLat>? = runCatching {
        val s = prefs(ctx).getString(key(line), null) ?: return null
        val a = JSONArray(s)
        (0 until a.length()).map { i -> a.getJSONArray(i).let { LonLat(it.getDouble(0), it.getDouble(1)) } }
    }.getOrNull()

    /** Une seule requête Overpass pour les deux : carrefours ⑂ et 🚵 types de chemin, gardés sur le téléphone. */
    private fun fetchAndKeep(ctx: Context, line: List<LonLat>): Pair<List<LonLat>, List<WayTypes.Run>> {
        val elements = fetchElements(line)
        val j = parse(elements, line)
        val runs = WayTypes.runs(elements, line)
        val a = JSONArray(); j.forEach { a.put(JSONArray().put(it.lon).put(it.lat)) }
        val r = JSONArray(); runs.forEach { r.put(JSONArray().put(Math.round(it.from)).put(Math.round(it.to)).put(it.type).put(if (it.gr) 1 else 0)) }
        prefs(ctx).edit().putString(key(line), a.toString()).putString("chemins:" + key(line), r.toString()).apply()
        return j to runs
    }

    /** Ceux du téléphone, sinon cherchés sur le réseau puis gardés. Appel réseau possible : hors du fil principal. */
    fun forLine(ctx: Context, line: List<LonLat>): List<LonLat> {
        cached(ctx, line)?.let { return it }
        return fetchAndKeep(ctx, line).first
    }

    /** 🚵 Types de chemin déjà gardés sur le téléphone (null : jamais cherchés). */
    fun cachedWays(ctx: Context, line: List<LonLat>): List<WayTypes.Run>? = runCatching {
        val s = prefs(ctx).getString("chemins:" + key(line), null) ?: return null
        val a = JSONArray(s)
        (0 until a.length()).map { i -> a.getJSONArray(i).let { WayTypes.Run(it.getDouble(0), it.getDouble(1), it.getString(2), it.optInt(3) == 1) } }
    }.getOrNull()

    /** 🚵 Types de chemin : ceux du téléphone, sinon cherchés sur le réseau puis gardés (hors du fil principal). */
    fun waysForLine(ctx: Context, line: List<LonLat>): List<WayTypes.Run> {
        cachedWays(ctx, line)?.let { return it }
        return fetchAndKeep(ctx, line).second
    }

    /** Position de chaque carrefour le long de la trace. */
    fun alongs(line: List<LonLat>, junctions: List<LonLat>) = junctions.map { Navigation.locateOnLine(line, it).alongM }

    /** Distance du prochain carrefour devant moi (null : aucun). */
    fun nextM(alongs: List<Double>, alongM: Double): Double? =
        alongs.map { it - alongM }.filter { it > -10 }.minOrNull()?.coerceAtLeast(0.0)

    private const val WAKE_PREF = "ecranCarrefours"
    fun wakeEnabled(ctx: Context) = ctx.getSharedPreferences("reglages", Context.MODE_PRIVATE).getBoolean(WAKE_PREF, true)
    private const val VIB_PREF = "vibreHorsTrace"
    /** Bouton vibration hors trace (activé par défaut). */
    fun vibrateEnabled(ctx: Context) = ctx.getSharedPreferences("reglages", Context.MODE_PRIVATE).getBoolean(VIB_PREF, true)
    fun setVibrateEnabled(ctx: Context, on: Boolean) = ctx.getSharedPreferences("reglages", Context.MODE_PRIVATE).edit().putBoolean(VIB_PREF, on).apply()
    fun setWakeEnabled(ctx: Context, on: Boolean) = ctx.getSharedPreferences("reglages", Context.MODE_PRIVATE).edit().putBoolean(WAKE_PREF, on).apply()
}
