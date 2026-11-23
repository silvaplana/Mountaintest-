package fr.assomoutain.proto

import org.json.JSONObject
import java.util.Locale
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * 🚵 Type de chemin le long d'une trace (route goudronnée, chemin, sentier…), d'après les chemins
 * d'OpenStreetMap autour de la trace : la même réponse Overpass que pour les carrefours ⑂ (Junctions.kt),
 * gardée sur le téléphone (hors ligne). Mêmes catégories que la légende du SCAN 25, plus « sentier
 * difficile ». Même calcul que src/trails/wayTypes.ts côté Capacitor.
 */
object WayTypes {
    data class Type(val key: String, val label: String, val color: String)

    /** Les types possibles, dans l'ordre de la légende (du plus roulant au plus difficile). */
    val TYPES = listOf(
        Type("route", "Route goudronnée", "#4a4f55"),
        Type("velo", "Piste cyclable", "#1e88e5"),
        Type("empierree", "Route empierrée", "#e0a800"),
        Type("chemin", "Chemin", "#8d5a2b"),
        Type("sentier", "Sentier", "#2e9d4a"),
        Type("technique", "Sentier difficile", "#8e24aa"),
        Type("inconnu", "Hors chemin connu", "#b8bcc0"),
    )
    fun color(key: String) = TYPES.firstOrNull { it.key == key }?.color ?: "#b8bcc0"
    /** Portions sur un GR ou un GR de Pays : tireté rouge, comme sur le SCAN 25. */
    const val GR_COLOR = "#e53935"

    private val ROADS = Regex("^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road)(_link)?$")
    private val PAVED = Regex("^(asphalt|paved|concrete(:.*)?|paving_stones|sett|chipseal|metal)$")
    private val HARD = Regex("^(demanding_mountain_hiking|alpine_hiking|demanding_alpine_hiking|difficult_alpine_hiking)$")

    /** Type d'un chemin OSM d'après ses étiquettes (highway, surface, tracktype, mtb:scale, sac_scale). */
    fun wayType(tags: JSONObject): String {
        val hw = tags.optString("highway")
        val surface = tags.optString("surface")
        if (hw == "cycleway" || (hw == "path" && tags.optString("bicycle") == "designated" && PAVED.matches(surface))) return "velo"
        if (ROADS.matches(hw)) return if (surface.isNotEmpty() && !PAVED.matches(surface)) "empierree" else "route"
        if (hw == "track") return when {
            PAVED.matches(surface) -> "route"
            tags.optString("tracktype") in setOf("grade1", "grade2") || surface in setOf("gravel", "fine_gravel", "compacted") -> "empierree"
            else -> "chemin"
        }
        if (hw == "bridleway") return "chemin"
        if (hw in setOf("path", "footway", "pedestrian", "steps")) {
            val mtb = tags.optString("mtb:scale").take(1).toIntOrNull() ?: -1
            if (hw == "steps" || mtb >= 2 || HARD.matches(tags.optString("sac_scale")) || surface in setOf("rock", "scree", "bare_rock")
                || tags.optString("trail_visibility") in setOf("bad", "horrible", "no")) return "technique"
            if (PAVED.matches(surface)) return "route"
            return "sentier"
        }
        return "inconnu"
    }

    /** Un morceau de la trace d'un seul type : de `from` à `to` mètres depuis le départ. */
    data class Run(val from: Double, var to: Double, val type: String, val gr: Boolean)

    private const val NEAR_M = 15.0
    private const val SAMPLE_M = 10.0
    private const val MIN_RUN_M = 30.0
    private const val CELL = 50.0

    private class Seg(val ax: Double, val ay: Double, val bx: Double, val by: Double, val t: String, val gr: Boolean)

