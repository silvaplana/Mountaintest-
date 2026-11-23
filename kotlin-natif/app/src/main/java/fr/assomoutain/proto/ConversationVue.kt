package fr.assomoutain.proto

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.widget.doAfterTextChanged
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Une conversation (spec/buddies.md §5.6, écrans 6 et 24) : le fil, puis [📷] [📍] [Message] [🎤 / ➤].
 * Celle d'un Buddy Time vit dans le bandeau de sa carte (BandeauSortie), celle d'un Buddy Group dans le panneau
 * (BuddiesPanel). Même écran que Conversation dans capacitor/src/buddies/Messages.tsx.
 *
 * Le fil se remplit dans `fil` (fourni par l'écran, qui le fait défiler) ; la saisie reste la même vue tant que la
 * conversation est ouverte, pour ne pas perdre ce qu'on tape quand un message arrive.
 */
class ConversationVue(
    private val a: AppCompatActivity,
    private val buddies: Buddies,
    private val album: Album,
    val groupe: String?,
    val sortie: Buddies.Sortie?,
    private val membres: List<Buddies.Buddy>,
    private val fil: LinearLayout,
    private val defiler: () -> Unit,
    private val localiser: ((Spot?) -> Unit) -> Unit,
    private val dicter: ((String?) -> Unit) -> Unit,
    /** 📷 Déposer des photos dans l'album du Buddy Time, chacune part aussi en message. */
    private val deposer: (() -> Unit)?,
    private val onPoint: (Double, Double, String) -> Unit,
    private val onTrace: (Buddies.TraceBuddy) -> Unit,
    private val onHebergement: (Buddies.Hebergement) -> Unit = {},
    private val onPhoto: () -> Unit = {},
) {
    private val d = a.resources.displayMetrics.density
    private fun dp(v: Int) = (v * d).toInt()
    private val ink = Color.parseColor("#1D2421")
    private val muted = Color.parseColor("#5F6B66")
    private val accent = Color.parseColor("#2F6F4F")
    private val card = Color.parseColor("#F2F4F1")
    private val mienFond = Color.parseColor("#DCE9E1")
    private val couleurs = listOf("#2F6F4F", "#3F6FB5", "#8A4FB0", "#C9862B", "#2C8C8C", "#B5534A").map(Color::parseColor)
    private val cle = sortie?.id ?: groupe.orEmpty()

    /** Repliée (écran 24) : seulement les deux derniers mots. */
    var court = false
        set(v) { field = v; rafraichir() }
    private var choisi: String? = null

    private fun text(t: CharSequence, size: Float = 17f, color: Int = ink, bold: Boolean = false) = TextView(a).apply {
        text = t; textSize = size; setTextColor(color); if (bold) setTypeface(typeface, Typeface.BOLD)
    }
    private fun rond(t: String, fond: Int = card, desc: String, f: () -> Unit) = Button(a).apply {
        text = t; textSize = 20f; setPadding(0, 0, 0, 0); minWidth = 0; minimumWidth = 0; minHeight = 0; minimumHeight = 0
        background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(fond) }
        contentDescription = desc; setOnClickListener { f() }
        layoutParams = LinearLayout.LayoutParams(dp(48), dp(48)).apply { rightMargin = dp(8) }
    }

    private val champ = EditText(a).apply {
        hint = "Message"; textSize = 17f; setTextColor(ink); isSingleLine = true; imeOptions = EditorInfo.IME_ACTION_SEND
        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        setPadding(dp(16), 0, dp(16), 0)
        background = GradientDrawable().apply { cornerRadius = 24 * d; setColor(Color.WHITE); setStroke(dp(1), Color.parseColor("#D9DFDC")) }
        setOnEditorActionListener { _, id, _ -> if (id == EditorInfo.IME_ACTION_SEND) { envoyer(); true } else false }
    }
    private val bouton = rond("🎤", desc = "Dicter") { if (champ.text.isBlank()) dicter { t -> if (!t.isNullOrBlank()) ajouterTexte(t) } else envoyer() }
        .apply { (layoutParams as LinearLayout.LayoutParams).rightMargin = 0 }

    /** [📷] [📍] [Message] [🎤 / ➤] */
    val saisie: View = LinearLayout(a).apply {
        gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(8), 0, 0)
        if (sortie != null && deposer != null) addView(rond("📷", desc = "Envoyer une photo") { deposer?.invoke() })
        addView(rond("📍", desc = "Montrer où je suis") { point() })
        addView(champ, LinearLayout.LayoutParams(0, dp(48), 1f).apply { rightMargin = dp(8) })
        addView(bouton)
    }

    private fun ajouterTexte(t: String) {
        val x = champ.text.toString()
        champ.setText(x + (if (x.isNotEmpty() && !x.endsWith(" ")) " " else "") + t)
        champ.setSelection(champ.text.length)
    }
    private fun majBouton() {
        val ecrit = champ.text.isNotBlank()
        bouton.text = if (ecrit) "➤" else "🎤"; bouton.contentDescription = if (ecrit) "Envoyer" else "Dicter"
        bouton.setTextColor(if (ecrit) Color.WHITE else ink)
        (bouton.background as GradientDrawable).setColor(if (ecrit) accent else card)
    }
    private fun synchroniser() = a.lifecycleScope.launch {
        withContext(Dispatchers.IO) { runCatching { buddies.synchroniser() } }.getOrNull()?.forEach { Toast.makeText(a, it, Toast.LENGTH_LONG).show() }
    }
    private fun envoyer() {
        val t = champ.text.toString()
        if (t.isBlank()) return
        buddies.envoyerMessage(groupe, sortie?.id, texte = t)
        champ.setText(""); synchroniser()
    }
    private fun point() = localiser { s ->
        if (s == null) Toast.makeText(a, "Position introuvable : le GPS est-il allumé ?", Toast.LENGTH_LONG).show()
        else { buddies.envoyerMessage(groupe, sortie?.id, "point", lon = s.lon, lat = s.lat); synchroniser() }
    }

    private fun nom(id: String) = membres.firstOrNull { it.id == id }?.pseudo ?: "?"
    private fun couleur(id: String) = couleurs[Math.floorMod(id.sumOf { it.code }, couleurs.size)]

    /** Redessine le fil (nouveaux messages, envoi) et le marque lu. */
    fun rafraichir() {
        fil.removeAllViews()
        val ms = buddies.messages()
        val bulles = Messages.fil(groupe, sortie?.id, ms, buddies.traces(), buddies.hebergements())
        if (bulles.isEmpty()) fil.addView(text("Pas encore de message. Écris, dicte avec 🎤, ou montre où tu es avec 📍.", 17f, muted))
        val photos = buddies.photos()
        for (b in if (court) bulles.takeLast(2) else bulles) fil.addView(bulle(b, photos), LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
        if (buddies.nonLus(cle, ms) > 0) buddies.marquerLu(cle)
        fil.post { defiler() }
    }

    private fun carte(icone: String, titre: String, sous: String, f: () -> Unit) = LinearLayout(a).apply {
        gravity = Gravity.CENTER_VERTICAL; minimumHeight = dp(56); setPadding(dp(12), dp(8), dp(14), dp(8)); isClickable = true
        background = GradientDrawable().apply { cornerRadius = 16 * d; setColor(Color.WHITE); setStroke(dp(1), Color.parseColor("#D9DFDC")) }
        setOnClickListener { f() }
        addView(text(icone, 26f), LinearLayout.LayoutParams(dp(42), -2))
        addView(LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            addView(text(titre, 17f, bold = true))
            addView(text(sous, 15f, muted))
        })
    }
    /** Place la bulle à gauche (les autres) ou à droite (moi). */
    private fun cote(v: View, mien: Boolean) = LinearLayout(a).apply {
        gravity = if (mien) Gravity.END else Gravity.START
        addView(v, LinearLayout.LayoutParams(-2, -2).apply { if (mien) leftMargin = dp(48) else rightMargin = dp(48) })
    }

    private fun bulle(b: Messages.Bulle, photos: List<Buddies.PhotoBuddy>): View = when (b) {
        is Messages.Bulle.Trace -> cote(carte("〰", b.t.nom, "${b.t.par.pseudo} · ${Messages.longueur(b.t.ligne)} · voir sur la carte") { onTrace(b.t) }, false)
        is Messages.Bulle.Heberg -> cote(carte(Hebergements.icone(b.h.nature), b.h.nom + if (b.h.retenu) " ✅" else "",
            "${nom(b.h.par)} · ${Hebergements.prix(b.h.prixNuit)} · ${if (b.h.lon != null) "voir sur la carte" else "voir"}") { onHebergement(b.h) }, false)
        is Messages.Bulle.Message -> message(b.m, photos)
    }

    private fun message(m: Buddies.MessageBuddy, photos: List<Buddies.PhotoBuddy>): View {
        val mien = m.par == buddies.moi || m.par == "moi"
        val pied = Messages.heure(m.cree) + if (m.attente) " · 🕓 partira au retour du réseau" else ""
        val choisir = { choisi = if (choisi == m.id) null else m.id; rafraichir() }
        val boite = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL; gravity = if (mien) Gravity.END else Gravity.START
            when (m.nature) {
                "point" -> {
                    val n = if (mien) "Je suis ici" else "${nom(m.par)} est ici"
                    addView(carte("📍", n, Messages.heure(m.cree) + " · voir sur la carte" + if (m.attente) " · 🕓" else "") {
                        if (m.lon != null && m.lat != null) onPoint(m.lon, m.lat, n)
                    }.apply { setOnLongClickListener { if (mien) choisir(); true } })
                }
                else -> addView(LinearLayout(a).apply {
                    orientation = LinearLayout.VERTICAL; setPadding(dp(14), dp(8), dp(14), dp(8))
                    background = GradientDrawable().apply { cornerRadius = 16 * d; setColor(if (mien) mienFond else card) }
                    if (m.attente) alpha = 0.8f
                    if (!mien) addView(text(nom(m.par), 15f, couleur(m.par), bold = true))
                    if (m.nature == "photo") {
                        val p = photos.firstOrNull { it.id == m.photo }
                        if (p == null) addView(text("📷 photo retirée de l'album", 15f, muted))
                        else addView(FrameLayout(a).apply {
                            outlineProvider = object : android.view.ViewOutlineProvider() {
                                override fun getOutline(view: View, o: android.graphics.Outline) { o.setRoundRect(0, 0, view.width, view.height, 12 * d) }
                            }
                            clipToOutline = true; isClickable = true; setOnClickListener { onPhoto() }
                            val img = ImageView(a).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
                            addView(img, FrameLayout.LayoutParams(-1, -1))
                            AlbumVue.charger(a, album, p, "petite", img)
                        }, LinearLayout.LayoutParams(dp(200), dp(150)))
                    } else addView(text(m.texte))
                    addView(text(pied, 13f, muted).apply { gravity = Gravity.END }, LinearLayout.LayoutParams(-1, -2))
                    if (mien) { isClickable = true; setOnClickListener { choisir() } }
                })
            }
            if (mien && choisi == m.id) addView(text("Retirer ce message", 15f, muted).apply {
                minHeight = dp(40); gravity = Gravity.CENTER_VERTICAL
                setOnClickListener { buddies.retirerMessage(m.id); choisi = null; synchroniser() }
            })
        }
        return cote(boite, mien)
    }

    private val desabonner = Buddies.suivre { a.runOnUiThread { rafraichir() } }
    /** Ouverte : on regarde les nouveaux messages toutes les 10 s. */
    private val minuteur = a.lifecycleScope.launch { while (true) { delay(10_000); synchroniser() } }
    fun fermer() { desabonner(); minuteur.cancel() }

    init {
        champ.doAfterTextChanged { majBouton() }
        rafraichir()
    }
}
