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
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Profil en coupe : altitude en fonction de la distance parcourue (même dessin que Profile.tsx côté Capacitor).
 * Échelle fixe (ProfileData.scale) : une même pente a toujours le même angle, quelle que soit la trace ;
 * une trace longue et plate défile de côté en glissant le doigt. Toucher place un curseur (distance, altitude,
 * pente) ; onCursor prévient l'activité. Sur une trace qui tient à l'écran, glisser déplace le curseur.
 * 🚵 runs : type de chemin par portion (mode VTT), en bande sous le profil.
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
    /** 🚵 Types de chemin le long de la trace (null : pas affichés). */
    var runs: List<WayTypes.Run>? = null
        set(v) { if (field != v) { field = v; requestLayout(); invalidate() } }
    private var offset = 0f
    private var downX = 0f; private var downOff = 0f; private var moved = false

    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; color = Color.parseColor("#E4572E"); strokeWidth = 1.8f * density
        strokeJoin = Paint.Join.ROUND
    }
    private val area = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#33E4572E") }
    private val label = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#5F6B66"); textSize = 11 * density }
    private val cursorLine = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; color = Color.parseColor("#1D2421"); strokeWidth = density
        pathEffect = DashPathEffect(floatArrayOf(3 * density, 2 * density), 0f)
    }
    private val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#E4572E") }
    private val dotRing = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }

    private val left get() = 34 * density
    private val padRight get() = 6 * density
    private val padTop get() = 6 * density
    private val bottomAxis get() = 16 * density
    private val gaugeRow get() = 22 * density
    private val band get() = if (runs.isNullOrEmpty()) 0f else 8 * density
    private val gauge = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = Color.parseColor("#E4572E"); strokeWidth = 1.8f * density }
    private val runPaint = Paint()
    private val grPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; color = Color.parseColor(WayTypes.GR_COLOR); strokeWidth = 2 * density
        pathEffect = DashPathEffect(floatArrayOf(4 * density, 3 * density), 0f)
    }

    fun setData(segments: List<List<Pair<LonLat, Double?>>>?) {
        if (segments === source) return // même rando : on garde le curseur
        source = segments
        profile = segments?.let { ProfileData.build(it) }?.takeIf { it.size >= 2 && it.total > 0 }
        cursor = null
        offset = 0f
        requestLayout()
        invalidate()
    }

    /** Échelle en dp (comme le px CSS côté Capacitor), puis convertie en pixels. */
    private fun scaleFor(w: Int): ProfileScale? {
        val p = profile ?: return null
        val plotWdp = (w - left - padRight) / density
        return ProfileData.scale(p.d.last(), p.z.max() - p.z.min(), plotWdp.toDouble())
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val w = MeasureSpec.getSize(widthMeasureSpec)
        val sc = scaleFor(w)
        val h = if (sc == null) 0 else (padTop + sc.plotH.toFloat() * density + band + bottomAxis + gaugeRow).toInt()
        setMeasuredDimension(w, h)
    }

    private fun maxOffset(): Float {
        val sc = scaleFor(width) ?: return 0f
        return maxOf(0f, (sc.contentW * density).toFloat() - (width - left - padRight))
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        val p = profile ?: return false
        val sc = scaleFor(width) ?: return false
        val s = sc.s * density
        val total = p.d.last()
        fun at(x: Float) = ((x - left + offset) / s).coerceIn(0.0, total)
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                parent?.requestDisallowInterceptTouchEvent(true) // le panneau ne défile pas pendant ce temps
                downX = e.x; downOff = offset; moved = false
                cursor = at(e.x); onCursor?.invoke(cursor)
            }
            MotionEvent.ACTION_MOVE -> {
                val max = maxOffset()
                if (max <= 0f) { cursor = at(e.x); onCursor?.invoke(cursor); return true }
                if (!moved && abs(e.x - downX) < 8 * density) return true
                moved = true
                offset = (downOff - (e.x - downX)).coerceIn(0f, max)
                invalidate()
            }
        }
        return true
    }

    /** Curseur placé depuis la carte : on fait défiler pour le montrer. */
    fun reveal() {
        val c = cursor ?: return
        val sc = scaleFor(width) ?: return
        val max = maxOffset(); if (max <= 0f) return
        val px = (c * sc.s * density).toFloat(); val plotW = width - left - padRight
        if (px < offset + 20 * density || px > offset + plotW - 20 * density) { offset = (px - plotW / 2).coerceIn(0f, max); invalidate() }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val p = profile ?: return
        val sc = scaleFor(width) ?: return
        val total = p.d.last()
        val zMin0 = p.z.min(); val zMax0 = p.z.max()
        // Trace plus plate que la hauteur minimale : centrée verticalement.
        val extra = sc.plotH / sc.vPxPerM - (zMax0 - zMin0)
        val zMax = zMax0 + extra / 2
        val w = width.toFloat(); val h = height.toFloat()
        val l = left; val t = padTop
        val s = sc.s * density; val v = sc.vPxPerM * density
        offset = offset.coerceIn(0f, maxOffset())
        val base = t + (sc.plotH * density).toFloat()
        val axisY = h - gaugeRow - 3 * density
        fun x(d: Double) = (l + d * s - offset).toFloat()
        fun y(z: Double) = (t + (zMax - z) * v).toFloat()
        canvas.save()
        canvas.clipRect(l, 0f, w - padRight, h)
        val path = Path()
        for (i in 0 until p.size) if (i == 0) path.moveTo(x(p.d[i]), y(p.z[i])) else path.lineTo(x(p.d[i]), y(p.z[i]))
        val fill = Path(path).apply { lineTo(x(total), base); lineTo(x(0.0), base); close() }
        canvas.drawPath(fill, area)
        canvas.drawPath(path, line)
        runs?.takeIf { it.isNotEmpty() }?.let { rs ->
            // Les morceaux sont mesurés sur la ligne de la trace : ramenés à la longueur du profil.
            val k = total / (rs.last().to.takeIf { it > 0 } ?: total)
            for (r in rs) {
                runPaint.color = Color.parseColor(WayTypes.color(r.type))
                val (t0, t1) = if (WayTypes.isWide(r.type)) (base + 2 * density) to (base + band - density) else (base + 3.5f * density) to (base + 6.5f * density)
                canvas.drawRect(x(r.from * k), t0, maxOf(x(r.to * k), x(r.from * k) + 1), t1, runPaint)
            }
            for (r in rs) if (r.gr) canvas.drawLine(x(r.from * k), base + density, x(r.to * k), base + density, grPaint)
        }
        label.textAlign = Paint.Align.CENTER
        val tick = ProfileData.kmTick(sc.s)
        var km = tick
        while (km < total / 1000) {
            val str = if (km % 1.0 == 0.0) "${km.toInt()}" else String.format(java.util.Locale.FRANCE, "%.1f", km)
            canvas.drawText(str, x(km * 1000), axisY, label)
            km += tick
        }
        cursor?.let { c ->
            val at = p.pointAt(c)
            canvas.drawLine(x(at.d), t, x(at.d), base, cursorLine)
            canvas.drawCircle(x(at.d), y(at.z), 5 * density, dotRing)
            canvas.drawCircle(x(at.d), y(at.z), 3.5f * density, dot)
        }
        canvas.restore()
        label.textAlign = Paint.Align.RIGHT
        canvas.drawText("${zMax0.roundToInt()}", l - 4 * density, t + 9 * density, label)
        canvas.drawText("${zMin0.roundToInt()}", l - 4 * density, base, label)
        canvas.drawText("km", l - 4 * density, axisY, label)
        // Pentes de repère à la même échelle (5 %, 10 %, 20 %) : même angle sur toutes les traces.
        val gy = h - 4 * density
        canvas.drawText("pente", l - 4 * density, h - 5 * density, label)
        label.textAlign = Paint.Align.LEFT
        listOf(5, 10, 20).forEachIndexed { i, pct ->
            val gw = 18 * density; val x0 = l + 6 * density + i * 62 * density
            canvas.drawLine(x0, gy, x0 + gw, (gy - gw * pct / 100.0 * ProfileData.EXAG).toFloat(), gauge)
            canvas.drawText("$pct %", x0 + gw + 4 * density, gy - density, label)
        }
    }
}
