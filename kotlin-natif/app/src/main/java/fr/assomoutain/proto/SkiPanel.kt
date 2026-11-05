package fr.assomoutain.proto

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
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
                  val skiabilite: String = "", val etoiles: Int? = null,
                  /** Point de départ (parking), si skitour le place. */
                  val parking: Parking? = null) {
    /** Étiquette à côté du point bleu (même texte que outingLabel) :
     *  « Monte Bellino (2942 m), NE / ski 2.3, D+200 m, ★★ / skiabilité 🤢 Mauvaise, il y a 8 j ». */
    fun label(now: Long = System.currentTimeMillis()): String {
        val nom = sommet.ifEmpty { titre }
        val l1 = listOf((if (nom.length > 28) nom.take(27) + "…" else nom) + (altitude?.let { " ($it m)" } ?: ""), orientation)
            .filter { it.isNotEmpty() }.joinToString(", ")
        val l2 = listOf(if (difSki.isNotEmpty()) "ski $difSki" else "", denivele?.let { "D+$it m" } ?: "",
            etoiles?.takeIf { it > 0 }?.let { "★".repeat(it) } ?: "").filter { it.isNotEmpty() }.joinToString(", ")
        val l3 = listOf(if (skiabilite.isNotEmpty()) "skiabilité $skiabilite" else "", if (date > 0) daysAgo(date, now) else "")
            .filter { it.isNotEmpty() }.joinToString(", ")
        return listOf(l1, l2, l3).filter { it.isNotEmpty() }.joinToString("\n")
    }
    fun dateText(): String = Instant.ofEpochSecond(date).atZone(ZoneId.systemDefault()).toLocalDate()
        .format(DateTimeFormatter.ofPattern("d MMM yyyy", Locale.FRANCE))
    fun line() = listOfNotNull(sommet + (altitude?.let { " $it m" } ?: ""), denivele?.let { "D+ $it m" },
        difSki.ifEmpty { null }?.let { "ski $it" }, orientation.ifEmpty { null }).joinToString(" · ")
}

/** Parking (point de départ) d'une sortie, même modèle que Parking de src/ski/skitour.ts. */
data class Parking(val nom: String, val altitude: Int?, val lat: Double, val lon: Double) {
    /** « P Val Thorens (2300 m) » : le P est dessiné en bleu par skiTagBitmap (même texte que parkingText de l'appli web). */
    fun text() = listOf("P", nom, altitude?.let { "($it m)" } ?: "").filter { it.isNotEmpty() }.joinToString(" ")
    fun toJson(): JSONObject = JSONObject().put("nom", nom).put("altitude", altitude ?: JSONObject.NULL).put("lat", lat).put("lon", lon)
    companion object {
        fun from(o: JSONObject?): Parking? {
            if (o == null) return null
            val lat = o.optDouble("lat"); val lon = o.optDouble("lon")
            if (lat.isNaN() || lon.isNaN()) return null
            return Parking(o.optString("nom"), if (o.isNull("altitude") || !o.has("altitude")) null else o.optInt("altitude"), lat, lon)
        }
    }
}

/**
 * Un seul parking par endroit quand plusieurs sorties partent du même : la sortie choisie le représente si elle en fait
 * partie (sinon la première) ; nom et altitude pris sur celle qui les a. Même règle que uniqueParkings de l'appli web.
 */
fun uniqueParkings(outings: List<Outing>, sel: Int?): List<Triple<Int, Parking, Boolean>> {
    val by = LinkedHashMap<String, Triple<Int, Parking, Boolean>>()
    outings.forEachIndexed { i, o ->
        val pk = o.parking ?: return@forEachIndexed
        val k = String.format(Locale.US, "%.4f,%.4f", pk.lat, pk.lon)
        val cur = by[k]
        if (cur == null) { by[k] = Triple(i, pk, i == sel); return@forEachIndexed }
        val merged = cur.second.copy(nom = cur.second.nom.ifEmpty { pk.nom }, altitude = cur.second.altitude ?: pk.altitude)
        by[k] = if (i == sel) Triple(i, merged, true) else cur.copy(second = merged)
    }
    return by.values.toList()
}

