package fr.assomoutain.proto

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.PointF
import android.graphics.RectF
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Encadrer une zone : calque posé sur la carte qui capte le doigt et trace un rectangle ; au lâcher,
 * renvoie les deux coins en pixels (même principe que FrameOverlay.tsx côté Capacitor).
 * Le calque couvre exactement la carte : les coordonnées écran sont les mêmes.
 */
class FrameDrawView @JvmOverloads constructor(ctx: Context, attrs: AttributeSet? = null) : View(ctx, attrs) {
    var onFrame: ((PointF, PointF) -> Unit)? = null

    private val density = resources.displayMetrics.density
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; color = Color.parseColor("#1D2421"); strokeWidth = 2 * density
        pathEffect = DashPathEffect(floatArrayOf(6 * density, 4 * density), 0f)
    }
    private val fill = Paint().apply { color = Color.parseColor("#227B3FE4") }
    private var start: PointF? = null
    private val rect = RectF()
    private var hasRect = false

    init { setBackgroundColor(Color.parseColor("#0D000000")) }

    fun reset() { start = null; hasRect = false; invalidate() }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> { start = PointF(e.x, e.y); hasRect = false; invalidate() }
            MotionEvent.ACTION_MOVE -> start?.let { s ->
                rect.set(min(s.x, e.x), min(s.y, e.y), max(s.x, e.x), max(s.y, e.y)); hasRect = true; invalidate()
            }
            MotionEvent.ACTION_UP -> {
                val s = start ?: return true
                start = null
                val minPx = 20 * density
                // Simple appui : on recommence.
                if (abs(e.x - s.x) < minPx || abs(e.y - s.y) < minPx) { hasRect = false; invalidate(); return true }
                onFrame?.invoke(s, PointF(e.x, e.y))
            }
            MotionEvent.ACTION_CANCEL -> reset()
        }
        return true
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (!hasRect) return
        canvas.drawRect(rect, fill)
        canvas.drawRect(rect, stroke)
    }
}
