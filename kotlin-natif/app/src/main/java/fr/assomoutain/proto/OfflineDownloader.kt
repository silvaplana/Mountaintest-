package fr.assomoutain.proto

import android.content.Context
import android.os.SystemClock
import android.util.Log
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.offline.OfflineManager
import org.maplibre.android.offline.OfflineRegion
import org.maplibre.android.offline.OfflineRegionError
import org.maplibre.android.offline.OfflineRegionStatus
import org.maplibre.android.offline.OfflineTilePyramidRegionDefinition

/**
 * Télécharge la bbox du scénario (z10 à z16) dans la base hors-ligne de MapLibre.
 * En mode Auto : Plan IGN z10-12 et SCAN 25 z12-16 (zooms des sources du style, voir Scenario.kt).
 * Mesures relevées : durée, nombre de tuiles, octets des tuiles (= place occupée hors index SQLite).
 */
class OfflineDownloader(private val context: Context) {

    data class Progress(val done: Long, val total: Long, val bytes: Long, val seconds: Long, val finished: Boolean, val error: String? = null)

    private val manager get() = OfflineManager.getInstance(context)
    private var current: OfflineRegion? = null

    /**
     * Télécharge la zone pour ce fond de carte. Si elle existe déjà, on la reprend : les tuiles déjà
     * présentes ne sont pas retéléchargées (la base est gardée par les mises à jour de l'appli).
     */
    fun download(mode: MapMode, apiKey: String, bounds: LatLngBounds?, onProgress: (Progress) -> Unit) {
        // Zone du scénario : « SCAN25 » ; zone affichée : « SCAN25|sud,ouest,nord,est ».
        val meta = if (bounds == null) mode.name else String.format(java.util.Locale.US, "%s|%.4f,%.4f,%.4f,%.4f",
            mode.name, bounds.latitudeSouth, bounds.longitudeWest, bounds.latitudeNorth, bounds.longitudeEast)
        manager.listOfflineRegions(object : OfflineManager.ListOfflineRegionsCallback {
            override fun onList(offlineRegions: Array<OfflineRegion>?) {
                val existing = offlineRegions.orEmpty().firstOrNull { String(it.metadata) == meta }
                if (existing != null) start(existing, mode, onProgress) else create(mode, apiKey, bounds ?: Scenario.BOUNDS, meta, onProgress)
            }
            override fun onError(error: String) = create(mode, apiKey, bounds ?: Scenario.BOUNDS, meta, onProgress)
        })
    }

