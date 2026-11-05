package fr.assomoutain.proto

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
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
import org.json.JSONArray
import org.json.JSONObject
import java.text.Normalizer
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Une sortie de la liste en texte (même modèle que OutingRow de src/ski/skitour.ts). */
data class OutingRow(val id: Long, val titre: String, val date: Long, val massif: String, val sommet: String, val altitude: Int?,
                     val lat: Double?, val lon: Double?, val denivele: Int?, val difSki: String, val orientation: String,
                     val auteurs: String, val url: String, val skiabilite: String = "", val etoiles: Int? = null)

/** La fiche d'une sortie (même modèle que OutingSheet). */
class OutingSheet(val row: OutingRow, val sommets: List<String>, val depart: String, val topos: List<String>,
                  val conditions: String, val neige: List<String>, val recit: String, val skiabilite: String, val photos: List<SkiPhoto>)

/** Photo d'une sortie : affichée seulement dans sa fiche, avec son auteur (conditions de l'API skitour). */
data class SkiPhoto(val url: String, val legende: String, val auteur: String)

/**
 * Photos des fiches : chaque photo vue est gardée en taille réduite (1024 px, JPEG) dans filesDir/skitour-photos,
 * ce qui la rend lisible hors ligne ; on ne garde que celles des 50 fiches gardées. Même rôle que src/ski/photoStore.ts.
 */
object SkiPhotos {
    private const val MAX_PX = 1024
    private fun dir(c: android.content.Context) = java.io.File(c.filesDir, "skitour-photos").apply { mkdirs() }
    private fun name(url: String) = java.security.MessageDigest.getInstance("SHA-1").digest(url.toByteArray())
        .joinToString("") { "%02x".format(it) } + ".jpg"

    /** La photo (gardée, sinon téléchargée puis gardée), ou null sans réseau. À appeler hors du fil principal. */
    fun load(c: android.content.Context, url: String): android.graphics.Bitmap? {
        val f = java.io.File(dir(c), name(url))
        if (!f.exists()) runCatching {
            val bytes = (java.net.URL(url).openConnection() as java.net.HttpURLConnection).run {
                connectTimeout = 15_000; readTimeout = 30_000; setRequestProperty("User-Agent", "Assomoutain")
                inputStream.use { it.readBytes() }
            }
            val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
            android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            var sample = 1
            while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_PX) sample *= 2
            val bmp = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size,
                android.graphics.BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
            val k = minOf(1f, MAX_PX.toFloat() / maxOf(bmp.width, bmp.height))
            val small = if (k < 1f) android.graphics.Bitmap.createScaledBitmap(bmp, (bmp.width * k).toInt(), (bmp.height * k).toInt(), true) else bmp
            val tmp = java.io.File(f.path + ".tmp")
            tmp.outputStream().use { small.compress(android.graphics.Bitmap.CompressFormat.JPEG, 75, it) }
            tmp.renameTo(f)
        }
        return if (f.exists()) android.graphics.BitmapFactory.decodeFile(f.path) else null
    }

    /** Retire les photos qui n'appartiennent plus à une fiche gardée. */
    fun prune(c: android.content.Context, keep: Collection<String>) {
        val names = keep.map { name(it) }.toSet()
        dir(c).listFiles()?.forEach { if (it.name !in names) it.delete() }
    }
}

/**
 * Sorties en texte (⛷💬) : liste façon skitour.fr puis fiche, via le relais (/skitour-liste, /skitour-sortie).
 * La dernière liste et les 50 dernières fiches ouvertes restent sur le téléphone (lisibles hors ligne).
 */
object SkiText {
    private fun strs(a: JSONArray?) = if (a == null) emptyList() else (0 until a.length()).map { a.optString(it) }
    private fun intOrNull(o: JSONObject, k: String) = if (o.isNull(k) || !o.has(k)) null else o.optInt(k)
    private fun dblOrNull(o: JSONObject, k: String) = if (o.isNull(k) || !o.has(k)) null else o.optDouble(k).takeIf { !it.isNaN() }

