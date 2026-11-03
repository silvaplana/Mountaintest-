package fr.assomoutain.proto

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Préparer un voyage en voiture : itinéraires IGN (plusieurs variantes, dessinées sur la carte pour choisir),
 * puis coût (énergie + péages) calculé par Claude via le relais du VPS. Même code que src/travel/travel.ts.
 */
data class Motorway(val numero: String, val km: Double)
data class CarRoute(val name: String, val color: String, val km: Double, val minutes: Double,
                    val coords: List<DoubleArray>, val motorways: List<Motorway>)
data class CarModel(val nom: String, val energie: String, val conso: Double, val unite: String)
data class TripCost(val prixUnitaire: Double, val unitePrix: String, val coutEnergie: Double, val peages: Double,
                    val peagesDetail: String, val total: Double, val explication: String, val cost: WebCost, val cache: Boolean)

object Travel {
    private const val ITINERAIRE = "https://data.geopf.fr/navigation/itineraire"
    private const val SANS_AUTOROUTE = """{"constraintType":"banned","key":"waytype","operator":"=","value":"autoroute"}"""
    val ENERGIES = linkedMapOf("essence" to "Essence", "diesel" to "Diesel", "electrique" to "Électrique", "hybride" to "Hybride", "gpl" to "GPL")
    val DEFAULT_CONSO = mapOf("essence" to 6.5, "diesel" to 5.5, "electrique" to 17.0, "hybride" to 5.0, "gpl" to 8.0)
    fun unitFor(e: String) = if (e == "electrique") "kWh/100 km" else "L/100 km"
    private val COLORS = listOf("#1d6fe0", "#e4572e", "#2f9e44", "#7b3fe4")

    fun motorways(o: JSONObject): List<Motorway> {
        val km = linkedMapOf<String, Double>()
        val portions = o.optJSONArray("portions") ?: JSONArray()
        for (p in 0 until portions.length()) {
            val steps = portions.getJSONObject(p).optJSONArray("steps") ?: continue
            for (i in 0 until steps.length()) {
                val s = steps.getJSONObject(i)
                val a = s.optJSONObject("attributes") ?: JSONObject()
                val cls = "${a.optString("cpx_classement_administratif")} ${a.optString("nature")}"
                if (!cls.contains("autoroute", ignoreCase = true)) continue
                val n = a.optString("cpx_numero").ifEmpty { "autoroute" }.split(' ', ';')[0]
                km[n] = (km[n] ?: 0.0) + s.optDouble("distance", 0.0) / 1000
            }
        }
        return km.map { (n, k) -> Motorway(n, (k * 10).roundToInt() / 10.0) }.filter { it.km >= 0.5 }
    }

    fun parse(json: String, name: String): CarRoute {
        val o = JSONObject(json)
        val c = o.getJSONObject("geometry").getJSONArray("coordinates")
        val coords = (0 until c.length()).map { val p = c.getJSONArray(it); doubleArrayOf(p.getDouble(0), p.getDouble(1)) }
        return CarRoute(name, "", o.getDouble("distance") / 1000, o.getDouble("duration") / 60, coords, motorways(o))
    }

    /** Deux variantes quasi identiques (même distance et même durée à 2 % près) n'en font qu'une. */
    fun dedupe(routes: List<CarRoute>): List<CarRoute> {
        val out = mutableListOf<CarRoute>()
        for (r in routes) {
            if (out.any { abs(it.km - r.km) < 0.02 * it.km && abs(it.minutes - r.minutes) < 0.02 * it.minutes + 1 }) continue
            out += r
        }
        return out.mapIndexed { i, r -> r.copy(color = COLORS[i % COLORS.size]) }
    }

    private fun get(url: String): String {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 15_000; c.readTimeout = 30_000
        if (c.responseCode != 200) error("itinéraire IGN : HTTP ${c.responseCode}")
        return c.inputStream.bufferedReader().use { it.readText() }
    }

