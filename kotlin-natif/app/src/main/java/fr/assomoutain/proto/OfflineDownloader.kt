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
 * Mesures relevées : durée, nombre de tuiles, octets des tuiles (= place occupée hors index SQLite).
 */
class OfflineDownloader(private val context: Context) {

    fun download(layer: IgnLayer, onProgress: (String) -> Unit) {
        val definition = OfflineTilePyramidRegionDefinition(
            layer.styleUri(context), Scenario.BOUNDS,
            Scenario.OFFLINE_MIN_ZOOM, Scenario.OFFLINE_MAX_ZOOM,
            1f, // pixelRatio 1 : tuiles 256 px, comme côté Capacitor
        )
        val started = SystemClock.elapsedRealtime()
        OfflineManager.getInstance(context).createOfflineRegion(
            definition, layer.name.toByteArray(),
            object : OfflineManager.CreateOfflineRegionCallback {
                override fun onCreate(offlineRegion: OfflineRegion) {
                    offlineRegion.setObserver(object : OfflineRegion.OfflineRegionObserver {
                        override fun onStatusChanged(status: OfflineRegionStatus) {
                            val ms = SystemClock.elapsedRealtime() - started
                            onProgress("Tuiles ${status.completedTileCount}/${status.requiredResourceCount} " +
                                "(${status.completedTileSize / 1024} Ko, ${ms / 1000} s)")
                            if (status.isComplete) {
                                offlineRegion.setDownloadState(OfflineRegion.STATE_INACTIVE)
                                Log.i(Scenario.BENCH_TAG, """{"offline":"${layer.name}","tiles":${status.completedTileCount},""" +
                                    """"expected":${Scenario.EXPECTED_TILES},"tileBytes":${status.completedTileSize},""" +
                                    """"resourceBytes":${status.completedResourceSize},"ms":$ms}""")
                            }
                        }
                        override fun onError(error: OfflineRegionError) {
                            onProgress("Erreur hors-ligne : ${error.reason} ${error.message}")
                        }
                        override fun mapboxTileCountLimitExceeded(limit: Long) {
                            onProgress("Limite de tuiles atteinte : $limit")
                        }
                    })
                    offlineRegion.setDownloadState(OfflineRegion.STATE_ACTIVE)
                }
                override fun onError(error: String) = onProgress("Erreur : $error")
            })
    }
}