object Skitour {
    private fun outing(it: JSONObject) = Outing(it.optLong("id"), it.optString("titre"), it.optLong("date"), it.optString("massif"), it.optString("sommet"),
        if (it.isNull("altitude")) null else it.optInt("altitude"), it.optDouble("lat"), it.optDouble("lon"),
        if (it.isNull("denivele")) null else it.optInt("denivele"), if (it.isNull("dif_ski")) "" else it.optString("dif_ski"),
        it.optString("orientation"), it.optString("conditions"), it.optString("auteur"), it.optString("url"),
        it.optString("skiabilite"), if (it.isNull("etoiles") || !it.has("etoiles")) null else it.optInt("etoiles"),
        Parking.from(it.optJSONObject("parking")))

    /**
     * ⛷🗺 : toutes les sorties de la période en une requête (filtrées ensuite sur l'écran), gardées dans un fichier pour
     * le hors ligne. Rend les sorties et, hors ligne, la date de la liste gardée. Même logique que loadAll de l'appli web.
     */
    fun fetchAll(file: java.io.File, days: Int, password: String): Pair<List<Outing>, Long?> = try {
        val a = Travel.post("skitour-tout", JSONObject().put("jours", days), password).optJSONArray("sorties") ?: org.json.JSONArray()
        val o = (0 until a.length()).map { outing(a.getJSONObject(it)) }.filter { !it.lat.isNaN() && !it.lon.isNaN() }.sortedByDescending { it.date }
        runCatching { file.writeText(JSONObject().put("days", days).put("t", System.currentTimeMillis()).put("sorties", org.json.JSONArray(o.map { toJson(it) })).toString()) }
        o to null
    } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) {
        val saved = runCatching { JSONObject(file.readText()) }.getOrNull() ?: throw e
        val since = System.currentTimeMillis() / 1000 - days * 86400L
        val a = saved.getJSONArray("sorties")
        (0 until a.length()).map { fromJson(a.getJSONObject(it)) }.filter { it.date >= since } to saved.optLong("t")
    }

    /** Étoiles, skiabilité en mot et parking des sorties demandées (30 au plus), par id. */
    fun details(ids: List<Long>, password: String): Map<Long, JSONObject> {
        val d = Travel.post("skitour-details", JSONObject().put("ids", org.json.JSONArray(ids.take(30))), password).optJSONObject("details") ?: return emptyMap()
        return d.keys().asSequence().mapNotNull { k -> k.toLongOrNull()?.let { it to d.getJSONObject(k) } }.toMap()
    }

    fun fetch(z: Zone, days: Int, password: String): List<Outing> {
        val o = Travel.post("skitour", JSONObject().put("ouest", z.west).put("sud", z.south).put("est", z.east).put("nord", z.north).put("jours", days), password)
        val a = o.optJSONArray("sorties") ?: return emptyList()
        return (0 until a.length()).map { i -> a.getJSONObject(i).let {
            Outing(it.optLong("id"), it.optString("titre"), it.optLong("date"), it.optString("massif"), it.optString("sommet"),
                if (it.isNull("altitude")) null else it.optInt("altitude"), it.optDouble("lat"), it.optDouble("lon"),
                if (it.isNull("denivele")) null else it.optInt("denivele"), if (it.isNull("dif_ski")) "" else it.optString("dif_ski"),
                it.optString("orientation"), it.optString("conditions"), it.optString("auteur"), it.optString("url"),
                it.optString("skiabilite"), if (it.isNull("etoiles") || !it.has("etoiles")) null else it.optInt("etoiles"),
                Parking.from(it.optJSONObject("parking")))
        } }.filter { !it.lat.isNaN() && !it.lon.isNaN() }.sortedByDescending { it.date }
    }

    fun toJson(x: Outing): JSONObject = JSONObject().put("id", x.id).put("titre", x.titre).put("date", x.date).put("massif", x.massif)
        .put("sommet", x.sommet).put("altitude", x.altitude ?: JSONObject.NULL).put("lat", x.lat).put("lon", x.lon)
        .put("denivele", x.denivele ?: JSONObject.NULL).put("dif_ski", x.difSki).put("orientation", x.orientation)
        .put("conditions", x.conditions).put("auteur", x.auteur).put("url", x.url)
        .put("skiabilite", x.skiabilite).put("etoiles", x.etoiles ?: JSONObject.NULL).put("parking", x.parking?.toJson() ?: JSONObject.NULL)

    fun fromJson(it: JSONObject) = Outing(it.optLong("id"), it.optString("titre"), it.optLong("date"), it.optString("massif"),
        it.optString("sommet"), if (it.isNull("altitude")) null else it.optInt("altitude"), it.optDouble("lat"), it.optDouble("lon"),
        if (it.isNull("denivele")) null else it.optInt("denivele"), it.optString("dif_ski"), it.optString("orientation"),
        it.optString("conditions"), it.optString("auteur"), it.optString("url"),
        it.optString("skiabilite"), if (it.isNull("etoiles") || !it.has("etoiles")) null else it.optInt("etoiles"),
        Parking.from(it.optJSONObject("parking")))
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
/** Détails (étoiles, skiabilité, parking) gardés sur le téléphone, 800 sorties au plus (les plus récentes). */
class SkiDetails(private val file: java.io.File) {
    private val max = 800
    private val map: LinkedHashMap<Long, JSONObject> = runCatching {
        val o = JSONObject(file.readText()); val m = LinkedHashMap<Long, JSONObject>()
        val a = o.getJSONArray("ordre"); for (k in 0 until a.length()) { val id = a.getLong(k); o.optJSONObject("d$id")?.let { m[id] = it } }; m
    }.getOrDefault(LinkedHashMap())
    fun has(id: Long) = map.containsKey(id)
    fun apply(x: Outing): Outing {
        val d = map[x.id] ?: return x
        return x.copy(etoiles = if (d.isNull("etoiles") || !d.has("etoiles")) x.etoiles else d.optInt("etoiles"),
            skiabilite = d.optString("skiabilite").ifEmpty { x.skiabilite }, parking = Parking.from(d.optJSONObject("parking")) ?: x.parking)
    }
    fun add(add: Map<Long, JSONObject>) {
        add.forEach { (k, v) -> map.remove(k); map[k] = v }
        while (map.size > max) map.remove(map.keys.first())
        val o = JSONObject().put("ordre", org.json.JSONArray(map.keys.toList()))
        map.forEach { (k, v) -> o.put("d$k", v) }
        runCatching { file.writeText(o.toString()) }
    }
}

