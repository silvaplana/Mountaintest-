package fr.assomoutain.proto

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.Locale
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.roundToLong

/**
 * Forêts par essence : BD Forêt® V2 de l'IGN (carte forestière, licence ouverte Etalab 2.0), lue par le
 * service WFS de la Géoplateforme (gratuit, sans clé). Chaque massif de plus de 0,5 ha porte son essence
 * principale. Même requête, mêmes couleurs et mêmes règles que src/forests/bdForet.ts côté Capacitor.
 */
data class Forest(
    val id: String,
    /** Essence principale, ou type de formation quand l'essence n'est pas renseignée (landes…). */
    val essence: String,
    val type: String,
    val color: String,
    /** Polygones : anneau extérieur puis trous. */
    val polygons: List<List<List<LonLat>>>,
    val areaHa: Double,
)

data class EssenceGroup(val essence: String, val color: String, val count: Int, val areaHa: Double)

object Forests {
    const val ATTRIBUTION = "© IGN – BD Forêt® V2 (licence ouverte Etalab 2.0)"
    private const val WFS_URL = "https://data.geopf.fr/wfs/ows"
    const val TYPENAME = "LANDCOVER.FORESTINVENTORY.V2:formation_vegetale"
    /** Au-delà (environ 20 km de côté), la réponse dépasserait plusieurs dizaines de Mo. */
    const val MAX_ZONE_DEG = 0.2
    /** Nombre maximum de massifs demandés en une fois (le serveur en renvoie au plus 5000). */
    const val MAX_FORESTS = 5000

    fun zoneTooBig(z: Zone) = z.east - z.west > MAX_ZONE_DEG || z.north - z.south > MAX_ZONE_DEG

    fun wfsUrl(z: Zone): String {
        fun f(v: Double) = String.format(Locale.US, "%.5f", v)
        fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
        // En WFS 2.0 avec ce nom de système, l'ordre est latitude puis longitude.
        val bbox = "${f(z.south)},${f(z.west)},${f(z.north)},${f(z.east)},urn:ogc:def:crs:EPSG::4326"
        return "$WFS_URL?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=${enc(TYPENAME)}" +
            "&OUTPUTFORMAT=${enc("application/json")}&SRSNAME=${enc("EPSG:4326")}&BBOX=${enc(bbox)}&COUNT=$MAX_FORESTS"
    }

    private val COLORS = mapOf(
        "Chênes décidus" to "#b08d2c",
        "Chênes sempervirents" to "#6b7d1f",
        "Hêtre" to "#7cc242",
        "Châtaignier" to "#c4702a",
        "Robinier" to "#d9c43a",
        "Peuplier" to "#b5d334",
        "Feuillus" to "#94c973",
        "Pin d'Alep" to "#2e8b3e",
        "Pin maritime" to "#1b5e20",
        "Pin sylvestre" to "#2a9d8f",
        "Pin laricio, pin noir" to "#00695c",
        "Pin à crochets, pin cembro" to "#26667a",
        "Pins mélangés" to "#3f8f5a",
        "Autres pins" to "#4d7c3a",
        "Sapin, épicéa" to "#1f4e79",
        "Mélèze" to "#8e6cc2",
        "Douglas" to "#3949ab",
        "Conifères" to "#2f6f4f",
        "Autres conifères" to "#456b5e",
        "Mixte" to "#7f9c4a",
    )
    private val PALETTE = listOf("#e07a5f", "#81b29a", "#f2cc8f", "#3d405b", "#c06c84", "#6c5b7b", "#355c7d", "#99b898")
    private const val NON_TREE = "#c9b79c"

    /** Même calcul que côté Capacitor (hachage sur les unités UTF-16), pour les mêmes couleurs. */
    fun essenceColor(essence: String, tree: Boolean = true): String {
        COLORS[essence]?.let { return it }
        if (!tree) return NON_TREE
        var h = 0L
        for (c in essence) h = (h * 31 + c.code) and 0xffffffffL
        return PALETTE[(h % PALETTE.size).toInt()]
    }

    /** « NC » : non concerné (landes…) ; « NR » : non renseigné. On montre alors le type de formation. */
    fun essenceLabel(essence: String?, tfvG11: String?, tfv: String?): Pair<String, Boolean> {
        val e = essence?.trim().orEmpty()
        if (e.isNotEmpty() && e != "NC" && e != "NR") return e to true
        val l = tfvG11?.trim().orEmpty().ifEmpty { tfv?.trim().orEmpty() }.ifEmpty { "Non renseigné" }
        return l to false
    }

