package fr.assomoutain.proto

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.DateFormat
import java.util.Date
import kotlin.concurrent.thread

/**
 * Burger ☰ → 📊 « Usage IA et mémoire » (même écran que capacitor/src/Usage.tsx) :
 * coût cumulé de toutes les requêtes IA (compté par le relais du VPS, journal couts.jsonl)
 * et place prise sur le téléphone par l'appli et surtout par ses données (shared/StorageUsage.java).
 */
object UsagePanel {
    /** Libellés des usages notés par le relais (le même tableau côté Capacitor : IA_TYPES). */
    /** Types de demandes skitour (même tableau côté Capacitor : SKITOUR_TYPES). */
    private val SKITOUR_TYPES = mapOf(
        "sorties" to "Listes de sorties", "sortie" to "Fiches et parkings", "topos" to "Topos d’un sommet",
        "topo" to "Topos (fiche, itinéraire)", "massifs" to "Massifs", "autre" to "Autres",
    )
    private val IA_TYPES = mapOf(
        "randos" to "Randos trouvées sur le web",
        "voiture" to "Voiture (modèle, consommation)",
        "voyage" to "Coût des trajets",
        "hebergement" to "Hébergements",
        "facture" to "Lecture des factures",
    )
    private const val KEY = "usageIa"

    fun formatBytes(n: Long): String = when {
        n >= 1_000_000_000 -> String.format(java.util.Locale.FRANCE, "%.2f Go", n / 1e9)
        n >= 1_000_000 -> String.format(java.util.Locale.FRANCE, "%.1f Mo", n / 1e6)
        else -> "${Math.round(n / 1e3)} ko"
    }
    fun formatUsd(n: Double): String = String.format(java.util.Locale.FRANCE, "%.2f $", n)