/**
 * Sorties skitour.fr de l'écran affiché : toute la liste de la période est chargée une fois, puis filtrée sur l'écran
 * à chaque arrêt de la carte (aucune requête) ; étoiles, skiabilité et parking demandés pour les sorties visibles.
 * Même fonctionnement que SkiPanel.tsx.
 */
class SkiPanel(
    private val a: AppCompatActivity,
    private val password: String,
    /** Écran affiché (zone et zoom), ou null si la carte n'est pas prête. */
    private val viewport: () -> Pair<Zone, Double>?,
    private val onOutings: (List<Outing>, Int?) -> Unit,
    private val onClose: () -> Unit,
    /** Ouvre la fiche complète de la sortie (façon skitour.fr). */
    private val onSheet: (Outing) -> Unit = {},
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
    /** Choix de période (jours ; 3650 = « Tout »), comme PERIODS de l'appli web. */
    private val periods = listOf(1 to "< 1 j", 2 to "< 2 j", 3 to "< 3 j", 4 to "< 4 j", 5 to "< 5 j", 7 to "< 1 sem.",
        15 to "< 15 j", 30 to "< 30 j", 90 to "< 3 mois", 365 to "< 1 an", 3650 to "Tout")
    /** Difficulté ski maximale (échelle Toponeige 1.1 à 5.6) ; 0 = toutes. Comme SKI_LEVELS de l'appli web. */
    private val skiLevels = listOf(1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 5.2, 5.4).map { it to "≤ $it" } + (0.0 to "Tout")
    private val count = text("", 13f, muted)
    private val pill = Button(a)
    private val skiPill = Button(a)
    private val menu = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; visibility = android.view.View.GONE }
    private val skiMenu = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; visibility = android.view.View.GONE }
    private var days = 30
    private var skiMax = 0.0
    private val prefs = a.getSharedPreferences("reglages", AppCompatActivity.MODE_PRIVATE)
    private val allFile = java.io.File(a.filesDir, "skitour-tout.json")
    private val details = SkiDetails(java.io.File(a.filesDir, "skitour-details.json"))
    private val asked = mutableSetOf<Long>() // déjà demandés (une fois par ouverture, même si la réponse manque)
    private var all: List<Outing> = emptyList()
    private var offline: Long? = null
    private var selId: Long? = null
    private var low = false
    private val lowBtn = Button(a)

    init {
        days = prefs.getInt("skitourJours", 30).takeIf { d -> periods.any { it.first == d } } ?: 30
        skiMax = prefs.getFloat("skitourSkiMax", 0f).toDouble().let { m -> skiLevels.firstOrNull { kotlin.math.abs(it.first - m) < 1e-6 }?.first ?: 0.0 }
        // Filtres en pastilles, tous visibles sur la première ligne (sans titre : on est déjà dans la recherche par carte) ;
        // celui qu'on touche se déplie au-dessus, un seul à la fois, et un choix le replie. Puis ▾ (réduire) et ✕.
        fun pillStyle(b: Button, color: String, desc: String) = b.apply {
            isAllCaps = false; setTextColor(Color.WHITE); setTypeface(typeface, Typeface.BOLD); textSize = 13f; minWidth = 0; minimumWidth = 0
            setPadding(dp(10), 0, dp(10), 0)
            background = GradientDrawable().apply { setColor(Color.parseColor(color)); cornerRadius = 999f }
            contentDescription = desc
        }
        pillStyle(pill, "#2F6FD6", "Période des sorties").setOnClickListener { showMenu(if (menu.visibility == android.view.View.VISIBLE) null else menu) }
        pillStyle(skiPill, "#E07B1D", "Difficulté ski maximale").setOnClickListener { showMenu(if (skiMenu.visibility == android.view.View.VISIBLE) null else skiMenu) }
        fillMenu(menu, periods.map { it.first.toDouble() to it.second }) { v ->
            days = v.toInt(); prefs.edit().putInt("skitourJours", days).apply(); load(days)
        }
        fillMenu(skiMenu, skiLevels) { v -> skiMax = v; prefs.edit().putFloat("skitourSkiMax", v.toFloat()).apply(); refresh() }
        col.addView(menu); col.addView(skiMenu)
        col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(count, LinearLayout.LayoutParams(0, -2, 1f))
            addView(pill, LinearLayout.LayoutParams(-2, dp(36)).apply { marginEnd = dp(4) })
            addView(skiPill, LinearLayout.LayoutParams(-2, dp(36)).apply { marginEnd = dp(4) })
            addView(lowBtn.apply { setOnClickListener { setLow(!low) } }, LinearLayout.LayoutParams(dp(44), dp(44)))
            addView(Button(a).apply { text = "✕"; setOnClickListener { onClose() } }, LinearLayout.LayoutParams(dp(44), dp(44)))
        })
        showMenu(null)
        col.addView(status); col.addView(detail); col.addView(list)
        col.addView(text("Données skitour.fr (CC BY-NC-ND pour les récits)."))
        setLow(true) // ouvert réduit : juste la ligne des pastilles, la carte d'abord
        view.post { load(days) } // après l'init complet (job, detJob)
    }

    /** Choix d'un filtre, par lignes de 6 ; un appui choisit et replie. */
    private fun fillMenu(m: LinearLayout, items: List<Pair<Double, String>>, pick: (Double) -> Unit) {
        items.chunked(6).forEach { row ->
            m.addView(LinearLayout(a).apply {
                row.forEach { (v, t) ->
                    addView(Button(a).apply {
                        text = t; tag = v; isAllCaps = false; textSize = 12f; minWidth = 0; minimumWidth = 0; minHeight = 0; minimumHeight = 0
                        setPadding(dp(2), dp(6), dp(2), dp(6))
                        setOnClickListener { pick(v); showMenu(null) }
                    }, LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = dp(3) })
                }
                if (row.size < 6) addView(android.view.View(a), LinearLayout.LayoutParams(0, 0, (6 - row.size).toFloat()))
            }, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(3) })
        }
    }

    /** Les 2 menus (enfants 0 et 1) et la ligne des pastilles (enfant 2) restent ; ▾ cache le reste, ▴ le remet. */
    private fun setLow(v: Boolean) {
        low = v
        lowBtn.text = if (v) "▴" else "▾"; lowBtn.contentDescription = if (v) "Agrandir le panneau" else "Réduire le panneau"
        for (k in 3 until col.childCount) col.getChildAt(k).visibility = if (v) android.view.View.GONE else android.view.View.VISIBLE
        if (status.text.isEmpty()) status.visibility = android.view.View.GONE
        view.layoutParams = view.layoutParams.apply { height = -2 }
    }

    /** Déplie un seul menu (ou aucun) et met les pastilles à jour. */
    private fun showMenu(open: LinearLayout?) {
        menu.visibility = if (open === menu) android.view.View.VISIBLE else android.view.View.GONE
        skiMenu.visibility = if (open === skiMenu) android.view.View.VISIBLE else android.view.View.GONE
        pill.text = (periods.firstOrNull { it.first == days }?.second ?: "< $days j") + if (open === menu) " ▴" else " ▾"
        skiPill.text = (if (skiMax > 0) "≤ $skiMax" else "Ski : tout") + if (open === skiMenu) " ▴" else " ▾"
        for ((m, cur, color) in listOf(Triple(menu, days.toDouble(), "#2F6FD6"), Triple(skiMenu, skiMax, "#E07B1D")))
            for (k in 0 until m.childCount) (m.getChildAt(k) as LinearLayout).let { row ->
                for (j in 0 until row.childCount) (row.getChildAt(j) as? Button)?.let { b ->
                    val on = (b.tag as? Double)?.let { kotlin.math.abs(it - cur) < 1e-6 } == true
                    b.setTypeface(null, if (on) Typeface.BOLD else Typeface.NORMAL)
                    b.background = GradientDrawable().apply { setColor(Color.parseColor(if (on) color else "#F2F4F1")); cornerRadius = 999f }
                    b.setTextColor(if (on) Color.WHITE else ink)
                }
            }
    }

    private var job: kotlinx.coroutines.Job? = null
    private fun load(days: Int) {
        job?.cancel()
        status.text = ""; status.visibility = android.view.View.GONE; count.text = "Recherche…"; list.removeAllViews(); detail.removeAllViews()
        all = emptyList(); outings = emptyList(); onOutings(outings, null)
        job = a.lifecycleScope.launch {
            runCatching { withContext(Dispatchers.IO) { Skitour.fetchAll(allFile, days, password) } }
                .onSuccess { (o, off) -> all = o; offline = off; refresh() }
                .onFailure { if (it !is kotlinx.coroutines.CancellationException) { count.text = ""; status.visibility = android.view.View.VISIBLE; status.text = "Recherche impossible : ${if (it is java.io.IOException) "pas de réseau" else it.message}" } }
        }
    }

    private var detJob: kotlinx.coroutines.Job? = null
    /** À chaque arrêt de la carte (appelé par MainActivity) : sorties de l'écran, puis leurs détails manquants. */
    fun refresh() {
        val vp = viewport() ?: return
        val (z, zoom) = vp
        val far = zoom < SKI_MIN_ZOOM
        val vis = if (far) emptyList() else all.filter { it.lon in z.west..z.east && it.lat in z.south..z.north && skiOk(it.difSki, skiMax) }.take(150).map { details.apply(it) }
        outings = vis
        val k = vis.indexOfFirst { it.id == selId }.takeIf { it >= 0 }
        onOutings(vis, k)
        count.text = if (far) "Zoome" else "" // pas de nombre de sorties (inutile)
        val notes = listOfNotNull(
            offline?.let { "📴 Hors ligne : sorties gardées sur le téléphone, liste du " +
                Instant.ofEpochMilli(it).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("d MMM 'à' HH:mm", Locale.FRANCE)) + "." },
            if (far) "Rapproche la carte pour voir les sorties (${all.size} sur la période)." else null)
        status.text = notes.joinToString("\n")
        status.visibility = if (notes.isEmpty() || low) android.view.View.GONE else android.view.View.VISIBLE
        list.removeAllViews()
        if (k == null) detail.removeAllViews()
        vis.forEachIndexed { i, x ->
            list.addView(LinearLayout(a).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(10), dp(8), dp(10), dp(8))
                background = GradientDrawable().apply { setColor(Color.parseColor(if (i == k) "#DCE8F7" else "#F2F4F1")); cornerRadius = 8 * d }
                addView(LinearLayout(a).apply {
                    addView(text(x.titre, 15f, ink, true), LinearLayout.LayoutParams(0, -2, 1f))
                    addView(text(x.dateText(), 13f, ink))
                })
                addView(text(x.line()))
                setOnClickListener { select(i) }
            }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) })
        }
        val missing = vis.filter { !details.has(it.id) && it.id !in asked }.take(30).map { it.id }
        detJob?.cancel()
        if (missing.isEmpty()) return
        detJob = a.lifecycleScope.launch {
            kotlinx.coroutines.delay(1000)
            asked.addAll(missing)
            runCatching { withContext(Dispatchers.IO) { Skitour.details(missing, password) } }
                .onSuccess { details.add(it); refresh() }
        }
    }

    /** Ouvre la fiche texte de la sortie (appui sur la carte). */
    fun openSheet(x: Outing) = onSheet(x)

    /** Sortie choisie (dans la liste ou en touchant son point). */
    fun select(i: Int) {
        val x = outings.getOrNull(i) ?: return
        selId = x.id
        onOutings(outings, i)
        detail.removeAllViews()
        detail.addView(text(x.titre, 15f, ink, true))
        detail.addView(text("${x.dateText()} · ${x.massif} · par ${x.auteur}"))
        detail.addView(text(x.line(), 14f, ink))
        if (x.conditions.isNotEmpty()) detail.addView(text(x.conditions))
        detail.addView(LinearLayout(a).apply {
            addView(Button(a).apply { text = "Fiche de la sortie"; setOnClickListener { onSheet(x) } }, LinearLayout.LayoutParams(0, -2, 1f))
            addView(Button(a).apply {
                text = "Sur skitour.fr"
                setOnClickListener { runCatching { a.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(x.url))) } }
            }, LinearLayout.LayoutParams(0, -2, 1f))
        })
        view.post { view.smoothScrollTo(0, 0) }
    }
}