    /** Surface d'un anneau en m² (projection locale, assez précise à l'échelle d'un massif). */
    fun ringAreaM2(ring: List<LonLat>): Double {
        if (ring.size < 3) return 0.0
        val lat0 = ring.sumOf { it.lat } / ring.size
        val kx = 111_320 * cos(Math.toRadians(lat0)); val ky = 110_540.0
        var a = 0.0
        var j = ring.size - 1
        for (i in ring.indices) {
            a += (ring[j].lon * kx) * (ring[i].lat * ky) - (ring[i].lon * kx) * (ring[j].lat * ky)
            j = i
        }
        return abs(a) / 2
    }

    fun polygonsAreaHa(polygons: List<List<List<LonLat>>>): Double {
        var m2 = 0.0
        polygons.forEach { p -> p.forEachIndexed { k, r -> m2 += if (k == 0) ringAreaM2(r) else -ringAreaM2(r) } }
        return max(0.0, m2) / 10_000
    }

    private fun ring(a: JSONArray, swap: Boolean) = (0 until a.length()).map {
        val p = a.getJSONArray(it)
        if (swap) LonLat(p.getDouble(1), p.getDouble(0)) else LonLat(p.getDouble(0), p.getDouble(1))
    }

    private fun polygon(a: JSONArray, swap: Boolean) = (0 until a.length()).map { ring(a.getJSONArray(it), swap) }

    fun parseForests(json: String): List<Forest> {
        val features = JSONObject(json).optJSONArray("features") ?: return emptyList()
        val out = mutableListOf<Forest>()
        for (i in 0 until features.length()) {
            val f = features.getJSONObject(i)
            val g = f.optJSONObject("geometry") ?: continue
            val coords = g.optJSONArray("coordinates") ?: continue
            val raw = when (g.optString("type")) {
                "Polygon" -> JSONArray().put(coords)
                "MultiPolygon" -> coords
                else -> continue
            }
            // Le serveur rend du lon/lat ; par prudence, on retourne si on reçoit du lat/lon (en France, lat > 40 > lon).
            val first = runCatching { raw.getJSONArray(0).getJSONArray(0).getJSONArray(0).getDouble(0) }.getOrNull() ?: continue
            val swap = first >= 40
            val polys = (0 until raw.length()).map { polygon(raw.getJSONArray(it), swap) }.filter { it.isNotEmpty() && it[0].size >= 4 }
            if (polys.isEmpty()) continue
            val pr = f.optJSONObject("properties") ?: JSONObject()
            fun s(k: String) = if (pr.isNull(k)) null else pr.optString(k)
            val (label, tree) = essenceLabel(s("essence"), s("tfv_g11"), s("tfv"))
            out += Forest(
                id = s("id") ?: f.optString("id", out.size.toString()),
                essence = label,
                type = s("tfv")?.trim().orEmpty(),
                color = essenceColor(label, tree),
                polygons = polys,
                areaHa = polygonsAreaHa(polys),
            )
        }
        return out
    }

    /** Essences présentes, de la plus étendue à la moins étendue. */
    fun groupByEssence(forests: List<Forest>): List<EssenceGroup> =
        forests.groupBy { it.essence }.map { (e, l) -> EssenceGroup(e, l.first().color, l.size, l.sumOf { it.areaHa }) }
            .sortedByDescending { it.areaHa }

    fun fetchForests(z: Zone): List<Forest> {
        val c = URL(wfsUrl(z)).openConnection() as HttpURLConnection
        c.connectTimeout = 15_000; c.readTimeout = 90_000
        c.setRequestProperty("User-Agent", "Assomountain-proto (Android)")
        if (c.responseCode != 200) error("HTTP ${c.responseCode}")
        return parseForests(c.inputStream.bufferedReader().use { it.readText() })
    }

    /** « 1 234 ha » ou « 3,5 ha ». */
    fun formatHa(ha: Double): String =
        if (ha >= 100) String.format(Locale.FRANCE, "%,d ha", ha.roundToLong()) else String.format(Locale.FRANCE, "%.1f ha", ha)
}