    fun row(o: JSONObject) = OutingRow(o.optLong("id"), o.optString("titre"), o.optLong("date"), o.optString("massif"), o.optString("sommet"),
        intOrNull(o, "altitude"), dblOrNull(o, "lat"), dblOrNull(o, "lon"), intOrNull(o, "denivele"),
        if (o.isNull("dif_ski")) "" else o.optString("dif_ski"), o.optString("orientation"), o.optString("auteurs"), o.optString("url"),
        o.optString("skiabilite"), intOrNull(o, "etoiles"))

    fun sheet(o: JSONObject) = OutingSheet(row(o), strs(o.optJSONArray("sommets")), o.optString("depart"), strs(o.optJSONArray("topos")),
        o.optString("conditions"), strs(o.optJSONArray("neige")), o.optString("recit"), o.optString("skiabilite"),
        // Anciennes fiches gardées : « photos » était un nombre.
        o.optJSONArray("photos")?.let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it) }
            .map { SkiPhoto(it.optString("url"), it.optString("legende"), it.optString("auteur")) }.filter { it.url.isNotEmpty() } } ?: emptyList())

    /** Adresses des photos de toutes les fiches gardées (pour SkiPhotos.prune). */
    fun keptPhotoUrls(f: java.io.File): List<String> {
        val a = readSheets(f)
        return (0 until a.length()).flatMap { sheet(a.getJSONObject(it)).photos.map { p -> p.url } }
    }

    /** (jours, date de la liste en ms, sorties) */
    fun readList(f: java.io.File): Triple<Int, Long, List<OutingRow>>? = runCatching {
        val o = JSONObject(f.readText()); val a = o.getJSONArray("sorties")
        Triple(o.getInt("jours"), o.getLong("t"), (0 until a.length()).map { row(a.getJSONObject(it)) })
    }.getOrNull()

    fun fetchList(f: java.io.File, jours: Int, massifs: List<Int>, password: String): Triple<Int, Long, List<OutingRow>> {
        val o = Travel.post("skitour-liste", JSONObject().put("jours", jours).put("massifs", JSONArray(massifs)), password)
        val a = o.optJSONArray("sorties") ?: JSONArray()
        val t = System.currentTimeMillis()
        runCatching { f.writeText(JSONObject().put("jours", jours).put("t", t).put("sorties", a).toString()) }
        return Triple(jours, t, (0 until a.length()).map { row(a.getJSONObject(it)) })
    }

    private fun readSheets(f: java.io.File): JSONArray = runCatching { JSONArray(f.readText()) }.getOrDefault(JSONArray())

    fun savedSheet(f: java.io.File, id: Long): OutingSheet? {
        val a = readSheets(f)
        return (0 until a.length()).map { a.getJSONObject(it) }.firstOrNull { it.optLong("id") == id }?.let { sheet(it) }
    }

    fun fetchSheet(f: java.io.File, id: Long, password: String): OutingSheet {
        val o = Travel.post("skitour-sortie", JSONObject().put("id", id), password)
        val old = readSheets(f)
        val a = JSONArray().put(o)
        (0 until old.length()).map { old.getJSONObject(it) }.filter { it.optLong("id") != id }.take(49).forEach { a.put(it) }
        runCatching { f.writeText(a.toString()) }
        return sheet(o)
    }

    /** Massifs de skitour (id, nom, groupe), demandés au relais et gardés dans un fichier. */
    data class Massif(val id: Int, val nom: String, val groupe: String)
    private fun massifs(a: JSONArray) = (0 until a.length()).map { a.getJSONObject(it) }
        .map { Massif(it.optInt("id"), it.optString("nom"), it.optString("groupe")) }.filter { it.id > 0 }
    fun readMassifs(f: java.io.File): List<Massif> = runCatching { massifs(JSONArray(f.readText())) }.getOrDefault(emptyList())
    fun fetchMassifs(f: java.io.File, password: String): List<Massif> {
        val a = Travel.post("skitour-massifs", JSONObject(), password).optJSONArray("massifs") ?: JSONArray()
        if (a.length() > 0) runCatching { f.writeText(a.toString()) }
        return massifs(a)
    }
    /** Groupes dans l'ordre de l'API, massifs dans l'ordre alphabétique. */
    fun group(ms: List<Massif>): List<Pair<String, List<String>>> = ms.groupBy { it.groupe.ifEmpty { "Autres" } }
        .map { (g, l) -> g to l.map { it.nom }.sortedWith(java.text.Collator.getInstance(Locale.FRANCE)) }

    /** Massifs du site skitour.fr (page Sorties), pour le hors ligne quand la liste n'a jamais été reçue. */
    val MASSIF_GROUPS = listOf(
        "Haute Savoie" to listOf("Bornes - Aravis", "Chablais - Faucigny", "Haut Giffre - Aiguilles Rouges", "Mont Blanc"),
        "Savoie" to listOf("Alpes Grées N", "Alpes Grées S", "Bauges", "Beaufortain", "Lauzière - Cheval Noir", "Vanoise"),
        "Isère" to listOf("Belledonne", "Chartreuse", "Grandes Rousses - Arves", "Taillefer - Matheysine", "Vercors"),
        "Hautes Alpes" to listOf("Cerces - Thabor - Mont Cenis", "Devoluy", "Ecrins", "Queyras - Alpes Cozie N"),
        "Alpes du Sud - Corse" to listOf("Corse", "Mercantour - Alpes Maritimes Italiennes", "Préalpes de Digne", "Préalpes de Grasse", "Préalpes de provence", "Ubaye - Parpaillon - Alpes Cozie S"),
        "Pyrénées" to listOf("Andorre - Ariège", "Canigó - Catalogne Est", "Cerdagne - Capcir - Conflent", "Couserans - Catalogne Ouest", "Luchon - Posets - Maladeta", "Mont-Perdu - Gavarnie - Bigorre", "Navarre - Béarn"),
        "Autres massifs" to listOf("Jura", "Massif Central", "Montagne Ardéchoise", "Vosges"),
    )

    /** « Limiter à » de skitour.fr, en jours. */
    val LIMITS = listOf(1 to "1 jour", 2 to "2 jours", 3 to "3 jours", 4 to "4 jours", 5 to "5 jours", 6 to "6 jours",
        7 to "1 sem.", 14 to "2 sem.", 30 to "1 mois", 60 to "2 mois", 90 to "3 mois", 180 to "6 mois")

    private fun norm(t: String) = Normalizer.normalize(t, Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "").lowercase()

    /** Chaque mot (sans accents) doit se trouver dans le titre, le massif, le sommet ou les auteurs. */
    fun filter(rows: List<OutingRow>, q: String): List<OutingRow> {
        val words = norm(q).split(Regex("[^a-z0-9]+")).filter { it.isNotEmpty() }
        if (words.isEmpty()) return rows
        return rows.filter { o -> val t = norm("${o.titre} ${o.massif} ${o.sommet} ${o.auteurs}"); words.all { t.contains(it) } }
    }
}

