package fr.assomoutain.proto

import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.tan

/**
 * 🧭 Naviguer sur une de mes traces : où suis-je sur la trace, à quelle distance d'elle, combien reste-t-il.
 * Calcul local, sans réseau. Même calcul que src/trails/navigation.ts côté Capacitor.
 * Et 📶 Hors ligne : les tuiles d'un couloir autour de la trace (src/tiles/tileMath.ts).
 */
object Navigation {
    /** Au-delà de cette distance de la trace, on prévient « hors trace ». */
    const val OFF_TRACK_M = 50.0
    /** Largeur du couloir téléchargé de part et d'autre de la trace. */
    const val CORRIDOR_M = 1000.0
    private const val M_PER_DEG = 111_320.0

    data class Located(val offM: Double, val alongM: Double, val totalM: Double, val nearest: LonLat)
    data class State(val offM: Double, val alongM: Double, val remainingM: Double, val gainLeftM: Double?, val lossLeftM: Double?)

    /** Projette la position sur chaque tronçon (plan local, précis à l'échelle d'une rando). */
    fun locateOnLine(line: List<LonLat>, pos: LonLat): Located {
        val k = cos(Math.toRadians(pos.lat))
        fun x(p: LonLat) = (p.lon - pos.lon) * k * M_PER_DEG
        fun y(p: LonLat) = (p.lat - pos.lat) * M_PER_DEG
        var bestOff = Double.MAX_VALUE; var bestAlong = 0.0; var nearest = line.first()
        var acc = 0.0
        for (i in 1 until line.size) {
            val a = line[i - 1]; val b = line[i]
            val seg = Trails.distanceM(a, b)
            val ax = x(a); val ay = y(a); val dx = x(b) - ax; val dy = y(b) - ay
            val l2 = dx * dx + dy * dy
            val t = if (l2 > 0) (-(ax * dx + ay * dy) / l2).coerceIn(0.0, 1.0) else 0.0
            val off = hypot(ax + t * dx, ay + t * dy)
            if (off < bestOff) {
                bestOff = off; bestAlong = acc + t * seg
                nearest = LonLat(a.lon + t * (b.lon - a.lon), a.lat + t * (b.lat - a.lat))
            }
            acc += seg
        }
        return Located(bestOff, bestAlong, acc, nearest)
    }

    /** Montée et descente du profil après la distance donnée. */
    fun climbLeft(p: ProfileData, fromM: Double): Pair<Double, Double> {
        var gain = 0.0; var loss = 0.0
        for (i in 1 until p.d.size) {
            if (p.d[i] <= fromM) continue
            val dz = p.z[i] - p.z[i - 1]
            if (dz > 0) gain += dz else loss -= dz
        }
        return gain to loss
    }

    fun state(line: List<LonLat>, pos: LonLat, profile: ProfileData?): State {
        val r = locateOnLine(line, pos)
        val c = if (profile != null && profile.d.size > 1) climbLeft(profile, r.alongM) else null
        return State(r.offM, r.alongM, maxOf(0.0, r.totalM - r.alongM), c?.first, c?.second)
    }

    // ---------- Couloir hors ligne ----------

    private fun lonToX(lon: Double, z: Int) = floor((lon + 180) / 360 * (1 shl z)).toInt()
    private fun latToY(lat: Double, z: Int): Int {
        val r = Math.toRadians(lat)
        return floor((1 - ln(tan(r) + 1 / cos(r)) / Math.PI) / 2 * (1 shl z)).toInt()
    }

    /** Points tous les bufferM/2 le long de la trace. */
    fun samples(line: List<LonLat>, bufferM: Double = CORRIDOR_M): List<LonLat> {
        val step = maxOf(50.0, bufferM / 2)
        val out = ArrayList<LonLat>()
        for (i in line.indices) {
            val a = line[i]; out += a
            val b = line.getOrNull(i + 1) ?: break
            val d = hypot((b.lon - a.lon) * cos(Math.toRadians(a.lat)), b.lat - a.lat) * M_PER_DEG
            var s = step
            while (s < d) { out += LonLat(a.lon + (b.lon - a.lon) * s / d, a.lat + (b.lat - a.lat) * s / d); s += step }
        }
        return out
    }

    /** Carré de ± bufferM autour d'un point : ouest, sud, est, nord. */
    fun square(p: LonLat, bufferM: Double = CORRIDOR_M): Zone {
        val dLat = bufferM / M_PER_DEG; val dLon = dLat / cos(Math.toRadians(p.lat))
        return Zone(p.lon - dLon, p.lat - dLat, p.lon + dLon, p.lat + dLat)
    }

    /** Nombre de tuiles du couloir pour ces zooms (même calcul que tilesForCorridor côté Capacitor). */
    fun corridorTileCount(line: List<LonLat>, zooms: IntRange, bufferM: Double = CORRIDOR_M): Int {
        val seen = HashSet<Long>()
        for (p in samples(line, bufferM)) {
            val q = square(p, bufferM)
            for (z in zooms) for (x in lonToX(q.west, z)..lonToX(q.east, z)) for (y in latToY(q.north, z)..latToY(q.south, z))
                seen += (z.toLong() shl 50) or (x.toLong() shl 25) or y.toLong()
        }
        return seen.size
    }

    /** Rectangle englobant de la trace, élargi de marginM. */
    fun bbox(line: List<LonLat>, marginM: Double = CORRIDOR_M): Zone {
        val lat = (line.minOf { it.lat } + line.maxOf { it.lat }) / 2
        val dLat = marginM / M_PER_DEG; val dLon = dLat / cos(Math.toRadians(lat))
        return Zone(line.minOf { it.lon } - dLon, line.minOf { it.lat } - dLat, line.maxOf { it.lon } + dLon, line.maxOf { it.lat } + dLat)
    }
}
