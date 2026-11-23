package fr.assomoutain.proto

import android.app.Dialog
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Album (spec/buddies.md §5.8) : ce qui sert à la fois dans Buddies (écran 11) et sur la carte (écran 7) :
 * charger une image sans bloquer l'écran, et la visionneuse (une photo en grand, ⭐ pour le carnet, Retirer).
 * Même rôle que Image et Visionneuse dans capacitor/src/buddies/Album.tsx.
 */
object AlbumVue {
    /** Met l'image dans `v` dès qu'elle est là (gardée sur le téléphone, sinon lue sur le serveur) ; 🕓 sinon. */
    fun charger(a: AppCompatActivity, album: Album, p: Buddies.PhotoBuddy, taille: String, v: ImageView, sinon: (() -> Unit)? = null) {
        v.tag = "${p.id}-$taille"
        a.lifecycleScope.launch {
            val b: Bitmap? = withContext(Dispatchers.IO) { runCatching { album.image(p.id, taille, p.envoyee) }.getOrNull() }
            if (v.tag != "${p.id}-$taille") return@launch
            if (b != null) v.setImageBitmap(b) else sinon?.invoke()
        }
    }

    fun jourLong(j: String): String = runCatching {
        SimpleDateFormat("EEE d MMM", Locale.FRANCE).format(SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(j.take(10))!!)
    }.getOrDefault(j)

    /** Une photo en grand : ‹ ›, ⭐ pour le carnet, « Retirer » pour l'auteur. */
    fun visionneuse(a: AppCompatActivity, buddies: Buddies, album: Album, l: List<Buddies.PhotoBuddy>, depart: Int) {
        if (l.isEmpty()) return
        val d = a.resources.displayMetrics.density
        fun dp(v: Int) = (v * d).toInt()
        val dlg = Dialog(a, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        var i = depart.coerceIn(0, l.size - 1)
        var etoiles = l.associate { it.id to it.etoile }.toMutableMap()
        val racine = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.BLACK) }
        fun bouton(t: String, f: () -> Unit) = TextView(a).apply {
            text = t; textSize = 17f; setTextColor(Color.WHITE); gravity = Gravity.CENTER; setPadding(dp(16), 0, dp(16), 0); minWidth = dp(48)
            background = GradientDrawable().apply { cornerRadius = 24 * d; setColor(Color.parseColor("#33FFFFFF")) }
            isClickable = true; setOnClickListener { f() }
        }
        fun afficher() {
            racine.removeAllViews()
            val p = l[i]
            racine.addView(LinearLayout(a).apply {
                gravity = Gravity.CENTER_VERTICAL; setPadding(dp(12), dp(28), dp(12), dp(10))
                addView(LinearLayout(a).apply {
                    orientation = LinearLayout.VERTICAL
                    addView(TextView(a).apply { text = p.par.pseudo; textSize = 17f; setTextColor(Color.WHITE); setTypeface(typeface, Typeface.BOLD) })
                    addView(TextView(a).apply { text = "${jourLong(p.priseLe)} · ${p.priseLe.drop(11).take(5).replace(":", " h ")}"; textSize = 14f; setTextColor(Color.LTGRAY) })
                }, LinearLayout.LayoutParams(0, -2, 1f))
                addView(bouton("✕") { dlg.dismiss() }, LinearLayout.LayoutParams(-2, dp(48)))
            })
            val img = ImageView(a).apply { scaleType = ImageView.ScaleType.FIT_CENTER }
            racine.addView(FrameLayout(a).apply {
                addView(TextView(a).apply { text = "🕓"; textSize = 40f; gravity = Gravity.CENTER }, FrameLayout.LayoutParams(-1, -1))
                addView(img, FrameLayout.LayoutParams(-1, -1))
            }, LinearLayout.LayoutParams(-1, 0, 1f))
            charger(a, album, p, "petite", img)
            charger(a, album, p, "grande", img)
            racine.addView(LinearLayout(a).apply {
                gravity = Gravity.CENTER_VERTICAL; setPadding(dp(12), dp(10), dp(12), dp(24))
                fun lp() = LinearLayout.LayoutParams(-2, dp(48)).apply { rightMargin = dp(8) }
                addView(bouton("‹") { if (i > 0) { i--; afficher() } }.apply { alpha = if (i > 0) 1f else 0.3f }, lp())
                addView(View(a), LinearLayout.LayoutParams(0, 1, 1f))
                val et = etoiles[p.id] == true
                addView(bouton(if (et) "⭐ Dans le carnet" else "☆ Pour le carnet") {
                    etoiles[p.id] = !et; buddies.mettreEtoile(p.id, !et); afficher()
                }.apply { if (et) { setTextColor(Color.parseColor("#1D2421")); (background as GradientDrawable).setColor(Color.parseColor("#F2C94C")) } }, lp())
                if (buddies.estMoi(p.par)) addView(bouton("Retirer") { buddies.retirerPhoto(p.id); dlg.dismiss() }, lp())
                addView(View(a), LinearLayout.LayoutParams(0, 1, 1f))
                addView(bouton("›") { if (i < l.size - 1) { i++; afficher() } }.apply { alpha = if (i < l.size - 1) 1f else 0.3f },
                    LinearLayout.LayoutParams(-2, dp(48)))
            })
        }
        afficher()
        dlg.setContentView(racine, ViewGroup.LayoutParams(-1, -1))
        dlg.show()
    }

    /** Image d'une photo sur la carte : carré arrondi bordé de blanc (écran 7). */
    fun marqueur(src: Bitmap, d: Float): Bitmap {
        val t = (46 * d).toInt(); val bord = 3 * d
        val out = Bitmap.createBitmap(t, t, Bitmap.Config.ARGB_8888)
        val c = android.graphics.Canvas(out)
        val p = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
        val r = android.graphics.RectF(0f, 0f, t.toFloat(), t.toFloat())
        p.color = Color.WHITE; c.drawRoundRect(r, 10 * d, 10 * d, p)
        val s = minOf(src.width, src.height)
        val carre = Bitmap.createBitmap(src, (src.width - s) / 2, (src.height - s) / 2, s, s)
        p.shader = android.graphics.BitmapShader(Bitmap.createScaledBitmap(carre, (t - 2 * bord).toInt(), (t - 2 * bord).toInt(), true),
            android.graphics.Shader.TileMode.CLAMP, android.graphics.Shader.TileMode.CLAMP).apply {
            setLocalMatrix(android.graphics.Matrix().apply { setTranslate(bord, bord) })
        }
        c.drawRoundRect(android.graphics.RectF(bord, bord, t - bord, t - bord), 8 * d, 8 * d, p)
        return out
    }
}
