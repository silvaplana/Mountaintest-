package fr.assomoutain.proto

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.text.InputType
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
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Réponse à une question en texte sur les sorties skitour (même modèle que SkiAnswer de src/ski/skitour.ts). */
data class SkiAnswer(val q: String, val texte: String, val sorties: List<Outing>, val t: Long, val coutUsd: Double?)

/**
 * ⛷💬 : question en texte ; le relais fait chercher Claude dans les sorties récentes et renvoie une réponse courte
 * et les sorties citées. Les 10 dernières réponses restent sur le téléphone (fichier), relisibles hors ligne.
 */
object SkiQuestions {
    fun ask(file: java.io.File, q: String, center: Pair<Double, Double>?, password: String): SkiAnswer {
        val body = JSONObject().put("question", q)
        center?.let { body.put("lat", it.first).put("lon", it.second) }
        val o = Travel.post("skitour-texte", body, password)
        val s = o.optJSONArray("sorties") ?: JSONArray()
        val a = SkiAnswer(q, o.optString("texte"), (0 until s.length()).map { Skitour.fromJson(s.getJSONObject(it)) }
            .filter { !it.lat.isNaN() && !it.lon.isNaN() }, System.currentTimeMillis(),
            if (o.has("cout_usd")) o.optDouble("cout_usd") else null)
        save(file, (listOf(a) + read(file)).take(10))
        return a
    }

    fun read(file: java.io.File): List<SkiAnswer> = runCatching {
        val a = JSONArray(file.readText())
        (0 until a.length()).map { i -> a.getJSONObject(i).let { e ->
            val s = e.getJSONArray("sorties")
            SkiAnswer(e.getString("q"), e.getString("texte"), (0 until s.length()).map { Skitour.fromJson(s.getJSONObject(it)) },
                e.getLong("t"), if (e.has("cout_usd")) e.getDouble("cout_usd") else null)
        } }
    }.getOrDefault(emptyList())

    private fun save(file: java.io.File, list: List<SkiAnswer>) {
        val a = JSONArray()
        list.forEach { x ->
            a.put(JSONObject().put("q", x.q).put("texte", x.texte).put("t", x.t)
                .put("sorties", JSONArray(x.sorties.map { Skitour.toJson(it) })).apply { x.coutUsd?.let { put("cout_usd", it) } })
        }
        runCatching { file.writeText(a.toString()) }
    }
}

class SkiTextPanel(
    private val a: AppCompatActivity,
    private val center: Pair<Double, Double>?,
    private val password: String,
    private val onOutings: (List<Outing>) -> Unit,
    private val onClose: () -> Unit,
) {
    private val d = a.resources.displayMetrics.density
    private fun dp(v: Int) = (v * d).toInt()
    private val ink = Color.parseColor("#1D2421")
    private val muted = Color.parseColor("#5F6B66")
    private val file = java.io.File(a.filesDir, "skitour-reponses.json")
    private val col = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(8), dp(12), dp(16)) }
    val view: ScrollView = ScrollView(a).apply {
        addView(col); elevation = 10 * d; isClickable = true
        background = GradientDrawable().apply { setColor(Color.WHITE); cornerRadii = floatArrayOf(14 * d, 14 * d, 14 * d, 14 * d, 0f, 0f, 0f, 0f) }
        layoutParams = FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM)
        addOnLayoutChangeListener { v, _, _, _, _, _, _, _, _ ->
            val maxH = (a.resources.displayMetrics.heightPixels * 0.55).toInt()
            if (v.height > maxH) v.layoutParams = v.layoutParams.apply { height = maxH }
        }
    }
    private fun text(t: String, size: Float = 13f, color: Int = muted, bold: Boolean = false) =
        TextView(a).apply { text = t; textSize = size; setTextColor(color); if (bold) setTypeface(typeface, Typeface.BOLD); setPadding(0, dp(3), 0, dp(2)) }
    private fun card() = LinearLayout(a).apply {
        orientation = LinearLayout.VERTICAL; setPadding(dp(10), dp(8), dp(10), dp(8))
        background = GradientDrawable().apply { setColor(Color.parseColor("#F2F4F1")); cornerRadius = 8 * d }
    }

    private val input = EditText(a).apply {
        hint = "Ex. : comment est la neige en Belledonne cette semaine ?"
        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        minLines = 2; maxLines = 4
    }
    private val askBtn = Button(a).apply { text = "Demander" }
    private val status = text("")
    private val answer = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private val history = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private var shown: SkiAnswer? = null

    init {
        col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(text("⛷💬 Question sur les sorties", 16f, ink, true), LinearLayout.LayoutParams(0, -2, 1f))
            addView(Button(a).apply { text = "✕"; setOnClickListener { onClose() } }, LinearLayout.LayoutParams(dp(48), dp(44)))
        })
        col.addView(input); col.addView(askBtn); col.addView(status); col.addView(answer); col.addView(history)
        col.addView(text("Réponse de Claude à partir des sorties skitour.fr (CC BY-NC-ND pour les récits)."))
        askBtn.setOnClickListener { ask() }
        refreshHistory()
    }

    private fun ask() {
        val q = input.text.toString().trim()
        if (q.length < 3) return
        askBtn.isEnabled = false; askBtn.text = "Recherche dans les sorties skitour.fr…"; status.text = ""; show(null)
        a.lifecycleScope.launch {
            runCatching { withContext(Dispatchers.IO) { SkiQuestions.ask(file, q, center, password) } }
                .onSuccess { show(it); input.setText(""); refreshHistory() }
                .onFailure {
                    status.text = "Pas de réponse : " + if (it is java.io.IOException) "pas de réseau (les réponses précédentes restent lisibles ci-dessous)" else it.message
                }
            askBtn.isEnabled = true; askBtn.text = "Demander"
        }
    }

    private fun show(x: SkiAnswer?) {
        shown = x; answer.removeAllViews(); onOutings(x?.sorties ?: emptyList())
        if (x == null) return
        answer.addView(card().apply {
            addView(text("« ${x.q} »"))
            x.texte.split('\n').filter { it.isNotBlank() }.forEach { addView(text(it, 14f, ink)) }
            x.coutUsd?.let { addView(text("Coût : %.3f $".format(Locale.US, it))) }
        }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) })
        x.sorties.forEach { o ->
            answer.addView(card().apply {
                addView(LinearLayout(a).apply {
                    addView(text(o.titre, 15f, ink, true), LinearLayout.LayoutParams(0, -2, 1f))
                    addView(text(o.dateText(), 13f, ink))
                })
                addView(text(o.line() + " · lire sur skitour.fr"))
                setOnClickListener { runCatching { a.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(o.url))) } }
            }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) })
        }
        refreshHistory()
        view.post { view.smoothScrollTo(0, 0) }
    }

    private fun refreshHistory() {
        history.removeAllViews()
        val list = SkiQuestions.read(file)
        if (list.isEmpty()) return
        history.addView(text("Questions précédentes (lisibles hors ligne) :"))
        val fmt = DateTimeFormatter.ofPattern("d MMM", Locale.FRANCE)
        list.forEach { x ->
            history.addView(card().apply {
                if (x.t == shown?.t) background = GradientDrawable().apply { setColor(Color.parseColor("#DCEBE2")); cornerRadius = 8 * d }
                addView(LinearLayout(a).apply {
                    addView(text(x.q, 14f, ink, true), LinearLayout.LayoutParams(0, -2, 1f))
                    addView(text(Instant.ofEpochMilli(x.t).atZone(ZoneId.systemDefault()).format(fmt)))
                })
                setOnClickListener { show(x) }
            }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) })
        }
    }
}
