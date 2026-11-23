package fr.assomoutain.proto

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.view.View

/**
 * Carnet (spec/buddies.md §5.8) : les deux dessins de l'écran (même rôle que PetitPlan et ProfilCarnet dans
 * capacitor/src/buddies/Carnet.tsx). Le reste des écrans est dans BuddiesPanel.kt.
 */

/** La trace sur un petit plan, une couleur par jour (écran 12). */
class PetitPlanView(context: Context, private val traces: List<Carnet.TraceCarnet>) : View(context) {
    private val d = resources.displayMetrics.density
    private val trait = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeWidth = 4 * d; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND
    }

    override fun onDraw(c: Canvas) {
        c.drawColor(Color.parseColor("#EFEBE3"))
        val pts = traces.flatMap { it.t.ligne }
        if (pts.size < 2) return
        val lat0 = pts.sumOf { it.lat } / pts.size
        val k = Math.cos(Math.toRadians(lat0))
        val xs = pts.map { it.lon * k }; val ys = pts.map { -it.lat }
        val x0 = xs.min(); val x1 = xs.max(); val y0 = ys.min(); val y1 = ys.max()
        val m = 14 * d
        val e = minOf((width - 2 * m) / (x1 - x0).coerceAtLeast(1e-9), (height - 2 * m) / (y1 - y0).coerceAtLeast(1e-9))
        val ox = (width - (x1 - x0) * e) / 2; val oy = (height - (y1 - y0) * e) / 2
        for (t in traces) {
            val p = Path()
            t.t.ligne.forEachIndexed { i, q ->
                val x = (ox + (q.lon * k - x0) * e).toFloat(); val y = (oy + (-q.lat - y0) * e).toFloat()
                if (i == 0) p.moveTo(x, y) else p.lineTo(x, y)
            }
            trait.color = Color.parseColor(t.couleur)
            c.drawPath(p, trait)
        }
    }
}

/** Profil de tout le Buddy Time, jour après jour (écran 13). */
class ProfilCarnetView(context: Context, private val parts: List<Pair<Carnet.TraceCarnet, Carnet.Relief>>) : View(context) {
    private val d = resources.displayMetrics.density
    private val aire = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val ligne = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 2 * d }
    private val sep = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeWidth = d; color = Color.GRAY; pathEffect = DashPathEffect(floatArrayOf(4 * d, 4 * d), 0f)
    }
    private val txt = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#5F6B66"); textSize = 12 * d }

    override fun onDraw(c: Canvas) {
        c.drawColor(Color.parseColor("#FAF9FD"))
        if (parts.isEmpty()) return
        val total = parts.sumOf { it.second.d.last() }.coerceAtLeast(1).toFloat()
        val zs = parts.flatMap { it.second.z }
        val zmin = zs.min(); val zmax = zs.max(); val dz = maxOf(50, zmax - zmin).toFloat()
        val w = width.toFloat(); val h = height.toFloat()
        fun x(v: Float) = v / total * w
        fun y(z: Int) = 16 * d + (1 - (z - zmin) / dz) * (h - 26 * d)
        var o = 0f
        parts.forEachIndexed { i, (t, r) ->
            val col = Color.parseColor(t.couleur)
            val p = Path(); val a = Path().apply { moveTo(x(o), h) }
            r.d.forEachIndexed { k, dd -> val px = x(o + dd); val py = y(r.z[k]); if (k == 0) p.moveTo(px, py) else p.lineTo(px, py); a.lineTo(px, py) }
            a.lineTo(x(o + r.d.last()), h); a.close()
            aire.color = col; aire.alpha = 46; c.drawPath(a, aire)
            ligne.color = col; c.drawPath(p, ligne)
            if (i > 0) c.drawLine(x(o), 0f, x(o), h, sep)
            o += r.d.last()
        }
        c.drawText(Carnet.metres(zmax), 4 * d, 12 * d, txt)
    }
}
