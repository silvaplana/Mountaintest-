package fr.assomoutain.proto

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.view.Gravity
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Sortie de ski de rando publiée sur skitour.fr (via le relais du VPS, qui garde la clé API). Même modèle que src/ski/skitour.ts. */
data class Outing(val id: Long, val titre: String, val date: Long, val massif: String, val sommet: String, val altitude: Int?,
                  val lat: Double, val lon: Double, val denivele: Int?, val difSki: String, val orientation: String,
                  val conditions: String, val auteur: String, val url: String,
                  /** Skiabilité notée par l'auteur (texte, ou chiffre selon l'API) et étoiles si l'API les donne. */
                  val skiabilite: String = "", val etoiles: Int? = null) {
    /** Étiquette à côté du point bleu : nom de la course, puis étoiles et skiabilité (même texte que outingLabel). */
    fun label(): String {
        val t = if (titre.length > 26) titre.take(25) + "…" else titre
        val sk = skiabText(skiabilite)
        val meta = listOf(etoiles?.takeIf { it > 0 }?.let { "★".repeat(it) } ?: "", sk).filter { it.isNotEmpty() }.joinToString(" · ")
        return if (meta.isEmpty()) t else "$t\n$meta"
    }
    fun dateText(): String = Instant.ofEpochSecond(date).atZone(ZoneId.systemDefault()).toLocalDate()
        .format(DateTimeFormatter.ofPattern("d MMM yyyy", Locale.FRANCE))
    fun line() = listOfNotNull(sommet + (altitude?.let { " $it m" } ?: ""), denivele?.let { "D+ $it m" },
        difSki.ifEmpty { null }?.let { "ski $it" }, orientation.ifEmpty { null }).joinToString(" · ")
}

object Skitour {
    fun fetch(z: Zone, days: Int, password: String): List<Outing> {
        val o = Travel.post("skitour", JSONObject().put("ouest", z.west).put("sud", z.south).put("est", z.east).put("nord", z.north).put("jours", days), password)
        val a = o.optJSONArray("sorties") ?: return emptyList()
        return (0 until a.length()).map { i -> a.getJSONObject(i).let {
            Outing(it.optLong("id"), it.optString("titre"), it.optLong("date"), it.optString("massif"), it.optString("sommet"),
                if (it.isNull("altitude")) null else it.optInt("altitude"), it.optDouble("lat"), it.optDouble("lon"),
                if (it.isNull("denivele")) null else it.optInt("denivele"), if (it.isNull("dif_ski")) "" else it.optString("dif_ski"),
                it.optString("orientation"), it.optString("conditions"), it.optString("auteur"), it.optString("url"),
                it.optString("skiabilite"), if (it.isNull("etoiles") || !it.has("etoiles")) null else it.optInt("etoiles"))
        } }.filter { !it.lat.isNaN() && !it.lon.isNaN() }.sortedByDescending { it.date }
    }

    fun toJson(x: Outing): JSONObject = JSONObject().put("id", x.id).put("titre", x.titre).put("date", x.date).put("massif", x.massif)
        .put("sommet", x.sommet).put("altitude", x.altitude ?: JSONObject.NULL).put("lat", x.lat).put("lon", x.lon)
        .put("denivele", x.denivele ?: JSONObject.NULL).put("dif_ski", x.difSki).put("orientation", x.orientation)
        .put("conditions", x.conditions).put("auteur", x.auteur).put("url", x.url)
        .put("skiabilite", x.skiabilite).put("etoiles", x.etoiles ?: JSONObject.NULL)

    fun fromJson(it: JSONObject) = Outing(it.optLong("id"), it.optString("titre"), it.optLong("date"), it.optString("massif"),
        it.optString("sommet"), if (it.isNull("altitude")) null else it.optInt("altitude"), it.optDouble("lat"), it.optDouble("lon"),
        if (it.isNull("denivele")) null else it.optInt("denivele"), it.optString("dif_ski"), it.optString("orientation"),
        it.optString("conditions"), it.optString("auteur"), it.optString("url"),
        it.optString("skiabilite"), if (it.isNull("etoiles") || !it.has("etoiles")) null else it.optInt("etoiles"))
}

