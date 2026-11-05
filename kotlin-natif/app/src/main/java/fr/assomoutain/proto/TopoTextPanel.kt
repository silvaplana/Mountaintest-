package fr.assomoutain.proto

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.Editable
import android.text.InputType
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
import org.json.JSONArray
import org.json.JSONObject
import java.text.Normalizer

/** Un topo de la liste (départ placé sur la carte). Même chose que TopoRow de skitour.ts. */
data class TopoRow(val id: Long, val nom: String, val url: String, val massif: String, val orientation: String, val denivele: Int?,
                   val difSki: String, val difficulte: String, val gpx: Boolean, val depart: TopoPoint?) {
    /** « ski 2.3 · D+ 780 m · E · R » */
    fun line() = listOf(difSki.takeIf { it.isNotEmpty() }?.let { "ski $it" }, denivele?.takeIf { it > 0 }?.let { "D+ $it m" },
        orientation.ifEmpty { null }, difficulte.ifEmpty { null }).filterNotNull().joinToString(" · ")
}

/** Listes de topos du relais (/skitour-topos) : par massifs (onglet Topos) ou autour d'un point (Carte topos). */
object Topos {
    private fun dbl(o: JSONObject, k: String) = if (o.isNull(k) || !o.has(k)) null else o.optDouble(k).takeIf { !it.isNaN() }
    private fun row(o: JSONObject) = TopoRow(o.optLong("id"), o.optString("nom"), o.optString("url"), o.optString("massif"), o.optString("orientation"),
        if (o.isNull("denivele")) null else o.optInt("denivele"), o.optString("dif_ski"), o.optString("difficulte"), o.optBoolean("gpx"),
        o.optJSONObject("depart")?.let { TopoPoint(it.optString("nom"), if (it.isNull("altitude")) null else it.optInt("altitude"), dbl(it, "lat"), dbl(it, "lon")) })
    private fun rows(a: JSONArray?) = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map { row(it) }

    /** Dernière liste (massifs choisis), gardée pour le hors ligne. */
    fun readList(f: java.io.File, massifs: List<Int>): List<TopoRow>? = runCatching {
        val o = JSONObject(f.readText())
        if (o.optString("massifs") == massifs.joinToString(",")) rows(o.optJSONArray("topos")) else null
    }.getOrNull()
    fun fetchList(f: java.io.File, massifs: List<Int>, password: String): List<TopoRow> {
        val r = Travel.post("skitour-topos", JSONObject().put("massifs", JSONArray(massifs)), password)
        runCatching { f.writeText(JSONObject().put("massifs", massifs.joinToString(",")).put("t", System.currentTimeMillis()).put("topos", r.optJSONArray("topos") ?: JSONArray()).toString()) }
        return rows(r.optJSONArray("topos"))
    }

    /** Case de 0,1° du centre de l'écran : une demande par case, gardée 7 jours (téléphone et serveur), 40 cases au plus. */
    fun cell(lat: Double, lon: Double) = String.format(java.util.Locale.US, "%.1f,%.1f", Math.round(lat * 10) / 10.0, Math.round(lon * 10) / 10.0)
    private fun cells(f: java.io.File): JSONObject = runCatching { JSONObject(f.readText()) }.getOrDefault(JSONObject())
    fun hasFresh(f: java.io.File, lat: Double, lon: Double): Boolean =
        cells(f).optJSONObject(cell(lat, lon))?.let { System.currentTimeMillis() - it.optLong("t") < 7 * 86_400_000L } == true
    fun fetchNear(f: java.io.File, lat: Double, lon: Double, password: String) {
        val k = cell(lat, lon)
        val (la, lo) = k.split(",").map { it.toDouble() }
        val r = Travel.post("skitour-topos", JSONObject().put("lat", la).put("lon", lo), password)
        val all = cells(f)
        all.remove(k)
        val keys = all.keys().asSequence().toList().takeLast(39)
        val out = JSONObject()
        keys.forEach { out.put(it, all.get(it)) }
        out.put(k, JSONObject().put("t", System.currentTimeMillis()).put("topos", r.optJSONArray("topos") ?: JSONArray()))
        runCatching { f.writeText(out.toString()) }
    }
    /** Tous les topos des cases gardées (on garde les points déjà vus en bougeant la carte). */
    fun allSaved(f: java.io.File): List<TopoRow> {
        val c = cells(f); val seen = HashSet<Long>()
        return c.keys().asSequence().flatMap { rows(c.optJSONObject(it)?.optJSONArray("topos")).asSequence() }.filter { seen.add(it.id) }.toList()
    }