class SkiTextPanel(
    private val a: AppCompatActivity,
    private val password: String,
    private val onShowOnMap: (Outing) -> Unit,
    private val onClose: () -> Unit,
) {
    private val d = a.resources.displayMetrics.density
    private fun dp(v: Int) = (v * d).toInt()
    private val ink = Color.parseColor("#1D2421")
    private val muted = Color.parseColor("#5F6B66")
    private val accent = Color.parseColor("#2F6F4F")
    private val listFile = java.io.File(a.filesDir, "skitour-liste.json")
    private val sheetsFile = java.io.File(a.filesDir, "skitour-fiches.json")
    private val prefs = a.getSharedPreferences("reglages", AppCompatActivity.MODE_PRIVATE)
    private val col = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(14), dp(36), dp(14), dp(24)) }
    val view: ScrollView = ScrollView(a).apply {
        addView(col); elevation = 12 * d; isClickable = true; setBackgroundColor(Color.WHITE)
        layoutParams = FrameLayout.LayoutParams(-1, -1)
    }
    private fun text(t: String, size: Float = 13f, color: Int = muted, bold: Boolean = false) =
        TextView(a).apply { text = t; textSize = size; setTextColor(color); if (bold) setTypeface(typeface, Typeface.BOLD); setPadding(0, dp(3), 0, dp(2)) }
    private fun box() = LinearLayout(a).apply {
        orientation = LinearLayout.VERTICAL; setPadding(dp(10), dp(8), dp(10), dp(8))
        background = GradientDrawable().apply { setColor(Color.parseColor("#F2F4F1")); cornerRadius = 8 * d }
    }
    private fun lp(top: Int = 6) = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(top) }

    private val periods = SkiText.LIMITS
    private val massifsFile = java.io.File(a.filesDir, "skitour-massifs.json")
    private var allMassifs: List<SkiText.Massif> = SkiText.readMassifs(massifsFile)
    /** Massifs choisis (vide = tous), retenus d'une fois sur l'autre. */
    private var chosen: List<String> = runCatching { JSONArray(prefs.getString("skitourMassifs", "[]")).let { j -> (0 until j.length()).map { j.getString(it) } } }.getOrDefault(emptyList())
    private fun saveChosen() = prefs.edit().putString("skitourMassifs", JSONArray(chosen).toString()).apply()
    private fun chosenIds(): List<Int> {
        val ids = chosen.mapNotNull { n -> allMassifs.firstOrNull { it.nom == n }?.id }
        return if (ids.size == chosen.size) ids else emptyList()  // un massif inconnu : on demande tout et on filtre ici
    }
    private val massifBtn = Button(a).apply { isAllCaps = false; gravity = Gravity.START or Gravity.CENTER_VERTICAL }
    private fun massifLabel() { massifBtn.text = "Massifs : " + when (chosen.size) { 0 -> "Tous"; 1 -> chosen[0]; else -> "${chosen.size} massifs" } + " ▾" }
    private var rows: List<OutingRow> = emptyList()
    private val search = EditText(a).apply {
        hint = "Filtrer : sommet, auteur…"; isSingleLine = true; inputType = InputType.TYPE_CLASS_TEXT
        addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) = fill()
            override fun beforeTextChanged(s: CharSequence?, st: Int, c: Int, af: Int) {}
            override fun onTextChanged(s: CharSequence?, st: Int, b: Int, c: Int) {}
        })
    }
    private val status = text("")
    private val table = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private var job: kotlinx.coroutines.Job? = null
    private var loadedIds: List<Int>? = null
    private var loading = false
    private var note = ""

    init {
        showList()
        a.lifecycleScope.launch {
            runCatching { withContext(Dispatchers.IO) { SkiText.fetchMassifs(massifsFile, password) } }.onSuccess { if (it.isNotEmpty()) allMassifs = it }
        }
    }

    private fun header(left: android.view.View) = LinearLayout(a).apply {
        gravity = Gravity.CENTER_VERTICAL
        addView(left, LinearLayout.LayoutParams(0, -2, 1f))
        addView(Button(a).apply { text = "✕"; setOnClickListener { onClose() } }, LinearLayout.LayoutParams(dp(48), dp(44)))
    }

    private fun showList() {
        col.removeAllViews()
        col.addView(header(text("⛷💬 Sorties ski de rando", 16f, ink, true)))
        val spin = Spinner(a).apply {
            adapter = ArrayAdapter(a, android.R.layout.simple_spinner_dropdown_item, periods.map { it.second })
            setSelection(periods.indexOfFirst { it.first == prefs.getInt("skitourTexteJours", 14) }.coerceAtLeast(0))
        }
        (search.parent as? android.view.ViewGroup)?.removeView(search)
        (massifBtn.parent as? android.view.ViewGroup)?.removeView(massifBtn)
        massifLabel(); massifBtn.setOnClickListener { showPicker() }
        col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(massifBtn, LinearLayout.LayoutParams(0, -2, 1f))
            addView(LinearLayout(a).apply {
                orientation = LinearLayout.VERTICAL
                addView(text("Limiter à", 11f)); addView(spin)
            })
        })
        col.addView(search)
        col.addView(status); col.addView(table)
        col.addView(text("Données skitour.fr (CC BY-NC-ND pour les récits)."))
        spin.onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
            override fun onItemSelected(p: android.widget.AdapterView<*>?, v: android.view.View?, pos: Int, id: Long) {
                val j = periods[pos].first
                if (j != prefs.getInt("skitourTexteJours", 14) || rows.isEmpty() || loadedIds != chosenIds()) { prefs.edit().putInt("skitourTexteJours", j).apply(); load(j) }
                else fill()
            }
            override fun onNothingSelected(p: android.widget.AdapterView<*>?) {}
        }
        fill()
        view.post { view.scrollTo(0, 0) }
    }

    private fun load(jours: Int) {
        job?.cancel()
        val ids = chosenIds(); loadedIds = ids
        loading = true; note = ""; fill()
        job = a.lifecycleScope.launch {
            runCatching { withContext(Dispatchers.IO) { SkiText.fetchList(listFile, jours, ids, password) } }
                .onSuccess { rows = it.third; loading = false; fill() }
                .onFailure { e ->
                    if (e is kotlinx.coroutines.CancellationException) return@onFailure
                    loading = false
                    val saved = SkiText.readList(listFile)
                    if (saved != null) {
                        rows = saved.third
                        note = "📴 Hors ligne : liste du " + Instant.ofEpochMilli(saved.second).atZone(ZoneId.systemDefault())
                            .format(DateTimeFormatter.ofPattern("d MMM 'à' HH:mm", Locale.FRANCE)) + " (${saved.first} jours)."
                    } else note = "Liste impossible : ${if (e is java.io.IOException) "pas de réseau" else e.message}"
                    fill()
                }
        }
    }

    private fun fill() {
        val shown = SkiText.filter(rows.filter { chosen.isEmpty() || it.massif in chosen }, search.text.toString())
        status.text = listOf(note, if (loading) "Chargement des sorties skitour.fr…" else if (rows.isEmpty() && note.isNotEmpty()) ""
            else "${shown.size} sortie${if (shown.size > 1) "s" else ""}").filter { it.isNotEmpty() }.joinToString("\n")
        table.removeAllViews()
        table.addView(LinearLayout(a).apply {
            addView(text("Date", 13f, muted, true), LinearLayout.LayoutParams(dp(52), -2))
            addView(text("Titre", 13f, muted, true), LinearLayout.LayoutParams(0, -2, 1f))
            addView(text("Auteurs", 13f, muted, true), LinearLayout.LayoutParams(dp(96), -2))
        })
        val fmt = DateTimeFormatter.ofPattern("dd/MM", Locale.FRANCE)
        shown.forEach { o ->
            table.addView(LinearLayout(a).apply {
                setPadding(dp(6), dp(8), dp(6), dp(8))
                background = GradientDrawable().apply { setColor(Color.parseColor("#F2F4F1")); cornerRadius = 8 * d }
                addView(text(Instant.ofEpochSecond(o.date).atZone(ZoneId.systemDefault()).format(fmt), 14f, ink), LinearLayout.LayoutParams(dp(46), -2))
                addView(LinearLayout(a).apply {
                    orientation = LinearLayout.VERTICAL
                    addView(text(o.titre + (o.etoiles?.takeIf { it > 0 }?.let { " " + "★".repeat(it) } ?: "") +
                        if (o.difSki.isNotEmpty()) "  ski ${o.difSki}" else "", 15f, ink, true))
                    addView(text(o.massif + if (o.skiabilite.isNotEmpty()) " · " + (if (o.skiabilite.all { it.isDigit() }) "skiabilité ${o.skiabilite}" else o.skiabilite) else ""))
                }, LinearLayout.LayoutParams(0, -2, 1f))
                addView(text(o.auteurs), LinearLayout.LayoutParams(dp(96), -2))
                setOnClickListener { openSheet(o) }
            }, lp(4))
        }
    }

    /** Choix des massifs, groupés comme sur skitour.fr (cases à cocher). */
    private fun showPicker() {
        col.removeAllViews()
        val picked = chosen.toMutableList()
        col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(text("Massifs", 16f, ink, true), LinearLayout.LayoutParams(0, -2, 1f))
            addView(Button(a).apply { text = "Tous"; setOnClickListener { chosen = emptyList(); saveChosen(); showList() } })
            addView(Button(a).apply { text = "OK"; setOnClickListener { chosen = picked.toList(); saveChosen(); showList() } })
        })
        val groups = if (allMassifs.isNotEmpty()) SkiText.group(allMassifs) else SkiText.MASSIF_GROUPS
        groups.forEach { (g, ms) ->
            col.addView(text(g, 17f, accent, true).apply { setPadding(0, dp(14), 0, dp(4)) })
            col.addView(android.view.View(a).apply { setBackgroundColor(accent) }, LinearLayout.LayoutParams(-1, dp(3)))
            ms.forEach { m ->
                col.addView(android.widget.CheckBox(a).apply {
                    text = m; textSize = 16f; setTextColor(ink); isChecked = m in picked
                    setOnCheckedChangeListener { _, on -> if (on) { if (m !in picked) picked.add(m) } else picked.remove(m) }
                })
            }
        }
        view.post { view.scrollTo(0, 0) }
    }

    private fun openSheet(o: OutingRow) {
        job?.cancel()
        val saved = SkiText.savedSheet(sheetsFile, o.id)
        renderSheet(o, saved, if (saved == null) "Chargement de la sortie…" else "")
        job = a.lifecycleScope.launch {
            runCatching { withContext(Dispatchers.IO) { SkiText.fetchSheet(sheetsFile, o.id, password) } }
                .onSuccess {
                    renderSheet(o, it, "")
                    withContext(Dispatchers.IO) { runCatching { SkiPhotos.prune(a, SkiText.keptPhotoUrls(sheetsFile)) } }
                }
                .onFailure { e ->
                    if (e is kotlinx.coroutines.CancellationException) return@onFailure
                    renderSheet(o, saved, if (saved != null) "📴 Hors ligne : fiche gardée sur le téléphone."
                        else "Fiche impossible : ${if (e is java.io.IOException) "pas de réseau" else e.message}")
                }
        }
    }

    /** Vignette : la photo (gardée ou téléchargée), avec l'auteur en bas. */
    private fun photoTile(ph: SkiPhoto, onClick: () -> Unit) = FrameLayout(a).apply {
        val img = android.widget.ImageView(a).apply { scaleType = android.widget.ImageView.ScaleType.CENTER_CROP; setBackgroundColor(Color.parseColor("#DDDDDD")) }
        addView(img, FrameLayout.LayoutParams(-1, -1))
        addView(text("© ${ph.auteur}", 11f, Color.WHITE).apply { setBackgroundColor(Color.parseColor("#88000000")); setPadding(dp(5), dp(1), dp(5), dp(1)) },
            FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.START).apply { setMargins(dp(4), 0, 0, dp(4)) })
        setOnClickListener { onClick() }
        a.lifecycleScope.launch { withContext(Dispatchers.IO) { SkiPhotos.load(a, ph.url) }?.let { img.setImageBitmap(it) } }
    }

    /** Photo en grand (fond noir), légende et auteur, ‹ › pour passer à la suivante ; toucher la photo ferme. */
    private fun showPhoto(list: List<SkiPhoto>, start: Int) {
        val dlg = android.app.Dialog(a, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        var i = start
        val img = android.widget.ImageView(a).apply { scaleType = android.widget.ImageView.ScaleType.FIT_CENTER; setOnClickListener { dlg.dismiss() } }
        val cap = text("", 14f, Color.WHITE).apply { gravity = Gravity.CENTER }
        val count = text("", 14f, Color.WHITE)
        val prev = Button(a).apply { text = "‹" }
        val next = Button(a).apply { text = "›" }
        fun show() {
            val ph = list[i]
            cap.text = listOf(ph.legende, "© ${ph.auteur} · skitour.fr").filter { it.isNotBlank() }.joinToString(" · ")
            count.text = "${i + 1} / ${list.size}"; prev.isEnabled = i > 0; next.isEnabled = i < list.size - 1
            img.setImageDrawable(null)
            a.lifecycleScope.launch { withContext(Dispatchers.IO) { SkiPhotos.load(a, ph.url) }?.let { if (list[i] == ph) img.setImageBitmap(it) } }
        }
        prev.setOnClickListener { if (i > 0) { i--; show() } }
        next.setOnClickListener { if (i < list.size - 1) { i++; show() } }
        dlg.setContentView(LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setBackgroundColor(Color.BLACK); setPadding(dp(12), dp(12), dp(12), dp(12))
            addView(img, LinearLayout.LayoutParams(-1, 0, 1f))
            addView(cap, LinearLayout.LayoutParams(-1, -2))
            addView(LinearLayout(a).apply {
                gravity = Gravity.CENTER
                addView(prev); addView(count.apply { setPadding(dp(16), 0, dp(16), 0) }); addView(next)
            }, LinearLayout.LayoutParams(-1, -2))
        })
        show(); dlg.show()
    }

    private fun renderSheet(row: OutingRow, f: OutingSheet?, msg: String) {
        val o = f?.row ?: row
        col.removeAllViews()
        col.addView(header(LinearLayout(a).apply {
            addView(Button(a).apply { text = "← Liste"; setOnClickListener { job?.cancel(); showList() } })
        }))
        col.addView(text(o.titre, 20f, ink, true))
        col.addView(text("Sortie du " + Instant.ofEpochSecond(o.date).atZone(ZoneId.systemDefault())
            .format(DateTimeFormatter.ofPattern("EEEE d MMMM yyyy", Locale.FRANCE)) + " · par ${o.auteurs}"))
        if (msg.isNotEmpty()) col.addView(text(msg))
        val info = listOf(
            "Massif" to o.massif, "Départ" to (f?.depart ?: ""),
            "Sommet" to (f?.sommets?.takeIf { it.isNotEmpty() }?.joinToString(", ") ?: (o.sommet + (o.altitude?.let { " ($it m)" } ?: ""))),
            "Topo" to (f?.topos?.joinToString(", ") ?: ""), "Orientation" to o.orientation,
            "Dénivelé" to (o.denivele?.let { "$it m" } ?: ""), "Ski" to o.difSki, "Skiabilité" to (f?.skiabilite ?: ""),
        ).filter { it.second.isNotEmpty() }
        col.addView(box().apply {
            info.forEach { (k, v) ->
                addView(LinearLayout(a).apply {
                    addView(text(k, 14f, ink, true), LinearLayout.LayoutParams(dp(96), -2))
                    addView(text(v, 14f, ink), LinearLayout.LayoutParams(0, -2, 1f))
                })
            }
        }, lp())
        fun section(title: String, body: String) {
            if (body.isBlank()) return
            col.addView(text(title, 16f, accent, true).apply { setPadding(0, dp(12), 0, dp(2)) })
            col.addView(text(body, 15f, ink).apply { setLineSpacing(0f, 1.2f) })
        }
        if (f != null) {
            section("❄ Conditions nivologiques, accès et météo", f.conditions)
            section("Neige observée", f.neige.joinToString("\n") { "• $it" })
            section("Récit", f.recit)
            if (f.photos.isNotEmpty()) {
                col.addView(text("Photos", 16f, accent, true).apply { setPadding(0, dp(12), 0, dp(2)) })
                f.photos.chunked(2).forEachIndexed { r, pair ->
                    col.addView(LinearLayout(a).apply {
                        pair.forEachIndexed { c, ph ->
                            addView(photoTile(ph) { showPhoto(f.photos, r * 2 + c) },
                                LinearLayout.LayoutParams(0, dp(200), 1f).apply { if (c == 0) marginEnd = dp(6) })
                        }
                        if (pair.size == 1) addView(android.view.View(a), LinearLayout.LayoutParams(0, dp(200), 1f))
                    }, lp())
                }
            }
        }
        col.addView(LinearLayout(a).apply {
            setPadding(0, dp(10), 0, 0)
            addView(Button(a).apply {
                text = "Voir sur skitour.fr"
                setOnClickListener { runCatching { a.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(o.url))) } }
            }, LinearLayout.LayoutParams(0, -2, 1f))
            if (o.lat != null && o.lon != null) addView(Button(a).apply {
                text = "Sur la carte"
                setOnClickListener {
                    onShowOnMap(Outing(o.id, o.titre, o.date, o.massif, o.sommet, o.altitude, o.lat, o.lon, o.denivele, o.difSki,
                        o.orientation, f?.conditions ?: "", o.auteurs, o.url, o.skiabilite, o.etoiles))
                }
            })
        })
        col.addView(text("Texte de ${o.auteurs} sur skitour.fr (CC BY-NC-ND), non modifié."))
        view.post { view.scrollTo(0, 0) }
    }
}
