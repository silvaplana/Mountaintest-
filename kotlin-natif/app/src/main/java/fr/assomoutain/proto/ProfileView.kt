package fr.assomoutain.proto

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import kotlin.math.roundToInt

/**
 * Profil en coupe : altitude en fonction de la distance parcourue (même dessin que Profile.tsx côté Capacitor).
 * Glisser le doigt dessus place un curseur (distance, altitude, pente) ; onCursor prévient l'activité.
 */
class ProfileView @JvmOverloads constructor(ctx: Context, attrs: AttributeSet? = null) : View(ctx, attrs) {
    private val density = resources.displayMetrics.density
    private var source: Any? = null
    var profile: ProfileData? = null
        private set
    /** Distance du curseur le long du parcours, ou null. */
    var cursor: Double? = null
        set(v) { field = v; invalidate() }
    var onCursor: ((Double?) -> Unit)? = null

    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; color = Color.parseColor("#E4572E"); strokeWidth = 1.8f * density
        strokeJoin = Paint.Join.ROUND
    }
    private val area = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#33E4572E") }
    private val label = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#5F6B66"); textSize = 10 * density }
    private val cursorLine = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; color = Color.parseColor("#1D2421"); strokeWidth = density
        pathEffect = DashPathEffect(floatArrayOf(3 * density, 2 * density), 0f)
    }
    private val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#E4572E") }
    private val dotRing = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }

    private val left get() = 34 * density

    fun setData(segments: List<List<Pair<LonLat, Double?>>>?) {
        if (segments === source) return // même rando : on garde le curseur
        source = segments
        profile = segments?.let { ProfileData.build(it) }?.takeIf { it.size >= 2 && it.total > 0 }
        cursor = null
        invalidate()
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        val p = profile ?: return false
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE -> {
                parent?.requestDisallowInterceptTouchEvent(true) // le panneau ne défile pas pendant ce temps
                val total = p.d.last()
                val x = ((e.x - left) / (width - left - 4 * density) * total).coerceIn(0.0, total)
                cursor = x
                onCursor?.invoke(x)
            }
        }
        return true
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val p = profile ?: return
        val total = p.d.last()
        var zMin = p.z.min(); var zMax = p.z.max()
        if (zMax - zMin < 50) { val m = (zMax + zMin) / 2; zMin = m - 25; zMax = m + 25 }
        val w = width.toFloat(); val h = height.toFloat()
        val l = left; val b = 16 * density; val t = 6 * density
        fun x(v: Double) = (l + v / total * (w - l - 4 * density)).toFloat()
        fun y(z: Double) = (t + (1 - (z - zMin) / (zMax - zMin)) * (h - t - b)).toFloat()
        val path = Path()
        for (i in 0 until p.size) if (i == 0) path.moveTo(x(p.d[i]), y(p.z[i])) else path.lineTo(x(p.d[i]), y(p.z[i]))
        val fill = Path(path).apply { lineTo(x(total), h - b); lineTo(x(0.0), h - b); close() }
        canvas.drawPath(fill, area)
        canvas.drawPath(path, line)
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
        cursor?.let { c ->
            val at = p.pointAt(c)
            canvas.drawLine(x(at.d), t, x(at.d), h - b, cursorLine)
            canvas.drawCircle(x(at.d), y(at.z), 5 * density, dotRing)
            canvas.drawCircle(x(at.d), y(at.z), 3.5f * density, dot)
        }
    }
}
