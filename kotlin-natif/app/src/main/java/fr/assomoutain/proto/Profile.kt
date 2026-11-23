package fr.assomoutain.proto

import java.util.Locale
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.roundToInt

/**
 * Profil en coupe et pente le long d'un parcours (même calcul que src/trails/profile.ts côté Capacitor).
 * Les altitudes viennent du modèle de terrain IGN (RGE ALTI), interrogé au plus tous les 10 m.
 * Pente = dénivelé entre 25 m avant et 25 m après le point, divisé par ces 50 m :
 * cette fenêtre glissante lisse les petits sauts du modèle et les zigzags du tracé.
 */
class ProfileData(val d: DoubleArray, val z: DoubleArray, val lon: DoubleArray, val lat: DoubleArray, val total: Double) {
    val size get() = d.size

    data class At(val d: Double, val z: Double, val lon: Double, val lat: Double)
    data class Slope(val deg: Double, val pct: Double)

    private fun seek(x: Double): Int {
        var lo = 0; var hi = size - 1
        while (hi - lo > 1) { val m = (lo + hi) ushr 1; if (d[m] <= x) lo = m else hi = m }
        return lo
    }

    fun pointAt(x0: Double): At {
        val x = x0.coerceIn(d.first(), d.last())
        val k = seek(x); val k2 = minOf(k + 1, size - 1)
        val span = d[k2] - d[k]; val t = if (span > 0) (x - d[k]) / span else 0.0
        fun lerp(a: DoubleArray) = a[k] + (a[k2] - a[k]) * t
        return At(x, lerp(z), lerp(lon), lerp(lat))
    }

    /** Pente au point x (positive = ça monte dans le sens du tracé). */
    fun slopeAt(x: Double, window: Double = SLOPE_WINDOW_M): Slope {
        val a = maxOf(d.first(), x - window / 2); val b = minOf(d.last(), x + window / 2)
        if (b - a < 1) return Slope(0.0, 0.0)
        val dz = pointAt(b).z - pointAt(a).z
        return Slope(Math.toDegrees(atan2(dz, b - a)), dz / (b - a) * 100)
    }

    /** Distance le long du parcours du point le plus proche de (lon, lat). */
    fun nearestD(lon0: Double, lat0: Double): Double {
        var best = 0.0; var bestM = Double.MAX_VALUE
        for (i in 0 until size) {
            val m = Trails.distanceM(LonLat(lon0, lat0), LonLat(lon[i], lat[i]))
            if (m < bestM) { bestM = m; best = d[i] }
        }
        return best
    }

    data class Label(val lon: Double, val lat: Double, val deg: Double, val text: String)

    /**
     * Étiquettes de pente régulières le long du parcours (au milieu de chaque tronçon), au plus ~maxLabels.
     * window : 50 m sur le relief IGN ; plus large (100 m) sur des altitudes GPS, plus bruitées.
     */
    fun slopeLabels(window: Double = SLOPE_WINDOW_M, maxLabels: Int = 20, pctFirst: Boolean = false): List<Label> {
        if (size < 2) return emptyList()
        val start = d.first(); val end = d.last()
        val step = labelStep(end - start, maxLabels)
        val out = ArrayList<Label>()
        var x = start + step / 2
        while (x < end) {
            val at = pointAt(x); val s = slopeAt(x, window)
            out += Label(at.lon, at.lat, s.deg, format(s, pctFirst).replace(" (", " · ").replace(")", ""))
            x += step
        }
        return out
    }

    companion object {
        const val SLOPE_WINDOW_M = 50.0

        /** Pas « rond » entre deux étiquettes (même règle que labelStep côté Capacitor). */
        fun labelStep(total: Double, maxLabels: Int = 20): Double =
            listOf(100.0, 200.0, 250.0, 500.0, 1000.0, 2000.0, 2500.0, 5000.0).firstOrNull { total / it <= maxLabels } ?: 10000.0

        fun build(segments: List<List<Pair<LonLat, Double?>>>): ProfileData {
            val d = ArrayList<Double>(); val z = ArrayList<Double>(); val lo = ArrayList<Double>(); val la = ArrayList<Double>()
            var acc = 0.0
            segments.forEach { seg ->
                seg.forEachIndexed { i, (p, e) ->
                    if (i > 0) acc += Trails.distanceM(seg[i - 1].first, p)
                    if (e == null) return@forEachIndexed
                    if (d.isNotEmpty() && acc - d.last() < 0.5) return@forEachIndexed // doublons
                    d += acc; z += e; lo += p.lon; la += p.lat
                }
            }
            return ProfileData(d.toDoubleArray(), z.toDoubleArray(), lo.toDoubleArray(), la.toDoubleArray(), acc)
        }

        /** Pente « ↗ 12° (21 %) » ; en 🚵 VTT, le % d'abord : « ↗ 21 % (12°) ». */
        fun format(s: Slope, pctFirst: Boolean = false): String {
            val sign = if (s.deg > 0.5) "↗ " else if (s.deg < -0.5) "↘ " else ""
            val deg = abs(s.deg).roundToInt(); val pct = abs(s.pct).roundToInt()
            return if (pctFirst) String.format(Locale.FRANCE, "%s%d %% (%d°)", sign, pct, deg)
            else String.format(Locale.FRANCE, "%s%d° (%d %%)", sign, deg, pct)
        }

        // Échelle du profil : la même pente a toujours le même angle à l'écran, quelle que soit la longueur
        // de la trace (même règle que profileScale côté Capacitor). Hauteurs exagérées EXAG fois ; une trace
        // longue et plate défile de côté. Valeurs en dp.
        const val EXAG = 5.0
        const val H_MIN = 70.0
        const val H_MAX = 190.0
        /** Étirement maximal : 1 km = 300 dp. */
        const val PX_PER_M_MAX = 0.3

        fun scale(totalM: Double, dzM: Double, plotW: Double): ProfileScale {
            val dz = maxOf(dzM, 1.0)
            var s = plotW / totalM
            if (dz * EXAG * s > H_MAX) s = H_MAX / (dz * EXAG)
            else if (dz * EXAG * s < H_MIN) s = maxOf(s, minOf(H_MIN / (dz * EXAG), PX_PER_M_MAX))
            return ProfileScale(s, (dz * EXAG * s).coerceIn(H_MIN, H_MAX), totalM * s)
        }

        /** Pas des graduations en km : au moins ~45 dp entre deux. */
        fun kmTick(pxPerM: Double) = listOf(0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0).firstOrNull { it * 1000 * pxPerM >= 45 } ?: 100.0
    }
}

/** Échelle du profil (en dp) : s = dp par mètre en distance, hauteur du dessin, largeur totale (défile si plus large). */
data class ProfileScale(val s: Double, val plotH: Double, val contentW: Double) { val vPxPerM get() = ProfileData.EXAG * s }