/**
 * Hors ligne : chaque recherche réussie est gardée dans un fichier (texte seulement : titre, date, sommet, point, D+,
 * conditions, lien ; ni récit ni photos), 10 dernières zones. Sans réseau, on rassemble les sorties gardées qui tombent
 * dans la zone et la période demandées. Même logique que addToCache / fromCache de src/ski/skitour.ts.
 */
class SkitourCache(private val file: java.io.File) {
    private class Entry(val zone: Zone, val days: Int, val t: Long, val sorties: List<Outing>)
    private val max = 10

    private fun read(): List<Entry> = runCatching {
        val a = org.json.JSONArray(file.readText())
        (0 until a.length()).map { i -> a.getJSONObject(i).let { e ->
            val z = e.getJSONArray("zone"); val s = e.getJSONArray("sorties")
            Entry(Zone(z.getDouble(0), z.getDouble(1), z.getDouble(2), z.getDouble(3)), e.getInt("days"), e.getLong("t"),
                (0 until s.length()).map { Skitour.fromJson(s.getJSONObject(it)) })
        } }
    }.getOrDefault(emptyList())

    fun add(zone: Zone, days: Int, sorties: List<Outing>, now: Long = System.currentTimeMillis()) {
        val list = (listOf(Entry(zone, days, now, sorties)) + read().filter { it.days != days || it.zone != zone }).take(max)
        val a = org.json.JSONArray()
        list.forEach { e ->
            a.put(JSONObject().put("zone", org.json.JSONArray(listOf(e.zone.west, e.zone.south, e.zone.east, e.zone.north)))
                .put("days", e.days).put("t", e.t).put("sorties", org.json.JSONArray(e.sorties.map { Skitour.toJson(it) })))
        }
        runCatching { file.writeText(a.toString()) }
    }

    /** Sorties gardées dans la zone et la période, et date de la plus ancienne recherche utilisée ; null si aucune ne couvre la zone. */
    fun find(z: Zone, days: Int, now: Long = System.currentTimeMillis()): Pair<List<Outing>, Long>? {
        val used = read().filter { it.zone.west < z.east && it.zone.east > z.west && it.zone.south < z.north && it.zone.north > z.south }
        if (used.isEmpty()) return null
        val since = now / 1000 - days * 86400L
        val res = used.flatMap { it.sorties }.filter { it.lon in z.west..z.east && it.lat in z.south..z.north && it.date >= since }
            .distinctBy { it.id }.sortedByDescending { it.date }
        return res to used.minOf { it.t }
    }
}

