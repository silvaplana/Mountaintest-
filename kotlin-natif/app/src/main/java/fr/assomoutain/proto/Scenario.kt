package fr.assomoutain.proto

import android.content.Context
import org.maplibre.android.geometry.LatLngBounds
import java.io.File

/** Paramètres du scénario commun (prototypes/scenario-commun/SCENARIO.md). Ne pas modifier d'un seul côté. */
object Scenario {
    // bbox [5.55, 43.15, 5.66, 43.21]
    val BOUNDS: LatLngBounds = LatLngBounds.from(43.21, 5.66, 43.15, 5.55)
    const val OFFLINE_MIN_ZOOM = 10.0
    const val OFFLINE_MAX_ZOOM = 16.0
    const val EXPECTED_TILES = 467
    const val MAX_DISPLAY_ZOOM = 18.0
    const val BENCH_TAG = "ASSO_BENCH"
}

enum class IgnLayer(val label: String, val wmtsLayer: String, val format: String, val maxNativeZoom: Int, val needsKey: Boolean) {
    SCAN25("SCAN 25", "GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN25TOUR", "image/jpeg", 16, true),
    PLAN("Plan IGN v2", "GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2", "image/png", 19, false);

    fun tileUrl(): String {
        val base = if (needsKey) "https://data.geopf.fr/private/wmts" else "https://data.geopf.fr/wmts"
        val key = if (needsKey) "&apikey=${BuildConfig.IGN_SCAN_KEY}" else ""
        return "$base?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=$wmtsLayer&STYLE=normal" +
            "&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=$format$key"
    }

    /**
     * Écrit le style dans un fichier et renvoie son URI file://. Le même URI sert à l'affichage et à la
     * région hors-ligne : MapLibre retrouve ainsi les tuiles téléchargées sans réseau.
     */
    fun styleUri(context: Context): String {
        val json = """
            {
              "version": 8,
              "name": "$label",
              "sources": {
                "ign": {
                  "type": "raster",
                  "tiles": ["${tileUrl()}"],
                  "tileSize": 256,
                  "minzoom": 0,
                  "maxzoom": $maxNativeZoom,
                  "attribution": "© IGN"
                }
              },
              "layers": [
                {"id": "background", "type": "background", "paint": {"background-color": "#f2efe9"}},
                {"id": "ign", "type": "raster", "source": "ign", "paint": {"raster-fade-duration": 0}}
              ]
            }
        """.trimIndent()
        val file = File(context.filesDir, "style-${name.lowercase()}.json")
        if (!file.exists() || file.readText() != json) file.writeText(json)
        return "file://${file.absolutePath}"
    }
}
