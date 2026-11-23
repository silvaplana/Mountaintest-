package fr.assomoutain.proto

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Un Buddy Time sur la carte (écran 4, spec/buddies.md §5.4) : ‹ nom et dates en haut, bandeau rabattable en
 * bas (dans combien de jours, qui vient, chiffres du parcours). Le reste de l'écran reste à la carte.
 * Même écran que BandeauSortie dans src/buddies/Buddies.tsx.
 */
object BandeauSortie {
    fun vue(a: android.app.Activity, x: Buddies.Sortie, traces: List<Buddies.TraceBuddy>, haut: Int, bas: Int, onRetour: () -> Unit): View {
        val d = a.resources.displayMetrics.density
        fun dp(v: Int) = (v * d).toInt()
        val ink = Color.parseColor("#1D2421"); val muted = Color.parseColor("#5F6B66"); val card = Color.parseColor("#F2F4F1")
        fun text(t: String, size: Float = 17f, color: Int = ink, bold: Boolean = false) = TextView(a).apply {
            text = t; textSize = size; setTextColor(color); if (bold) setTypeface(typeface, Typeface.BOLD)
        }
        val jour = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val auj = jour.format(Date())
        fun ms(s: String) = runCatching { jour.parse(s)!!.time }.getOrDefault(0L)
        fun court(s: String) = SimpleDateFormat("EEE d MMM", Locale.FRANCE).format(Date(ms(s)))
        val n = Math.round((ms(x.debut) - ms(auj)) / 86_400_000.0).toInt()
        val quand = when { x.fin < auj -> "Souvenir"; n <= 0 -> "En cours"; n == 1 -> "Demain"; else -> "Dans $n jours" }
        val dates = if (x.fin == x.debut) court(x.debut) else "${court(x.debut)} – ${court(x.fin)}"
        val km = traces.sumOf { Trails.lineLengthM(it.ligne) } / 1000

        val racine = FrameLayout(a).apply { elevation = 22 * d; layoutParams = FrameLayout.LayoutParams(-1, -1) }
        // Haut : ‹ nom, dates, lieu
        racine.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL; setPadding(dp(4), dp(4), dp(14), dp(4))
            background = GradientDrawable().apply { cornerRadius = 26 * d; setColor(Color.WHITE) }
            elevation = 4 * d
            addView(Button(a).apply {
                text = "‹"; textSize = 22f; setPadding(0, 0, 0, 0); minWidth = 0; minimumWidth = 0; minHeight = 0; minimumHeight = 0
                background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(card) }
                contentDescription = "Retour aux Buddies"; setOnClickListener { onRetour() }
            }, LinearLayout.LayoutParams(dp(44), dp(44)))
            addView(LinearLayout(a).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(8), 0, 0, 0)
                addView(text(x.nom, 17f, bold = true).apply { isSingleLine = true })
                addView(text(dates + if (x.lieu.isNotEmpty()) " · ${x.lieu}" else "", 14f, muted).apply { isSingleLine = true })
            })
        }, FrameLayout.LayoutParams(-1, -2, Gravity.TOP).apply { setMargins(dp(10), haut + dp(10), dp(72), 0) })

        // Bas : bandeau qui se replie en touchant la poignée
        val contenu = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            addView(text(quand, 20f, bold = true))
            val invites = x.invitations.filter { it.canal != "qr" }.joinToString(" · ") { "${it.nom} ?" }
            addView(text("👥 ${x.participants.joinToString(", ") { it.pseudo }}" + if (invites.isNotEmpty()) " · $invites" else "", 15f, muted))
            addView(LinearLayout(a).apply {
                fun chiffre(v: String, l: String) = LinearLayout(a).apply {
                    orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setPadding(dp(8), dp(8), dp(8), dp(8))
                    background = GradientDrawable().apply { cornerRadius = 12 * d; setColor(card) }
                    addView(text(v, 20f, bold = true)); addView(text(l, 14f, muted))
                }
                addView(chiffre(if (traces.isEmpty()) "—" else "%.1f km".format(km), if (traces.size > 1) "${traces.size} traces" else "parcours"),
                    LinearLayout.LayoutParams(0, -2, 1f).apply { rightMargin = dp(8) })
                addView(chiffre(if (x.fin >= auj) "${maxOf(0, n)}" else "✓", if (x.fin >= auj) "jours avant" else "souvenir"), LinearLayout.LayoutParams(0, -2, 1f))
            }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) })
            if (traces.isEmpty()) addView(text("Partage une trace dans ce Buddy Time depuis Mes traces (icône de partage) : elle apparaîtra ici chez tout le monde.", 15f, muted))
        }
        racine.addView(LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(6), dp(16), bas + dp(16))
            background = GradientDrawable().apply { cornerRadii = floatArrayOf(18 * d, 18 * d, 18 * d, 18 * d, 0f, 0f, 0f, 0f); setColor(Color.WHITE) }
            elevation = 8 * d; isClickable = true
            addView(View(a).apply {
                background = GradientDrawable().apply { cornerRadius = 3 * d; setColor(Color.parseColor("#D9DFDC")) }
                contentDescription = "Replier"
            }, LinearLayout.LayoutParams(dp(44), dp(5)).apply { gravity = Gravity.CENTER_HORIZONTAL; bottomMargin = dp(8) })
            setOnClickListener { contenu.visibility = if (contenu.visibility == View.VISIBLE) View.GONE else View.VISIBLE }
            addView(contenu)
        }, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
        return racine
    }
}
