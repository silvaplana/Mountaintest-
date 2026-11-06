package fr.assomoutain.proto

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Fiche d'un topo dans l'appli (même chose que TopoView.tsx) : infos, départ (Google Maps), présentation, itinéraire… ;
 * les 50 derniers ouverts sont gardés sur le téléphone. Dessinée dans la colonne du panneau qui l'ouvre.
 */
class TopoPage(private val a: AppCompatActivity, private val password: String, private val col: LinearLayout, private val view: ScrollView) {
    private val d = a.resources.displayMetrics.density
    private fun dp(v: Int) = (v * d).toInt()
    private val ink = Color.parseColor("#1D2421")
    private val muted = Color.parseColor("#5F6B66")
    private val accent = Color.parseColor("#2F6F4F")
    private val toposFile = java.io.File(a.filesDir, "skitour-topos.json")
    private fun text(t: String, size: Float = 13f, color: Int = muted, bold: Boolean = false) =
        TextView(a).apply { text = t; textSize = size; setTextColor(color); if (bold) setTypeface(typeface, Typeface.BOLD); setPadding(0, dp(3), 0, dp(2)) }
    private fun box() = LinearLayout(a).apply {
        orientation = LinearLayout.VERTICAL; setPadding(dp(10), dp(8), dp(10), dp(8))
        background = GradientDrawable().apply { setColor(Color.parseColor("#F2F4F1")); cornerRadius = 8 * d }
    }
    private fun lp(top: Int = 6) = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(top) }
    private var job: kotlinx.coroutines.Job? = null

    /** « 🗺 Sur la carte » : carte des topos centrée sur celui-ci (départ, sommets, itinéraire). */
    private var onMap: ((TopoSheet) -> Unit)? = null

    fun show(id: Long, nom: String, url: String, backLabel: String, onBack: () -> Unit, onClose: () -> Unit, onMap: ((TopoSheet) -> Unit)? = null) {
        this.onMap = onMap
        val saved = SkiText.savedTopo(toposFile, id)
        render(nom, url, saved, if (saved == null) "Chargement du topo…" else "", backLabel, onBack, onClose)
        job = a.lifecycleScope.launch {
            runCatching { withContext(Dispatchers.IO) { SkiText.fetchTopo(toposFile, id, password) } }
                .onSuccess { render(nom, url, it, "", backLabel, onBack, onClose) }
                .onFailure { e ->
                    if (e is kotlinx.coroutines.CancellationException) return@onFailure
                    render(nom, url, saved, if (saved != null) "📴 Hors ligne : topo gardé sur le téléphone."
                        else "Topo impossible : ${if (e is java.io.IOException) "pas de réseau" else e.message}", backLabel, onBack, onClose)
                }
        }
    }

    private fun render(nom: String, url: String, t: TopoSheet?, tmsg: String, backLabel: String, onBack: () -> Unit, onClose: () -> Unit) {
        col.removeAllViews()
        col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(Button(a).apply { text = "← $backLabel"; isAllCaps = false; setOnClickListener { job?.cancel(); onBack() } })
            addView(android.view.View(a), LinearLayout.LayoutParams(0, 0, 1f))
            addView(Button(a).apply { text = "✕"; contentDescription = "Fermer"; setOnClickListener { job?.cancel(); onClose() } }, LinearLayout.LayoutParams(dp(48), dp(44)))
        })
        col.addView(box().apply { gravity = Gravity.CENTER_HORIZONTAL; addView(text("📖 " + (t?.nom?.ifEmpty { null } ?: nom), 20f, ink, true).apply { gravity = Gravity.CENTER }) }, lp())
        if (tmsg.isNotEmpty()) col.addView(text(tmsg))
        val blue = Color.parseColor("#2E6DB4")
        fun open(url: String) = runCatching { a.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
        if (t != null) {
            val dep = t.depart
            val info: List<Pair<String, Any>> = listOf(
                "Massif" to t.massif,
                "Départ" to (dep?.let { p ->
                    LinearLayout(a).apply {
                        gravity = Gravity.CENTER_VERTICAL
                        addView(text(p.text(), 14f, ink), LinearLayout.LayoutParams(0, -2, 1f))
                        val gurl = if (p.lat != null && p.lon != null) "https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}"
                            else "https://www.google.com/maps/search/?api=1&query=" + Uri.encode("${p.nom} ${t.massif}")
                        addView(Button(a).apply {
                            text = "🚗 Google Maps"; isAllCaps = false; textSize = 12f; minWidth = 0; minimumWidth = 0; minHeight = 0; minimumHeight = 0
                            setPadding(dp(8), dp(4), dp(8), dp(4)); contentDescription = "${p.nom} dans Google Maps"
                            setOnClickListener { open(gurl) } })
                    }
                } ?: ""),
                (if (t.sommets.size > 1) "Sommets" else "Sommet") to t.sommets.joinToString(", ") { it.text() },
                "Orientation" to t.orientation, "Dénivelé" to (t.denivele?.let { "$it m" } ?: ""), "Ski" to t.difSki,
                "Difficulté" to t.difficulte, "Exposition" to t.expo, "Auteur" to t.auteur,
            ).filter { (_, v) -> (v as? String)?.isNotEmpty() ?: true }
            col.addView(box().apply {
                info.forEach { (k, v) ->
                    addView(LinearLayout(a).apply {
                        setPadding(0, dp(2), 0, dp(2))
                        addView(text("$k :", 14f, blue, true), LinearLayout.LayoutParams(dp(110), -2))
                        if (v is String) addView(text(v, 14f, ink), LinearLayout.LayoutParams(0, -2, 1f))
                        else addView(v as android.view.View, LinearLayout.LayoutParams(0, -2, 1f))
                    })
                }
            }, lp())
            t.sections.filter { it.second.isNotBlank() }.forEach { (k, body) ->
                col.addView(text(k, 16f, accent, true).apply { setPadding(0, dp(12), 0, dp(2)) })
                col.addView(text(body, 15f, ink).apply { setLineSpacing(0f, 1.2f) })
            }
        }
        col.addView(LinearLayout(a).apply {
            setPadding(0, dp(10), 0, 0)
            val m = onMap
            if (m != null && t != null && t.row() != null) addView(Button(a).apply { text = "🗺 Sur la carte"; isAllCaps = false; setOnClickListener { job?.cancel(); m(t) } }, LinearLayout.LayoutParams(0, -2, 1f))
            addView(Button(a).apply { text = "Voir sur skitour.fr"; setOnClickListener { open(url) } }, LinearLayout.LayoutParams(0, -2, 1f))
            if (t != null && t.gpx.isNotEmpty()) addView(Button(a).apply { text = "GPX"; isAllCaps = false; setOnClickListener { open(t.gpx) } })
        })
        col.addView(text("Topo de ${t?.auteur?.ifEmpty { null } ?: "skitour.fr"} sur skitour.fr, non modifié."))
        view.post { view.scrollTo(0, 0) }
    }
}
