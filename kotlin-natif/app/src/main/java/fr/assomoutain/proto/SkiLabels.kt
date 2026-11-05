package fr.assomoutain.proto

/**
 * Placement des étiquettes de la carte (sorties skitour, parkings) pour qu'elles se chevauchent le moins possible.
 * Même algorithme que src/ski/labels.ts de l'appli web.
 */
object SkiLabels {
    class Item(val x: Float, val y: Float, val w: Float, val h: Float)

    /** Coin haut-gauche de l'étiquette par rapport à son point, dans l'ordre de préférence (à droite d'abord). */
    fun candidates(w: Float, h: Float, gap: Float = 13f): List<Pair<Float, Float>> {
        val g = gap * 0.6f
        return listOf(gap to -h / 2, -gap - w to -h / 2, g to -h - g, g to g, -w - g to -h - g, -w - g to g, -w / 2 to -h - gap, -w / 2 to gap)
    }

    private fun overlap(a: FloatArray, b: FloatArray): Float =
        maxOf(0f, minOf(a[2], b[2]) - maxOf(a[0], b[0])) * maxOf(0f, minOf(a[3], b[3]) - maxOf(a[1], b[1]))

    /**
     * Glouton : chaque étiquette (dans l'ordre donné, la sortie choisie en premier) prend la première place libre autour
     * de son point, sans toucher les étiquettes déjà posées ni les autres points, dans l'écran ; sinon la place qui
     * chevauche le moins. Rend le décalage (dx, dy) du coin haut-gauche de chaque étiquette par rapport à son point.
     */
    fun place(items: List<Item>, points: List<Pair<Float, Float>>, viewW: Float? = null, viewH: Float? = null, r: Float = 10f): List<Pair<Float, Float>> {
        val placed = mutableListOf<FloatArray>()
        val dots = points.map { (x, y) -> floatArrayOf(x - r, y - r, x + r, y + r) }
        return items.map { it ->
            var best = 13f to -it.h / 2
            var bestCost = Float.MAX_VALUE
            for ((dx, dy) in candidates(it.w, it.h)) {
                val box = floatArrayOf(it.x + dx, it.y + dy, it.x + dx + it.w, it.y + dy + it.h)
                var cost = 0f
                for (p in placed) cost += overlap(box, p)
                for (d in dots) cost += overlap(box, d)
                // Ce qui dépasse de l'écran (ou passe sous la colonne d'icônes) compte aussi comme un chevauchement.
                if (viewW != null && viewH != null) cost += it.w * it.h - overlap(box, floatArrayOf(0f, 0f, viewW, viewH))
                if (cost < bestCost) { bestCost = cost; best = dx to dy }
                if (cost == 0f) break
            }
            placed.add(floatArrayOf(it.x + best.first, it.y + best.second, it.x + best.first + it.w, it.y + best.second + it.h))
            best
        }
    }
}
