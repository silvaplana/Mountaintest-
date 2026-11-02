package fr.assomoutain.proto

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.asin
import kotlin.math.atan
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sinh
import kotlin.math.tan

/** Position du soleil : azimut depuis le nord (sens horaire) et hauteur, en degrés. */
data class SunPos(val azimuth: Double, val altitude: Double)

/**
 * Position du soleil (algorithme NOAA, ~0,1°), sans réseau ni librairie.
 * Même calcul que capacitor/src/shade/sun.ts : garder les deux identiques.
 */
object Sun {
    private const val RAD = PI / 180

    fun position(epochMs: Long, lat: Double, lon: Double): SunPos {
        val jd = epochMs / 86_400_000.0 + 2440587.5
        val t = (jd - 2451545) / 36525
        val l0 = (((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360) + 360) % 360
        val m = 357.52911 + t * (35999.05029 - 0.0001537 * t)
        val e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
        val c = sin(m * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
            sin(2 * m * RAD) * (0.019993 - 0.000101 * t) + sin(3 * m * RAD) * 0.000289
        val omega = 125.04 - 1934.136 * t
        val lambda = l0 + c - 0.00569 - 0.00478 * sin(omega * RAD)
        val eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
        val eps = eps0 + 0.00256 * cos(omega * RAD)
        val decl = asin(sin(eps * RAD) * sin(lambda * RAD))
        val y = tan(eps / 2 * RAD).let { it * it }
        // Équation du temps, en minutes.
        val eot = 4 / RAD * (y * sin(2 * l0 * RAD) - 2 * e * sin(m * RAD) +
            4 * e * y * sin(m * RAD) * cos(2 * l0 * RAD) -
            0.5 * y * y * sin(4 * l0 * RAD) - 1.25 * e * e * sin(2 * m * RAD))
        val utcMin = ((epochMs / 60_000.0) % 1440 + 1440) % 1440
        val tst = (((utcMin + eot + 4 * lon) % 1440) + 1440) % 1440
        val ha = (tst / 4 - 180) * RAD
        val phi = lat * RAD
        val cosZ = sin(phi) * sin(decl) + cos(phi) * cos(decl) * cos(ha)
        var altitude = 90 - acos(cosZ.coerceIn(-1.0, 1.0)) / RAD
        // Réfraction atmosphérique (Bennett).
        if (altitude > -1) altitude += 1.02 / tan((altitude + 10.3 / (altitude + 5.11)) * RAD) / 60
        val az = atan2(sin(ha), cos(ha) * sin(phi) - tan(decl) * cos(phi)) / RAD + 180
        return SunPos(((az % 360) + 360) % 360, altitude)
    }

    private val DIRS = arrayOf("N", "NE", "E", "SE", "S", "SO", "O", "NO")
    fun compass(az: Double): String = DIRS[(az / 45).roundToInt() % 8]
}

/**
 * Ombres du relief, même algorithme que capacitor/src/shade/shadow.ts :
 * ombre portée par balayage depuis le côté du soleil (un seul passage), ombre propre par la normale.
 */
object ShadeCalc {
    const val LIT: Byte = 0
    const val SELF_SHADE: Byte = 1
    const val CAST_SHADOW: Byte = 2
    const val NIGHT: Byte = 3
    private const val TOLERANCE_M = 0.5f

    fun compute(dem: FloatArray, w: Int, h: Int, cellM: Double, azimuthDeg: Double, altitudeDeg: Double): ByteArray {
        val out = ByteArray(w * h)
        if (altitudeDeg <= 0) { out.fill(NIGHT); return out }
        val az = azimuthDeg * PI / 180
        val alt = altitudeDeg * PI / 180
        val dx = sin(az); val dy = -cos(az)
        val tanAlt = tan(alt)

        // Ombre propre.
        val sx = sin(az) * cos(alt); val sy = cos(az) * cos(alt); val sz = sin(alt)
        for (y in 0 until h) {
            val yu = max(0, y - 1); val yd = min(h - 1, y + 1)
            for (x in 0 until w) {
                val xl = max(0, x - 1); val xr = min(w - 1, x + 1)
                val dzdx = (dem[y * w + xr] - dem[y * w + xl]) / ((if (xr - xl == 0) 1 else xr - xl) * cellM)
                val dzdn = (dem[yu * w + x] - dem[yd * w + x]) / ((if (yd - yu == 0) 1 else yd - yu) * cellM)
                if (-dzdx * sx - dzdn * sy + sz <= 0) out[y * w + x] = SELF_SHADE
            }
        }

        // Ombre portée.
        val hs = FloatArray(w * h)
        if (abs(dx) >= abs(dy)) {
            val step = if (dx > 0) 1 else -1
            val f = dy / abs(dx)
            val drop = (cellM * hypot(1.0, f) * tanAlt).toFloat()
            val xs = if (dx > 0) w - 1 else 0
            for (i in 0 until w) {
                val x = xs - i * step
                val xu = x + step
                for (y in 0 until h) {
                    val k = y * w + x; val g = dem[k]
                    var up = Float.NEGATIVE_INFINITY
                    if (xu in 0 until w) {
                        val yy = y + f; val y0 = floor(yy).toInt(); val t = (yy - y0).toFloat()
                        if (y0 >= 0 && y0 + 1 < h) up = hs[y0 * w + xu] * (1 - t) + hs[(y0 + 1) * w + xu] * t
                        else if (y0 == h - 1 && t == 0f) up = hs[y0 * w + xu]
                        up -= drop
                    }
                    if (up > g + TOLERANCE_M) { out[k] = CAST_SHADOW; hs[k] = up } else hs[k] = g
                }
            }
        } else {
            val step = if (dy > 0) 1 else -1
            val f = dx / abs(dy)
            val drop = (cellM * hypot(1.0, f) * tanAlt).toFloat()
            val ys = if (dy > 0) h - 1 else 0
            for (i in 0 until h) {
                val y = ys - i * step
                val yu = y + step
                for (x in 0 until w) {
                    val k = y * w + x; val g = dem[k]
                    var up = Float.NEGATIVE_INFINITY
                    if (yu in 0 until h) {
                        val xx = x + f; val x0 = floor(xx).toInt(); val t = (xx - x0).toFloat()
                        if (x0 >= 0 && x0 + 1 < w) up = hs[yu * w + x0] * (1 - t) + hs[yu * w + x0 + 1] * t
                        else if (x0 == w - 1 && t == 0f) up = hs[yu * w + x0]
                        up -= drop
                    }
                    if (up > g + TOLERANCE_M) { out[k] = CAST_SHADOW; hs[k] = up } else hs[k] = g
                }
            }
        }
        return out
    }

    fun ratio(codes: ByteArray): Double = if (codes.isEmpty()) 0.0 else codes.count { it != LIT }.toDouble() / codes.size

    /** Couleurs ARGB : bleu nuit translucide, plus sombre la nuit (mêmes valeurs que film.ts). */
    private val SHADE_ARGB = (115 shl 24) or (20 shl 16) or (30 shl 8) or 85
    private val NIGHT_ARGB = (150 shl 24) or (10 shl 16) or (15 shl 8) or 40

    /** Un bit par maille (1 = ombre) : 48 images tiennent en mémoire (3 Mo de mailles → 400 Ko). */
    fun pack(codes: ByteArray): ByteArray {
        val out = ByteArray((codes.size + 7) / 8)
        for (i in codes.indices) if (codes[i] != LIT) out[i shr 3] = (out[i shr 3].toInt() or (1 shl (i and 7))).toByte()
        return out
    }

    /** Pixels ARGB d'une image : bits d'ombre, ou null la nuit (tout sombre). */
    fun pixels(bits: ByteArray?, into: IntArray) {
        if (bits == null) { into.fill(NIGHT_ARGB); return }
        for (i in into.indices) into[i] = if ((bits[i shr 3].toInt() shr (i and 7)) and 1 != 0) SHADE_ARGB else 0
    }
}

/**
 * Relief pour les ombres : MNT IGN RGE ALTI (Géoplateforme, licence ouverte, sans clé), en WMS,
 * par tuiles Web Mercator de 256 × 256 altitudes float32 (BIL). Même découpage que capacitor/src/shade/dem.ts.
 * Tuiles gardées dans files/tiles/mnt/z/x/y.bil (conservées par les mises à jour de l'appli).
 */
object Dem {
    const val LAYER = "ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES"
    const val TILE = 256
    const val TILE_BYTES = TILE * TILE * 4
    const val MIN_ZOOM = 10
    const val MAX_ZOOM = 14
    const val MARGIN = 1
    const val MAX_GRID_TILES = 48
    private const val E = 20037508.342789244

    data class Spec(val z: Int, val x0: Int, val y0: Int, val nx: Int, val ny: Int) {
        val w get() = nx * TILE
        val h get() = ny * TILE
    }
    class Grid(val spec: Spec, val dem: FloatArray, val missing: Int)

    fun tileUrl(z: Int, x: Int, y: Int): String {
        val size = 2 * E / (1 shl z)
        val b = listOf(-E + x * size, E - (y + 1) * size, -E + (x + 1) * size, E - y * size)
            .joinToString(",") { String.format(java.util.Locale.US, "%.2f", it) }
        return "https://data.geopf.fr/wms-r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=$LAYER&STYLES=" +
            "&FORMAT=image%2Fx-bil%3Bbits%3D32&CRS=EPSG:3857&BBOX=$b&WIDTH=$TILE&HEIGHT=$TILE"
    }

    fun lonToX(lon: Double, z: Int) = floor((lon + 180) / 360 * (1 shl z)).toInt()
    fun latToY(lat: Double, z: Int): Int {
        val r = Math.toRadians(lat)
        return floor((1 - ln(tan(r) + 1 / cos(r)) / PI) / 2 * (1 shl z)).toInt()
    }
    fun xToLon(x: Int, z: Int) = x.toDouble() / (1 shl z) * 360 - 180
    fun yToLat(y: Int, z: Int) = Math.toDegrees(atan(sinh(PI - 2 * PI * y / (1 shl z))))

    fun zoomFor(mapZoom: Double) = (floor(mapZoom).toInt() - 1).coerceIn(MIN_ZOOM, MAX_ZOOM)

    /** Tuiles couvrant la vue (ouest, sud, est, nord) avec la marge ; zoom réduit si trop de tuiles. */
    fun gridFor(w: Double, s: Double, e: Double, n: Double, mapZoom: Double): Spec {
        var z = zoomFor(mapZoom)
        while (true) {
            val x0 = lonToX(w, z) - MARGIN; val x1 = lonToX(e, z) + MARGIN
            val y0 = latToY(n, z) - MARGIN; val y1 = latToY(s, z) + MARGIN
            val spec = Spec(z, x0, y0, x1 - x0 + 1, y1 - y0 + 1)
            if (spec.nx * spec.ny <= MAX_GRID_TILES || z <= MIN_ZOOM) return spec
            z--
        }
    }

    /** Emprise : ouest, sud, est, nord. */
    fun bbox(s: Spec) = doubleArrayOf(xToLon(s.x0, s.z), yToLat(s.y0 + s.ny, s.z), xToLon(s.x0 + s.nx, s.z), yToLat(s.y0, s.z))

    fun cellMeters(s: Spec): Double {
        val b = bbox(s)
        return 2 * E / (1 shl s.z) / TILE * cos(Math.toRadians((b[1] + b[3]) / 2))
    }

    /** La grille calculée couvre-t-elle encore la vue demandée ? */
    fun covers(cur: Spec, need: Spec, margin: Int = 1) = cur.z == need.z &&
        need.x0 + margin >= cur.x0 && need.y0 + margin >= cur.y0 &&
        need.x0 + need.nx - margin <= cur.x0 + cur.nx && need.y0 + need.ny - margin <= cur.y0 + cur.ny

    /** BIL float32 petit-boutiste ; −99999 (pas de donnée, mer) devient 0. */
    fun decode(bytes: ByteArray): FloatArray? {
        if (bytes.size != TILE_BYTES) return null
        val fb = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
        val v = FloatArray(TILE * TILE)
        fb.get(v)
        for (i in v.indices) if (!(v[i] > -1000f) || v[i] > 9000f) v[i] = 0f
        return v
    }

    private fun file(ctx: Context, z: Int, x: Int, y: Int) = File(ctx.filesDir, "tiles/mnt/$z/$x/$y.bil")

    private fun fetch(z: Int, x: Int, y: Int): ByteArray? = runCatching {
        val c = URL(tileUrl(z, x, y)).openConnection() as HttpURLConnection
        c.connectTimeout = 15_000; c.readTimeout = 30_000
        try {
            if (c.responseCode != 200) null else c.inputStream.use { it.readBytes() }
        } finally { c.disconnect() }
    }.getOrNull()

    /** Une tuile : disque d'abord, réseau ensuite (et gardée pour la prochaine fois). */
    fun loadTile(ctx: Context, z: Int, x: Int, y: Int, network: Boolean = true): FloatArray? {
        val f = file(ctx, z, x, y)
        if (f.exists()) decode(f.readBytes())?.let { return it }
        if (!network) return null
        val bytes = fetch(z, x, y) ?: return null
        val v = decode(bytes) ?: return null
        runCatching { f.parentFile?.mkdirs(); f.writeBytes(bytes) }
        return v
    }

    /** Assemble les tuiles de la grille (4 téléchargements en parallèle). */
    suspend fun loadGrid(ctx: Context, s: Spec, onTile: (Int, Int) -> Unit): Grid = withContext(Dispatchers.IO) {
        val w = s.w
        val dem = FloatArray(w * s.h)
        val total = s.nx * s.ny
        var done = 0; var missing = 0
        val lock = Mutex()
        val jobs = (0 until s.ny).flatMap { j -> (0 until s.nx).map { i -> i to j } }
        coroutineScope {
            jobs.chunked((jobs.size + 3) / 4).map { part ->
                async {
                    for ((i, j) in part) {
                        val v = loadTile(ctx, s.z, s.x0 + i, s.y0 + j)
                        lock.withLock {
                            if (v == null) missing++
                            else for (r in 0 until TILE) System.arraycopy(v, r * TILE, dem, (j * TILE + r) * w + i * TILE, TILE)
                            done++
                            onTile(done, total)
                        }
                    }
                }
            }.forEach { it.await() }
        }
        Grid(s, dem, missing)
    }

    /** Tuiles à télécharger avec une zone hors ligne (zooms 10 à 14, avec la marge). */
    fun tilesForZone(w: Double, s: Double, e: Double, n: Double): List<Triple<Int, Int, Int>> =
        (MIN_ZOOM..MAX_ZOOM).flatMap { z ->
            val x0 = lonToX(w, z) - MARGIN; val x1 = lonToX(e, z) + MARGIN
            val y0 = latToY(n, z) - MARGIN; val y1 = latToY(s, z) + MARGIN
            (x0..x1).flatMap { x -> (y0..y1).map { y -> Triple(z, x, y) } }
        }

    /** Place prise par le relief sur le téléphone (octets) et nombre de tuiles. */
    fun stored(ctx: Context): Pair<Int, Long> {
        val files = File(ctx.filesDir, "tiles/mnt").walkTopDown().filter { it.isFile }.toList()
        return files.size to files.sumOf { it.length() }
    }

    fun clear(ctx: Context) { File(ctx.filesDir, "tiles/mnt").deleteRecursively() }
}

/** Film des ombres : une image toutes les 30 min sur 24 h (heure du téléphone), comme film.ts. */
object Film {
    const val START_H = 0
    /** Exclu : la dernière image est 23:30. */
    const val END_H = 24
    const val STEP_MIN = 30

    fun times(day: LocalDate): List<LocalDateTime> =
        (START_H * 60 until END_H * 60 step STEP_MIN).map { day.atStartOfDay().plusMinutes(it.toLong()) }

    /** Image affichée d'abord : l'heure actuelle si c'est aujourd'hui, sinon 8 h (départ de rando). */
    fun startIndex(day: LocalDate, now: LocalDateTime = LocalDateTime.now()): Int {
        val min = if (day == now.toLocalDate()) now.hour * 60 + now.minute else 8 * 60
        return max(0, (min - START_H * 60) / STEP_MIN)
    }

    fun epochMs(t: LocalDateTime): Long = t.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
}