    companion object {
        /** Au-delà, le téléchargement serait long et lourd : on demande de zoomer (même limite côté Capacitor). */
        const val MAX_ZONE_TILES = 6000

        /** Nombre de tuiles 256 px de la zone pour ce fond (mêmes zooms que le style hors ligne). */
        fun tileCount(mode: MapMode, b: LatLngBounds): Int {
            val min = Scenario.OFFLINE_MIN_ZOOM.toInt(); val max = Scenario.OFFLINE_MAX_ZOOM.toInt()
            val ranges = if (mode == MapMode.AUTO) listOf(min..Scenario.AUTO_SCAN_FROM, Scenario.AUTO_SCAN_FROM..max) else listOf(min..max)
            return ranges.sumOf { r -> r.sumOf { z ->
                val x0 = lonToX(b.longitudeWest, z); val x1 = lonToX(b.longitudeEast, z)
                val y0 = latToY(b.latitudeNorth, z); val y1 = latToY(b.latitudeSouth, z)
                (x1 - x0 + 1) * (y1 - y0 + 1)
            } }
        }
        private fun lonToX(lon: Double, z: Int) = Math.floor((lon + 180) / 360 * (1 shl z)).toInt()
        private fun latToY(lat: Double, z: Int): Int {
            val r = Math.toRadians(lat)
            return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * (1 shl z)).toInt()
        }
    }

    /** Taille de la base hors ligne de MapLibre sur le téléphone (tuiles téléchargées + cache des tuiles vues). */
    fun databaseBytes(): Long =
        context.filesDir.listFiles { f -> f.name.startsWith("mbgl-offline.db") }?.sumOf { it.length() } ?: 0L

    fun cancel() {
        current?.setDownloadState(OfflineRegion.STATE_INACTIVE)
        current = null
    }

    /** Efface toutes les régions hors ligne. */
    fun clear(onDone: () -> Unit) { cancel(); deleteRegions({ true }, onDone) }

    /** Résumé des régions présentes : nombre de tuiles et taille. */
    fun summary(onResult: (String) -> Unit) {
        manager.listOfflineRegions(object : OfflineManager.ListOfflineRegionsCallback {
            override fun onList(offlineRegions: Array<OfflineRegion>?) {
                val regions = offlineRegions.orEmpty()
                if (regions.isEmpty()) { onResult("rien"); return }
                val parts = ArrayList<String>()
                regions.forEach { r ->
                    r.getStatus(object : OfflineRegion.OfflineRegionStatusCallback {
                        override fun onStatus(status: OfflineRegionStatus?) {
                            val meta = String(r.metadata).split("|")
                            val label = runCatching { MapMode.valueOf(meta[0]).label }.getOrDefault("?") +
                                if (meta.size > 1) " (zone choisie)" else " (La Ciotat)"
                            parts += "$label : ${status?.completedTileCount ?: 0} tuiles, ${(status?.completedTileSize ?: 0) / 1_000_000} Mo"
                            if (parts.size == regions.size) onResult(parts.joinToString(" ; "))
                        }
                        override fun onError(error: String?) {
                            parts += "erreur"
                            if (parts.size == regions.size) onResult(parts.joinToString(" ; "))
                        }
                    })
                }
            }
            override fun onError(error: String) = onResult("erreur : $error")
        })
    }

    private fun deleteRegions(match: (ByteArray) -> Boolean, onDone: () -> Unit) {
        manager.listOfflineRegions(object : OfflineManager.ListOfflineRegionsCallback {
            override fun onList(offlineRegions: Array<OfflineRegion>?) {
                val targets = offlineRegions.orEmpty().filter { match(it.metadata) }
                if (targets.isEmpty()) { onDone(); return }
                var left = targets.size
                targets.forEach { r ->
                    r.setDownloadState(OfflineRegion.STATE_INACTIVE)
                    r.delete(object : OfflineRegion.OfflineRegionDeleteCallback {
                        override fun onDelete() { if (--left == 0) onDone() }
                        override fun onError(error: String) { if (--left == 0) onDone() }
                    })
                }
            }
            override fun onError(error: String) = onDone()
        })
    }

    private fun create(mode: MapMode, apiKey: String, bounds: LatLngBounds, meta: String, onProgress: (Progress) -> Unit) {
        val definition = OfflineTilePyramidRegionDefinition(
            mode.styleUri(context, apiKey), bounds,
            Scenario.OFFLINE_MIN_ZOOM, Scenario.OFFLINE_MAX_ZOOM,
            1f, // pixelRatio 1 : tuiles 256 px, comme côté Capacitor
        )
        manager.createOfflineRegion(
            definition, meta.toByteArray(),
            object : OfflineManager.CreateOfflineRegionCallback {
                override fun onCreate(offlineRegion: OfflineRegion) = start(offlineRegion, mode, onProgress)
                override fun onError(error: String) = onProgress(Progress(0, 0, 0, 0, false, error))
            })
    }

    private fun start(offlineRegion: OfflineRegion, mode: MapMode, onProgress: (Progress) -> Unit) {
        val started = SystemClock.elapsedRealtime()
                    current = offlineRegion
                    offlineRegion.setObserver(object : OfflineRegion.OfflineRegionObserver {
                        override fun onStatusChanged(status: OfflineRegionStatus) {
                            val ms = SystemClock.elapsedRealtime() - started
                            onProgress(Progress(status.completedResourceCount, status.requiredResourceCount,
                                status.completedTileSize, ms / 1000, status.isComplete))
                            if (status.isComplete) {
                                offlineRegion.setDownloadState(OfflineRegion.STATE_INACTIVE)
                                current = null
                                Log.i(Scenario.BENCH_TAG, """{"offline":"${mode.name}","tiles":${status.completedTileCount},""" +
                                    """"expected":${Scenario.EXPECTED_TILES},"tileBytes":${status.completedTileSize},""" +
                                    """"resourceBytes":${status.completedResourceSize},"ms":$ms}""")
                            }
                        }
                        override fun onError(error: OfflineRegionError) {
                            onProgress(Progress(0, 0, 0, 0, false, "${error.reason} ${error.message}"))
                        }
                        override fun mapboxTileCountLimitExceeded(limit: Long) {
                            onProgress(Progress(0, 0, 0, 0, false, "limite de tuiles atteinte : $limit"))
                        }
                    })
                    offlineRegion.setDownloadState(OfflineRegion.STATE_ACTIVE)
    }
}
