package fr.assomoutain.proto

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale

/**
 * Randos trouvées sur le web par Claude : l'appli envoie la zone au relais du VPS (deploy/ia/relais.py),
 * qui garde la clé API et renvoie un point de départ et un lien par rando. Même appel que
 * src/trails/webHikes.ts côté Capacitor.
 */
data class WebHike(
    val nom: String, val lat: Double, val lon: Double, val url: String, val site: String,
    val distanceKm: Double?, val deniveleM: Double?, val resume: String,
)

/** Coût de la recherche (0 si la zone était déjà en cache sur le relais) et cumuls, en dollars. */
data class WebCost(val cout: Double, val mois: Double, val total: Double)

data class WebHikesResult(val hikes: List<WebHike>, val cache: Boolean, val cost: WebCost)

object WebHikes {
    const val RELAIS_URL = "https://silvaplana.cloud/mountaintest-ia/randos"
    const val COLOR = "#f28c28"

    fun parse(json: String): WebHikesResult {
        val o = JSONObject(json)
        val a = o.optJSONArray("randos")
        val hikes = (0 until (a?.length() ?: 0)).mapNotNull { i ->
            val h = a!!.getJSONObject(i)
            val url = h.optString("url")
            val lat = h.optDouble("lat"); val lon = h.optDouble("lon")
            if (lat.isNaN() || lon.isNaN() || !(url.startsWith("http://") || url.startsWith("https://"))) null
            else WebHike(h.optString("nom"), lat, lon, url, h.optString("site"),
                if (h.isNull("distance_km")) null else h.optDouble("distance_km"),
                if (h.isNull("denivele_m")) null else h.optDouble("denivele_m"), h.optString("resume"))
        }
        return WebHikesResult(hikes, o.optBoolean("cache"),
            WebCost(o.optDouble("cout_usd", 0.0), o.optDouble("cumul_mois_usd", 0.0), o.optDouble("cumul_total_usd", 0.0)))
    }

    fun detail(h: WebHike): String = listOfNotNull(
        h.site.ifEmpty { null },
        h.distanceKm?.let { String.format(Locale.FRANCE, "%s km", if (it % 1.0 == 0.0) it.toInt().toString() else it.toString().replace('.', ',')) },
        h.deniveleM?.let { "D+ ${Math.round(it)} m" },
    ).joinToString(" · ")

    private fun usd(v: Double) = String.format(Locale.FRANCE, if (v < 0.1) "%.3f $" else "%.2f $", v)

    fun costLine(c: WebCost, cache: Boolean) =
        "${if (cache) "Zone déjà cherchée : gratuit" else "Coût : ${usd(c.cout)}"} (ce mois-ci ${usd(c.mois)}, total ${usd(c.total)})."

    /** Appel réseau : à lancer hors du fil principal. Claude met 1 à 2 minutes. */
    fun fetch(z: Zone, password: String): WebHikesResult {
        val c = URL(RELAIS_URL).openConnection() as HttpURLConnection
        c.requestMethod = "POST"; c.doOutput = true
        c.connectTimeout = 15_000; c.readTimeout = 240_000
        c.setRequestProperty("Content-Type", "application/json")
        c.setRequestProperty("X-Mot-De-Passe", password)
        val body = JSONObject().put("ouest", z.west).put("sud", z.south).put("est", z.east).put("nord", z.north).toString()
        c.outputStream.use { it.write(body.toByteArray()) }
        val code = c.responseCode
        val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
        if (code !in 200..299) error(runCatching { JSONObject(text).optString("erreur") }.getOrNull()?.ifEmpty { null } ?: "relais HTTP $code")
        return parse(text)
    }
}
