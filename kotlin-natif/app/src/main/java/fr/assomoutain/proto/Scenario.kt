package fr.assomoutain.proto

import android.content.Context
import org.maplibre.android.geometry.LatLngBounds
import java.io.File

/** Paramètres du scénario commun (prototypes/scenario-commun/SCENARIO.md). Ne pas modifier d'un seul côté. */
object Scenario {
    // bbox [5.55, 43.15, 5.66, 43.21]
    val BOUNDS: LatLngBounds = LatLngBounds.from(43.21, 5.66, 43.15, 5.55)
    /** Clé transitoire publiée par l'IGN en 2024 ; remplacée par celle saisie dans l'onglet Hors ligne. */
    val DEFAULT_SCAN_KEY: String = BuildConfig.IGN_SCAN_KEY
    const val OFFLINE_MIN_ZOOM = 10.0
    const val OFFLINE_MAX_ZOOM = 16.0
    const val EXPECTED_TILES = 467
    const val MAX_DISPLAY_ZOOM = 18.0
    const val BENCH_TAG = "ASSO_BENCH"

    // Carte « Auto » (même réglage que le prototype Capacitor, src/config.ts) :
    // Plan IGN de loin, SCAN 25 de près, fondu entre les zooms 13 et 14.
    // Hors ligne : Plan IGN z10-13 + SCAN 25 z13-16.
    const val AUTO_SCAN_FROM = 13
    const val AUTO_PLAN_UNTIL = 14
}

enum class IgnLayer(val label: String, val wmtsLayer: String, val format: String, val maxNativeZoom: Int, val needsKey: Boolean) {
    SCAN25("SCAN 25", "GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN25TOUR", "image/jpeg", 16, true),
    PLAN("Plan IGN v2", "GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2", "image/png", 19, false),
    // Surcouche « pentes > 30° », comme côté Capacitor. Ajoutée à l'affichage seulement (pas au style
    // hors-ligne), pour que le téléchargement compte les mêmes tuiles que l'autre prototype.
    SLOPES("Pentes > 30°", "GEOGRAPHICALGRIDSYSTEMS.SLOPES.MOUNTAIN", "image/png", 17, false);

    fun tileUrl(apiKey: String): String {
        val base = if (needsKey) "https://data.geopf.fr/private/wmts" else "https://data.geopf.fr/wmts"
        val key = if (needsKey) "&apikey=$apiKey" else ""
        return "$base?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=$wmtsLayer&STYLE=normal" +
            "&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=$format$key"
    }
}

/** Fond de carte choisi par l'utilisateur. */
enum class MapMode(val label: String) {
    AUTO("Carte auto"),
    SCAN25("SCAN 25"),
    PLAN("Plan IGN v2");

    fun next(): MapMode = entries[(ordinal + 1) % entries.size]

    /** Couches et zooms téléchargés hors ligne pour ce fond (même découpage que offlinePlan côté Capacitor). */
    fun offlinePlan(): String = when (this) {
        AUTO -> "Plan IGN z${Scenario.OFFLINE_MIN_ZOOM.toInt()}-${Scenario.AUTO_SCAN_FROM} + SCAN 25 z${Scenario.AUTO_SCAN_FROM}-${Scenario.OFFLINE_MAX_ZOOM.toInt()}"
        SCAN25 -> "SCAN 25 z${Scenario.OFFLINE_MIN_ZOOM.toInt()}-${Scenario.OFFLINE_MAX_ZOOM.toInt()}"
        PLAN -> "Plan IGN z${Scenario.OFFLINE_MIN_ZOOM.toInt()}-${Scenario.OFFLINE_MAX_ZOOM.toInt()}"
    }

    private fun source(layer: IgnLayer, apiKey: String, minZoom: Int, maxZoom: Int) = """
        {
          "type": "raster",
          "tiles": ["${layer.tileUrl(apiKey)}"],
          "tileSize": 256,
          "minzoom": $minZoom,
          "maxzoom": $maxZoom,
          "attribution": "© IGN"
        }
    """.trimIndent()

    /**
     * Écrit le style dans un fichier et renvoie son URI file://. Le même URI sert à l'affichage et à la
     * région hors-ligne : MapLibre retrouve ainsi les tuiles téléchargées sans réseau, et ne télécharge
     * pour chaque source que les zooms où elle est utilisée (minzoom/maxzoom des sources).
     */
    fun styleUri(context: Context, apiKey: String): String {
        val scan = IgnLayer.SCAN25
        val plan = IgnLayer.PLAN
        val bg = """{"id": "background", "type": "background", "paint": {"background-color": "#f2efe9"}}"""
        val (sources, layers) = when (this) {
            SCAN25 -> """"scan": ${source(scan, apiKey, 0, scan.maxNativeZoom)}""" to
                """{"id": "scan", "type": "raster", "source": "scan", "paint": {"raster-fade-duration": 0}}"""
            PLAN -> """"plan": ${source(plan, apiKey, 0, plan.maxNativeZoom)}""" to
                """{"id": "plan", "type": "raster", "source": "plan", "paint": {"raster-fade-duration": 0}}"""
            AUTO -> """
                "plan": ${source(plan, apiKey, 0, Scenario.AUTO_SCAN_FROM)},
                "scan": ${source(scan, apiKey, Scenario.AUTO_SCAN_FROM, scan.maxNativeZoom)}
            """.trimIndent() to """
                {"id": "plan", "type": "raster", "source": "plan", "maxzoom": ${Scenario.AUTO_PLAN_UNTIL},
                 "paint": {"raster-fade-duration": 0}},
                {"id": "scan", "type": "raster", "source": "scan", "minzoom": ${Scenario.AUTO_SCAN_FROM},
                 "paint": {"raster-fade-duration": 0,
                   "raster-opacity": ["interpolate", ["linear"], ["zoom"], ${Scenario.AUTO_SCAN_FROM}, 0, ${Scenario.AUTO_PLAN_UNTIL}, 1]}}
            """.trimIndent()
        }
        val json = """{"version": 8, "name": "$label", "sources": {$sources}, "layers": [$bg, $layers]}"""
        val file = File(context.filesDir, "style-${name.lowercase()}.json")
        if (!file.exists() || file.readText() != json) file.writeText(json)
        return "file://${file.absolutePath}"
    }
}
