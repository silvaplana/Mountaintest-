package fr.assomoutain.proto

import android.content.Context
import android.os.SystemClock
import android.util.Log
import org.maplibre.android.offline.OfflineManager
import org.maplibre.android.offline.OfflineRegion
import org.maplibre.android.offline.OfflineRegionError
import org.maplibre.android.offline.OfflineRegionStatus
import org.maplibre.android.offline.OfflineTilePyramidRegionDefinition

/**
 * Télécharge la bbox du scénario (z10 à z16) dans la base hors-ligne de MapLibre.
 * En mode Auto : Plan IGN z10-13 et SCAN 25 z13-16 (zooms des sources du style, voir Scenario.kt).
 * Mesures relevées : durée, nombre de tuiles, octets des tuiles (= place occupée hors index SQLite).
 */
class OfflineDownloader(private val context: Context) {

    data class Progress(val done: Long, val total: Long, val bytes: Long, val seconds: Long, val finished: Boolean, val error: String? = null)

    private val manager get() = OfflineManager.getInstance(context)
    private var current: OfflineRegion? = null

    /** Remplace la région déjà téléchargée pour ce fond de carte, puis télécharge. */
    fun download(mode: MapMode, apiKey: String, onProgress: (Progress) -> Unit) {
        deleteRegions({ String(it) == mode.name }) { create(mode, apiKey, onProgress) }
    }

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
                            val label = runCatching { MapMode.valueOf(String(r.metadata)).label }.getOrDefault("?")
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

    private fun create(mode: MapMode, apiKey: String, onProgress: (Progress) -> Unit) {
        val definition = OfflineTilePyramidRegionDefinition(
            mode.styleUri(context, apiKey), Scenario.BOUNDS,
            Scenario.OFFLINE_MIN_ZOOM, Scenario.OFFLINE_MAX_ZOOM,
            1f, // pixelRatio 1 : tuiles 256 px, comme côté Capacitor
        )
        val started = SystemClock.elapsedRealtime()
        manager.createOfflineRegion(
            definition, mode.name.toByteArray(),
            object : OfflineManager.CreateOfflineRegionCallback {
                override fun onCreate(offlineRegion: OfflineRegion) {
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
                override fun onError(error: String) = onProgress(Progress(0, 0, 0, 0, false, error))
            })
    }
}
