package fr.assomoutain.proto

import android.app.AlertDialog
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Écran « Mon compte » (maquettes 2 et 3, /mnt/project-files/maquettes/comptes), plein écran.
 * Même écran que src/Account.tsx côté Capacitor.
 */
class AccountPanel(private val a: AppCompatActivity, private val compte: Compte, private val onClose: () -> Unit) {
    private val d = a.resources.displayMetrics.density
    private fun dp(v: Int) = (v * d).toInt()
    private val ink = Color.parseColor("#1D2421")
    private val muted = Color.parseColor("#5F6B66")
    private val accent = Color.parseColor("#2F6F4F")

    private val col = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(10), dp(16), dp(40)) }
    private val scroll = ScrollView(a).apply { addView(col) }
    val view: View = FrameLayout(a).apply {
        setBackgroundColor(Color.WHITE); isClickable = true; elevation = 30 * d
        addView(scroll, FrameLayout.LayoutParams(-1, -1))
        layoutParams = FrameLayout.LayoutParams(-1, -1)
    }
    fun insets(top: Int, bottom: Int) = col.setPadding(dp(16), top + dp(10), dp(16), bottom + dp(40))

    private val desabonner = Compte.suivre { a.runOnUiThread { afficher() } }
    fun fermer() { desabonner() }

    init { afficher() }

    // ---------- petits outils ----------
    private fun text(t: CharSequence, size: Float = 14f, color: Int = ink, bold: Boolean = false, centre: Boolean = false) = TextView(a).apply {
        text = t; textSize = size; setTextColor(color); if (bold) setTypeface(typeface, Typeface.BOLD); setPadding(0, dp(4), 0, dp(4))
        if (centre) gravity = Gravity.CENTER_HORIZONTAL
    }
    private fun lp(top: Int = 8) = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(top) }
    private fun toast(m: String) = Toast.makeText(a, m, Toast.LENGTH_LONG).show()
    private fun bouton(t: String, primaire: Boolean = false, couleur: Int = ink, f: () -> Unit) = Button(a).apply {
        text = t; isAllCaps = false; textSize = 15f
        setTextColor(if (primaire) Color.WHITE else couleur)
        background = GradientDrawable().apply {
            cornerRadius = 10 * d
            if (primaire) setColor(accent) else { setColor(Color.WHITE); setStroke(dp(1), Color.parseColor(if (couleur == ink) "#D9DFDC" else "#E7B6B2")) }
        }
        setOnClickListener { f() }
    }
    private fun bandeau(icone: String, t: CharSequence, orange: Boolean) = LinearLayout(a).apply {
        setPadding(dp(12), dp(9), dp(12), dp(9))
        background = GradientDrawable().apply { cornerRadius = 10 * d; setColor(Color.parseColor(if (orange) "#FDF0D5" else "#E3EFE8")) }
        val c = Color.parseColor(if (orange) "#6B4A00" else "#1F4D36")
        addView(text(icone, 13f, c)); addView(text(t, 13f, c).apply { setPadding(dp(8), dp(4), 0, dp(4)) }, LinearLayout.LayoutParams(0, -2, 1f))
    }
    private fun head() {
        col.removeAllViews()
        col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(text("Mon compte", 22f, bold = true), LinearLayout.LayoutParams(0, -2, 1f))
            addView(Button(a).apply { text = "✕"; setOnClickListener { onClose() } })
        })
    }
    private fun enLigne(): Boolean {
        val cm = a.getSystemService(ConnectivityManager::class.java) ?: return false
        return cm.getNetworkCapabilities(cm.activeNetwork)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
    }
    private fun quand(ms: Long): String {
        if (ms == 0L) return "jamais"
        val jour = SimpleDateFormat("yyyyMMdd", Locale.FRANCE)
        val h = SimpleDateFormat("HH 'h' mm", Locale.FRANCE).format(Date(ms))
        return if (jour.format(Date(ms)) == jour.format(Date())) "aujourd'hui $h" else "le ${SimpleDateFormat("dd/MM/yyyy", Locale.FRANCE).format(Date(ms))} $h"
    }

    private var occupe = false
    private var emailSaisi = ""

    private fun seConnecter(fournisseur: String? = null) {
        if (occupe) return
        occupe = true
        a.lifecycleScope.launch {
            try {
                val url = withContext(Dispatchers.IO) { compte.debutConnexion(compte.chargerConfig(), emailSaisi, fournisseur) }
                CustomTabsIntent.Builder()
                    .setDefaultColorSchemeParams(CustomTabColorSchemeParams.Builder().setToolbarColor(accent).build())
                    .build().launchUrl(a, Uri.parse(url))
            } catch (e: Compte.HorsLigne) {
                toast("Il faut du réseau pour la première connexion")
            } catch (e: Exception) {
                toast(e.message ?: "Erreur")
            } finally { occupe = false }
        }
    }

    private fun afficher() {
        head()
        if (!compte.connecte) {
            col.addView(ImageView(a).apply { setImageResource(R.mipmap.ic_launcher) }, LinearLayout.LayoutParams(dp(84), dp(84)).apply { gravity = Gravity.CENTER_HORIZONTAL; topMargin = dp(4) })
            col.addView(text("Mountain Buddies K", 17f, bold = true, centre = true), lp(6))
            col.addView(text("Connecte-toi pour retrouver tes Buddies, partager traces et sorties. Le reste de l'appli marche sans compte.", 13f, muted, centre = true))
            col.addView(bouton("Continuer avec Google") { seConnecter("google") }.apply {
                setCompoundDrawablesRelativeWithIntrinsicBounds(LogoGoogle(d), null, null, null); compoundDrawablePadding = dp(10)
                setTypeface(typeface, Typeface.BOLD)
            }, lp(12))
            // Apple : prêt côté serveur, actif quand le compte Apple Developer existera.
            col.addView(Button(a).apply {
                text = "  Continuer avec Apple (bientôt)"; isAllCaps = false; textSize = 15f; setTextColor(Color.WHITE); isEnabled = false; alpha = 0.55f
                background = GradientDrawable().apply { cornerRadius = 10 * d; setColor(Color.BLACK) }
            }, lp(8))
            col.addView(text("ou par e-mail", 13f, muted, centre = true), lp(10))
            col.addView(text("Adresse e-mail", 13f, muted), lp(4))
            val mail = EditText(a).apply {
                setText(emailSaisi.ifEmpty { compte.email }); hint = "toi@exemple.fr"; isSingleLine = true
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
                imeOptions = EditorInfo.IME_ACTION_GO
                setOnEditorActionListener { _, _, _ -> emailSaisi = text.toString(); seConnecter(); true }
            }
            col.addView(mail)
            col.addView(bouton("Recevoir un code", primaire = true) { emailSaisi = mail.text.toString(); seConnecter() }, lp(10))
            col.addView(text("Une seule fois : ensuite tu restes connecté, même des semaines sans réseau.", 13f, muted, centre = true), lp())
            col.addView(Button(a).apply {
                text = "Plus tard"; isAllCaps = false; textSize = 15f; setTextColor(muted); setBackgroundColor(Color.TRANSPARENT)
                setOnClickListener { onClose() }
            }, lp(4))
            return
        }
        // Avatar : initiale, pastille verte (connecté) ou orange (à reconnecter)
        col.addView(FrameLayout(a).apply {
            addView(TextView(a).apply {
                text = compte.nomAffiche().take(1).uppercase(); textSize = 30f; setTextColor(Color.WHITE); gravity = Gravity.CENTER
                setTypeface(typeface, Typeface.BOLD)
                background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(accent) }
            }, FrameLayout.LayoutParams(dp(76), dp(76)))
            addView(View(a).apply {
                background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.parseColor(if (compte.aReconnecter) "#F0A000" else "#2F9E5F")); setStroke(dp(3), Color.WHITE) }
            }, FrameLayout.LayoutParams(dp(20), dp(20), Gravity.BOTTOM or Gravity.END))
        }, LinearLayout.LayoutParams(dp(76), dp(76)).apply { gravity = Gravity.CENTER_HORIZONTAL; topMargin = dp(6) })

        col.addView(text("Pseudo (vu par tes amis)", 13f, muted), lp(10))
        val pseudo = EditText(a).apply {
            setText(compte.nomAffiche()); isSingleLine = true; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS
            filters = arrayOf<android.text.InputFilter>(android.text.InputFilter.LengthFilter(40)); imeOptions = EditorInfo.IME_ACTION_DONE
        }
        fun envoyerPseudo() {
            val p = pseudo.text.toString()
            if (p.isBlank() || p.trim() == compte.nomAffiche()) return
            a.lifecycleScope.launch { withContext(Dispatchers.IO) { runCatching { compte.changerPseudo(p) } } }
        }
        pseudo.setOnFocusChangeListener { _, f -> if (!f) envoyerPseudo() }
        pseudo.setOnEditorActionListener { v, _, _ -> envoyerPseudo(); v.clearFocus(); false }
        col.addView(pseudo)
        col.addView(text("E-mail", 13f, muted), lp(6))
        col.addView(EditText(a).apply { setText(compte.email); isEnabled = false; setTextColor(muted) })

        val attente = compte.attentePseudo != null
        when {
            compte.aReconnecter -> col.addView(bandeau("⚠", "Session expirée. Tes données restent sur le téléphone ; reconnecte-toi quand tu as du réseau pour les synchroniser.", true), lp(10))
            !enLigne() -> col.addView(bandeau("📵", "Hors ligne, toujours connecté." + if (attente) " Ton pseudo partira au retour du réseau." else "", true), lp(10))
            attente -> col.addView(bandeau("🕓", "Ton pseudo attend d'être envoyé.", true), lp(10))
        }
        col.addView(bandeau("✓", "Dernière synchro : ${quand(compte.synchro)}", false), lp(8))
        if (compte.aReconnecter) col.addView(bouton("Me reconnecter", primaire = true) { emailSaisi = compte.email; seConnecter() }, lp(10))
        col.addView(bouton("🔄 Synchroniser") {
            a.lifecycleScope.launch {
                val r = withContext(Dispatchers.IO) { runCatching { compte.synchroniser() } }
                toast(r.fold({ "Synchronisé" }, { if (it is Compte.HorsLigne) "Pas de réseau" else it.message ?: "Erreur" }))
            }
        }.apply { isEnabled = enLigne() }, lp(10))
        col.addView(bouton("Se déconnecter", couleur = Color.parseColor("#B3261E")) {
            AlertDialog.Builder(a).setMessage("Se déconnecter ? Tes traces restent sur le téléphone.")
                .setPositiveButton("Se déconnecter") { _, _ ->
                    a.lifecycleScope.launch { withContext(Dispatchers.IO) { compte.deconnecter() }; toast("Déconnecté") }
                }.setNegativeButton("Annuler", null).show()
        }, lp(40))
        col.addView(text("Se déconnecter garde tes traces sur le téléphone.", 13f, muted, centre = true))
    }
}

