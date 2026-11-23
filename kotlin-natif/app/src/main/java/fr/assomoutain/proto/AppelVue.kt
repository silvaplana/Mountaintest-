package fr.assomoutain.proto

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * 📞 Écrans des appels (spec/buddies.md §5.7) : la sonnerie plein écran (écran 10) et la barre d'appel en haut de
 * la carte (écran 24). Mêmes écrans côté React (src/buddies/Appel.tsx).
 */
object AppelVue {
    private fun text(c: Context, t: String, size: Float, color: Int = Color.WHITE, bold: Boolean = false) = TextView(c).apply {
        text = t; textSize = size; setTextColor(color); gravity = Gravity.CENTER; if (bold) setTypeface(typeface, Typeface.BOLD)
    }

    private fun rond(c: Context, t: String, fond: Int, taille: Int, desc: String, f: () -> Unit) = Button(c).apply {
        text = t; textSize = taille / 3.2f; setTextColor(Color.WHITE); setPadding(0, 0, 0, 0)
        minWidth = 0; minimumWidth = 0; minHeight = 0; minimumHeight = 0; stateListAnimator = null
        background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(fond) }
        contentDescription = desc; setOnClickListener { f() }
    }

    /** Écran 10 : « Week-end Queyras · Julie t'appelle… », visages (cercle vert : déjà en ligne), Refuser / Répondre. */
    fun sonnerie(c: Context, e: Appel.Etat, qui: List<Buddies.Buddy>, enLigne: Set<String>, haut: Int, bas: Int,
                 onRefuser: () -> Unit, onRepondre: () -> Unit): View {
        val d = c.resources.displayMetrics.density
        fun dp(v: Int) = (v * d).toInt()
        val blanc = Color.parseColor("#B0FFFFFF")
        return LinearLayout(c).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; elevation = 40 * d; isClickable = true
            setPadding(dp(24), haut + dp(40), dp(24), bas + dp(40))
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(Color.parseColor("#1F3B2D"), Color.parseColor("#0F1D16")))
            layoutParams = FrameLayout.LayoutParams(-1, -1)
            addView(text(c, "Mountain Buddies · appel de groupe", 16f, blanc))
            addView(text(c, e.nom, 28f, bold = true), LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(18) })
            addView(text(c, if (e.phase == "connexion") "Connexion…" else "${e.de} t'appelle…", 18f), LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(8) })
            addView(LinearLayout(c).apply {
                gravity = Gravity.CENTER
                for (p in qui.take(5)) addView(FrameLayout(c).apply {
                    setPadding(dp(3), dp(3), dp(3), dp(3))
                    if (p.id in enLigne) background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.parseColor("#3CCF6E")) }
                    addView(BandeauSortie.visage(c, p, 64), FrameLayout.LayoutParams(dp(64), dp(64)))
                }, LinearLayout.LayoutParams(-2, -2).apply { setMargins(dp(5), 0, dp(5), 0) })
            }, LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(24) })
            val deja = qui.filter { it.id in enLigne }.map { it.pseudo }
            if (deja.isNotEmpty()) addView(text(c, "${deja.joinToString(" et ")} ${if (deja.size > 1) "sont" else "est"} déjà en ligne", 16f, blanc),
                LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(10) })
            addView(View(c), LinearLayout.LayoutParams(1, 0, 1f))
            addView(LinearLayout(c).apply {
                gravity = Gravity.CENTER
                fun bouton(t: String, l: String, fond: Int, f: () -> Unit) = LinearLayout(c).apply {
                    orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
                    addView(rond(c, t, fond, 76, l, f), LinearLayout.LayoutParams(dp(76), dp(76)))
                    addView(text(c, l, 16f), LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(8) })
                }
                addView(bouton("✕", "Refuser", Color.parseColor("#D93A3A"), onRefuser), LinearLayout.LayoutParams(-2, -2).apply { rightMargin = dp(64) })
                addView(bouton("📞", "Répondre", Color.parseColor("#2FAE5C"), onRepondre).apply { if (e.phase == "connexion") alpha = 0.5f })
            })
        }
    }

    /** Écran 24 : la barre d'appel en haut, la carte reste à l'écran. */
    fun barre(c: Context, e: Appel.Etat, haut: Int, onMuet: () -> Unit, onRaccrocher: () -> Unit): View {
        val d = c.resources.displayMetrics.density
        fun dp(v: Int) = (v * d).toInt()
        val blanc = Color.parseColor("#C0FFFFFF")
        val titre = when (e.phase) {
            "en_ligne" -> "En ligne · ${Appel.duree(System.currentTimeMillis() - (e.debut ?: System.currentTimeMillis()))}"
            "connexion" -> "Connexion…"
            else -> "Ça sonne…"
        }
        return LinearLayout(c).apply {
            gravity = Gravity.CENTER_VERTICAL; elevation = 30 * d; isClickable = true
            setPadding(dp(12), dp(6), dp(6), dp(6))
            background = GradientDrawable().apply { cornerRadius = 26 * d; setColor(Color.parseColor("#1F5A3A")) }
            layoutParams = FrameLayout.LayoutParams(-1, -2, Gravity.TOP).apply { setMargins(dp(8), haut + dp(6), dp(8), 0) }
            addView(text(c, "📞", 22f), LinearLayout.LayoutParams(-2, -2).apply { rightMargin = dp(8) })
            addView(LinearLayout(c).apply {
                orientation = LinearLayout.VERTICAL
                addView(text(c, titre, 17f, bold = true).apply { gravity = Gravity.START })
                addView(text(c, if (e.phase == "en_ligne") Appel.enLigne(e) else e.nom, 15f, blanc).apply { gravity = Gravity.START; isSingleLine = true })
                if (e.phase == "en_ligne") addView(text(c, "Appui long sur la carte : tu la montres aux autres 👉", 13f, blanc).apply { gravity = Gravity.START })
            }, LinearLayout.LayoutParams(0, -2, 1f))
            addView(rond(c, if (e.muet) "🔇" else "🎙", if (e.muet) Color.WHITE else Color.parseColor("#40FFFFFF"), 48,
                if (e.muet) "Remettre le micro" else "Couper le micro", onMuet), LinearLayout.LayoutParams(dp(48), dp(48)).apply { rightMargin = dp(8) })
            addView(rond(c, "✕", Color.parseColor("#D93A3A"), 48, "Raccrocher", onRaccrocher), LinearLayout.LayoutParams(dp(48), dp(48)))
        }
    }
}
