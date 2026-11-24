package fr.assomoutain.proto

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
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
 * 🥾 / 🚵 Itinéraires Camptocamp de l'écran affiché, sur le modèle des sorties skitour : liste puis fiche
 * (même écran que C2cPanel.tsx côté Capacitor). Pas de filtre de date : du plus proche au plus loin du centre
 * de l'écran. 🗺 à droite du titre : les itinéraires tracés sur la carte. « 🗺 Sur la carte » d'une fiche
 * ajoute le tracé à Mes traces (profil, type de chemin, ▶ Commencer, 📶 Hors ligne).
 */
class C2cPanel(
    private val a: AppCompatActivity,
    private val act: String,
    private val zone: Zone,
    private val center: LonLat,
    /** Itinéraires trouvés : un point chacun sur la carte. */
    private val onRoutes: (List<Camptocamp.Route>) -> Unit,
    private val onShowLine: (Camptocamp.Sheet) -> Unit,
    private val onMap: () -> Unit,
    private val onClose: () -> Unit,
    /** Mot de passe du relais (circuits VisuGPX). */
    private val password: String,
) {
    private val d = a.resources.displayMetrics.density
    private fun dp(v: Int) = (v * d).toInt()
    private val ink = Color.parseColor("#1D2421")
    private val muted = Color.parseColor("#5F6B66")
    private val accent = Color.parseColor("#2F6F4F")
    private val col = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(14), dp(36), dp(14), dp(24)) }
    val view: ScrollView = ScrollView(a).apply {
        addView(col); elevation = 12 * d; isClickable = true; setBackgroundColor(Color.WHITE)
        layoutParams = FrameLayout.LayoutParams(-1, -1)
    }
    private fun text(t: String, size: Float = 13f, color: Int = muted, bold: Boolean = false) =
        TextView(a).apply { text = t; textSize = size; setTextColor(color); if (bold) setTypeface(typeface, Typeface.BOLD); setPadding(0, dp(3), 0, dp(2)) }
    private fun lp(top: Int = 6) = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(top) }

    private val icon = if (act == "hiking") "🥾" else "🚵"
    private val what = if (act == "hiking") "Randos" else "Itinéraires VTT"
    private var c2c: List<Camptocamp.Route>? = null
    private var vgpx: List<Camptocamp.Route>? = null
    private var vgpxMsg = ""
    /** Camptocamp et VisuGPX ensemble. */
    var routes: List<Camptocamp.Route>? = null
        private set
    private fun merge() { routes = if (c2c == null && vgpx == null) null else c2c.orEmpty() + vgpx.orEmpty() }
    private var busy = true
    private var offline = false
    private var error = ""
    private var q = ""
    private val search = EditText(a).apply {
        hint = "Chercher un nom"; textSize = 16f; setSingleLine()
        addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, st: Int, c: Int, af: Int) {}
            override fun onTextChanged(s: CharSequence?, st: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable?) { q = s?.toString().orEmpty(); showList() }
        })
    }
    private val listBox = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }

    init {
        showList()
        a.lifecycleScope.launch {
            val r = withContext(Dispatchers.IO) { runCatching { Camptocamp.fetchRoutes(a, zone, act) } }
            r.onSuccess { c2c = it }.onFailure { e ->
                val saved = withContext(Dispatchers.IO) { Camptocamp.savedRoutes(a, act) }
                if (saved != null) { c2c = saved; offline = true } else error = "Camptocamp injoignable (pas de réseau ?) : ${e.message}"
            }
            busy = false
            merge(); onRoutes(routes ?: emptyList())
            showList()
        }
        a.lifecycleScope.launch {
            val vtt = act == "mountain_biking"
            val r = withContext(Dispatchers.IO) { runCatching { VisuGpx.fetchRoutes(a, center, vtt, password) } }
            r.onSuccess { vgpx = it }.onFailure { e ->
                val saved = withContext(Dispatchers.IO) { VisuGpx.savedRoutes(a, vtt) }
                if (saved != null) { vgpx = saved; vgpxMsg = "📴 VisuGPX : dernière liste chargée." }
                else { vgpx = emptyList(); vgpxMsg = "VisuGPX indisponible : ${e.message}" }
            }
            merge(); onRoutes(routes ?: emptyList())
            showList()
        }
    }

    private fun header(title: String, withMap: Boolean, back: Boolean) = LinearLayout(a).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        if (back) addView(Button(a).apply { text = "← Liste"; setOnClickListener { showList() } })
        addView(text(title, 18f, ink, true), LinearLayout.LayoutParams(0, -2, 1f))
        if (withMap) addView(Button(a).apply { text = "🗺"; contentDescription = "Itinéraires tracés sur la carte"; setOnClickListener { onMap() } })
        addView(Button(a).apply { text = "✕"; contentDescription = "Fermer"; setOnClickListener { onClose() } })
    }

    /** La liste : filtrée par le nom cherché, du plus proche au plus loin. */
    fun showList() {
        if (search.parent == null || col.indexOfChild(search) < 0) {
            col.removeAllViews()
            col.addView(header("$icon $what", withMap = true, back = false))
            col.addView(search, lp())
            col.addView(listBox, lp())
        }
        listBox.removeAllViews()
        if (busy) listBox.addView(text("Recherche des itinéraires de l'écran…"))
        if (error.isNotEmpty()) listBox.addView(text(error, color = Color.parseColor("#C0392B")))
        if (offline) listBox.addView(text("📴 Hors ligne : dernière liste chargée."))
        if (vgpx == null) listBox.addView(text("Recherche des circuits VisuGPX…"))
        if (vgpxMsg.isNotEmpty()) listBox.addView(text(vgpxMsg))
        val rs = routes ?: return
        val t = q.trim().lowercase()
        val rows = Camptocamp.byDistance(rs.filter { t.isEmpty() || it.title.lowercase().contains(t) }, center)
        if (!busy) listBox.addView(text("${rows.size} itinéraire${if (rows.size > 1) "s" else ""}, toutes dates, du plus proche au plus loin du centre de l'écran."))
        for ((r, m) in rows) {
            listBox.addView(LinearLayout(a).apply {
                orientation = LinearLayout.HORIZONTAL; setPadding(dp(8), dp(8), dp(8), dp(8))
                background = GradientDrawable().apply { setColor(Color.parseColor("#F2F4F1")); cornerRadius = 8 * d }
                addView(text(Camptocamp.km(m), 13f, muted), LinearLayout.LayoutParams(dp(64), -2))
                addView(LinearLayout(a).apply {
                    orientation = LinearLayout.VERTICAL
                    addView(text(r.title, 15f, ink, true))
                    addView(text(listOf(if (r.src.isNotEmpty()) "VisuGPX" else "Camptocamp", Camptocamp.info(r)).filter { it.isNotEmpty() }.joinToString(" · "), 13f, muted))
                }, LinearLayout.LayoutParams(0, -2, 1f))
                setOnClickListener { open(r) }
            }, lp(4))
        }
        listBox.addView(text("Données ${Camptocamp.ATTRIBUTION}. ${VisuGpx.ATTRIBUTION}."), lp(10))
    }

    /** Fiche d'un itinéraire (celle gardée sur le téléphone d'abord, puis la version à jour). */
    fun open(r: Camptocamp.Route) {
        if (r.src.isNotEmpty()) {
            showSheet(VisuGpx.savedSheet(a, r), r, "")
            a.lifecycleScope.launch {
                val s = withContext(Dispatchers.IO) { runCatching { VisuGpx.fetchSheet(a, r, password) } }
                s.onSuccess { showSheet(it, r, "") }.onFailure { e -> showSheet(null, r, "Tracé indisponible : ${e.message}") }
            }
            return
        }
        showSheet(Camptocamp.savedSheet(a, r.id), r, "")
        a.lifecycleScope.launch {
            val s = withContext(Dispatchers.IO) { runCatching { Camptocamp.fetchSheet(a, r.id) } }
            s.onSuccess { showSheet(it, r, "") }.onFailure { e -> showSheet(Camptocamp.savedSheet(a, r.id), r, "Fiche complète indisponible (pas de réseau ?) : ${e.message}") }
        }
    }

    fun openId(id: Long) { routes?.firstOrNull { it.id == id }?.let { open(it) } }

    private fun showSheet(s: Camptocamp.Sheet?, r: Camptocamp.Route, msg: String) {
        col.removeAllViews()
        col.addView(header("", withMap = false, back = true))
        col.addView(text(r.title, 20f, ink, true).apply { gravity = Gravity.CENTER }, lp())
        col.addView(text(Camptocamp.info(r), 15f, ink))
        if (msg.isNotEmpty()) col.addView(text(msg))
        if (r.summary.isNotEmpty()) col.addView(text(r.summary, 15f, ink, true), lp())
        val desc = s?.description?.ifEmpty { null } ?: r.vdesc
        if (desc.isNotEmpty()) {
            col.addView(text("Description", 16f, accent, true), lp(10))
            col.addView(text(desc, 15f, ink).apply { setLineSpacing(0f, 1.2f) })
        }
        col.addView(LinearLayout(a).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(Button(a).apply {
                text = "🗺 Sur la carte"; isEnabled = s != null && s.line.isNotEmpty()
                setOnClickListener { if (s != null) onShowLine(s) }
            }, LinearLayout.LayoutParams(0, -2, 1f))
            addView(Button(a).apply {
                text = if (r.src.isNotEmpty()) "Voir sur visugpx.com" else "Voir sur camptocamp.org"
                val url = if (r.src.isNotEmpty()) VisuGpx.link(r.vid) else Camptocamp.link(r.id)
                setOnClickListener { runCatching { a.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }
            }, LinearLayout.LayoutParams(0, -2, 1f))
        }, lp(10))
        if (s != null && s.line.isEmpty()) col.addView(text("Pas de tracé pour cet itinéraire."))
        col.addView(text(if (r.src.isNotEmpty()) "${VisuGpx.ATTRIBUTION}." else "Texte ${Camptocamp.ATTRIBUTION}, non modifié."), lp(10))
        view.scrollTo(0, 0)
    }
}
