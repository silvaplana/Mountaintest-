package fr.assomoutain.proto

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.AttributeSet
import android.view.View
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.pow

/**
 * Barre d'échelle de la carte : longueur « ronde » (1, 2 ou 5 × 10^n mètres) la plus grande
 * qui tient dans 110 dp. Même calcul que l'appli Capacitor (src/map/scale.ts).
 */
object ScaleMath {
    /** Mètres par dp (MapLibre : tuile de 512 dp au zoom 0, projection Mercator). */
    fun metersPerDp(lat: Double, zoom: Double): Double =
        40_075_016.686 * cos(Math.toRadians(lat)) / (512 * 2.0.pow(zoom))

    fun label(m: Double): String =
        if (m >= 1000) "${NumberFormat.getInstance(Locale.FRANCE).format(m / 1000)} km" else "${m.toInt()} m"

    /** (mètres, largeur en dp) */
    fun nice(mPerDp: Double, maxDp: Double = 110.0): Pair<Double, Double> {
        val max = mPerDp * maxDp
        val p = 10.0.pow(floor(log10(max)))
        val m = listOf(5.0, 2.0, 1.0).map { it * p }.firstOrNull { it <= max } ?: p
        return m to m / mPerDp
    }
}

class ScaleBarView @JvmOverloads constructor(ctx: Context, attrs: AttributeSet? = null) : View(ctx, attrs) {
    private val d = resources.displayMetrics.density
    private var text = ""
    private var barPx = 0f
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#1D2421"); strokeWidth = 2 * d; style = Paint.Style.STROKE }
    private val halo = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(176, 255, 255, 255); style = Paint.Style.FILL }
    private val txt = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#1D2421"); textSize = 12 * d; isFakeBoldText = true
    }

    fun update(lat: Double, zoom: Double) {
        val (m, dp) = ScaleMath.nice(ScaleMath.metersPerDp(lat, zoom))
        val t = ScaleMath.label(m)
        val w = (dp * d).toFloat()
        if (t == text && kotlin.math.abs(w - barPx) < 0.5f) return
        text = t; barPx = w
        contentDescription = "Échelle : $t"
        invalidate()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension((124 * d).toInt(), (30 * d).toInt())
    }

    override fun onDraw(c: Canvas) {
        if (text.isEmpty()) return
        val pad = 2 * d
        val tw = txt.measureText(text)
        val base = 14 * d
        c.drawRoundRect(0f, 0f, tw + 8 * d, base + 3 * d, 4 * d, 4 * d, halo)
        c.drawText(text, 4 * d, base - pad, txt)
        val top = base + 6 * d
        val bottom = top + 6 * d
        c.drawRect(pad, top, pad + barPx, bottom, halo)
        // Équerre ouverte en haut : ⊔
        c.drawLine(pad, top, pad, bottom, line)
        c.drawLine(pad, bottom, pad + barPx, bottom, line)
        c.drawLine(pad + barPx, top, pad + barPx, bottom, line)
    }
}
