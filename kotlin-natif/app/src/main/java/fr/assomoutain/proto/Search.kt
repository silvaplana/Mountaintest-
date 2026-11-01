package fr.assomoutain.proto

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Recherche de lieux : service d'autocomplétion de la Géoplateforme IGN (gratuit, sans clé).
 * Communes, départements, régions, sommets, lieux-dits, adresses… (même service et mêmes règles
 * que src/search.ts côté Capacitor).
 */
data class Place(val label: String, val detail: String, val lon: Double, val lat: Double, val zoom: Double)

object Search {
    private const val URL_COMPLETION = "https://data.geopf.fr/geocodage/completion/"

    /** Zoom adapté au type de lieu : un département se voit en entier, un sommet de près. */
    fun zoomFor(kind: String, poiTypes: List<String>): Double {
        val t = (listOf(kind) + poiTypes).map { it.lowercase() }
        return when {
            "région" in t -> 7.0
            "département" in t -> 9.0
            "commune" in t -> 13.0
            "street" in t || "housenumber" in t -> 16.0
            else -> 15.0
        }
    }

    fun parse(json: String): List<Place> {
        val results = JSONObject(json).optJSONArray("results") ?: return emptyList()
        return (0 until results.length()).mapNotNull { i ->
            val r = results.getJSONObject(i)
            if (!r.has("x") || !r.has("y")) return@mapNotNull null
            val poi = when (val p = r.opt("poiType")) {
                is org.json.JSONArray -> (0 until p.length()).map { p.getString(it) }
                is String -> listOf(p)
                else -> emptyList()
            }
            val kind = r.optString("kind")
            // poiType va du plus précis au plus général, sauf pour l'administratif (« administratif, département »).
            val detail = (if (poi.firstOrNull() == "administratif") poi.getOrNull(1) else poi.firstOrNull())
                ?: if (r.optString("country") == "StreetAddress") "adresse" else kind
            Place(r.optString("fulltext"), if (detail == "street") "rue" else detail,
                r.getDouble("x"), r.getDouble("y"), zoomFor(kind, poi))
        }
    }

    /** Appel réseau : à lancer hors du fil principal. */
    fun search(text: String): List<Place> {
        val url = URL("$URL_COMPLETION?text=${URLEncoder.encode(text, "UTF-8")}&maximumResponses=8")
        val c = url.openConnection() as HttpURLConnection
        c.connectTimeout = 10_000; c.readTimeout = 15_000
        if (c.responseCode != 200) error("HTTP ${c.responseCode}")
        return parse(c.inputStream.bufferedReader().use { it.readText() })
    }
}