    private fun norm(t: String) = Normalizer.normalize(t, Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "").lowercase()
    /** Chaque mot (sans accents) dans le nom, le massif ou le départ. */
    fun filter(rows: List<TopoRow>, q: String): List<TopoRow> {
        val w = norm(q).split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (w.isEmpty()) return rows
        return rows.filter { t -> val h = norm("${t.nom} ${t.massif} ${t.depart?.nom ?: ""}"); w.all { it in h } }
    }
}

/**
 * 📖 Topos : liste des topos skitour.fr des massifs choisis (mêmes massifs que les sorties), avec recherche ; un topo
 * s'ouvre dans l'appli. Même fonctionnement que TopoTextPanel.tsx.
 */
class TopoTextPanel(
    private val a: AppCompatActivity,
    private val password: String,
    private val onMode: (SkiMode) -> Unit,
    private val onClose: () -> Unit,
    /** Topo à ouvrir tout de suite (touché sur la carte des topos) : « ← Carte » revient à la carte. */
    private val start: TopoRow? = null,
    private val onBackToMap: (() -> Unit)? = null,
) {
    private val d = a.resources.displayMetrics.density
    private fun dp(v: Int) = (v * d).toInt()
    private val ink = Color.parseColor("#1D2421")
    private val muted = Color.parseColor("#5F6B66")
    private val accent = Color.parseColor("#2F6F4F")
    private val prefs = a.getSharedPreferences("reglages", AppCompatActivity.MODE_PRIVATE)
    private val listFile = java.io.File(a.filesDir, "skitour-topos-liste.json")
    private val massifsFile = java.io.File(a.filesDir, "skitour-massifs.json")
    private var allMassifs: List<SkiText.Massif> = SkiText.readMassifs(massifsFile)
    private var chosen: List<String> = runCatching { JSONArray(prefs.getString("skitourMassifs", "[]")).let { j -> (0 until j.length()).map { j.getString(it) } } }.getOrDefault(emptyList())
    private val col = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(14), dp(36), dp(14), dp(24)) }
    val view: ScrollView = ScrollView(a).apply {
        addView(col); elevation = 12 * d; isClickable = true; setBackgroundColor(Color.WHITE)
        layoutParams = FrameLayout.LayoutParams(-1, -1)
    }
    private fun text(t: String, size: Float = 13f, color: Int = muted, bold: Boolean = false) =
        TextView(a).apply { text = t; textSize = size; setTextColor(color); if (bold) setTypeface(typeface, Typeface.BOLD); setPadding(0, dp(3), 0, dp(2)) }
    private var topos: List<TopoRow> = emptyList()
    private var msg = ""
    private var busy = false
    private val list = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private val status = text("")
    private val search = EditText(a).apply {
        hint = "Chercher : sommet, départ…"; isSingleLine = true; inputType = InputType.TYPE_CLASS_TEXT
        addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) = fill()
            override fun beforeTextChanged(s: CharSequence?, st: Int, c: Int, af: Int) {}
            override fun onTextChanged(s: CharSequence?, st: Int, b: Int, c: Int) {}
        })
    }
    private var job: kotlinx.coroutines.Job? = null

    init {
        if (start != null) openTopo(start, fromMap = true) else showList()
        a.lifecycleScope.launch {
            runCatching { withContext(Dispatchers.IO) { SkiText.fetchMassifs(massifsFile, password) } }.onSuccess { if (it.isNotEmpty()) allMassifs = it }
        }
    }

    private fun ids() = chosen.mapNotNull { n -> allMassifs.firstOrNull { it.nom == n }?.id }.take(20)

    private fun showList() {
        col.removeAllViews()
        col.addView(SkiTabs.view(a, SkiMode.TOPOS, onMode, onClose))
        col.addView(Button(a).apply {
            isAllCaps = false; gravity = Gravity.START or Gravity.CENTER_VERTICAL
            text = "Massifs : " + when (chosen.size) { 0 -> "à choisir"; 1 -> chosen[0]; else -> "${chosen.size} massifs" } + " ▾"
            setOnClickListener { showPicker() }
        })
        (search.parent as? android.view.ViewGroup)?.removeView(search)
        col.addView(search)
        col.addView(status)
        col.addView(list)
        col.addView(text("Topos skitour.fr."))
        load()
    }

    private fun load() {
        val ids = ids()
        if (ids.isEmpty()) { topos = emptyList(); msg = "Choisis un ou plusieurs massifs pour voir leurs topos (20 au plus)."; fill(); return }
        topos = Topos.readList(listFile, ids) ?: emptyList()
        busy = true; msg = ""; fill()
        job?.cancel()
        job = a.lifecycleScope.launch {
            runCatching { withContext(Dispatchers.IO) { Topos.fetchList(listFile, ids, password) } }
                .onSuccess { topos = it; busy = false; msg = ""; fill() }
                .onFailure { e ->
                    if (e is kotlinx.coroutines.CancellationException) return@onFailure
                    busy = false
                    msg = if (topos.isNotEmpty()) "📴 Hors ligne : liste gardée sur le téléphone."
                        else "Topos impossibles : ${if (e is java.io.IOException) "pas de réseau" else e.message}"
                    fill()
                }
        }
    }

    private fun fill() {
        val rows = Topos.filter(topos, search.text.toString())
        status.text = listOf(msg, if (busy) "Chargement des topos skitour.fr…" else "",
            if (ids().isNotEmpty() && !busy) "${rows.size} topo${if (rows.size > 1) "s" else ""}" else "").filter { it.isNotEmpty() }.joinToString("\n")
        list.removeAllViews()
        rows.take(500).forEach { t ->
            list.addView(LinearLayout(a).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(10), dp(8), dp(10), dp(8))
                background = GradientDrawable().apply { setColor(Color.parseColor("#F2F4F1")); cornerRadius = 8 * d }
                addView(text(t.nom + if (t.gpx) "  · GPX" else "", 15f, ink, true))
                addView(text(listOf(t.massif, t.line()).filter { it.isNotEmpty() }.joinToString(" · ")))
                t.depart?.let { addView(text("Départ : ${it.text()}")) }
                setOnClickListener { openTopo(t, fromMap = false) }
            }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) })
        }
    }

    private fun openTopo(t: TopoRow, fromMap: Boolean) {
        job?.cancel()
        TopoPage(a, password, col, view).show(t.id, t.nom, t.url, if (fromMap) "Carte" else "Topos",
            onBack = { if (fromMap) (onBackToMap ?: onClose)() else showList() }, onClose = onClose)
    }

    /** Choix des massifs, groupés comme sur skitour.fr (mêmes massifs que la liste des sorties). */
    private fun showPicker() {
        col.removeAllViews()
        val picked = chosen.toMutableList()
        fun save() = prefs.edit().putString("skitourMassifs", JSONArray(chosen).toString()).apply()
        col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(text("Massifs", 16f, ink, true), LinearLayout.LayoutParams(0, -2, 1f))
            addView(Button(a).apply { text = "Aucun"; setOnClickListener { chosen = emptyList(); save(); showList() } })
            addView(Button(a).apply { text = "OK"; setOnClickListener { chosen = picked.toList(); save(); showList() } })
        })
        val groups = if (allMassifs.isNotEmpty()) SkiText.group(allMassifs) else SkiText.MASSIF_GROUPS
        groups.forEach { (g, ms) ->
            col.addView(text(g, 17f, accent, true).apply { setPadding(0, dp(14), 0, dp(4)) })
            ms.forEach { m ->
                col.addView(android.widget.CheckBox(a).apply {
                    text = m; textSize = 16f; setTextColor(ink); isChecked = m in picked
                    setOnCheckedChangeListener { _, on -> if (on) { if (m !in picked) picked.add(m) } else picked.remove(m) }
                })
            }
        }
        view.post { view.scrollTo(0, 0) }
    }
}
