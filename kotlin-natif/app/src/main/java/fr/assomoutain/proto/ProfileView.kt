package fr.assomoutain.proto

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.util.AttributeSet
import android.view.View
import kotlin.math.roundToInt

/** Profil en coupe : altitude en fonction de la distance parcourue (même dessin que Profile.tsx côté Capacitor). */
class ProfileView @JvmOverloads constructor(ctx: Context, attrs: AttributeSet? = null) : View(ctx, attrs) {
    private val density = resources.displayMetrics.density
    private var pts: List<Pair<Double, Double>> = emptyList()
    private var total = 0.0

    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; color = Color.parseColor("#E4572E"); strokeWidth = 1.8f * density
        strokeJoin = Paint.Join.ROUND
    }
    private val area = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#33E4572E") }
    private val label = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#5F6B66"); textSize = 10 * density }

    fun setData(segments: List<List<Pair<LonLat, Double?>>>?) {
        val out = ArrayList<Pair<Double, Double>>()
        var d = 0.0
        segments?.forEach { seg ->
            seg.forEachIndexed { i, (p, z) ->
                if (i > 0) d += Trails.distanceM(seg[i - 1].first, p)
                if (z != null) out += d to z
            }
        }
        pts = out; total = d
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (pts.size < 2 || total <= 0) return
        var zMin = pts.minOf { it.second }; var zMax = pts.maxOf { it.second }
        if (zMax - zMin < 50) { val m = (zMax + zMin) / 2; zMin = m - 25; zMax = m + 25 }
        val w = width.toFloat(); val h = height.toFloat()
        val l = 34 * density; val b = 16 * density; val t = 6 * density
        fun x(v: Double) = (l + v / total * (w - l - 4 * density)).toFloat()
        fun y(z: Double) = (t + (1 - (z - zMin) / (zMax - zMin)) * (h - t - b)).toFloat()
        val p = Path()
        pts.forEachIndexed { i, (a, z) -> if (i == 0) p.moveTo(x(a), y(z)) else p.lineTo(x(a), y(z)) }
        val fill = Path(p).apply { lineTo(x(total), h - b); lineTo(x(0.0), h - b); close() }
        canvas.drawPath(fill, area)
        canvas.drawPath(p, line)
        label.textAlign = Paint.Align.RIGHT
        canvas.drawText("${zMax.roundToInt()}", l - 4 * density, t + 9 * density, label)
        canvas.drawText("${zMin.roundToInt()}", l - 4 * density, h - b, label)
        canvas.drawText("km", w - 4 * density, h - 3 * density, label)
        val km = total / 1000
        val tick = if (km > 20) 5.0 else if (km > 8) 2.0 else if (km > 3) 1.0 else 0.5
        label.textAlign = Paint.Align.CENTER
        var k = tick
        while (k < km) {
            val s = if (k % 1.0 == 0.0) "${k.toInt()}" else "$k".replace('.', ',')
            canvas.drawText(s, x(k * 1000), h - 3 * density, label)
            k += tick
        }
    }
}