/** Skiabilité comme sur skitour.fr (« 🙂 Bonne », lue par le relais sur la page de la sortie) ;
 *  si le relais n'a que le chiffre de l'API, « skiabilité 1 » (même texte que skiabText de l'appli web). */
/** La sortie passe le filtre de difficulté ski (une sortie sans cotation est gardée), comme skiOk de l'appli web. */
fun skiOk(difSki: String?, max: Double): Boolean {
    if (max <= 0) return true
    val v = difSki?.replace(',', '.')?.trim()?.toDoubleOrNull() ?: return true
    return v <= 0 || v <= max + 1e-9
}

/** « il y a 8 j » depuis la date de la sortie (secondes Unix), comme daysAgo de l'appli web. */
/** En dessous de ce zoom, l'écran couvre trop de pays : on ne montre pas les points (comme SKI_MIN_ZOOM de l'appli web). */
const val SKI_MIN_ZOOM = 7.0

fun daysAgo(date: Long, now: Long = System.currentTimeMillis()): String {
    val n = maxOf(0L, (now - date * 1000) / 86_400_000L)
    return if (n == 0L) "aujourd'hui" else "il y a $n j"
}

fun skiabText(v: String): String = if (v.isNotEmpty() && v.all { it.isDigit() }) "skiabilité $v" else v