    fun show(a: Activity, pane: LinearLayout) {
        val prefs = a.getSharedPreferences("reglages", Context.MODE_PRIVATE)
        var ia: Pair<JSONObject, String>? = prefs.getString(KEY, null)?.let { s ->
            runCatching { JSONObject(s).let { it.getJSONObject("u") to it.getString("at") } }.getOrNull()
        }
        var iaErr = ""
        var mem: JSONObject? = null
        var memErr = ""
        var busy = true

        fun render() {
            pane.removeAllViews()
            val fg = Color.parseColor("#1D2421")
            val muted = ContextCompat.getColor(a, R.color.muted)
            val pad = (8 * a.resources.displayMetrics.density).toInt()
            fun title(t: String) = pane.addView(TextView(a).apply {
                text = t; textSize = 15f; setTypeface(typeface, Typeface.BOLD); setTextColor(fg); setPadding(0, pad, 0, pad / 2)
            })
            fun hint(t: String) = pane.addView(TextView(a).apply { text = t; textSize = 13f; setTextColor(muted); setPadding(0, pad / 2, 0, 0) })
            fun stats(vararg v: Pair<String, String>) = pane.addView(LinearLayout(a).apply {
                orientation = LinearLayout.HORIZONTAL
                v.forEach { (big, small) ->
                    addView(LinearLayout(a).apply {
                        orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
                        addView(TextView(a).apply { text = big; textSize = 18f; setTypeface(typeface, Typeface.BOLD); setTextColor(fg); gravity = Gravity.CENTER })
                        addView(TextView(a).apply { text = small; textSize = 12f; setTextColor(muted); gravity = Gravity.CENTER })
                    }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
                }
            })
            fun row(name: String, mid: String, right: String) = pane.addView(LinearLayout(a).apply {
                orientation = LinearLayout.HORIZONTAL; setPadding(0, pad / 2, 0, pad / 2)
                addView(TextView(a).apply { text = name; textSize = 14f; setTextColor(fg) }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
                addView(TextView(a).apply { text = mid; textSize = 14f; setTextColor(muted); setPadding(pad, 0, pad, 0) })
                addView(TextView(a).apply { text = right; textSize = 14f; setTypeface(typeface, Typeface.BOLD); setTextColor(fg) })
            })

            title("🤖 Requêtes IA (Claude)")
            ia?.let { (u, at) ->
                stats(formatUsd(u.optDouble("cumul_total_usd")) to "depuis le début",
                    formatUsd(u.optDouble("cumul_mois_usd")) to "ce mois-ci",
                    "${u.optInt("recherches_payantes")}" to "requêtes")
                val par = u.optJSONObject("par_type")
                par?.keys()?.asSequence()?.map { it to par.getJSONObject(it) }
                    ?.sortedByDescending { it.second.optDouble("cout_usd") }
                    ?.forEach { (t, d) -> row(IA_TYPES[t] ?: t, "${d.optInt("requetes")}×", formatUsd(d.optDouble("cout_usd"))) }
                hint("Toutes les requêtes payantes, de tous les téléphones, comptées par le relais IA (réponses en cache gratuites). Chiffres du $at.")
            } ?: run { if (iaErr.isEmpty()) hint("Chargement…") }
            if (iaErr.isNotEmpty()) hint(iaErr)

            ia?.first?.optJSONObject("skitour_appels")?.let { k ->
                title("⛷ Demandes à skitour.fr")
                val quota = k.optInt("quota", 1000)
                val jours = k.optJSONObject("jours")
                val semaine = jours?.keys()?.asSequence()?.sumOf { jours.optInt(it) } ?: 0
                stats("${k.optInt("aujourdhui")} / $quota" to "aujourd’hui", "$semaine" to "sur 7 jours")
                val par = k.optJSONObject("par_type")
                par?.keys()?.asSequence()?.map { it to par.optInt(it) }?.sortedByDescending { it.second }
                    ?.forEach { (t, n) -> row(SKITOUR_TYPES[t] ?: t, "$n×", "") }
                hint("Gratuit, mais skitour.fr limite à $quota demandes par jour (tous les téléphones ensemble). Au-delà, plus de parkings ni d’itinéraires jusqu’au lendemain.")
            }

            title("💾 Place sur le téléphone")
            mem?.let { m ->
                val donnees = m.optLong("donnees"); val appli = m.optLong("appli"); val cache = m.optLong("cache")
                val s = mutableListOf(formatBytes(donnees) to "données")
                if (appli > 0) s += formatBytes(appli) to "appli"
                if (cache > 0) s += formatBytes(cache) to "cache"
                s += formatBytes(donnees + appli + cache) to "total"
                stats(*s.toTypedArray())
                val d = m.optJSONArray("detail")
                if (d != null) for (i in 0 until d.length()) {
                    val e = d.getJSONObject(i)
                    if (e.optLong("octets") > 0) row(e.getString("nom"), "${e.optInt("fichiers")} fich.", formatBytes(e.optLong("octets")))
                }
                hint("Les données (tuiles hors ligne, sorties ski, traces…) restent après une mise à jour ; le cache peut être vidé par Android.")
            } ?: run { if (memErr.isEmpty()) hint("Mesure en cours…") }
            if (memErr.isNotEmpty()) hint("Mesure impossible : $memErr")
            ia?.first?.takeIf { it.has("donnees_serveur_octets") }?.let {
                hint("Sur le serveur (cache des recherches IA et des sorties ski, journal des coûts) : ${formatBytes(it.optLong("donnees_serveur_octets"))}.")
            }
            pane.addView(Button(a).apply {
                text = if (busy) "Actualisation…" else "Actualiser"; isAllCaps = false; isEnabled = !busy
                setOnClickListener { show(a, pane) }
            })
        }

        render()
        var pending = 2
        fun done() { if (--pending == 0) busy = false; if (!a.isFinishing) render() }
        thread {
            val r = runCatching {
                val c = URL(WebHikes.RELAIS_URL.removeSuffix("randos")).openConnection() as HttpURLConnection
                c.connectTimeout = 10_000; c.readTimeout = 15_000; c.useCaches = false
                try {
                    if (c.responseCode != 200) error("HTTP ${c.responseCode}")
                    JSONObject(c.inputStream.bufferedReader().use { it.readText() })
                } finally { c.disconnect() }
            }
            a.runOnUiThread {
                r.onSuccess { u ->
                    val at = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT, java.util.Locale.FRANCE).format(Date())
                    ia = u to at
                    prefs.edit().putString(KEY, JSONObject().put("u", u).put("at", at).toString()).apply()
                }.onFailure { iaErr = "Relais IA injoignable (pas de réseau ?) : derniers chiffres connus." }
                done()
            }
        }
        thread {
            val r = runCatching { StorageUsage.measure(a) }
            a.runOnUiThread {
                r.onSuccess { mem = it }.onFailure { memErr = it.message ?: it.toString() }
                done()
            }
        }
    }
}