/** Pastille de 👥 : verte = connecté (même hors ligne), orange = à reconnecter. */
class AccountDot(private val orange: Boolean, private val d: Float) : android.graphics.drawable.Drawable() {
    private val fill = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
    override fun draw(c: android.graphics.Canvas) {
        val r = 6 * d
        val cx = bounds.right - r; val cy = bounds.bottom - r
        fill.color = Color.WHITE; c.drawCircle(cx, cy, r + 2 * d, fill)
        fill.color = Color.parseColor(if (orange) "#F0A000" else "#2F9E5F"); c.drawCircle(cx, cy, r, fill)
    }
    override fun setAlpha(alpha: Int) {}
    override fun setColorFilter(cf: android.graphics.ColorFilter?) {}
    @Deprecated("Deprecated in Java")
    override fun getOpacity() = android.graphics.PixelFormat.TRANSLUCENT
}

/** Logo « G » de Google (quatre couleurs officielles), pour le bouton « Continuer avec Google ». */
class LogoGoogle(private val d: Float) : android.graphics.drawable.Drawable() {
    private val p = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { style = android.graphics.Paint.Style.STROKE }
    override fun getIntrinsicWidth() = (20 * d).toInt()
    override fun getIntrinsicHeight() = (20 * d).toInt()
    override fun draw(c: android.graphics.Canvas) {
        val w = bounds.width().toFloat(); val s = w * 0.2f
        p.strokeWidth = s
        val r = android.graphics.RectF(bounds.left + s / 2, bounds.top + s / 2, bounds.right - s / 2, bounds.bottom - s / 2)
        // Arcs dans le sens horaire depuis la droite (0°) : bleu, vert, jaune, rouge, ouverture en haut à droite.
        for ((debut, angle, couleur) in listOf(Triple(0f, 45f, "#4285F4"), Triple(45f, 90f, "#34A853"), Triple(135f, 90f, "#FBBC05"), Triple(225f, 90f, "#EA4335"))) {
            p.color = Color.parseColor(couleur); c.drawArc(r, debut, angle, false, p)
        }
        p.color = Color.parseColor("#4285F4"); p.style = android.graphics.Paint.Style.FILL
        c.drawRect(bounds.left + w / 2, bounds.top + w / 2 - s / 2, bounds.right - s * 0.1f, bounds.top + w / 2 + s / 2, p)
        p.style = android.graphics.Paint.Style.STROKE
    }
    override fun setAlpha(alpha: Int) {}
    override fun setColorFilter(cf: android.graphics.ColorFilter?) {}
    @Deprecated("Deprecated in Java")
    override fun getOpacity() = android.graphics.PixelFormat.TRANSLUCENT
}
