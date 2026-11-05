package fr.assomoutain.proto

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 🗺 Carte topos : un point orange par topo (à son départ) autour de l'écran affiché, demandés au relais par cases de 0,1°
 * (gardées 7 jours). Même fonctionnement que TopoMapPanel.tsx ; les points sont dessinés par MainActivity.
 */
class TopoMapPanel(
    private val a: AppCompatActivity,
    private val password: String,
    /** Écran affiché (zone et zoom), ou null si la carte n'est pas prête. */
    private val viewport: () -> Pair<Zone, Double>?,
    private val center: () -> Pair<Double, Double>?,
    private val onTopos: (List<TopoRow>, Int?) -> Unit,
    private val onOpen: (TopoRow) -> Unit,
    private val onMode: (SkiMode) -> Unit,
    private val onClose: () -> Unit,
) {
    companion object { const val TOPO_MIN_ZOOM = 9.0 }
    private val d = a.resources.displayMetrics.density
    private fun dp(v: Int) = (v * d).toInt()
    private val ink = Color.parseColor("#1D2421")
    private val muted = Color.parseColor("#5F6B66")
    private val cellsFile = java.io.File(a.filesDir, "skitour-topos-carte.json")
    private val col = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(8), dp(12), dp(16)) }
    val view: ScrollView = ScrollView(a).apply {
        addView(col); elevation = 10 * d; isClickable = true
        background = GradientDrawable().apply { setColor(Color.WHITE); cornerRadii = floatArrayOf(14 * d, 14 * d, 14 * d, 14 * d, 0f, 0f, 0f, 0f) }
        layoutParams = FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM)
        addOnLayoutChangeListener { v, _, _, _, _, _, _, _, _ ->
            val maxH = (a.resources.displayMetrics.heightPixels * 0.5).toInt()
            if (v.height > maxH) v.layoutParams = v.layoutParams.apply { height = maxH }
        }
    }
    private fun text(t: String, size: Float = 13f, color: Int = muted, bold: Boolean = false) =
        TextView(a).apply { text = t; textSize = size; setTextColor(color); if (bold) setTypeface(typeface, Typeface.BOLD); setPadding(0, dp(3), 0, dp(2)) }
    private val count = text("", 13f)
    private val detail = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private val list = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private val lowBtn = Button(a)
    private var low = true
    var topos: List<TopoRow> = emptyList()
        private set
    private var selId: Long? = null
    private var busy = false
    private var msg = ""
    private var job: kotlinx.coroutines.Job? = null

    init {
        col.addView(SkiTabs.view(a, SkiMode.CARTE_TOPOS, onMode))
        col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(count, LinearLayout.LayoutParams(0, -2, 1f))
            addView(lowBtn.apply { setOnClickListener { setLow(!low) } }, LinearLayout.LayoutParams(dp(44), dp(44)))
            addView(Button(a).apply { text = "✕"; setOnClickListener { onClose() } }, LinearLayout.LayoutParams(dp(44), dp(44)))
        })
        col.addView(detail); col.addView(list)
        col.addView(text("Topos skitour.fr, placés à leur départ."))
        setLow(true)
        view.post { refresh() }
    }

    private fun setLow(v: Boolean) {
        low = v
        lowBtn.text = if (v) "▴" else "▾"; lowBtn.contentDescription = if (v) "Agrandir le panneau" else "Réduire le panneau"
        for (k in 2 until col.childCount) col.getChildAt(k).visibility = if (v) android.view.View.GONE else android.view.View.VISIBLE
        view.layoutParams = view.layoutParams.apply { height = -2 }
    }

    /** À chaque arrêt de la carte (appelé par MainActivity) : topos de l'écran, puis ceux de la case du centre s'il manquent. */
    fun refresh() {
        show()
        val vp = viewport() ?: return
        if (vp.second < TOPO_MIN_ZOOM) return
        val (lat, lon) = center() ?: return
        if (Topos.hasFresh(cellsFile, lat, lon) || job?.isActive == true) return
        busy = true; show()
        job = a.lifecycleScope.launch {
            kotlinx.coroutines.delay(1000)
            runCatching { withContext(Dispatchers.IO) { Topos.fetchNear(cellsFile, lat, lon, password) } }
                .onSuccess { msg = "" }
                .onFailure { e -> if (e !is kotlinx.coroutines.CancellationException) msg = "Topos impossibles : ${if (e is java.io.IOException) "pas de réseau" else e.message}" }
            busy = false; show()
        }
    }

    private fun show() {
        val vp = viewport() ?: return
        val (z, zoom) = vp
        val far = zoom < TOPO_MIN_ZOOM
        val vis = if (far) emptyList() else Topos.allSaved(cellsFile).filter { t ->
            val p = t.depart; p?.lat != null && p.lon != null && p.lon in z.west..z.east && p.lat in z.south..z.north }.take(300)
        topos = vis
        val k = vis.indexOfFirst { it.id == selId }.takeIf { it >= 0 }
        onTopos(vis, k)
        count.text = when { busy -> "Recherche…"; far -> "Zoome pour voir les topos"; msg.isNotEmpty() -> msg; else -> "${vis.size} topo${if (vis.size > 1) "s" else ""}" }
        detail.removeAllViews()
        vis.getOrNull(k ?: -1)?.let { t ->
            detail.addView(text(t.nom, 15f, ink, true))
            detail.addView(text(listOf(t.massif, t.line()).filter { it.isNotEmpty() }.joinToString(" · ")))
            detail.addView(Button(a).apply { text = "Fiche du topo"; isAllCaps = false; setOnClickListener { onOpen(t) } })
        }
        list.removeAllViews()
        vis.forEachIndexed { i, t ->
            list.addView(LinearLayout(a).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(10), dp(8), dp(10), dp(8))
                background = GradientDrawable().apply { setColor(Color.parseColor(if (i == k) "#FBE3C8" else "#F2F4F1")); cornerRadius = 8 * d }
                addView(text(t.nom, 15f, ink, true)); addView(text(t.line()))
                setOnClickListener { select(i) }
            }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) })
        }
        if (low) { detail.visibility = android.view.View.GONE; list.visibility = android.view.View.GONE }
    }

    fun select(i: Int?) { selId = i?.let { topos.getOrNull(it)?.id }; show() }
}