    /** Variantes : avec péages le plus rapide, le plus court et sans autoroute ; sans péages, les deux sans autoroute. Hors fil principal. */
    fun carRoutes(fromLon: Double, fromLat: Double, toLon: Double, toLat: Double, tolls: Boolean): List<CarRoute> {
        val asks = if (tolls) listOf(Triple("Le plus rapide", "fastest", false), Triple("Le plus court", "shortest", false), Triple("Sans autoroute", "fastest", true))
        else listOf(Triple("Sans autoroute, rapide", "fastest", true), Triple("Sans autoroute, court", "shortest", true))
        var firstError: Throwable? = null
        val threads = asks.map { (name, opt, noMotorway) ->
            var r: CarRoute? = null
            val t = Thread {
                runCatching {
                    val q = "resource=bdtopo-pgr&profile=car&optimization=$opt&start=$fromLon,$fromLat&end=$toLon,$toLat" +
                        "&geometryFormat=geojson&getSteps=true&waysAttributes=${URLEncoder.encode("cpx_classement_administratif|cpx_numero|nature", "UTF-8")}" +
                        (if (noMotorway) "&constraints=${URLEncoder.encode(SANS_AUTOROUTE, "UTF-8")}" else "")
                    parse(get("$ITINERAIRE?$q"), name)
                }.onSuccess { r = it }.onFailure { if (firstError == null) firstError = it }
            }
            t.start(); { t.join(); r }
        }
        val ok = threads.mapNotNull { it() }
        if (ok.isEmpty()) throw firstError ?: IllegalStateException("aucun itinéraire")
        return dedupe(ok)
    }

    fun formatDuration(min: Double): String {
        val h = (min / 60).toInt(); val m = (min % 60).roundToInt()
        return if (h > 0) String.format(Locale.FRANCE, "%d h %02d", h, m) else "$m min"
    }

    fun routeLine(r: CarRoute) = "${r.km.roundToInt()} km · ${formatDuration(r.minutes)}" +
        if (r.motorways.isNotEmpty()) " · ${r.motorways.joinToString(", ") { "${it.numero} ${it.km.roundToInt()} km" }}" else ""

    fun euros(v: Double) = String.format(Locale.FRANCE, if (v < 10) "%.2f €" else "%.0f €", v)

    // ---------- Relais IA ----------

    private fun post(path: String, body: JSONObject, password: String): JSONObject {
        val c = URL(WebHikes.RELAIS_URL.removeSuffix("/randos") + "/" + path).openConnection() as HttpURLConnection
        c.requestMethod = "POST"; c.doOutput = true
        c.connectTimeout = 15_000; c.readTimeout = 240_000
        c.setRequestProperty("Content-Type", "application/json")
        c.setRequestProperty("X-Mot-De-Passe", password)
        c.outputStream.use { it.write(body.toString().toByteArray()) }
        val code = c.responseCode
        val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
        // 404 « inconnu » : le relais du VPS tourne encore l'ancienne version (mise à jour toutes les 5 à 10 min).
        if (code == 404) error("le serveur IA n'est pas encore à jour, réessaie dans quelques minutes")
        if (code !in 200..299) error(runCatching { JSONObject(text).optString("erreur") }.getOrNull()?.ifEmpty { null } ?: "relais HTTP $code")
        return JSONObject(text)
    }

    /** Un modèle par ligne (et par énergie disponible). Hors fil principal. */
    fun searchCars(text: String, password: String): List<CarModel> {
        val a = post("voiture", JSONObject().put("recherche", text), password).optJSONArray("voitures") ?: return emptyList()
        return (0 until a.length()).flatMap { i ->
            val v = a.getJSONObject(i)
            val e = v.optJSONArray("energies") ?: JSONArray()
            (0 until e.length()).map { j -> val x = e.getJSONObject(j)
                CarModel(v.optString("nom"), x.optString("energie"), x.optDouble("conso"), x.optString("unite")) }
        }.filter { it.nom.isNotEmpty() && it.energie in ENERGIES }
    }

    fun tripCost(depart: String, arrivee: String, r: CarRoute, voiture: String, energie: String, conso: Double, password: String): TripCost {
        val body = JSONObject().put("depart", depart).put("arrivee", arrivee).put("km", (r.km * 10).roundToInt() / 10.0)
            .put("duree_min", r.minutes.roundToInt()).put("voiture", voiture).put("energie", energie).put("conso", conso).put("unite", unitFor(energie))
            .put("autoroutes", JSONArray(r.motorways.map { JSONObject().put("numero", it.numero).put("km", it.km) }))
        val o = post("voyage", body, password)
        return TripCost(o.optDouble("prix_unitaire"), o.optString("unite_prix"), o.optDouble("cout_energie"), o.optDouble("peages"),
            o.optString("peages_detail"), o.optDouble("total"), o.optString("explication"),
            WebCost(o.optDouble("cout_usd", 0.0), o.optDouble("cumul_mois_usd", 0.0), o.optDouble("cumul_total_usd", 0.0)), o.optBoolean("cache"))
    }
}
