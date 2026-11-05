package fr.assomoutain.proto

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import androidx.appcompat.app.AppCompatActivity

/** Les quatre écrans du ski (même chose que SkiTabs.tsx côté Capacitor). */
enum class SkiMode(val label: String) { SORTIES("⛷ Sorties"), CARTE("🗺 Carte sorties"), TOPOS("📖 Topos"), CARTE_TOPOS("🗺 Carte topos") }

object SkiTabs {
    /** Onglets en haut des écrans ski (et en tête du panneau du bas sur les cartes) ; ✕ à droite si onClose. */
    fun view(a: AppCompatActivity, mode: SkiMode, onMode: (SkiMode) -> Unit, onClose: (() -> Unit)? = null): LinearLayout {
        val d = a.resources.displayMetrics.density
        return LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 0, 0, (6 * d).toInt())
            SkiMode.values().forEach { m ->
                addView(Button(a).apply {
                    text = m.label; isAllCaps = false; textSize = 12f; minWidth = 0; minimumWidth = 0; minHeight = 0; minimumHeight = 0
                    setPadding((2 * d).toInt(), (6 * d).toInt(), (2 * d).toInt(), (6 * d).toInt())
                    val on = m == mode
                    setTypeface(null, if (on) Typeface.BOLD else Typeface.NORMAL)
                    setTextColor(if (on) Color.WHITE else Color.parseColor("#1D2421"))
                    background = GradientDrawable().apply {
                        setColor(Color.parseColor(if (on) "#2F6F4F" else "#F2F4F1")); cornerRadius = 10 * d
                        setStroke((1 * d).toInt(), Color.parseColor(if (on) "#2F6F4F" else "#C9D1CC"))
                    }
                    setOnClickListener { if (!on) onMode(m) }
                }, LinearLayout.LayoutParams(0, (48 * d).toInt(), 1f).apply { marginEnd = (3 * d).toInt() })
            }
            onClose?.let { c -> addView(Button(a).apply { text = "✕"; contentDescription = "Fermer"; setOnClickListener { c() } },
                LinearLayout.LayoutParams((44 * d).toInt(), (48 * d).toInt())) }
        }
    }
}
