package fr.assomoutain.proto

/** Modes communs aux deux prototypes (table « Modes GPS communs » du scénario). */
enum class GpsMode(val label: String, val minDistanceM: Float, val minIntervalMs: Long) {
    RANDO("rando", 10f, 5_000),
    VELO("velo", 20f, 2_000),
    ECO("eco", 50f, 30_000);

    fun next(): GpsMode = entries[(ordinal + 1) % entries.size]
}