/** Liste des sorties de la zone encadrée (la plus récente d'abord) ; les points sont dessinés par MainActivity. */
class SkiPanel(
    private val a: AppCompatActivity,
    private val zone: Zone,
    private val password: String,
    private val onOutings: (List<Outing>, Int?) -> Unit,
    private val onReframe: () -> Unit,
    private val onClose: () -> Unit,
) {
    private val d = a.resources.displayMetrics.density
    private fun dp(v: Int) = (v * d).toInt()
    private val ink = Color.parseColor("#1D2421")
    private val muted = Color.parseColor("#5F6B66")
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
    private val status = text("")
    private val detail = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private val list = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private var outings: List<Outing> = emptyList()
    private val periods = listOf(7 to "7 derniers jours", 30 to "30 derniers jours", 90 to "3 derniers mois", 365 to "12 derniers mois")
    private val prefs = a.getSharedPreferences("reglages", AppCompatActivity.MODE_PRIVATE)
    private val cache = SkitourCache(java.io.File(a.filesDir, "skitour-cache.json"))

    init {
        col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(text("⛷ Sorties ski de rando", 16f, ink, true), LinearLayout.LayoutParams(0, -2, 1f))
            addView(Button(a).apply { text = "✕"; setOnClickListener { onClose() } }, LinearLayout.LayoutParams(dp(48), dp(44)))
        })
        val spin = Spinner(a).apply {
            adapter = ArrayAdapter(a, android.R.layout.simple_spinner_dropdown_item, periods.map { it.second })
            setSelection(periods.indexOfFirst { it.first == prefs.getInt("skitourJours", 30) }.coerceAtLeast(0))
        }
        col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(spin, LinearLayout.LayoutParams(0, -2, 1f))
            addView(Button(a).apply { text = "Autre zone"; setOnClickListener { onReframe() } })
        })
        spin.onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
            override fun onItemSelected(p: android.widget.AdapterView<*>?, v: android.view.View?, pos: Int, id: Long) {
                prefs.edit().putInt("skitourJours", periods[pos].first).apply(); load(periods[pos].first)
            }
            override fun onNothingSelected(p: android.widget.AdapterView<*>?) {}
        }
        col.addView(status); col.addView(detail); col.addView(list)
        col.addView(text("Données skitour.fr (CC BY-NC-ND pour les récits)."))
    }

    private var job: kotlinx.coroutines.Job? = null
    private fun load(days: Int) {
        job?.cancel()
        status.text = "Recherche sur skitour.fr…"; list.removeAllViews(); detail.removeAllViews()
        outings = emptyList(); onOutings(outings, null)
        job = a.lifecycleScope.launch {
            // Sans réseau (ou relais en panne) : sorties gardées sur le téléphone ; offline = date de cette recherche.
            runCatching { withContext<Pair<List<Outing>, Long?>>(Dispatchers.IO) {
                try { Skitour.fetch(zone, days, password).also { cache.add(zone, days, it) } to null }
                catch (e: kotlinx.coroutines.CancellationException) { throw e }
                catch (e: Exception) { cache.find(zone, days) ?: throw e }
            } }
                .onSuccess { (o, offline) ->
                    outings = o; onOutings(o, null)
                    val found = if (o.isEmpty()) "Aucune sortie dans cette zone sur la période."
                        else "${o.size} sortie${if (o.size > 1) "s" else ""} dans la zone (points bleus sur la carte)."
                    status.text = if (offline == null) found else "📴 Hors ligne : sorties gardées sur le téléphone, recherche du " +
                        Instant.ofEpochMilli(offline).atZone(ZoneId.systemDefault())
                            .format(DateTimeFormatter.ofPattern("d MMM 'à' HH:mm", Locale.FRANCE)) + ".\n" + found
                    o.forEachIndexed { i, x ->
                        list.addView(LinearLayout(a).apply {
                            orientation = LinearLayout.VERTICAL; setPadding(dp(10), dp(8), dp(10), dp(8))
                            background = GradientDrawable().apply { setColor(Color.parseColor("#F2F4F1")); cornerRadius = 8 * d }
                            addView(LinearLayout(a).apply {
                                addView(text(x.titre, 15f, ink, true), LinearLayout.LayoutParams(0, -2, 1f))
                                addView(text(x.dateText(), 13f, ink))
                            })
                            addView(text(x.line()))
                            setOnClickListener { select(i) }
                        }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) })
                    }
                }
                .onFailure { if (it !is kotlinx.coroutines.CancellationException) status.text = "Recherche impossible : ${if (it is java.io.IOException) "pas de réseau" else it.message}" }
        }
    }

    /** Sortie choisie (dans la liste ou en touchant son point). */
    fun select(i: Int) {
        val x = outings.getOrNull(i) ?: return
        onOutings(outings, i)
        detail.removeAllViews()
        detail.addView(text(x.titre, 15f, ink, true))
        detail.addView(text("${x.dateText()} · ${x.massif} · par ${x.auteur}"))
        detail.addView(text(x.line(), 14f, ink))
        if (x.conditions.isNotEmpty()) detail.addView(text(x.conditions))
        detail.addView(Button(a).apply {
            text = "Lire la sortie sur skitour.fr"
            setOnClickListener { runCatching { a.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(x.url))) } }
        })
        view.post { view.smoothScrollTo(0, 0) }
    }
}

/** Skiabilité comme sur skitour.fr (« 🙂 Bonne », lue par le relais sur la page de la sortie) ;
 *  si le relais n'a que le chiffre de l'API, « skiabilité 1 » (même texte que skiabText de l'appli web). */
fun skiabText(v: String): String = if (v.isNotEmpty() && v.all { it.isDigit() }) "skiabilité $v" else v
