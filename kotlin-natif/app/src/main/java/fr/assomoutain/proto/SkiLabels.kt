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

    /** Places essayées : d'abord tout près du point, puis un peu plus loin (2e et 3e tours) si tout est pris autour. */
    private class Cand(val dx: Float, val dy: Float, val pen: Float)
    private fun allCandidates(w: Float, h: Float): List<Cand> =
        listOf(13f, 34f, 58f).flatMapIndexed { ring, gap -> candidates(w, h, gap).mapIndexed { k, (dx, dy) -> Cand(dx, dy, ring * 60f + k * 0.5f) } }

    private fun overlap(a: FloatArray, b: FloatArray): Float =
        maxOf(0f, minOf(a[2], b[2]) - maxOf(a[0], b[0])) * maxOf(0f, minOf(a[3], b[3]) - maxOf(a[1], b[1]))

    /**
     * Chaque étiquette (sorties et parkings, la sortie choisie en premier) cherche autour de son point la place qui ne
     * touche ni les autres étiquettes, ni les autres points, ni le bord de l'écran ; si tout est pris tout près, elle
     * s'écarte un peu. Un premier passage glouton, puis quelques passages où chacune se replace en voyant toutes les autres.
     * Rend le décalage (dx, dy) du coin haut-gauche de chaque étiquette par rapport à son point. Comme labels.ts.
     */
    fun place(items: List<Item>, points: List<Pair<Float, Float>>, viewW: Float? = null, viewH: Float? = null, r: Float = 10f): List<Pair<Float, Float>> {
        val dots = points.map { (x, y) -> floatArrayOf(x - r, y - r, x + r, y + r) }
        val boxes = arrayOfNulls<FloatArray>(items.size)
        val out = items.map { 13f to -it.h / 2 }.toMutableList()
        val cands = items.map { allCandidates(it.w, it.h) }
        fun best(i: Int): Pair<Float, Float> {
            val it = items[i]
            var b = out[i]; var bestCost = Float.MAX_VALUE
            for (c in cands[i]) {
                val box = floatArrayOf(it.x + c.dx, it.y + c.dy, it.x + c.dx + it.w, it.y + c.dy + it.h)
                var cost = c.pen
                // Chevaucher une autre étiquette est le pire ; un point ou le bord de l'écran gêne moins.
                for (j in boxes.indices) { val p = boxes[j]; if (p != null && j != i) cost += 6 * overlap(box, p) }
                for (d in dots) cost += 2 * overlap(box, d)
                if (viewW != null && viewH != null) cost += 3 * (it.w * it.h - overlap(box, floatArrayOf(0f, 0f, viewW, viewH)))
                if (cost < bestCost) { bestCost = cost; b = c.dx to c.dy }
            }
            return b
        }
        for (pass in 0 until 4) {
            var moved = false
            for (i in items.indices) {
                val b = best(i)
                if (pass == 0 || b != out[i]) moved = true
                out[i] = b
                val it = items[i]
                boxes[i] = floatArrayOf(it.x + b.first, it.y + b.second, it.x + b.first + it.w, it.y + b.second + it.h)
            }
            if (!moved) break
        }
        return out
    }
}