    /**
     * Types de chemin le long de la trace : un point tous les 10 m, rattaché au chemin OSM le plus proche
     * (à moins de 15 m) qui va dans le même sens que la trace ; puis les morceaux trop courts sont lissés.
     */
    fun runs(elements: List<JSONObject>, line: List<LonLat>): List<Run> {
        if (line.size < 2) return emptyList()
        val kx = cos(Math.toRadians(line[0].lat)) * 111_320; val ky = 111_320.0
        val grid = HashMap<Long, MutableList<Seg>>()
        fun cell(cx: Long, cy: Long) = cx * 1_000_003L + cy
        val grWays = HashSet<Long>()
        for (r in elements) if (r.optString("type") == "relation") r.optJSONArray("members")?.let { m ->
            for (i in 0 until m.length()) m.optJSONObject(i)?.let { if (it.optString("type") == "way") grWays += it.optLong("ref") }
        }
        val seen = HashSet<Long>()
        for (w in elements) {
            val tags = w.optJSONObject("tags") ?: continue
            val geom = w.optJSONArray("geometry") ?: continue
            if (w.optString("type") != "way" || !tags.has("highway") || !seen.add(w.optLong("id"))) continue
            val t = wayType(tags); val gr = w.optLong("id") in grWays
            for (i in 1 until geom.length()) {
                val a = geom.optJSONObject(i - 1) ?: continue; val b = geom.optJSONObject(i) ?: continue
                if (!a.has("lat") || !b.has("lat")) continue
                val s = Seg(a.getDouble("lon") * kx, a.getDouble("lat") * ky, b.getDouble("lon") * kx, b.getDouble("lat") * ky, t, gr)
                val x0 = floor((minOf(s.ax, s.bx) - NEAR_M) / CELL).toLong(); val x1 = floor((maxOf(s.ax, s.bx) + NEAR_M) / CELL).toLong()
                val y0 = floor((minOf(s.ay, s.by) - NEAR_M) / CELL).toLong(); val y1 = floor((maxOf(s.ay, s.by) + NEAR_M) / CELL).toLong()
                for (cx in x0..x1) for (cy in y0..y1) grid.getOrPut(cell(cx, cy)) { ArrayList() } += s
            }
        }
        val types = ArrayList<Pair<String, Boolean>>()
        var acc = 0.0; var next = 0.0
        for (i in 1 until line.size) {
            val segM = Trails.distanceM(line[i - 1], line[i])
            val ax = line[i - 1].lon * kx; val ay = line[i - 1].lat * ky
            val dx = line[i].lon * kx - ax; val dy = line[i].lat * ky - ay
            val dl = hypot(dx, dy).takeIf { it > 0 } ?: 1.0
            while (next <= acc + segM) {
                val f = if (segM > 0) (next - acc) / segM else 0.0
                val px = ax + f * dx; val py = ay + f * dy
                var best = "inconnu"; var bestGr = false; var bestScore = Double.MAX_VALUE
                for (s in grid[cell(floor(px / CELL).toLong(), floor(py / CELL).toLong())] ?: emptyList<Seg>()) {
                    val sx = s.bx - s.ax; val sy = s.by - s.ay; val l2 = sx * sx + sy * sy
                    val u = if (l2 > 0) (((px - s.ax) * sx + (py - s.ay) * sy) / l2).coerceIn(0.0, 1.0) else 0.0
                    val off = hypot(s.ax + u * sx - px, s.ay + u * sy - py)
                    if (off > NEAR_M) continue
                    // Une route qu'on ne fait que traverser est perpendiculaire à la trace : pénalisée.
                    val c = if (l2 > 0) abs(sx * dx + sy * dy) / (sqrt(l2) * dl) else 1.0
                    val score = off + 20 * (1 - c)
                    if (score < bestScore) { bestScore = score; best = s.t; bestGr = s.gr }
                }
                types += best to bestGr
                next += SAMPLE_M
            }
            acc += segM
        }
        var runs = ArrayList<Run>()
        types.forEachIndexed { i, (t, gr) ->
            val from = maxOf(0.0, i * SAMPLE_M - SAMPLE_M / 2); val to = minOf(acc, i * SAMPLE_M + SAMPLE_M / 2)
            val last = runs.lastOrNull()
            if (last != null && last.type == t && last.gr == gr) last.to = to else runs += Run(from, to, t, gr)
        }
        repeat(2) {
            val out = ArrayList<Run>()
            runs.forEachIndexed { i, r ->
                val prev = out.lastOrNull()
                val k = if (r.to - r.from < MIN_RUN_M) prev ?: runs.getOrNull(i + 1) ?: r else r
                if (prev != null && prev.type == k.type && prev.gr == k.gr) prev.to = r.to else out += Run(r.from, r.to, k.type, k.gr)
            }
            runs = out
        }
        runs.lastOrNull()?.to = acc
        return runs
    }

    data class Totals(val byType: Map<String, Double>, val gr: Double, val total: Double)

    fun totals(runs: List<Run>): Totals {
        val by = HashMap<String, Double>()
        var gr = 0.0; var total = 0.0
        for (r in runs) { val m = r.to - r.from; by[r.type] = (by[r.type] ?: 0.0) + m; total += m; if (r.gr) gr += m }
        return Totals(by, gr, total)
    }

    /** Part en % (arrondie ; « < 1 % » pour un petit bout). */
    fun sharePct(m: Double, total: Double): String {
        if (total <= 0 || m <= 0) return ""
        val p = m / total * 100
        return if (p < 1) "< 1 %" else "${p.roundToInt()} %"
    }

    fun km(m: Double) = String.format(Locale.FRANCE, "%.1f km", m / 1000)

    /** Bouts de la trace (lon, lat) de chaque morceau, pour colorer la trace sur la carte. */
    fun lines(line: List<LonLat>, runs: List<Run>): List<Pair<Run, List<LonLat>>> {
        val cum = DoubleArray(line.size)
        for (i in 1 until line.size) cum[i] = cum[i - 1] + Trails.distanceM(line[i - 1], line[i])
        fun at(d: Double): LonLat {
            var i = 1
            while (i < line.size - 1 && cum[i] < d) i++
            val span = cum[i] - cum[i - 1]
            val f = if (span > 0) ((d - cum[i - 1]) / span).coerceIn(0.0, 1.0) else 0.0
            val a = line[i - 1]; val b = line[i]
            return LonLat(a.lon + f * (b.lon - a.lon), a.lat + f * (b.lat - a.lat))
        }
        return runs.map { r ->
            val pts = ArrayList<LonLat>()
            pts += at(r.from)
            for (i in line.indices) if (cum[i] > r.from && cum[i] < r.to) pts += line[i]
            pts += at(r.to)
            r to pts
        }
    }
}
