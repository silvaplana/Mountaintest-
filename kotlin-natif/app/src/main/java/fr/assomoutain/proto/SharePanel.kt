package fr.assomoutain.proto

import android.app.AlertDialog
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

/**
 * Panneau de partage d'une trace (écran 22, spec/buddies.md §3.4), le même partout : « Dans un Buddy Time »
 * (les plus actifs), « Ou à mes buddies » (mes Buddy Groups), un petit mot, un seul bouton Partager, puis
 * « Ou ailleurs » (les autres applis du téléphone). Même panneau que PartagePanel dans src/buddies/Buddies.tsx.
 * Les copains un par un arriveront avec la messagerie : aujourd'hui une trace se range dans un Buddy Time ou un groupe.
 */
object SharePanel {
    fun montrer(a: AppCompatActivity, compte: Compte, buddies: Buddies, nom: String, ligne: List<LonLat>, apres: () -> Unit, ailleurs: () -> Unit) {
        val d = a.resources.displayMetrics.density
        fun dp(v: Int) = (v * d).toInt()
        val accent = Color.parseColor("#2F6F4F")
        val muted = Color.parseColor("#5F6B66")
        val couleurs = listOf("#2F6F4F", "#3F6FB5", "#8A4FB0", "#C9862B", "#2C8C8C", "#B5534A").map(Color::parseColor)
        fun couleur(id: String) = couleurs[Math.floorMod(id.sumOf { it.code }, couleurs.size)]
        fun text(t: String, size: Float = 17f, color: Int = Color.parseColor("#1D2421"), bold: Boolean = false) = TextView(a).apply {
            text = t; textSize = size; setTextColor(color); if (bold) setTypeface(typeface, Typeface.BOLD); setPadding(0, dp(4), 0, dp(4))
        }
        val choix = mutableSetOf<String>()
        val boite = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(10), dp(16), dp(6)) }
        val dlg = AlertDialog.Builder(a).setView(ScrollView(a).apply { addView(boite) }).create()
        val km = Trails.lineLengthM(ligne) / 1000
        boite.addView(text("Partager « $nom » · ${"%.1f".format(km)} km", 20f, bold = true))

        /** Une tuile qu'on coche (anneau vert). */
        fun tuile(id: String, titre: String, image: View, rond: Boolean): View = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(dp(3), dp(3), dp(3), 0)
            val cadre = LinearLayout(a).apply { setPadding(dp(3), dp(3), dp(3), dp(3)); addView(image) }
            addView(cadre)
            addView(text(titre, 14f).apply { maxWidth = dp(if (rond) 72 else 96); isSingleLine = true; ellipsize = android.text.TextUtils.TruncateAt.END })
            setOnClickListener {
                if (!choix.remove(id)) choix += id
                cadre.background = if (id in choix) GradientDrawable().apply { if (rond) shape = GradientDrawable.OVAL else cornerRadius = 15 * d; setStroke(dp(3), accent) } else null
            }
        }
        fun rangee(vues: List<View>) = HorizontalScrollView(a).apply { addView(LinearLayout(a).apply { vues.forEach { addView(it) } }) }

        if (compte.connecte) {
            val auj = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date())
            val sorties = buddies.sorties().sortedWith(compareByDescending<Buddies.Sortie> { it.fin >= auj }.thenByDescending { it.modifie }).take(6)
            val groupes = buddies.groupes().filter { !it.meTime }
            if (sorties.isNotEmpty()) {
                boite.addView(text("DANS UN BUDDY TIME · les plus actifs", 14f, muted, bold = true))
                boite.addView(rangee(sorties.map { x ->
                    tuile(x.id, x.nom, TextView(a).apply {
                        text = x.debut.takeLast(2).trimStart('0'); textSize = 22f; setTextColor(Color.WHITE); setTypeface(typeface, Typeface.BOLD)
                        gravity = Gravity.CENTER; background = GradientDrawable().apply { cornerRadius = 12 * d; setColor(couleur(x.id)) }
                        layoutParams = LinearLayout.LayoutParams(dp(84), dp(84))
                    }, false)
                }))
            }
            if (groupes.isNotEmpty()) {
                boite.addView(text("OU À MES BUDDIES", 14f, muted, bold = true))
                boite.addView(rangee(groupes.map { g ->
                    tuile(g.id, g.nom, TextView(a).apply {
                        text = g.nom.take(1).uppercase(); textSize = 22f; setTextColor(Color.WHITE); setTypeface(typeface, Typeface.BOLD); gravity = Gravity.CENTER
                        background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(couleur(g.id)) }
                        layoutParams = LinearLayout.LayoutParams(dp(56), dp(56))
                    }, true)
                }))
            }
            if (sorties.isEmpty() && groupes.isEmpty()) boite.addView(text("Crée un Buddy Group ou un Buddy Time (👥) pour y partager tes traces.", 15f, muted))
            val mot = EditText(a).apply { hint = "Un petit mot (facultatif)…"; isSingleLine = true; textSize = 17f }
            boite.addView(mot)
            boite.addView(Button(a).apply {
                text = "Partager"; isAllCaps = false; textSize = 18f; setTextColor(Color.WHITE); minHeight = dp(56)
                background = GradientDrawable().apply { cornerRadius = 14 * d; setColor(accent) }
                setOnClickListener {
                    if (choix.isEmpty()) { Toast.makeText(a, "Choisis un Buddy Time ou un groupe", Toast.LENGTH_SHORT).show(); return@setOnClickListener }
                    buddies.partagerTrace(nom, ligne, mot.text.toString().trim(), sorties.map { it.id }.filter { it in choix }, groupes.map { it.id }.filter { it in choix })
                    Toast.makeText(a, "« $nom » partagée", Toast.LENGTH_SHORT).show()
                    dlg.dismiss(); apres()
                }
            }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
        } else boite.addView(text("Connecte-toi (👤) pour partager tes traces avec tes buddies.", 15f, muted))

        boite.addView(text("OU AILLEURS", 14f, muted, bold = true).apply { setPadding(0, dp(14), 0, dp(4)) })
        boite.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL; minimumHeight = dp(52); isClickable = true
            setOnClickListener { dlg.dismiss(); ailleurs() }
            addView(text("⋯", 22f).apply { gravity = Gravity.CENTER; background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.parseColor("#F2F4F1")) } },
                LinearLayout.LayoutParams(dp(44), dp(44)))
            addView(LinearLayout(a).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, 0, 0)
                addView(text("WhatsApp, mail, fichier GPX…", 17f, bold = true)); addView(text("les autres applis du téléphone", 15f, muted))
            })
        })
        dlg.show()
    }
}
