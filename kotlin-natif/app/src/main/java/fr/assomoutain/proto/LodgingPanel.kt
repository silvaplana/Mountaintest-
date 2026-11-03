package fr.assomoutain.proto

import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.time.LocalDate
import kotlin.math.roundToInt

/** Hébergements trouvés par Claude (relais du VPS, recherche web), du moins cher au plus cher. Même écran que src/Lodging.tsx. */
data class Lodging(val nom: String, val type: String, val prixNuit: Double?, val adresse: String, val url: String, val resume: String)

class LodgingPanel(
    private val a: AppCompatActivity,
    private val prefs: SharedPreferences,
    private val password: String,
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
    }
    private fun text(t: String, size: Float = 13f, color: Int = muted, bold: Boolean = false) =
        TextView(a).apply { text = t; textSize = size; setTextColor(color); if (bold) setTypeface(typeface, Typeface.BOLD); setPadding(0, dp(3), 0, dp(2)) }
    private fun input(v: String, type: Int) = EditText(a).apply { setText(v); inputType = type; isSingleLine = true }
    private fun labelled(label: String, e: EditText) = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; addView(text(label)); addView(e) }

    private val city = input(prefs.getString("hebVille", "")!!, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS).apply { hint = "ex. Chamonix" }
    private val people = input(prefs.getString("hebPersonnes", "2")!!, InputType.TYPE_CLASS_NUMBER)
    private val max = input(prefs.getString("hebPrix", "100")!!, InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL)
    private val date = input(prefs.getString("hebDate", "")!!.takeIf { it >= LocalDate.now().toString() } ?: LocalDate.now().plusDays(1).toString(),
        InputType.TYPE_CLASS_DATETIME or InputType.TYPE_DATETIME_VARIATION_DATE)
    private val nights = input(prefs.getString("hebNuits", "1")!!, InputType.TYPE_CLASS_NUMBER)
    private val btn = Button(a)
    /** Sites à cocher (on peut en ajouter) : cochés, Claude ne cherche que là ; aucun coché, tout le web. */
    private val defaultSites = listOf("gites-refuges.com", "capverb.org")
    private val sites = (prefs.getString("hebSites", null)?.split(',')?.filter { it.isNotBlank() } ?: defaultSites).toMutableList()
    private val checked = prefs.getString("hebCoches", "")!!.split(',').filter { it.isNotBlank() }.toMutableSet()
    private val siteBox = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private fun saveSites() = prefs.edit().putString("hebSites", sites.joinToString(",")).putString("hebCoches", checked.joinToString(",")).apply()
    private fun showSites() {
        siteBox.removeAllViews()
        sites.forEach { x ->
            siteBox.addView(LinearLayout(a).apply {
                gravity = Gravity.CENTER_VERTICAL
                addView(android.widget.CheckBox(a).apply {
                    text = x; isChecked = x in checked
                    setOnCheckedChangeListener { _, on -> if (on) checked += x else checked -= x; saveSites() }
                }, LinearLayout.LayoutParams(0, -2, 1f))
                if (x !in defaultSites) addView(Button(a).apply { text = "✕"; setOnClickListener { sites -= x; checked -= x; saveSites(); showSites() } })
            })
        }
    }
    private val error = text("", 13f, Color.parseColor("#C0392B"))
    private val result = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }

    init {
        col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(text("🏨 Trouver un hébergement", 16f, ink, true), LinearLayout.LayoutParams(0, -2, 1f))
            addView(Button(a).apply { text = "✕"; setOnClickListener { onClose() } }, LinearLayout.LayoutParams(dp(48), dp(44)))
        })
        col.addView(labelled("Ville ou lieu", city))
        col.addView(LinearLayout(a).apply {
            addView(labelled("Personnes", people), LinearLayout.LayoutParams(0, -2, 1f))
            addView(labelled("Prix maxi / nuit (€)", max), LinearLayout.LayoutParams(0, -2, 1f))
        })
        col.addView(LinearLayout(a).apply {
            addView(labelled("Arrivée (AAAA-MM-JJ)", date), LinearLayout.LayoutParams(0, -2, 1f))
            addView(labelled("Nuits", nights), LinearLayout.LayoutParams(0, -2, 1f))
        })
        col.addView(text("Chercher seulement sur (rien de coché : tout le web)"))
        showSites(); col.addView(siteBox)
        val add = EditText(a).apply { hint = "ajouter un site (ex. booking.com)"; isSingleLine = true; inputType = InputType.TYPE_TEXT_VARIATION_URI }
        col.addView(LinearLayout(a).apply {
            addView(add, LinearLayout.LayoutParams(0, -2, 1f))
            addView(Button(a).apply { text = "Ajouter"; setOnClickListener {
                val x = add.text.toString().trim().lowercase().removePrefix("https://").removePrefix("http://").removePrefix("www.").substringBefore('/')
                if (Regex("[a-z0-9-]+(\\.[a-z0-9-]+)+").matches(x) && x !in sites) { sites += x; checked += x; saveSites(); showSites() }
                add.setText("")
            } })
        })
        btn.apply { text = "Chercher (IA)"; isEnabled = password.isNotEmpty(); setOnClickListener { search() } }
        col.addView(btn)
        if (password.isEmpty()) col.addView(text("Mot de passe IA manquant (onglet Randos)."))
        col.addView(error); col.addView(result)
        view.addOnLayoutChangeListener { v, _, _, _, _, _, _, _, _ ->
            val maxH = (a.resources.displayMetrics.heightPixels * 0.62).toInt()
            if (v.height > maxH) v.layoutParams = v.layoutParams.apply { height = maxH }
        }
    }

    private fun search() {
        val p = people.text.toString().toIntOrNull(); val m = max.text.toString().replace(',', '.').toDoubleOrNull()
        val n = nights.text.toString().toIntOrNull(); val v = city.text.toString().trim()
        if (v.length < 2 || p == null || p < 1 || m == null || m <= 0 || n == null || n < 1) {
            error.text = "Indique la ville, le nombre de personnes, le prix maxi et les nuits"; return
        }
        val day = runCatching { LocalDate.parse(date.text.toString().trim()).toString() }.getOrDefault(LocalDate.now().plusDays(1).toString())
        prefs.edit().putString("hebVille", v).putString("hebPersonnes", p.toString()).putString("hebPrix", max.text.toString())
            .putString("hebDate", day).putString("hebNuits", n.toString()).apply()
        btn.isEnabled = false; error.text = ""; result.removeAllViews()
        result.addView(text("Claude compare plusieurs sites : 30 s à 2 min."))
        val t0 = System.currentTimeMillis()
        val tick = a.lifecycleScope.launch { while (true) { btn.text = "Claude cherche les meilleurs prix… ${(System.currentTimeMillis() - t0) / 1000} s"; delay(1000) } }
        view.post { view.fullScroll(View.FOCUS_DOWN) }
        a.lifecycleScope.launch {
            runCatching { withContext(Dispatchers.IO) {
                Travel.post("hebergement", JSONObject().put("ville", v).put("personnes", p).put("prix_max", m).put("arrivee", day).put("nuits", n)
                    .put("sites", org.json.JSONArray(checked.filter { it in sites })), password)
            } }.onSuccess { o -> show(o) }
                .onFailure { result.removeAllViews(); error.text = "Recherche impossible : ${if (it is java.io.IOException) "pas de réseau" else it.message}" }
            tick.cancel(); btn.text = "Chercher (IA)"; btn.isEnabled = true
            view.post { view.fullScroll(View.FOCUS_DOWN) }
        }
    }

    private fun show(o: JSONObject) {
        result.removeAllViews()
        val arr = o.optJSONArray("hebergements")
        val list = (0 until (arr?.length() ?: 0)).map { i -> arr!!.getJSONObject(i).let {
            Lodging(it.optString("nom"), it.optString("type"), if (it.isNull("prix_nuit")) null else it.optDouble("prix_nuit"),
                it.optString("adresse"), it.optString("url"), it.optString("resume"))
        } }.sortedBy { it.prixNuit ?: Double.MAX_VALUE }
        if (list.isEmpty()) result.addView(text("Aucun hébergement trouvé sous ce prix."))
        list.forEach { h ->
            result.addView(LinearLayout(a).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(10), dp(8), dp(10), dp(8))
                background = GradientDrawable().apply { setColor(Color.parseColor("#F2F4F1")); cornerRadius = 8 * d }
                addView(LinearLayout(a).apply {
                    addView(text(h.nom, 15f, ink, true), LinearLayout.LayoutParams(0, -2, 1f))
                    addView(text(h.prixNuit?.let { "${it.roundToInt()} €" } ?: "prix ?", 15f, ink, true))
                })
                addView(text(h.type + if (h.adresse.isNotEmpty()) " · ${h.adresse}" else ""))
                addView(text(h.resume))
                setOnClickListener { runCatching { a.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(h.url))) } }
            }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) })
        }
        o.optString("conseil").takeIf { it.isNotEmpty() }?.let { result.addView(text(it)) }
        result.addView(text(WebHikes.costLine(WebCost(o.optDouble("cout_usd", 0.0), o.optDouble("cumul_mois_usd", 0.0), o.optDouble("cumul_total_usd", 0.0)),
            o.optBoolean("cache")).replace("Zone déjà cherchée", "Déjà cherché")))
    }
}
