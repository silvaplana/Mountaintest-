package fr.assomoutain.proto

import android.app.AlertDialog
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Outline
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.text.InputType
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.view.ViewOutlineProvider
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * Buddies, bloc 1 (spec/buddies.md, écrans 2, 3 et 20) : la liste façon WhatsApp, un Buddy Group,
 * nouveau Buddy Group et invitations. Même écran que src/buddies/Buddies.tsx côté Capacitor.
 *
 * Choisir une photo ou un contact passe par l'activité (ses lanceurs sont créés au démarrage) :
 * `choisirPhoto` rend une petite image en data: URL, `choisirContact` un nom et un numéro.
 */
class BuddiesPanel(
    private val a: AppCompatActivity,
    private val compte: Compte,
    private val buddies: Buddies,
    private val choisirPhoto: ((String?) -> Unit) -> Unit,
    private val choisirContact: ((Pair<String, String>?) -> Unit) -> Unit,
    private val onAccount: () -> Unit,
    private val onExpenses: () -> Unit,
    private val onLodging: () -> Unit,
    private val onClose: () -> Unit,
    /** Ouvrir un Buddy Time sur la carte (écran 4), ou une trace partagée dans un groupe (sortie = null). */
    private val onCarte: (Buddies.Sortie?, List<Buddies.TraceBuddy>) -> Unit,
    /** Fichiers des photos de l'album, et « Déposer mes photos » (choix multiple, préparé par l'activité). */
    private val album: Album,
    private val deposer: (Buddies.Sortie) -> Unit,
    /** Dictée d'Android pour le récit du carnet : rend le texte transcrit, ou null (annulée, indisponible). */
    private val dicter: ((String?) -> Unit) -> Unit,
    /** Revenir sur ce Buddy Group (‹ depuis la carte d'un Buddy Time). */
    depart: String? = null,
    /** Ou ouvrir l'album de ce Buddy Time (📸 Album depuis la carte). */
    departAlbum: String? = null,
    /** Ou son carnet (📖 Carnet depuis la carte). */
    departCarnet: String? = null,
    /** Ou son Buddy Count (💶 depuis la carte). */
    departCount: String? = null,
    /** Ou « Où on dort ? » (🏨 depuis la carte). */
    departDodo: String? = null,
    /** 💬 Ouvrir la conversation d'un Buddy Time sur sa carte (écran 6). */
    private val onParler: (Buddies.Sortie) -> Unit = {},
    /** 📍 Montrer sur la carte le point d'un message (« Julie est ici »). */
    private val onPoint: (Double, Double, String) -> Unit = { _, _, _ -> },
    /** Ma position du moment, pour « je suis ici » (null : introuvable). */
    private val localiser: ((Spot?) -> Unit) -> Unit = { it(null) },
) {
    private val d = a.resources.displayMetrics.density
    private fun dp(v: Int) = (v * d).toInt()
    private val ink = Color.parseColor("#1D2421")
    private val muted = Color.parseColor("#5F6B66")
    private val accent = Color.parseColor("#2F6F4F")
    private val card = Color.parseColor("#F2F4F1")
    private val couleurs = listOf("#2F6F4F", "#3F6FB5", "#8A4FB0", "#C9862B", "#2C8C8C", "#B5534A").map(Color::parseColor)

    private sealed class Vue {
        object Liste : Vue(); data class UnGroupe(val id: String) : Vue(); object Nouveau : Vue(); data class NouvelleSortie(val groupe: String) : Vue()
        // Planning de saison (§5.5) : groupe = la bande d'où l'on vient (null : toutes mes bandes).
        data class Plannings(val groupe: String?) : Vue(); data class UnPlanning(val id: String, val groupe: String?) : Vue()
        data class Dispos(val id: String, val groupe: String?) : Vue(); data class NvPlanning(val groupe: String?) : Vue()
        // Album (§5.8).
        data class Albums(val groupe: String?) : Vue()
        data class UnAlbum(val id: String, val groupe: String?, val carnet: Boolean = false, val retourCarnet: Boolean = false) : Vue()
        // Carnet (§5.8).
        data class LeCarnet(val id: String, val groupe: String?) : Vue(); data class Ecrire(val id: String, val groupe: String?) : Vue()
        // Buddy count (§5.10).
        data class Comptes(val groupe: String?) : Vue(); data class Count(val id: String, val groupe: String?) : Vue()
        data class UneDepense(val id: String, val depense: String?, val groupe: String?) : Vue()
        // Hébergement (§5.11).
        data class Dodo(val id: String, val groupe: String?) : Vue()
        // Messagerie (§5.6) : toutes mes conversations, celle d'un Buddy Group.
        data class Conversations(val groupe: String?) : Vue(); data class Conv(val id: String) : Vue()
    }
    private var vue: Vue = departDodo?.let { Vue.Dodo(it, depart) } ?: departCount?.let { Vue.Count(it, depart) } ?: departCarnet?.let { Vue.LeCarnet(it, depart) } ?: departAlbum?.let { Vue.UnAlbum(it, depart) }
        ?: depart?.let { Vue.UnGroupe(it) } ?: Vue.Liste
    private val saisie get() = vue == Vue.Nouveau || vue is Vue.NouvelleSortie || vue is Vue.NvPlanning || vue is Vue.Ecrire || vue is Vue.UneDepense || vue is Vue.Conv || motOuvert != null

    private val tete = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private val col = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(0, 0, 0, dp(16)) }
    private val pied = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private val corps = LinearLayout(a).apply {
        orientation = LinearLayout.VERTICAL; setPadding(dp(14), 0, dp(6), 0)
        addView(tete)
        addView(ScrollView(a).apply { addView(col) }, LinearLayout.LayoutParams(-1, 0, 1f))
        addView(pied)
    }
    private val colonne = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(2), dp(64), dp(10), 0) }
    private val ligne = LinearLayout(a).apply {
        addView(corps, LinearLayout.LayoutParams(0, -1, 1f))
        addView(colonne, LinearLayout.LayoutParams(-2, -1))
    }
    val view: View = FrameLayout(a).apply {
        setBackgroundColor(Color.WHITE); isClickable = true; elevation = 25 * d
        addView(ligne, FrameLayout.LayoutParams(-1, -1))
        layoutParams = FrameLayout.LayoutParams(-1, -1)
    }
    fun insets(top: Int, bottom: Int) = ligne.setPadding(0, top + dp(10), 0, bottom + dp(16))

    fun fermer() { conv?.fermer(); conv = null; desabonner(); desabonnerCompte(); minuteur.cancel(); buddies.marquerVu() }

    /** Retour arrière : sous-écran → liste ; liste → fermé. */
    fun retour(): Boolean { if (vue == Vue.Liste) return false; vue = Vue.Liste; afficher(); return true }

    // ---------- petits outils ----------
    private fun text(t: CharSequence, size: Float = 17f, color: Int = ink, bold: Boolean = false) = TextView(a).apply {
        text = t; textSize = size; setTextColor(color); if (bold) setTypeface(typeface, Typeface.BOLD); setPadding(0, dp(2), 0, dp(2))
    }
    private fun lp(top: Int = 8) = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(top) }
    private fun toast(m: String) = Toast.makeText(a, m, Toast.LENGTH_LONG).show()
    private fun rond(t: String, taille: Int = 48, fond: Int = card, f: () -> Unit) = Button(a).apply {
        text = t; textSize = 20f; setPadding(0, 0, 0, 0); minWidth = 0; minimumWidth = 0; minHeight = 0; minimumHeight = 0
        background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(fond) }
        setOnClickListener { f() }
        layoutParams = LinearLayout.LayoutParams(dp(taille), dp(taille))
    }
    private fun bouton(t: String, primaire: Boolean = false, couleur: Int = ink, f: () -> Unit) = Button(a).apply {
        text = t; isAllCaps = false; textSize = 17f; minHeight = dp(56)
        setTextColor(if (primaire) Color.WHITE else couleur)
        background = GradientDrawable().apply {
            cornerRadius = 14 * d
            if (primaire) setColor(accent) else { setColor(Color.WHITE); setStroke(dp(1), Color.parseColor(if (couleur == ink) "#D9DFDC" else "#E7B6B2")) }
        }
        setOnClickListener { f() }
    }
    private fun section(t: String) = text(t.uppercase(), 14f, muted, bold = true).apply { letterSpacing = 0.04f }
    private fun enLigne(): Boolean {
        val cm = a.getSystemService(ConnectivityManager::class.java) ?: return false
        return cm.getNetworkCapabilities(cm.activeNetwork)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
    }

    private val images = HashMap<String, Bitmap?>()
    private fun image(dataUrl: String): Bitmap? = images.getOrPut(dataUrl) {
        runCatching { Base64.decode(dataUrl.substringAfter(","), Base64.DEFAULT).let { BitmapFactory.decodeByteArray(it, 0, it.size) } }.getOrNull()
    }

    /** Visage rond : la photo, sinon l'initiale sur une couleur tirée de l'identifiant. */
    private fun visage(id: String, nom: String, photo: String?, taille: Int = 34, pale: Boolean = false): View {
        val bmp = photo?.takeIf { it.startsWith("data:image/") }?.let(::image)
        val v: View = if (bmp != null) ImageView(a).apply { setImageBitmap(bmp); scaleType = ImageView.ScaleType.CENTER_CROP }
        else TextView(a).apply {
            text = nom.take(1).uppercase(); textSize = taille * 0.42f; setTextColor(Color.WHITE); gravity = Gravity.CENTER
            setTypeface(typeface, Typeface.BOLD)
            setBackgroundColor(couleurs[Math.floorMod(id.sumOf { it.code }, couleurs.size)])
        }
        v.outlineProvider = object : ViewOutlineProvider() { override fun getOutline(view: View, o: Outline) { o.setOval(0, 0, view.width, view.height) } }
        v.clipToOutline = true
        if (pale) v.alpha = 0.45f
        v.layoutParams = LinearLayout.LayoutParams(dp(taille), dp(taille))
        return v
    }

    private fun quand(ms: Long): String {
        if (ms <= 0) return ""
        val c = Calendar.getInstance().apply { timeInMillis = ms }
        val auj = Calendar.getInstance()
        fun memeJour(x: Calendar, y: Calendar) = x.get(Calendar.YEAR) == y.get(Calendar.YEAR) && x.get(Calendar.DAY_OF_YEAR) == y.get(Calendar.DAY_OF_YEAR)
        val hier = Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, -1) }
        return when {
            memeJour(c, auj) -> SimpleDateFormat("HH:mm", Locale.FRANCE).format(Date(ms))
            memeJour(c, hier) -> "hier"
            System.currentTimeMillis() - ms < 6 * 86_400_000L -> SimpleDateFormat("EEE", Locale.FRANCE).format(Date(ms))
            else -> SimpleDateFormat("d MMM", Locale.FRANCE).format(Date(ms))
        }
    }
    private fun heure(ms: Long): String {
        if (ms == 0L) return "pas encore synchronisé"
        val h = SimpleDateFormat("HH 'h' mm", Locale.FRANCE).format(Date(ms))
        val jour = SimpleDateFormat("yyyyMMdd", Locale.FRANCE)
        return if (jour.format(Date(ms)) == jour.format(Date())) "à jour à $h" else "à jour le ${SimpleDateFormat("d MMM", Locale.FRANCE).format(Date(ms))} $h"
    }
    private val canal = mapOf("sms" to "SMS envoyé", "contacts" to "SMS envoyé", "mail" to "mail envoyé", "qr" to "QR code", "lien" to "lien envoyé")
    private fun resume(g: Buddies.Groupe): String {
        val n = g.invitations.count { it.canal != "qr" }
        val m = g.membres.size
        return "$m ${if (m > 1) "buddies" else "buddy"}" + if (n > 0) " · $n invitation${if (n > 1) "s" else ""} envoyée${if (n > 1) "s" else ""}" else ""
    }

    private fun synchroniser() {
        if (!compte.connecte) return
        a.lifecycleScope.launch {
            val r = withContext(Dispatchers.IO) { runCatching { buddies.synchroniser() } }
            r.getOrNull()?.forEach { toast(it) }
        }
    }

    // ---------- colonne d'icônes (spec §3.3) : ce qui n'est pas encore construit le dit simplement ----------
    private fun remplirColonne() {
        fun bientot(m: String) = { toast("Bientôt : $m") }
        // 📅 : les plannings du Buddy Group ouvert, sinon de toutes mes bandes.
        val planning = {
            if (!compte.connecte) toast("Connecte-toi (👤) pour les plannings de saison")
            else { vue = Vue.Plannings(bandeCourante()); afficher() }
        }
        val albums = {
            if (!compte.connecte) toast("Connecte-toi (👤) pour les albums")
            else { vue = Vue.Albums(groupeCourant()); afficher() }
        }
        // 💬 : la conversation du Buddy Time ouvert (sur sa carte), sinon celle du Buddy Group ouvert, sinon toutes.
        val messages = {
            val sc = sortieCourante()?.let { id -> buddies.sorties().firstOrNull { it.id == id } }
            val v = vue
            when {
                !compte.connecte -> toast("Connecte-toi (👤) pour écrire à tes buddies")
                sc != null -> onParler(sc)
                v is Vue.UnGroupe && buddies.groupes().any { it.id == v.id && !it.meTime } -> { vue = Vue.Conv(v.id); afficher() }
                else -> { vue = Vue.Conversations(groupeCourant()); afficher() }
            }
        }
        listOf("📞" to bientot("appeler toute la bande"), "📅" to planning, "💬" to messages,
            "📸" to albums, "💶" to {
                // 💶 : le Buddy count du Buddy Time ouvert, sinon tous ceux du Buddy Group ouvert (ou de tous).
                if (!compte.connecte) onExpenses()
                else { depenseCount(); afficher() }
            }, "🏨" to {
                // 🏨 : « Où on dort ? » du Buddy Time ouvert, sinon la recherche d'hébergement.
                val sc = sortieCourante()
                if (sc != null) { vue = Vue.Dodo(sc, groupeCourant()); afficher() } else onLodging()
            },
        ).forEach { (t, f) -> colonne.addView(rond(t, 52) { f() }.apply { (layoutParams as LinearLayout.LayoutParams).bottomMargin = dp(12) }) }
    }

    private fun entete(titre: String, sousTitre: String? = null, retour: Boolean, onRetour: () -> Unit = { vue = Vue.Liste; afficher() }) {
        tete.removeAllViews()
        tete.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL
            if (retour) addView(rond("‹") { onRetour() }.apply { (layoutParams as LinearLayout.LayoutParams).rightMargin = dp(8) })
            addView(LinearLayout(a).apply {
                orientation = LinearLayout.VERTICAL
                addView(text(titre, if (retour) 22f else 26f, bold = true))
                sousTitre?.let { addView(text(it, 15f, muted)) }
            }, LinearLayout.LayoutParams(0, -2, 1f))
            addView(rond("✕") { onClose() })
        })
    }

    // ---------- écrans ----------
    private fun afficher() {
        col.removeAllViews(); pied.removeAllViews()
        if (vue !is Vue.Conv) { conv?.fermer(); conv = null }
        if (!compte.connecte) {
            buddies.oublierSiDeconnecte()
            entete("Buddies", retour = false)
            col.addView(text("Connecte-toi pour retrouver tes copains, créer tes Buddy Groups et partager vos sorties.", 17f, muted), lp(12))
            col.addView(bouton("👤 Me connecter", primaire = true) { onAccount() }, lp(12))
            if (buddies.rejointsEnAttente > 0) col.addView(text("🕓 Une invitation t'attend : elle s'ouvrira une fois connecté.", 15f, muted), lp())
            return
        }
        val gs = buddies.groupes()
        when (val v = vue) {
            Vue.Liste -> liste(gs)
            Vue.Nouveau -> nouveau()
            is Vue.NouvelleSortie -> nouvelleSortie(gs.firstOrNull { it.id == v.groupe } ?: gs.first { it.meTime })
            is Vue.UnGroupe -> gs.firstOrNull { it.id == v.id }?.let { unGroupe(it) } ?: run { vue = Vue.Liste; liste(gs) }
            is Vue.Plannings -> plannings(v.groupe, gs)
            is Vue.NvPlanning -> nouveauPlanning(v.groupe, gs)
            is Vue.UnPlanning -> buddies.plannings().firstOrNull { it.id == v.id }?.let { unPlanning(it, v.groupe, gs) } ?: run { vue = Vue.Plannings(v.groupe); afficher() }
            is Vue.Dispos -> buddies.plannings().firstOrNull { it.id == v.id }?.let { mesDispos(it, v.groupe) } ?: run { vue = Vue.Plannings(v.groupe); afficher() }
            is Vue.Albums -> albums(v.groupe)
            is Vue.UnAlbum -> buddies.sorties().firstOrNull { it.id == v.id }?.let { unAlbum(it, v) } ?: run { vue = Vue.Albums(v.groupe); afficher() }
            is Vue.LeCarnet -> buddies.sorties().firstOrNull { it.id == v.id }?.let { carnet(it, v.groupe) } ?: run { vue = Vue.Liste; afficher() }
            is Vue.Ecrire -> buddies.sorties().firstOrNull { it.id == v.id }?.let { ecrire(it, v.groupe) } ?: run { vue = Vue.Liste; afficher() }
            is Vue.Comptes -> comptes(v.groupe)
            is Vue.Count -> buddies.sorties().firstOrNull { it.id == v.id }?.let { count(it, v.groupe) } ?: run { vue = Vue.Comptes(v.groupe); afficher() }
            is Vue.Dodo -> buddies.sorties().firstOrNull { it.id == v.id }?.let { dodo(it, v.groupe) } ?: run { vue = Vue.Liste; afficher() }
            is Vue.Conversations -> conversations(v.groupe, gs)
            is Vue.Conv -> gs.firstOrNull { it.id == v.id }?.let { conversation(it) } ?: run { vue = Vue.Liste; afficher() }
            is Vue.UneDepense -> buddies.sorties().firstOrNull { it.id == v.id }
                ?.let { uneDepense(it, v.depense?.let { d -> buddies.depenses().firstOrNull { it.id == d } }, v.groupe) } ?: run { vue = Vue.Comptes(v.groupe); afficher() }
        }
    }

    private fun liste(gs: List<Buddies.Groupe>) {
        val n = buddies.nbAttente
        entete("Buddies", (if (n > 0) "🕓 $n changement${if (n > 1) "s" else ""} partira au retour du réseau · " else "") + heure(buddies.synchro), retour = false)
        if (buddies.rejointsEnAttente > 0) col.addView(text("🕓 Invitation reçue : tu entreras dans le Buddy Group au retour du réseau.", 15f, Color.parseColor("#6B4A00")).apply {
            setPadding(dp(12), dp(9), dp(12), dp(9)); background = GradientDrawable().apply { cornerRadius = 10 * d; setColor(Color.parseColor("#FDF0D5")) }
        }, lp())
        for (p in buddies.plannings()) bandeauRemplir(p, avecNom = true) { vue = Vue.Dispos(p.id, null); afficher() }
        val sorties = buddies.sorties()
        prochaine(sorties)?.let { col.addView(affiche(it, false) { ouvrir(it) }, lp(8)) }
        col.addView(section("Buddy Groups"), lp(10))
        for (g in gs) col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL; minimumHeight = dp(64); isClickable = true
            setOnClickListener { vue = Vue.UnGroupe(g.id); afficher() }
            addView(if (g.meTime) visage(g.id, compte.nomAffiche(), compte.profil?.optString("photo"), 56) else visage(g.id, g.nom, g.photo, 56))
            addView(LinearLayout(a).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, dp(6), 0)
                addView(text(g.nom, 17f, bold = true).apply { isSingleLine = true })
                addView(text(if (g.meTime) "Mes sorties à moi" else resume(g), 15f, muted).apply { isSingleLine = true })
            }, LinearLayout.LayoutParams(0, -2, 1f))
            addView(text(if (g.attente) "🕓" else quand(g.modifie), 15f, muted))
        }, lp(4))
        if (sorties.isNotEmpty()) col.addView(section("Buddy Times"), lp(10))
        for (x in sorties) col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL; minimumHeight = dp(64); isClickable = true
            setOnClickListener { voir(x, null) }
            addView(carre(x, 56))
            addView(LinearLayout(a).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, dp(6), 0)
                addView(text(x.nom, 17f, bold = true).apply { isSingleLine = true })
                addView(text(listOfNotNull(gs.firstOrNull { it.id == x.groupe }?.nom, if (x.participants.size > 1) "${x.participants.size} partants" else null,
                    if (x.fin < aujourdhui()) "souvenir" else null).joinToString(" · "), 15f, muted).apply { isSingleLine = true })
            }, LinearLayout.LayoutParams(0, -2, 1f))
            addView(text(if (x.attente) "🕓" else quand(x.modifie), 15f, muted))
        }, lp(4))
        pied.addView(LinearLayout(a).apply {
            addView(bouton("＋ Buddy Group\nune bande", primaire = true) { vue = Vue.Nouveau; afficher() }, LinearLayout.LayoutParams(0, -2, 1f).apply { rightMargin = dp(8) })
            addView(bouton("＋ Buddy Time\nune sortie", primaire = true) { nvSortieReset(); vue = Vue.NouvelleSortie(gs.first { it.meTime }.id); afficher() }, LinearLayout.LayoutParams(0, -2, 1f))
        }, lp(8))
    }

    private fun unGroupe(g: Buddies.Groupe) {
        entete(g.nom, (if (g.meTime) "Mes sorties à moi" else "Buddy Group · ${resume(g)}") + if (g.attente) " · 🕓 en attente du réseau" else "", retour = true)
        if (!g.meTime) col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL; isClickable = true; setPadding(0, dp(6), 0, dp(6))
            setOnClickListener { membres(g) }
            for (m in g.membres) addView(visage(m.id, m.pseudo, m.photo).apply { (layoutParams as LinearLayout.LayoutParams).rightMargin = dp(-6) })
            for (i in g.invitations.filter { it.canal != "qr" }) addView(visage(i.id, i.nom, null, pale = true).apply { (layoutParams as LinearLayout.LayoutParams).rightMargin = dp(-6) })
            addView(rond("＋", 40) { membres(g) }.apply { setTextColor(accent); (layoutParams as LinearLayout.LayoutParams).leftMargin = dp(16) })
        }, lp(4))
        for (p in buddies.plannings().filter { it.groupe == g.id }) bandeauRemplir(p, avecNom = true) { vue = Vue.Dispos(p.id, g.id); afficher() }
        val auj = aujourdhui()
        val sorties = buddies.sorties().filter { it.groupe == g.id }
        val avenir = sorties.filter { it.fin >= auj }.sortedBy { it.debut }
        val souvenirs = sorties.filter { it.fin < auj }.sortedByDescending { it.debut }
        col.addView(section("À venir"), lp(10))
        if (avenir.isEmpty()) col.addView(text(if (g.meTime) "Tes sorties à toi, seul ou avec un ou deux copains invités."
            else "Rien de prévu pour l’instant : ＋ Buddy Time quand vous êtes sûrs de partir.", 17f, muted), lp(4))
        for (x in avenir) col.addView(affiche(x, false) { ouvrir(x) }, lp(6))
        if (souvenirs.isNotEmpty()) col.addView(section("Souvenirs"), lp(12))
        for (paire in souvenirs.chunked(2)) col.addView(LinearLayout(a).apply {
            paire.forEachIndexed { k, x -> addView(affiche(x, true) { voir(x, g.id) }, LinearLayout.LayoutParams(0, dp(120), 1f).apply { if (k == 0) rightMargin = dp(10) }) }
            if (paire.size == 1) addView(View(a), LinearLayout.LayoutParams(0, 1, 1f))
        }, lp(6))
        val traces = buddies.traces().filter { it.groupe == g.id }
        if (traces.isNotEmpty()) col.addView(section("Traces partagées"), lp(12))
        for (t in traces) col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL; minimumHeight = dp(52); isClickable = true
            setOnClickListener { onCarte(null, listOf(t)) }
            addView(visage(t.par.id, t.par.pseudo, t.par.photo))
            addView(LinearLayout(a).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, dp(6), 0)
                addView(text("〰 ${t.nom}", 17f, bold = true).apply { isSingleLine = true })
                addView(text(t.par.pseudo + if (t.mot.isNotEmpty()) " : ${t.mot}" else "", 15f, muted).apply { isSingleLine = true })
            }, LinearLayout.LayoutParams(0, -2, 1f))
            addView(text(if (t.attente) "🕓" else quand(t.cree), 15f, muted))
        }, lp(4))
        pied.addView(bouton("＋ Buddy Time · une sortie", primaire = true) { nvSortieReset(); vue = Vue.NouvelleSortie(g.id); afficher() }, lp(8))
    }

    // ---------- Buddy Times ----------
    private fun aujourdhui(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
    private fun jourMs(d: String) = runCatching { SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(d)!!.time }.getOrDefault(0L)
    private fun joursAvant(x: Buddies.Sortie) = Math.round((jourMs(x.debut) - jourMs(aujourdhui())) / 86_400_000.0).toInt()
    private fun prochaine(l: List<Buddies.Sortie>) = l.filter { it.fin >= aujourdhui() }.minByOrNull { it.debut }
    private fun dateCourte(d: String) = SimpleDateFormat("EEE d MMM", Locale.FRANCE).format(Date(jourMs(d)))
    private fun dates(x: Buddies.Sortie) = if (x.fin == x.debut) dateCourte(x.debut) else "${dateCourte(x.debut)} – ${dateCourte(x.fin)}"
    private fun quandSortie(x: Buddies.Sortie): String {
        val n = joursAvant(x)
        return when { x.fin < aujourdhui() -> "Souvenir"; n <= 0 -> "En cours"; n == 1 -> "Demain"; else -> "Dans $n jours" }
    }
    private fun ouvrir(x: Buddies.Sortie) = onCarte(x, buddies.traces().filter { it.sortie == x.id })
    /** Un Buddy Time terminé s'ouvre sur son carnet (spec §5.4) ; la carte reste à un toucher. */
    private fun voir(x: Buddies.Sortie, groupe: String?) { if (x.fin < aujourdhui()) { vue = Vue.LeCarnet(x.id, groupe); afficher() } else ouvrir(x) }
    private fun couleurDe(id: String) = couleurs[Math.floorMod(id.sumOf { it.code }, couleurs.size)]
    private val moisCourts = listOf("JANV", "FÉVR", "MARS", "AVR", "MAI", "JUIN", "JUIL", "AOÛT", "SEPT", "OCT", "NOV", "DÉC")

    /** Fond d'un Buddy Time : sa photo, sinon une couleur tirée de son identifiant. */
    private fun fond(x: Buddies.Sortie, rayon: Float) = x.photo?.takeIf { it.startsWith("data:image/") }?.let(::image)
        ?.let { android.graphics.drawable.BitmapDrawable(a.resources, it) }
        ?: GradientDrawable().apply { cornerRadius = rayon; setColor(couleurDe(x.id)) }

    /** Photo carrée datée (même code dans la liste et le panneau de partage). */
    fun carre(x: Buddies.Sortie, taille: Int): View = FrameLayout(a).apply {
        background = fond(x, 12 * d)
        outlineProvider = object : ViewOutlineProvider() { override fun getOutline(view: View, o: Outline) { o.setRoundRect(0, 0, view.width, view.height, 12 * d) } }
        clipToOutline = true
        addView(LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(dp(4), 0, dp(4), dp(1))
            background = GradientDrawable().apply { cornerRadius = 6 * d; setColor(Color.WHITE) }
            addView(TextView(a).apply { text = moisCourts.getOrElse(x.debut.drop(5).take(2).toIntOrNull()?.minus(1) ?: -1) { "" }; textSize = 9f; setTextColor(Color.parseColor("#E0592A")); setTypeface(typeface, Typeface.BOLD) })
            addView(TextView(a).apply { text = x.debut.takeLast(2).trimStart('0'); textSize = 15f; setTextColor(ink); setTypeface(typeface, Typeface.BOLD); setPadding(0, dp(-3), 0, 0) })
        }, FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.START).apply { setMargins(dp(4), 0, 0, dp(4)) })
        layoutParams = LinearLayout.LayoutParams(dp(taille), dp(taille))
    }

    /** Grande image d'un Buddy Time (le prochain en haut de la liste, les cartes d'un groupe). */
    private fun affiche(x: Buddies.Sortie, petite: Boolean, f: () -> Unit): View = FrameLayout(a).apply {
        background = fond(x, 18 * d)
        outlineProvider = object : ViewOutlineProvider() { override fun getOutline(view: View, o: Outline) { o.setRoundRect(0, 0, view.width, view.height, 18 * d) } }
        clipToOutline = true; isClickable = true; setOnClickListener { f() }
        minimumHeight = dp(if (petite) 120 else 150)
        addView(View(a).apply { background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0x00000000, 0x99000000.toInt())) }, FrameLayout.LayoutParams(-1, -1))
        if (!petite) addView(TextView(a).apply {
            text = quandSortie(x); textSize = 15f; setTextColor(Color.WHITE); setTypeface(typeface, Typeface.BOLD); setPadding(dp(10), dp(3), dp(10), dp(3))
            background = GradientDrawable().apply { cornerRadius = 12 * d; setColor(Color.parseColor("#E0592A")) }
        }, FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.START).apply { setMargins(dp(12), dp(12), 0, 0) })
        addView(LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(14), 0, dp(14), dp(12))
            addView(text(x.nom, if (petite) 17f else 22f, Color.WHITE, bold = true))
            addView(text((if (petite) dateCourte(x.debut) else "${dates(x)} · ${x.participants.size} partant${if (x.participants.size > 1) "s" else ""}") + if (x.attente) " · 🕓" else "", 15f, Color.WHITE))
        }, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
    }

    /** Les buddies d'un groupe (toucher les visages) : inviter, nommer admin, retirer, quitter (spec §5.3). */
    private fun membres(g: Buddies.Groupe) {
        val admin = buddies.estAdmin(g)
        val boite = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(8), dp(16), dp(8)) }
        val dlg = AlertDialog.Builder(a).setView(ScrollView(a).apply { addView(boite) }).setNegativeButton("Fermer", null).create()
        boite.addView(text("Inviter mes copains", 20f, bold = true))
        boite.addView(inviterFixe(g.nom, g.invitations.firstOrNull { it.canal == "qr" }?.code) { i ->
            buddies.inviter(g.id, i); synchroniser()
            if (i.canal != "qr") toast("Invitation envoyée à ${i.nom}")
        }, lp())
        boite.addView(text("Dans la bande", 20f, bold = true), lp(14))
        for (m in g.membres) boite.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL; minimumHeight = dp(52)
            addView(visage(m.id, m.pseudo, m.photo))
            addView(text(m.pseudo + (if (buddies.estMoi(m)) " (toi)" else "") + if (m.role == "admin") "  · admin" else "", 17f).apply { setPadding(dp(12), 0, 0, 0) })
            if (admin && !buddies.estMoi(m)) {
                isClickable = true
                setOnClickListener {
                    val choix = listOfNotNull(if (m.role != "admin") "Nommer admin" else null, "Retirer de la bande")
                    AlertDialog.Builder(a).setTitle(m.pseudo).setItems(choix.toTypedArray()) { _, k ->
                        if (choix[k] == "Nommer admin") buddies.nommerAdmin(g.id, m.id) else buddies.retirer(g.id, m.id)
                        synchroniser(); dlg.dismiss()
                    }.setNegativeButton("Annuler", null).show()
                }
            }
        })
        for (i in g.invitations.filter { it.canal != "qr" }) boite.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL; minimumHeight = dp(52)
            addView(visage(i.id, i.nom, null))
            addView(LinearLayout(a).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, dp(6), 0)
                addView(text(i.nom, 17f, bold = true)); addView(text(i.contact, 15f, muted))
            }, LinearLayout.LayoutParams(0, -2, 1f))
            addView(text((if (i.attente) "🕓 " else "") + (canal[i.canal] ?: ""), 15f, accent, bold = true))
            addView(Button(a).apply {
                text = "✕"; setTextColor(muted); background = null; minWidth = dp(44); minimumWidth = dp(44)
                setOnClickListener { buddies.annulerInvitation(i.id); synchroniser(); dlg.dismiss() }
            })
        })
        boite.addView(bouton("Quitter le Buddy Group", couleur = Color.parseColor("#B3261E")) {
            AlertDialog.Builder(a).setMessage("Quitter « ${g.nom} » ?")
                .setPositiveButton("Quitter") { _, _ ->
                    buddies.quitter(g.id); synchroniser(); dlg.dismiss()
                    toast("Tu as quitté « ${g.nom} »"); vue = Vue.Liste; afficher()
                }.setNegativeButton("Annuler", null).show()
        }, lp(18))
        dlg.show()
    }

    /**
     * Les quatre façons d'inviter (écran 20) : Contacts, Mail, Téléphone, QR code. On n'invite que des gens qu'on
     * connaît, jamais par recherche (spec §3.5). Le message part tout de suite, même sans réseau.
     */
    private fun inviterRangee(nomGroupe: () -> String, qrExistant: () -> String?, sortie: Boolean = false, onInvite: (Buddies.NouvelleInvitation) -> Unit): View {
        val dans = if (sortie) "à" else "dans"
        fun pret() = nomGroupe().isNotBlank().also { if (!it) toast("Donne d’abord un nom au ${if (sortie) "Buddy Time" else "Buddy Group"}") }
        fun texte(code: String) = "${compte.nomAffiche()} t'invite $dans « ${nomGroupe()} » sur Mountain Buddies, pour nos sorties montagne : ${Buddies.lien(code)}"
        fun envoyer(c: String, nom: String, contact: String) {
            val code = Buddies.nouveauCode()
            val intent = if (c == "mail") Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:" + Uri.encode(contact))).apply {
                putExtra(Intent.EXTRA_SUBJECT, "${compte.nomAffiche()} t'invite $dans « ${nomGroupe()} »"); putExtra(Intent.EXTRA_TEXT, texte(code))
            } else Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(contact))).apply { putExtra("sms_body", texte(code)) }
            try { a.startActivity(intent) } catch (e: Exception) { toast("Aucune appli pour envoyer"); return }
            onInvite(Buddies.NouvelleInvitation(c, nom.trim().ifEmpty { contact }, contact, code))
        }
        fun formulaire(mail: Boolean) {
            val boite = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(8), dp(20), 0) }
            val nom = EditText(a).apply { hint = "Son prénom (Julie)"; isSingleLine = true; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS }
            val contact = EditText(a).apply {
                hint = if (mail) "julie@exemple.fr" else "06 12 34 56 78"; isSingleLine = true
                inputType = if (mail) InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS else InputType.TYPE_CLASS_PHONE
            }
            boite.addView(nom); boite.addView(contact)
            AlertDialog.Builder(a).setTitle(if (mail) "Inviter par mail" else "Inviter par SMS").setView(boite)
                .setPositiveButton(if (mail) "Écrire le mail" else "Écrire le SMS") { _, _ ->
                    val c = contact.text.toString().trim()
                    if (c.isNotEmpty()) envoyer(if (mail) "mail" else "sms", nom.text.toString(), c)
                }.setNegativeButton("Annuler", null).show()
        }
        fun qr() {
            val code = qrExistant() ?: Buddies.nouveauCode().also { onInvite(Buddies.NouvelleInvitation("qr", "", "", it)) }
            val taille = dp(260)
            val m = QRCodeWriter().encode(Buddies.lien(code), BarcodeFormat.QR_CODE, taille, taille, mapOf(EncodeHintType.MARGIN to 1))
            val px = IntArray(taille * taille) { k -> if (m.get(k % taille, k / taille)) Color.BLACK else Color.WHITE }
            val bmp = Bitmap.createBitmap(px, taille, taille, Bitmap.Config.RGB_565)
            val boite = LinearLayout(a).apply {
                orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(dp(20), dp(8), dp(20), 0)
                addView(ImageView(a).apply { setImageBitmap(bmp) }, LinearLayout.LayoutParams(taille, taille))
                addView(text("Tes copains visent ce code avec l'appareil photo de leur téléphone : il installe l'appli et les fait entrer ${if (sortie) "dans la sortie" else "dans la bande"}.", 15f, muted), lp())
            }
            AlertDialog.Builder(a).setTitle(nomGroupe()).setView(boite).setPositiveButton("Fermer", null).show()
        }
        return LinearLayout(a).apply {
            listOf(
                "📇" to "Contacts" to { if (pret()) choisirContact { c -> if (c != null) envoyer("contacts", c.first, c.second) } },
                "✉️" to "Mail" to { if (pret()) formulaire(true) },
                "📱" to "Téléphone" to { if (pret()) formulaire(false) },
                "🔳" to "QR code" to { if (pret()) qr() },
            ).forEach { (libelle, f) ->
                addView(LinearLayout(a).apply {
                    orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
                    addView(rond(libelle.first, 56) { f() })
                    addView(text(libelle.second, 15f, muted))
                }, LinearLayout.LayoutParams(0, -2, 1f))
            }
        }
    }
    private fun inviterFixe(nomGroupe: String, qrExistant: String?, onInvite: (Buddies.NouvelleInvitation) -> Unit): View =
        inviterRangee(nomGroupe = { nomGroupe }, qrExistant = { qrExistant }, sortie = false, onInvite = onInvite)

    // ---------- nouveau Buddy Group (écran 20) ----------
    private var nvNom = ""
    private var nvPhoto: String? = null
    private val nvInvites = mutableListOf<Buddies.NouvelleInvitation>()

    private fun nouveau() {
        entete("Nouveau Buddy Group", retour = true)
        col.addView(FrameLayout(a).apply {
            val v = nvPhoto?.let { visage("photo", "", it, 112) } ?: TextView(a).apply {
                text = "📷"; textSize = 36f; gravity = Gravity.CENTER
                background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(card); setStroke(dp(3), Color.parseColor("#D9DFDC"), dp(8).toFloat(), dp(6).toFloat()) }
            }
            addView(v, FrameLayout.LayoutParams(dp(112), dp(112)))
            isClickable = true
            setOnClickListener { choisirPhoto { p -> if (p != null) { nvPhoto = p; afficher() } } }
        }, LinearLayout.LayoutParams(dp(112), dp(112)).apply { gravity = Gravity.CENTER_HORIZONTAL; topMargin = dp(4) })
        val nom = EditText(a).apply {
            setText(nvNom); hint = "Nom de la bande"; isSingleLine = true; gravity = Gravity.CENTER; textSize = 18f
            setTypeface(typeface, Typeface.BOLD); inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            filters = arrayOf<android.text.InputFilter>(android.text.InputFilter.LengthFilter(80))
            addTextChangedListener(object : android.text.TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, st: Int, c: Int, af: Int) {}
                override fun onTextChanged(s: CharSequence?, st: Int, b: Int, c: Int) {}
                override fun afterTextChanged(s: android.text.Editable?) { nvNom = s?.toString().orEmpty() }
            })
        }
        col.addView(nom, lp())
        col.addView(section("Inviter mes copains"), lp(12))
        col.addView(inviterRangee({ nvNom }, { nvInvites.firstOrNull { it.canal == "qr" }?.code }) { i -> nvInvites += i; if (i.canal != "qr") afficher() }, lp(4))
        val gens = nvInvites.filter { it.canal != "qr" }
        col.addView(section("Dans la bande · ${1 + gens.size} buddies"), lp(12))
        col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL; minimumHeight = dp(52)
            addView(visage("moi", compte.nomAffiche(), compte.profil?.optString("photo")))
            addView(LinearLayout(a).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, 0, 0)
                addView(text("${compte.nomAffiche()} (toi)", 17f, bold = true)); addView(text("crée le groupe", 15f, muted))
            })
        })
        for (i in gens) col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL; minimumHeight = dp(52)
            addView(visage(i.code, i.nom, null))
            addView(LinearLayout(a).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, dp(6), 0)
                addView(text(i.nom, 17f, bold = true)); addView(text(i.contact, 15f, muted))
            }, LinearLayout.LayoutParams(0, -2, 1f))
            addView(text(canal[i.canal] ?: "", 15f, accent, bold = true))
        })
        col.addView(text("Ils reçoivent un lien : il installe l'appli et les fait entrer dans le groupe.", 15f, muted), lp())
        pied.addView(bouton("Créer le Buddy Group", primaire = true) {
            try {
                val id = buddies.creerGroupe(nvNom, nvPhoto, nvInvites.toList())
                toast(if (enLigne()) "« ${nvNom.trim()} » est créé" else "« ${nvNom.trim()} » est créé sur ton téléphone ; il partira au retour du réseau")
                nvNom = ""; nvPhoto = null; nvInvites.clear()
                vue = Vue.UnGroupe(id); afficher(); synchroniser()
            } catch (e: IllegalArgumentException) { toast(e.message ?: "Donne un nom au Buddy Group") }
        }, lp(8))
    }

    // ---------- nouveau Buddy Time (écran 21) : il naît quand on est sûr de partir ----------
    private var nsNom = ""
    private var nsPhoto: String? = null
    private var nsDebut = ""
    private var nsFin = ""
    private var nsLieu = ""
    private var nsQui: MutableSet<String>? = null
    private val nsInvites = mutableListOf<Buddies.NouvelleInvitation>()
    private fun nvSortieReset() { nsNom = ""; nsPhoto = null; nsDebut = aujourdhui(); nsFin = nsDebut; nsLieu = ""; nsQui = null; nsInvites.clear() }

    private fun champ(valeur: String, indice: String, f: (String) -> Unit) = EditText(a).apply {
        setText(valeur); hint = indice; isSingleLine = true; textSize = 17f; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, st: Int, c: Int, af: Int) {}
            override fun onTextChanged(s: CharSequence?, st: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) { f(s?.toString().orEmpty()) }
        })
    }

    private fun nouvelleSortie(g: Buddies.Groupe) {
        val qui = nsQui ?: g.membres.map { it.id }.toMutableSet().also { nsQui = it }
        entete("Nouveau Buddy Time", retour = true)
        // Photo en bandeau, « 📷 Changer »
        col.addView(FrameLayout(a).apply {
            background = nsPhoto?.let(::image)?.let { android.graphics.drawable.BitmapDrawable(a.resources, it) }
                ?: GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(Color.parseColor("#9CC3E6"), Color.parseColor("#6D8FAE"))).apply { cornerRadius = 18 * d }
            outlineProvider = object : ViewOutlineProvider() { override fun getOutline(view: View, o: Outline) { o.setRoundRect(0, 0, view.width, view.height, 18 * d) } }
            clipToOutline = true; isClickable = true
            setOnClickListener { choisirPhoto { p -> if (p != null) { nsPhoto = p; afficher() } } }
            addView(text(if (nsPhoto == null) "📷 Une photo" else "📷 Changer", 15f, bold = true).apply {
                setPadding(dp(10), dp(4), dp(10), dp(4)); background = GradientDrawable().apply { cornerRadius = 10 * d; setColor(Color.WHITE) }
            }, FrameLayout.LayoutParams(-2, -2).apply { setMargins(dp(10), dp(10), 0, 0) })
        }, LinearLayout.LayoutParams(-1, dp(120)).apply { topMargin = dp(4) })
        col.addView(champ(nsNom, "Week-end Queyras") { nsNom = it }.apply { gravity = Gravity.CENTER; setTypeface(typeface, Typeface.BOLD) }, lp())
        col.addView(section("Quand"), lp(12))
        col.addView(LinearLayout(a).apply {
            fun date(libelle: String, valeur: String, f: (String) -> Unit) = text("$libelle  ${dateCourte(valeur)}", 17f, bold = true).apply {
                setPadding(dp(12), dp(12), dp(12), dp(12)); background = GradientDrawable().apply { cornerRadius = 12 * d; setColor(card) }
                setOnClickListener {
                    val c = Calendar.getInstance().apply { timeInMillis = jourMs(valeur) }
                    android.app.DatePickerDialog(a, { _, y, m, j -> f(String.format(Locale.US, "%04d-%02d-%02d", y, m + 1, j)); afficher() },
                        c.get(Calendar.YEAR), c.get(Calendar.MONTH), c.get(Calendar.DAY_OF_MONTH)).show()
                }
            }
            addView(date("du", nsDebut) { nsDebut = it; if (nsFin < it) nsFin = it }, LinearLayout.LayoutParams(0, -2, 1f).apply { rightMargin = dp(10) })
            addView(date("au", nsFin) { nsFin = if (it < nsDebut) nsDebut else it }, LinearLayout.LayoutParams(0, -2, 1f))
        }, lp(4))
        col.addView(section("Avec qui · " + if (g.meTime) "Me Time" else "${g.nom} · ${qui.size} sur ${g.membres.size}"), lp(12))
        if (g.meTime) {
            col.addView(inviterRangee({ nsNom }, { nsInvites.firstOrNull { it.canal == "qr" }?.code }, sortie = true) { i -> nsInvites += i; if (i.canal != "qr") afficher() }, lp(4))
            for (i in nsInvites.filter { it.canal != "qr" }) col.addView(LinearLayout(a).apply {
                gravity = Gravity.CENTER_VERTICAL; minimumHeight = dp(52)
                addView(visage(i.code, i.nom, null))
                addView(text(i.nom, 17f, bold = true).apply { setPadding(dp(12), 0, 0, 0) }, LinearLayout.LayoutParams(0, -2, 1f))
                addView(text(canal[i.canal] ?: "", 15f, accent, bold = true))
            })
            if (nsInvites.isEmpty()) col.addView(text("Seul, ou invite un ou deux copains à cette sortie, sans créer de Buddy Group.", 15f, muted), lp(4))
        } else col.addView(android.widget.HorizontalScrollView(a).apply {
            addView(LinearLayout(a).apply {
                for (m in g.membres) addView(LinearLayout(a).apply {
                    orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(0, 0, dp(10), 0)
                    alpha = if (m.id in qui || buddies.estMoi(m)) 1f else 0.4f
                    addView(visage(m.id, m.pseudo, m.photo, 48))
                    addView(text(if (m.id in qui) "✓" else "—", 15f, muted))
                    if (!buddies.estMoi(m)) { isClickable = true; setOnClickListener { if (!qui.remove(m.id)) qui += m.id; afficher() } }
                })
            })
        }, lp(4))
        col.addView(section("Où · facultatif"), lp(12))
        col.addView(champ(nsLieu, "📍 Ceillac, Queyras") { nsLieu = it }, lp(4))
        pied.addView(bouton("Créer le Buddy Time", primaire = true) {
            try {
                val id = buddies.creerSortie(g.id, nsNom, nsPhoto, nsDebut, nsFin, nsLieu,
                    qui.filter { b -> g.membres.none { it.id == b && buddies.estMoi(it) } }, nsInvites.toList())
                toast(if (enLigne()) "« ${nsNom.trim()} » est créé" else "« ${nsNom.trim()} » est créé sur ton téléphone ; il partira au retour du réseau")
                nvSortieReset(); vue = Vue.UnGroupe(g.id); afficher(); synchroniser()
                buddies.sorties().firstOrNull { it.id == id }?.let { ouvrir(it) }
            } catch (e: IllegalArgumentException) { toast(e.message ?: "Donne un nom au Buddy Time") }
        }, lp(8))
    }

    // ---------- planning de saison (spec §5.5, écrans 16 à 19) ----------
    private var motOuvert: String? = null
    private var motTexte = ""
    private val moisLongs = listOf("JANVIER", "FÉVRIER", "MARS", "AVRIL", "MAI", "JUIN", "JUILLET", "AOÛT", "SEPTEMBRE", "OCTOBRE", "NOVEMBRE", "DÉCEMBRE")
    private val moisAbr = listOf("janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc.")
    private val phrases = listOf("Samedi seulement", "Dimanche seulement", "À confirmer", "Avec les enfants", "Je peux conduire")
    private val signe = mapOf("oui" to "✓", "peut" to "?", "non" to "✗")
    private val vert = Color.parseColor("#2F9E5F"); private val jaune = Color.parseColor("#F2C94C"); private val rose = Color.parseColor("#F1DCD9")
    private fun mois(d: String) = d.substring(5, 7).toInt() - 1
    private fun jourN(d: String) = d.substring(8, 10).toInt()
    private fun jourSemaine(d: String) = SimpleDateFormat("EEE", Locale.FRANCE).format(Date(jourMs(d)))
    /** « 5–6 déc. » ou « sam. 5 déc. ». */
    private fun ligneCourte(dt: Pair<String, String>) = if (dt.first == dt.second) "${jourSemaine(dt.first)} ${jourN(dt.first)} ${moisAbr[mois(dt.first)]}"
        else "${jourN(dt.first)}–${jourN(dt.second)} ${moisAbr[mois(dt.second)]}"
    private val moiId get() = buddies.moi ?: "moi"
    // ---------- 💬 Messagerie (§5.6) ----------
    private var conv: ConversationVue? = null

    /** La conversation d'un Buddy Group, dans le panneau (celle d'un Buddy Time s'ouvre sur sa carte). */
    private fun conversation(g: Buddies.Groupe) {
        entete(g.nom, "💬 ${g.membres.size} buddies", retour = true) { vue = Vue.UnGroupe(g.id); afficher() }
        val c = conv?.takeIf { it.groupe == g.id } ?: ConversationVue(a, buddies, album, g.id, null, g.membres, col,
            defiler = { (col.parent as? ScrollView)?.fullScroll(View.FOCUS_DOWN) }, localiser = localiser, dicter = dicter, deposer = null,
            onPoint = onPoint, onTrace = { onCarte(null, listOf(it)) }).also { conv = it }
        c.rafraichir()
        (c.saisie.parent as? android.view.ViewGroup)?.removeView(c.saisie)
        pied.addView(c.saisie)
    }

    /** Toutes mes conversations (💬 depuis la liste) : les plus récentes en haut, avec les non lus. */
    private fun conversations(groupe: String?, gs: List<Buddies.Groupe>) {
        entete("💬 Messages", retour = true) { vue = groupe?.let { Vue.UnGroupe(it) } ?: Vue.Liste; afficher() }
        val ms = buddies.messages(); val ts = buddies.traces(); val hs = buddies.hebergements()
        class C(val id: String, val nom: String, val photo: String?, val membres: List<Buddies.Buddy>, val dernier: Messages.Bulle?, val ouvrir: () -> Unit)
        val l = (gs.filter { !it.meTime }.map { g -> C(g.id, g.nom, g.photo, g.membres, Messages.fil(g.id, null, ms, ts, hs).lastOrNull()) { vue = Vue.Conv(g.id); afficher() } } +
            buddies.sorties().filter { it.participants.size > 1 }.map { x -> C(x.id, x.nom, x.photo, x.participants, Messages.fil(null, x.id, ms, ts, hs).lastOrNull()) { onParler(x) } }
                .filter { it.dernier != null })
            .sortedByDescending { it.dernier?.quand ?: 0L }
        if (l.isEmpty()) col.addView(text("Crée un Buddy Group ou un Buddy Time avec des copains : vous pourrez vous écrire ici.", 17f, muted), lp(12))
        for (c in l) col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL; minimumHeight = dp(64); isClickable = true
            setOnClickListener { c.ouvrir() }
            addView(visage(c.id, c.nom, c.photo, 48))
            addView(LinearLayout(a).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, dp(6), 0)
                addView(text(c.nom, 17f, bold = true).apply { isSingleLine = true })
                addView(text(c.dernier?.let { b -> Messages.apercu(b, { id -> c.membres.firstOrNull { it.id == id }?.pseudo ?: "?" }, buddies.moi) }
                    ?: "${c.membres.size} buddies", 15f, muted).apply { isSingleLine = true })
            }, LinearLayout.LayoutParams(0, -2, 1f))
            c.dernier?.let { addView(text(Messages.heure(it.quand), 14f, muted)) }
            val n = buddies.nonLus(c.id, ms)
            if (n > 0) addView(text("$n", 14f, Color.WHITE, bold = true).apply {
                gravity = Gravity.CENTER; minWidth = dp(24); setPadding(dp(8), dp(2), dp(8), dp(2))
                background = GradientDrawable().apply { cornerRadius = 12 * d; setColor(accent) }
            }, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(6) })
        }, lp(4))
    }

    private fun groupeCourant(): String? = when (val v = vue) {
        is Vue.UnGroupe -> v.id; is Vue.Albums -> v.groupe; is Vue.UnAlbum -> v.groupe; is Vue.LeCarnet -> v.groupe; is Vue.Ecrire -> v.groupe
        is Vue.Comptes -> v.groupe; is Vue.Count -> v.groupe; is Vue.UneDepense -> v.groupe; is Vue.Dodo -> v.groupe
        is Vue.Conv -> v.id; is Vue.Conversations -> v.groupe
        else -> bandeCourante()
    }
    private fun bandeCourante(): String? {
        val gs = buddies.groupes()
        val id = when (val v = vue) { is Vue.UnGroupe -> v.id; is Vue.NouvelleSortie -> v.groupe; is Vue.Plannings -> v.groupe
            is Vue.UnPlanning -> v.groupe; is Vue.Dispos -> v.groupe; is Vue.NvPlanning -> v.groupe; else -> null }
        return id?.takeIf { i -> gs.any { it.id == i && !it.meTime } }
    }
    /** Les buddies du planning : moi d'abord, puis la bande. */
    private fun colonnes(p: Buddies.Planning, g: Buddies.Groupe?): List<Buddies.Buddy> {
        val l = g?.membres ?: listOf(p.par)
        return l.filter { it.id == moiId } + l.filter { it.id != moiId }
    }
    private fun suivant(e: String?) = when (e) { null, "" -> "oui"; "oui" -> "peut"; "peut" -> "non"; else -> "" }

    /** « 🔔 Il te reste 3 week-ends à remplir · Remplir › ». */
    private fun bandeauRemplir(p: Buddies.Planning, avecNom: Boolean = false, f: () -> Unit) {
        val n = Buddies.aRemplir(p, moiId, aujourdhui())
        if (n == 0) return
        val quoi = if (p.dates.all { it.first != it.second }) "week-end${if (n > 1) "s" else ""}" else "date${if (n > 1) "s" else ""}"
        col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL; isClickable = true; minimumHeight = dp(52); setPadding(dp(12), dp(8), dp(12), dp(8))
            background = GradientDrawable().apply { cornerRadius = 14 * d; setColor(Color.parseColor("#FDF0D5")) }
            setOnClickListener { f() }
            addView(text("🔔 " + (if (avecNom) "${p.nom} : " else "Il te reste ") + "$n $quoi à remplir", 16f), LinearLayout.LayoutParams(0, -2, 1f))
            addView(text("Remplir ›", 16f, accent, bold = true))
        }, lp(6))
    }

    private fun plannings(groupe: String?, gs: List<Buddies.Groupe>) {
        entete("Plannings", retour = true) { vue = groupe?.let { Vue.UnGroupe(it) } ?: Vue.Liste; afficher() }
        val l = buddies.plannings().filter { groupe == null || it.groupe == groupe }
        for (p in l) {
            col.addView(LinearLayout(a).apply {
                gravity = Gravity.CENTER_VERTICAL; minimumHeight = dp(64); isClickable = true
                setOnClickListener { vue = Vue.UnPlanning(p.id, groupe); afficher() }
                addView(text("📅", 28f))
                addView(LinearLayout(a).apply {
                    orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, 0, 0)
                    addView(text(p.nom, 17f, bold = true).apply { isSingleLine = true })
                    addView(text("${gs.firstOrNull { it.id == p.groupe }?.nom ?: ""} · ${ligneCourte(p.dates.first())} → ${ligneCourte(p.dates.last())}" +
                        (if (p.dates.last().second < aujourdhui()) " · terminé" else "") + if (p.attente) " · 🕓" else "", 15f, muted))
                }, LinearLayout.LayoutParams(0, -2, 1f))
            }, lp(6))
            bandeauRemplir(p) { vue = Vue.Dispos(p.id, groupe); afficher() }
        }
        if (l.isEmpty()) col.addView(text("Une saison à organiser ? Propose des dates à ta bande : chacun coche ses dispos, vous voyez d'un coup d'œil les bons week-ends.", 17f, muted), lp(12))
        pied.addView(bouton("＋ Planning · une saison", primaire = true) { nvPlanningReset(); vue = Vue.NvPlanning(groupe); afficher() }, lp(8))
    }

    private fun caseDispo(e: String?, mot: Boolean, moi: Boolean, taille: Int) = FrameLayout(a).apply {
        addView(text(e?.let { signe[it] } ?: "·", if (taille > 40) 22f else 16f, when (e) { "oui" -> Color.WHITE; "peut" -> Color.parseColor("#5B4300")
            "non" -> Color.parseColor("#C0392B"); else -> Color.parseColor("#9AA5A0") }, bold = true).apply {
            gravity = Gravity.CENTER
            background = GradientDrawable().apply {
                cornerRadius = (if (taille > 40) 14 else 8) * d
                setColor(when (e) { "oui" -> vert; "peut" -> jaune; "non" -> rose; else -> card })
                if (moi) setStroke(dp(2), ink)
            }
        }, FrameLayout.LayoutParams(-1, -1))
        if (mot) addView(text("💬", 10f).apply { setPadding(0, 0, 0, 0) }, FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.END).apply { setMargins(0, dp(-6), dp(-4), 0) })
        clipChildren = false
    }

    /** Un planning (écran 16) : une ligne par date, une colonne par buddy, le nombre de dispos au bout. */
    private fun unPlanning(p: Buddies.Planning, groupe: String?, gs: List<Buddies.Groupe>) {
        val g = gs.firstOrNull { it.id == p.groupe }
        entete(p.nom, "${g?.nom ?: ""} · lancé par ${p.par.pseudo}" + if (p.attente) " · 🕓" else "", retour = true) { vue = Vue.Plannings(groupe); afficher() }
        bandeauRemplir(p) { vue = Vue.Dispos(p.id, groupe); afficher() }
        val qui = colonnes(p, g)
        val sorties = buddies.sorties()
        fun rangee() = LinearLayout(a).apply { gravity = Gravity.CENTER_VERTICAL; clipChildren = false }
        fun cellule(v: View) = LinearLayout.LayoutParams(dp(31), dp(31)).apply { rightMargin = dp(4) }
        col.addView(rangee().apply {
            addView(View(a), LinearLayout.LayoutParams(dp(50), 1))
            for (b in qui) addView(visage(b.id, b.pseudo, b.photo, 31).apply { layoutParams = cellule(this) })
        }, lp(8))
        var avant = -1
        for (dt in p.dates) {
            val dd = dt.first
            if (mois(dd) != avant) col.addView(section(moisLongs[mois(dd)]), lp(10))
            avant = mois(dd)
            val x = Buddies.sortieDeLigne(sorties, p, dd)
            col.addView(rangee().apply {
                addView(LinearLayout(a).apply {
                    orientation = LinearLayout.VERTICAL; isClickable = true; setOnClickListener { valider(p, g, dt, qui) }
                    addView(text(if (dt.first == dt.second) "${jourN(dd)}" else "${jourN(dd)}–${jourN(dt.second)}", 16f, bold = true).apply { setPadding(0, 0, 0, 0) })
                    addView(text(if (dt.first == dt.second) jourSemaine(dd) else moisAbr[mois(dt.second)], 13f, muted).apply { setPadding(0, 0, 0, 0) })
                }, LinearLayout.LayoutParams(dp(50), -2))
                if (x != null) addView(text("⛷ ${x.nom} ›", 16f, Color.WHITE, bold = true).apply {
                    isSingleLine = true; setPadding(dp(12), dp(8), dp(12), dp(8)); isClickable = true; setOnClickListener { ouvrir(x) }
                    background = GradientDrawable().apply { cornerRadius = 10 * d; setColor(accent) }
                }, LinearLayout.LayoutParams(0, -2, 1f))
                else {
                    for (b in qui) {
                        val r = p.dispos.firstOrNull { it.qui == b.id && it.debut == dd }
                        val moi = b.id == moiId
                        addView(caseDispo(r?.etat, !r?.mot.isNullOrEmpty(), moi, 31).apply {
                            layoutParams = cellule(this); isClickable = true
                            setOnClickListener {
                                when {
                                    moi -> buddies.repondre(p.id, dd, suivant(r?.etat), r?.mot ?: "").also { synchroniser() }
                                    !r?.mot.isNullOrEmpty() -> toast("${b.pseudo} : ${r!!.mot}")
                                    else -> valider(p, g, dt, qui)
                                }
                            }
                        })
                    }
                    val n = p.dispos.count { it.debut == dd && it.etat == "oui" }
                    addView(text("$n", 17f, if (n >= maxOf(2, qui.size - 1)) accent else Color.parseColor("#9AA5A0"), bold = true))
                }
            }, lp(4))
        }
        col.addView(text("Touche ta colonne pour répondre (✓ dispo, ? peut-être, ✗ non). Touche une date pour voir qui est dispo et créer le Buddy Time.", 15f, muted), lp(12))
    }

    /** Une ligne du planning (écran 19) : qui est dispo, où, puis « Créer le Buddy Time » ou « Pas encore ». */
    private fun valider(p: Buddies.Planning, g: Buddies.Groupe?, dt: Pair<String, String>, qui: List<Buddies.Buddy>) {
        val boite = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(8), dp(16), dp(8)) }
        val dlg = AlertDialog.Builder(a).setView(ScrollView(a).apply { addView(boite) }).create()
        boite.addView(text(ligneCourte(dt), 22f, bold = true))
        fun reponse(b: Buddies.Buddy) = p.dispos.firstOrNull { it.qui == b.id && it.debut == dt.first }
        fun bloc(l: List<Buddies.Buddy>, titre: String) {
            if (l.isEmpty()) return
            boite.addView(LinearLayout(a).apply {
                gravity = Gravity.CENTER_VERTICAL
                addView(LinearLayout(a).apply { for (b in l.take(5)) addView(visage(b.id, b.pseudo, b.photo, 36).apply { (layoutParams as LinearLayout.LayoutParams).rightMargin = dp(-8) }) })
                addView(LinearLayout(a).apply {
                    orientation = LinearLayout.VERTICAL; setPadding(dp(18), 0, 0, 0)
                    addView(text(titre, 17f, bold = true))
                    addView(text(l.joinToString(", ") { b -> b.pseudo + (reponse(b)?.mot?.takeIf { it.isNotEmpty() }?.let { " ($it)" } ?: "") }, 15f, muted))
                }, LinearLayout.LayoutParams(0, -2, 1f))
            }, lp(10))
        }
        val oui = qui.filter { reponse(it)?.etat == "oui" }
        bloc(oui, "${oui.size} dispo${if (oui.size > 1) "s" else ""}")
        bloc(qui.filter { reponse(it)?.etat == "peut" }, "peut-être")
        bloc(qui.filter { reponse(it)?.etat == "non" }, "pas dispo")
        bloc(qui.filter { reponse(it) == null }, "pas encore répondu")
        boite.addView(section("Où ? · facultatif, on peut décider plus tard"), lp(14))
        var lieu = ""
        boite.addView(champ("", "Dôme des Écrins") { lieu = it }, lp(4))
        boite.addView(bouton("Créer le Buddy Time", primaire = true) {
            val nom = lieu.trim().ifEmpty { p.nom }
            buddies.creerSortie(p.groupe, nom, null, dt.first, dt.second, lieu, oui.map { it.id }.filter { it != moiId })
            toast("« $nom » est créé"); dlg.dismiss(); synchroniser()
        }.apply { isEnabled = oui.isNotEmpty(); alpha = if (oui.isEmpty()) 0.5f else 1f }, lp(12))
        boite.addView(bouton("Pas encore") { dlg.dismiss() }, lp(8))
        if (g == null) boite.addView(text("Tu ne fais plus partie de cette bande.", 15f, muted), lp())
        dlg.show()
    }

    /** Remplir mes dispos (écran 17) : un toucher par date ; appui long pour un petit mot. */
    private fun mesDispos(p: Buddies.Planning, groupe: String?) {
        val auj = aujourdhui()
        val dates = p.dates.filter { it.second >= auj }
        val faits = dates.count { dt -> p.dispos.any { it.qui == moiId && it.debut == dt.first } }
        entete("Mes dispos", "${p.nom} · $faits sur ${dates.size} rempli${if (faits > 1) "s" else ""}", retour = true) {
            motOuvert = null; vue = Vue.UnPlanning(p.id, groupe); afficher()
        }
        for (dt in dates) {
            val dd = dt.first
            val r = p.dispos.firstOrNull { it.qui == moiId && it.debut == dd }
            val ouvert = motOuvert == dd
            val bloc = LinearLayout(a).apply {
                orientation = LinearLayout.VERTICAL
                if (ouvert) { setPadding(dp(10), dp(10), dp(10), dp(10)); background = GradientDrawable().apply { cornerRadius = 16 * d; setStroke(dp(2), ink) } }
            }
            bloc.addView(LinearLayout(a).apply {
                gravity = Gravity.CENTER_VERTICAL
                addView(LinearLayout(a).apply {
                    orientation = LinearLayout.VERTICAL
                    addView(text(ligneCourte(dt), 17f, bold = true).apply { isSingleLine = true })
                    if (dt.first != dt.second) addView(text("${jourSemaine(dt.first)} – ${jourSemaine(dt.second)}", 14f, muted))
                }, LinearLayout.LayoutParams(0, -2, 1f))
                for (e in listOf("oui", "peut", "non")) addView(caseDispo(if (r?.etat == e) e else null, false, false, 52).apply {
                    (getChildAt(0) as TextView).text = signe[e]
                    isClickable = true; isLongClickable = true
                    setOnClickListener { buddies.repondre(p.id, dd, if (r?.etat == e) "" else e, r?.mot ?: ""); synchroniser() }
                    setOnLongClickListener { motOuvert = dd; motTexte = r?.mot ?: ""; afficher(); true }
                }, LinearLayout.LayoutParams(dp(56), dp(52)).apply { leftMargin = dp(6) })
            })
            if (!r?.mot.isNullOrEmpty() && !ouvert) bloc.addView(text("💬 ${r!!.mot}", 15f, muted).apply {
                gravity = Gravity.END; isClickable = true; setOnClickListener { motOuvert = dd; motTexte = r?.mot ?: ""; afficher() }
            }, lp(2))
            if (ouvert) {
                for (paire in phrases.chunked(2)) bloc.addView(LinearLayout(a).apply {
                    for (m in paire) addView(text(m, 16f, if (motTexte == m) Color.WHITE else ink).apply {
                        gravity = Gravity.CENTER; setPadding(dp(10), dp(10), dp(10), dp(10)); isClickable = true
                        background = GradientDrawable().apply { cornerRadius = 22 * d; if (motTexte == m) setColor(ink) else { setColor(Color.WHITE); setStroke(dp(1), Color.parseColor("#D9DFDC")) } }
                        setOnClickListener { motTexte = if (motTexte == m) "" else m; afficher() }
                    }, LinearLayout.LayoutParams(0, -2, 1f).apply { rightMargin = dp(6) })
                    if (paire.size == 1) addView(View(a), LinearLayout.LayoutParams(0, 1, 1f))
                }, lp(6))
                bloc.addView(champ(motTexte, "ou un petit mot…") { motTexte = it }, lp(6))
                bloc.addView(LinearLayout(a).apply {
                    addView(bouton("OK", primaire = true) {
                        buddies.repondre(p.id, dd, r?.etat?.ifEmpty { null } ?: "peut", motTexte); motOuvert = null; afficher(); synchroniser()
                    }, LinearLayout.LayoutParams(0, -2, 1f).apply { rightMargin = dp(8) })
                    addView(bouton("Annuler") { motOuvert = null; afficher() }, LinearLayout.LayoutParams(0, -2, 1f))
                }, lp(6))
            }
            col.addView(bloc, lp(8))
        }
        if (dates.isEmpty()) col.addView(text("Toutes les dates de ce planning sont passées.", 17f, muted), lp(12))
        col.addView(text("Appui long sur une réponse : un petit mot (« Samedi seulement »…).", 15f, muted), lp(12))
    }

    // Nouveau planning (écran 18) : gardé pendant la saisie (la vue est redessinée à chaque choix).
    private var npNom = ""
    private var npPour: String? = null
    private var npDe = ""
    private var npA = ""
    private var npMode = "weekends"
    private val npNon = mutableSetOf<String>()
    private val npOui = mutableSetOf<String>()
    private var npLimite = ""
    private fun nvPlanningReset() {
        val c = Calendar.getInstance()
        fun m(n: Int) = (c.clone() as Calendar).apply { set(Calendar.DAY_OF_MONTH, 1); add(Calendar.MONTH, n) }.let { SimpleDateFormat("yyyy-MM", Locale.US).format(it.time) }
        npNom = ""; npPour = null; npDe = m(1); npA = m(4); npMode = "weekends"; npNon.clear(); npOui.clear()
        npLimite = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(System.currentTimeMillis() + 7 * 86_400_000L))
    }
    private fun nomMois(ym: String) = SimpleDateFormat("MMMM yyyy", Locale.FRANCE).format(SimpleDateFormat("yyyy-MM", Locale.US).parse(ym)!!)

    private fun nouveauPlanning(groupe: String?, gs: List<Buddies.Groupe>) {
        if (npDe.isEmpty()) nvPlanningReset()
        val bandes = gs.filter { !it.meTime }
        if (npPour == null || bandes.none { it.id == npPour }) npPour = groupe?.takeIf { gid -> bandes.any { it.id == gid } } ?: bandes.firstOrNull()?.id
        val g = bandes.firstOrNull { it.id == npPour }
        entete("Nouveau planning", retour = true) { vue = Vue.Plannings(groupe); afficher() }
        val an = Calendar.getInstance().get(Calendar.YEAR)
        col.addView(champ(npNom, "Saison ski $an-${(an + 1) % 100}") { npNom = it }.apply { gravity = Gravity.CENTER; setTypeface(typeface, Typeface.BOLD) }, lp())
        col.addView(section("Pour qui"), lp(12))
        if (g == null) col.addView(text("Crée d'abord un Buddy Group : un planning se fait avec une bande.", 17f, muted), lp(4))
        else col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL; setPadding(dp(12), dp(8), dp(12), dp(8)); isClickable = true
            background = GradientDrawable().apply { cornerRadius = 14 * d; setColor(card) }
            for (b in g.membres.take(4)) addView(visage(b.id, b.pseudo, b.photo, 30).apply { (layoutParams as LinearLayout.LayoutParams).rightMargin = dp(-6) })
            addView(text(g.nom, 17f).apply { setPadding(dp(16), 0, 0, 0) }, LinearLayout.LayoutParams(0, -2, 1f))
            if (bandes.size > 1) addView(text("▾", 17f))
            setOnClickListener {
                if (bandes.size > 1) AlertDialog.Builder(a).setItems(bandes.map { it.nom }.toTypedArray()) { _, i -> npPour = bandes[i].id; afficher() }.show()
            }
        }, lp(4))
        col.addView(section("Période"), lp(12))
        col.addView(LinearLayout(a).apply {
            fun choixMois(libelle: String, valeur: String, f: (String) -> Unit) = text("$libelle  ${nomMois(valeur)}", 17f, bold = true).apply {
                setPadding(dp(12), dp(12), dp(12), dp(12)); isSingleLine = true; background = GradientDrawable().apply { cornerRadius = 12 * d; setColor(card) }
                setOnClickListener {
                    val c = Calendar.getInstance().apply { set(Calendar.DAY_OF_MONTH, 1) }
                    val l = (0 until 18).map { k -> SimpleDateFormat("yyyy-MM", Locale.US).format((c.clone() as Calendar).apply { add(Calendar.MONTH, k) }.time) }
                    AlertDialog.Builder(a).setItems(l.map(::nomMois).toTypedArray()) { _, i -> f(l[i]); afficher() }.show()
                }
            }
            addView(choixMois("de", npDe) { npDe = it; if (npA < it) npA = it }, LinearLayout.LayoutParams(0, -2, 1f).apply { rightMargin = dp(10) })
            addView(choixMois("à", npA) { npA = if (it < npDe) npDe else it }, LinearLayout.LayoutParams(0, -2, 1f))
        }, lp(4))
        col.addView(LinearLayout(a).apply {
            setPadding(dp(4), dp(4), dp(4), dp(4)); background = GradientDrawable().apply { cornerRadius = 14 * d; setColor(card) }
            for ((k, t) in listOf("weekends" to "Week-ends", "jours" to "Tous les jours", "carte" to "À la carte")) addView(text(t, 16f, if (npMode == k) ink else muted, bold = npMode == k).apply {
                gravity = Gravity.CENTER; setPadding(0, dp(10), 0, dp(10)); isClickable = true
                if (npMode == k) background = GradientDrawable().apply { cornerRadius = 10 * d; setColor(Color.WHITE) }
                setOnClickListener { npMode = k; afficher() }
            }, LinearLayout.LayoutParams(0, -2, 1f))
        }, lp(10))
        val toutes = Buddies.datesPlanning(npDe, npA, npMode == "weekends")
        fun coche(dd: String) = if (npMode == "carte") dd in npOui else dd !in npNon
        val choisies = toutes.filter { coche(it.first) }
        col.addView(section("Dates proposées · ${choisies.size} sur ${toutes.size}"), lp(12))
        for (rang in toutes.chunked(3)) col.addView(LinearLayout(a).apply {
            for (dt in rang) addView(text(ligneCourte(dt), 15f, if (coche(dt.first)) ink else Color.parseColor("#9AA5A0"), bold = coche(dt.first)).apply {
                gravity = Gravity.CENTER; isSingleLine = true; setPadding(dp(4), dp(10), dp(4), dp(10)); isClickable = true
                if (!coche(dt.first)) paintFlags = paintFlags or android.graphics.Paint.STRIKE_THRU_TEXT_FLAG
                background = GradientDrawable().apply { cornerRadius = 12 * d
                    if (coche(dt.first)) { setColor(Color.parseColor("#E6F0EA")); setStroke(dp(2), accent) } else { setColor(Color.WHITE); setStroke(dp(1), Color.parseColor("#D9DFDC")) } }
                setOnClickListener {
                    val s = if (npMode == "carte") npOui else npNon
                    if (!s.remove(dt.first)) s += dt.first
                    afficher()
                }
            }, LinearLayout.LayoutParams(0, -2, 1f).apply { rightMargin = dp(6) })
            repeat(3 - rang.size) { addView(View(a), LinearLayout.LayoutParams(0, 1, 1f)) }
        }, lp(6))
        col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(text("Répondre avant le", 17f, muted), LinearLayout.LayoutParams(0, -2, 1f))
            addView(text("${dateCourte(npLimite)} ▾", 17f, bold = true).apply {
                setPadding(dp(10), dp(8), dp(10), dp(8)); isClickable = true
                setOnClickListener {
                    val c = Calendar.getInstance().apply { timeInMillis = jourMs(npLimite) }
                    android.app.DatePickerDialog(a, { _, y, m, j -> npLimite = String.format(Locale.US, "%04d-%02d-%02d", y, m + 1, j); afficher() },
                        c.get(Calendar.YEAR), c.get(Calendar.MONTH), c.get(Calendar.DAY_OF_MONTH)).show()
                }
            })
        }, lp(12))
        pied.addView(bouton("Publier le planning", primaire = true) {
            val pour = npPour
            if (pour == null) { toast("Crée d'abord un Buddy Group"); return@bouton }
            try {
                val id = buddies.creerPlanning(pour, npNom, choisies, npLimite)
                toast("« ${npNom.trim()} » est publié : ${g?.nom ?: "la bande"} est prévenue")
                npDe = ""; vue = Vue.UnPlanning(id, groupe); afficher(); synchroniser()
            } catch (e: IllegalArgumentException) { toast(e.message ?: "Donne un nom au planning") }
        }, lp(8))
    }

    // ---------- album (spec §5.8, écrans 7 et 11) ----------
    private fun imagePhoto(p: Buddies.PhotoBuddy, taille: Int): View = FrameLayout(a).apply {
        background = GradientDrawable().apply { cornerRadius = 12 * d; setColor(card) }
        outlineProvider = object : ViewOutlineProvider() { override fun getOutline(view: View, o: Outline) { o.setRoundRect(0, 0, view.width, view.height, 12 * d) } }
        clipToOutline = true
        val montre = text("🕓", 22f).apply { gravity = Gravity.CENTER }
        addView(montre, FrameLayout.LayoutParams(-1, -1))
        val img = ImageView(a).apply { scaleType = ImageView.ScaleType.CENTER_CROP; if (p.attente) alpha = 0.55f }
        addView(img, FrameLayout.LayoutParams(-1, -1))
        AlbumVue.charger(a, album, p, "petite", img)
        if (!p.attente) montre.text = ""
        if (taille > 0) layoutParams = LinearLayout.LayoutParams(dp(taille), dp(taille))
    }

    private fun albums(groupe: String?) {
        entete("Albums", retour = true) { vue = groupe?.let { Vue.UnGroupe(it) } ?: Vue.Liste; afficher() }
        val photos = buddies.photos()
        val l = buddies.sorties().filter { (groupe == null || it.groupe == groupe) && it.debut <= aujourdhui() }.sortedByDescending { it.debut }
        for (x in l) col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL; minimumHeight = dp(64); isClickable = true
            setOnClickListener { vue = Vue.UnAlbum(x.id, groupe); afficher() }
            val ph = photos.filter { it.sortie == x.id }
            addView(ph.firstOrNull()?.let { imagePhoto(it, 56) } ?: text("📸", 28f).apply { gravity = Gravity.CENTER; layoutParams = LinearLayout.LayoutParams(dp(56), dp(56)) })
            addView(LinearLayout(a).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, 0, 0)
                addView(text(x.nom, 17f, bold = true).apply { isSingleLine = true })
                addView(text(if (ph.isEmpty()) "pas encore de photo" else "${ph.size} photo${if (ph.size > 1) "s" else ""}", 15f, muted))
            }, LinearLayout.LayoutParams(0, -2, 1f))
        }, lp(6))
        if (l.isEmpty()) col.addView(text("L’album d’un Buddy Time s’ouvre le jour du départ : chacun y dépose ses photos.", 17f, muted), lp(12))
    }

    /** Un album (écran 11) : Toutes, Sur la carte, ⭐ Carnet ; « Déposer mes photos ». */
    private fun unAlbum(x: Buddies.Sortie, v: Vue.UnAlbum) {
        val toutes = buddies.photos().filter { it.sortie == x.id }
        val l = if (v.carnet) toutes.filter { it.etoile } else toutes
        val auteurs = toutes.map { it.par.id }.toSet().size
        entete(x.nom, "📸 ${toutes.size} photo${if (toutes.size > 1) "s" else ""}" + if (auteurs > 0) " · $auteurs ${if (auteurs > 1) "buddies" else "buddy"}" else "",
            retour = true) { vue = if (v.retourCarnet) Vue.LeCarnet(x.id, v.groupe) else Vue.Albums(v.groupe); afficher() }
        col.addView(LinearLayout(a).apply {
            setPadding(dp(4), dp(4), dp(4), dp(4)); background = GradientDrawable().apply { cornerRadius = 14 * d; setColor(card) }
            for ((k, t) in listOf(0 to "Toutes", 1 to "Sur la carte", 2 to "⭐ Carnet")) {
                val choisi = (k == 0 && !v.carnet) || (k == 2 && v.carnet)
                addView(text(t, 16f, if (choisi) ink else muted, bold = choisi).apply {
                    gravity = Gravity.CENTER; setPadding(0, dp(10), 0, dp(10)); isClickable = true
                    if (choisi) background = GradientDrawable().apply { cornerRadius = 10 * d; setColor(Color.WHITE) }
                    setOnClickListener {
                        when (k) { 0 -> { vue = v.copy(carnet = false); afficher() }; 2 -> { vue = v.copy(carnet = true); afficher() }; else -> ouvrir(x) }
                    }
                }, LinearLayout.LayoutParams(0, -2, 1f))
            }
        }, lp(6))
        // Rangées par jour : « Jour 1 · sam. 18 oct. »
        for ((jour, ph) in l.groupBy { it.priseLe.take(10) }.toSortedMap()) {
            val n = Math.round((jourMs(jour) - jourMs(x.debut)) / 86_400_000.0).toInt() + 1
            col.addView(LinearLayout(a).apply {
                addView(section((if (n >= 1) "Jour $n · " else "") + AlbumVue.jourLong(jour)), LinearLayout.LayoutParams(0, -2, 1f))
                addView(text("${ph.size} photo${if (ph.size > 1) "s" else ""}", 14f, muted))
            }, lp(12))
            for (rang in ph.chunked(3)) col.addView(LinearLayout(a).apply {
                for (p in rang) addView(FrameLayout(a).apply {
                    addView(imagePhoto(p, 0), FrameLayout.LayoutParams(-1, -1))
                    if (p.etoile) addView(text("⭐", 16f), FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.END).apply { setMargins(0, dp(2), dp(4), 0) })
                    addView(visage(p.par.id, p.par.pseudo, p.par.photo, 24), FrameLayout.LayoutParams(dp(24), dp(24), Gravity.BOTTOM or Gravity.START).apply { setMargins(dp(4), 0, 0, dp(4)) })
                    isClickable = true; setOnClickListener { AlbumVue.visionneuse(a, buddies, album, l, l.indexOf(p)) }
                }, LinearLayout.LayoutParams(0, dp(108), 1f).apply { rightMargin = dp(6) })
                repeat(3 - rang.size) { addView(View(a), LinearLayout.LayoutParams(0, 1, 1f).apply { rightMargin = dp(6) }) }
            }, lp(6))
        }
        if (l.isEmpty()) col.addView(text(if (v.carnet) "Touche ⭐ sur une photo pour la garder pour le carnet."
            else "Pas encore de photo : dépose les tiennes, chacun ajoute les siennes.", 17f, muted), lp(12))
        val miennes = toutes.count { it.attente }
        if (miennes > 0) col.addView(text("🕓 $miennes photo${if (miennes > 1) "s" else ""} à toi ${if (miennes > 1) "partiront" else "partira"} au retour du réseau.", 15f, muted), lp(10))
        pied.addView(bouton("📷 Déposer mes photos", primaire = true) { deposer(x) }, lp(8))
    }

    // ---------- carnet (spec §5.8, écrans 12 à 14) ----------
    private val prefsCarnet by lazy { a.getSharedPreferences("carnet", android.content.Context.MODE_PRIVATE) }
    private val reliefs = HashMap<String, Carnet.Relief>()
    private val reliefsEnCours = HashSet<String>()
    /** Relief des traces : gardé sur le téléphone, sinon demandé une fois en ligne ; l'écran se redessine à l'arrivée. */
    private fun chargerReliefs(tc: List<Carnet.TraceCarnet>) {
        for (t in tc) {
            if (reliefs.containsKey(t.t.id)) continue
            val garde = Carnet.reliefGarde(prefsCarnet, t.t.id)
            if (garde != null) { reliefs[t.t.id] = garde; continue }
            if (!reliefsEnCours.add(t.t.id)) continue
            a.lifecycleScope.launch {
                val r = withContext(Dispatchers.IO) { Carnet.relief(prefsCarnet, t.t) }
                reliefsEnCours.remove(t.t.id)
                if (r != null) { reliefs[t.t.id] = r; if (vue is Vue.LeCarnet) afficher() }
            }
        }
    }
    private fun arrondi(v: View, r: Int) = v.apply {
        outlineProvider = object : ViewOutlineProvider() { override fun getOutline(view: View, o: Outline) { o.setRoundRect(0, 0, view.width, view.height, r * d) } }
        clipToOutline = true
    }
    private fun photoCarnet(p: Buddies.PhotoBuddy, grande: Boolean): View = arrondi(FrameLayout(a).apply {
        background = GradientDrawable().apply { setColor(card) }
        val img = ImageView(a).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
        addView(img, FrameLayout.LayoutParams(-1, -1))
        AlbumVue.charger(a, album, p, "petite", img)
        if (grande) AlbumVue.charger(a, album, p, "grande", img)
        isClickable = true
    }, 14)
    private fun grilleTuiles(l: List<Carnet.Tuile>, parRangee: Int, taille: Float = 18f): View = LinearLayout(a).apply {
        orientation = LinearLayout.VERTICAL
        for (rang in l.chunked(parRangee)) addView(LinearLayout(a).apply {
            for (t in rang) addView(LinearLayout(a).apply {
                orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setPadding(dp(2), dp(8), dp(2), dp(8))
                background = GradientDrawable().apply {
                    cornerRadius = 12 * d
                    if (t.vide) setStroke(dp(2), Color.parseColor("#D9DFDC"), 6 * d, 4 * d) else setColor(card)
                }
                addView(text(t.v, taille, if (t.vide) muted else ink, bold = true).apply { gravity = Gravity.CENTER; isSingleLine = true })
                addView(text(t.l, 14f, muted).apply { gravity = Gravity.CENTER; isSingleLine = true })
            }, LinearLayout.LayoutParams(0, -2, 1f).apply { rightMargin = dp(6) })
            repeat(parRangee - rang.size) { addView(View(a), LinearLayout.LayoutParams(0, 1, 1f).apply { rightMargin = dp(6) }) }
        }, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(6) })
    }
    private fun pastilleJour(n: Int, couleur: String) = text("Jour $n", 16f, Color.WHITE, bold = true).apply {
        setPadding(dp(10), dp(3), dp(10), dp(3)); background = GradientDrawable().apply { cornerRadius = 10 * d; setColor(Color.parseColor(couleur)) }
    }
    private fun cadre() = LinearLayout(a).apply {
        orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(12), dp(12), dp(12))
        background = GradientDrawable().apply { cornerRadius = 16 * d; setColor(Color.WHITE); setStroke(dp(1), Color.parseColor("#D9DFDC")) }
    }
    private fun chiffresFiche(f: Buddies.Fiche) = listOf(
        Carnet.Tuile(if (f.depart.isNotEmpty()) f.depart.replace(":", " h ") else "—", "départ", f.depart.isEmpty()),
        Carnet.Tuile(f.duree?.let(Carnet::duree) ?: "—", "durée", f.duree == null),
        Carnet.Tuile(f.distance?.let(Carnet::km) ?: "—", "distance", f.distance == null),
        Carnet.Tuile(f.denivele?.let { "+${Carnet.metres(it)}" } ?: "—", "montée", f.denivele == null))
    private var pratiqueOuvert = false

    /** Le carnet (écrans 12 et 13) : photos choisies, récits signés, trace, profil et chiffres, fiches des jours, « Le pratique ». */
    private fun carnet(x: Buddies.Sortie, groupe: String?) {
        val photos = buddies.photos().filter { it.sortie == x.id }
        val traces = buddies.traces().filter { it.sortie == x.id }
        val tc = Carnet.tracesDuCarnet(traces, Carnet.joursDe(x))
        chargerReliefs(tc)
        val (choix, auto) = Carnet.choixPhotos(photos)
        val fs = Carnet.fiches(x, tc, reliefs)
        val tuiles = Carnet.chiffres(x, tc, reliefs, fs)
        entete(x.nom, "${dates(x)} · ${x.participants.joinToString(", ") { it.pseudo }}", retour = true) {
            vue = groupe?.let { Vue.UnGroupe(it) } ?: Vue.Liste; afficher()
        }
        // Couverture : la photo du Buddy Time, sinon la première photo choisie.
        col.addView(arrondi(FrameLayout(a).apply {
            background = fond(x, 18 * d)
            if (x.photo == null) choix.firstOrNull()?.let { addView(photoCarnet(it, true), FrameLayout.LayoutParams(-1, -1)) }
            addView(View(a).apply { background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0x00000000, 0x99000000.toInt())) }, FrameLayout.LayoutParams(-1, -1))
            addView(text(x.nom, 26f, Color.WHITE, bold = true).apply { setPadding(dp(14), 0, dp(14), dp(12)) }, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
        }, 18), LinearLayout.LayoutParams(-1, dp(170)).apply { topMargin = dp(8) })
        if (photos.isNotEmpty()) {
            col.addView(LinearLayout(a).apply {
                gravity = Gravity.CENTER_VERTICAL
                addView(text("${if (auto) "✨" else "⭐"} ${choix.size} photo${if (choix.size > 1) "s" else ""} choisie${if (choix.size > 1) "s" else ""} sur ${photos.size}", 17f, bold = true),
                    LinearLayout.LayoutParams(0, -2, 1f))
                addView(text("Changer", 16f, accent, bold = true).apply {
                    gravity = Gravity.CENTER; minHeight = dp(48); setPadding(dp(8), 0, dp(4), 0); isClickable = true
                    setOnClickListener { vue = Vue.UnAlbum(x.id, groupe, carnet = true, retourCarnet = true); afficher() }
                })
            }, lp(10))
            col.addView(LinearLayout(a).apply {
                addView(photoCarnet(choix[0], true).apply { setOnClickListener { AlbumVue.visionneuse(a, buddies, album, choix, 0) } },
                    LinearLayout.LayoutParams(0, -1, 2f).apply { rightMargin = dp(8) })
                if (choix.size > 1) addView(LinearLayout(a).apply {
                    orientation = LinearLayout.VERTICAL
                    for (i in 1..minOf(2, choix.size - 1)) addView(FrameLayout(a).apply {
                        addView(photoCarnet(choix[i], false).apply { setOnClickListener { AlbumVue.visionneuse(a, buddies, album, choix, i) } }, FrameLayout.LayoutParams(-1, -1))
                        if (i == 2 && choix.size > 3) addView(text("+${choix.size - 3}", 24f, Color.WHITE, bold = true).apply {
                            gravity = Gravity.CENTER; setBackgroundColor(0x66000000)
                        }, FrameLayout.LayoutParams(-1, -1))
                    }, LinearLayout.LayoutParams(-1, 0, 1f).apply { if (i == 1) bottomMargin = dp(8) })
                }, LinearLayout.LayoutParams(0, -1, 1f))
            }, LinearLayout.LayoutParams(-1, dp(220)).apply { topMargin = dp(6) })
        }
        for (r in x.carnet.recits) {
            col.addView(text(r.texte, 18f).apply { setLineSpacing(0f, 1.25f) }, lp(12))
            col.addView(LinearLayout(a).apply {
                gravity = Gravity.CENTER_VERTICAL
                addView(visage(r.par.id, r.par.pseudo, r.par.photo, 26))
                addView(text(r.par.pseudo + if (r.attente) " · 🕓" else "", 15f, muted).apply { setPadding(dp(8), 0, 0, 0) })
            }, lp(2))
        }
        if (x.carnet.recits.isEmpty()) col.addView(text("🎤 Raconte la sortie : chacun ajoute son texte, à la voix ou au clavier.", 17f, muted).apply {
            setPadding(dp(14), dp(14), dp(14), dp(14)); isClickable = true
            background = GradientDrawable().apply { cornerRadius = 14 * d; setStroke(dp(2), Color.parseColor("#D9DFDC"), 6 * d, 4 * d) }
            setOnClickListener { vue = Vue.Ecrire(x.id, groupe); ecrireReset(x); afficher() }
        }, lp(12))
        if (tc.isNotEmpty()) {
            col.addView(LinearLayout(a).apply {
                addView(text("〰 La trace", 17f, bold = true), LinearLayout.LayoutParams(0, -2, 1f))
                addView(text(listOfNotNull(tuiles.firstOrNull { it.l == "distance" }?.v, tuiles.firstOrNull { it.l == "montée" }?.v).joinToString(" · "), 15f, muted))
            }, lp(14))
            col.addView(arrondi(FrameLayout(a).apply {
                addView(PetitPlanView(a, tc), FrameLayout.LayoutParams(-1, -1))
                addView(text("⤢", 20f).apply {
                    gravity = Gravity.CENTER; background = GradientDrawable().apply { cornerRadius = 10 * d; setColor(Color.WHITE) }
                }, FrameLayout.LayoutParams(dp(40), dp(40), Gravity.TOP or Gravity.END).apply { setMargins(0, dp(10), dp(10), 0) })
                if (tc.size > 1 || tc[0].jour == null) addView(LinearLayout(a).apply {
                    setPadding(dp(10), dp(4), dp(10), dp(4)); background = GradientDrawable().apply { cornerRadius = 12 * d; setColor(Color.WHITE) }
                    for (t in tc) addView(text("━ ", 15f, Color.parseColor(t.couleur), bold = true).apply { append(android.text.SpannableString(t.libelle + "  ").apply {
                        setSpan(android.text.style.ForegroundColorSpan(ink), 0, length, 0) }) })
                }, FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.START).apply { setMargins(dp(10), 0, 0, dp(10)) })
                isClickable = true; setOnClickListener { ouvrir(x) }
            }, 16), LinearLayout.LayoutParams(-1, dp(200)).apply { topMargin = dp(6) })
            val parts = tc.mapNotNull { t -> reliefs[t.t.id]?.let { t to it } }
            if (parts.isNotEmpty()) col.addView(arrondi(ProfilCarnetView(a, parts), 12), LinearLayout.LayoutParams(-1, dp(90)).apply { topMargin = dp(8) })
        }
        col.addView(grilleTuiles(tuiles, 3), lp(12))
        if (x.carnet.conditions.isNotEmpty()) col.addView(text("Conditions : ${x.carnet.conditions}", 17f), lp(4))
        for (fa in fs) col.addView(cadre().apply {
            addView(LinearLayout(a).apply {
                gravity = Gravity.CENTER_VERTICAL
                addView(pastilleJour(fa.n, fa.couleur))
                addView(text(fa.f.nom.ifEmpty { AlbumVue.jourLong(fa.f.jour) }, 19f, bold = true).apply { setPadding(dp(8), 0, 0, 0) }, LinearLayout.LayoutParams(0, -2, 1f))
            })
            addView(grilleTuiles(chiffresFiche(fa.f), 4, 16f), lp(8))
            val ph = (if (auto) photos else choix).filter { it.priseLe.startsWith(fa.f.jour) }.take(3)
            if (ph.isNotEmpty()) addView(LinearLayout(a).apply {
                for (p in ph) addView(photoCarnet(p, false).apply { setOnClickListener { AlbumVue.visionneuse(a, buddies, album, ph, ph.indexOf(p)) } },
                    LinearLayout.LayoutParams(0, -1, 1f).apply { rightMargin = dp(6) })
                repeat(3 - ph.size) { addView(View(a), LinearLayout.LayoutParams(0, 1, 1f).apply { rightMargin = dp(6) }) }
            }, LinearLayout.LayoutParams(-1, dp(80)).apply { topMargin = dp(4) })
        }, lp(10))
        col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL; minimumHeight = dp(56); setPadding(dp(14), 0, dp(14), 0); isClickable = true
            background = GradientDrawable().apply { cornerRadius = 14 * d; setColor(card) }
            addView(text("📍 💶 〰", 17f)); addView(text("Le pratique", 17f, muted).apply { setPadding(dp(10), 0, 0, 0) }, LinearLayout.LayoutParams(0, -2, 1f))
            addView(text(if (pratiqueOuvert) "▾" else "▸", 17f, muted))
            setOnClickListener { pratiqueOuvert = !pratiqueOuvert; afficher() }
        }, lp(12))
        if (pratiqueOuvert) {
            if (x.lieu.isNotEmpty()) col.addView(text("📍 ${x.lieu}"), lp(4))
            col.addView(text("👥 ${x.participants.joinToString(", ") { it.pseudo }}"), lp(4))
            val dsc = buddies.depenses().filter { it.sortie == x.id }
            col.addView(text("💶 " + (if (dsc.isEmpty()) "Buddy count ›" else "${BuddyCount.euros(dsc.sumOf { it.montant })} à ${x.participants.size} · les comptes ›"),
                17f, accent, bold = true).apply { minHeight = dp(48); gravity = Gravity.CENTER_VERTICAL; isClickable = true
                setOnClickListener { vue = Vue.Count(x.id, groupe); afficher() } }, lp(4))
            for (t in traces) col.addView(text("〰 ${t.nom} · par ${t.par.pseudo}"), lp(2))
            col.addView(text("L’hébergement et les messages s’ajouteront ici.", 15f, muted), lp(4))
        }
        pied.addView(LinearLayout(a).apply {
            addView(bouton("✏️ Modifier") { ecrireReset(x); vue = Vue.Ecrire(x.id, groupe); afficher() }, LinearLayout.LayoutParams(0, -2, 1f).apply { rightMargin = dp(8) })
            addView(bouton("Partager", primaire = true) {
                val t = Carnet.texte(x, dates(x), tuiles, fs)
                runCatching { a.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain")
                    .putExtra(Intent.EXTRA_SUBJECT, x.nom).putExtra(Intent.EXTRA_TEXT, t), x.nom)) }
            }, LinearLayout.LayoutParams(0, -2, 1f))
        }, lp(8))
    }

    // Écrire le carnet (écran 14) : ce qui est tapé reste là pendant la synchro.
    private var ecTexte = ""
    private var ecSaisies = mutableListOf<Array<String>>()  // nom, départ, durée, distance, montée
    private var ecAutres = arrayOf("", "", "")
    private var ecDebut = 0L
    private fun ecrireReset(x: Buddies.Sortie) {
        ecTexte = x.carnet.recits.firstOrNull { buddies.estMoi(it.par) }?.texte ?: ""
        ecSaisies = Carnet.joursDe(x).map { j ->
            val f = x.carnet.fiches.firstOrNull { it.jour == j }
            arrayOf(f?.nom ?: "", f?.depart ?: "", f?.duree?.let(Carnet::duree) ?: "", f?.distance?.let { (it / 1000.0).toString().removeSuffix(".0").replace('.', ',') } ?: "",
                f?.denivele?.toString() ?: "")
        }.toMutableList()
        ecAutres = arrayOf(x.carnet.difficulte, x.carnet.meteo, x.carnet.conditions)
        ecDebut = System.currentTimeMillis()
    }

    private fun ecrire(x: Buddies.Sortie, groupe: String?) {
        val jours = Carnet.joursDe(x)
        if (ecSaisies.size != jours.size) ecrireReset(x)
        val tc = Carnet.tracesDuCarnet(buddies.traces().filter { it.sortie == x.id }, jours)
        chargerReliefs(tc)
        val derives = Carnet.fiches(x.copy(carnet = x.carnet.copy(fiches = emptyList())), tc, reliefs)
        entete(x.nom, "📖 écrire le carnet", retour = true) { vue = Vue.LeCarnet(x.id, groupe); afficher() }
        col.addView(LinearLayout(a).apply {
            addView(text("Le récit", 17f, bold = true), LinearLayout.LayoutParams(0, -2, 1f))
            addView(text(compte.nomAffiche(), 15f, muted))
        }, lp(10))
        val recit = champ(ecTexte, "Ce que tu veux raconter : le départ, le temps, les rires du soir…") { ecTexte = it }.apply {
            isSingleLine = false; minLines = 5; gravity = Gravity.TOP or Gravity.START; textSize = 18f
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_MULTI_LINE
        }
        col.addView(recit, lp(4))
        col.addView(FrameLayout(a).apply {
            addView(rond("🎤", 112, Color.parseColor("#E4572E")) {
                dicter { t -> if (!t.isNullOrBlank()) { ecTexte = if (ecTexte.isBlank()) t else "${ecTexte.trim()} $t"; afficher() } else toast("Pas de texte : réessaie, ou touche 🎤 sur le clavier") }
            }.apply { textSize = 44f }, FrameLayout.LayoutParams(dp(112), dp(112), Gravity.CENTER))
        }, LinearLayout.LayoutParams(-1, dp(130)).apply { topMargin = dp(8) })
        col.addView(text("Touche le micro et raconte : tes mots sont écrits tels quels, puis corrige le texte.", 15f, muted).apply { gravity = Gravity.CENTER }, lp(2))
        for ((i, j) in jours.withIndex()) {
            val v = ecSaisies[i]
            val dv = derives.firstOrNull { it.f.jour == j }
            col.addView(cadre().apply {
                addView(LinearLayout(a).apply {
                    gravity = Gravity.CENTER_VERTICAL
                    addView(pastilleJour(i + 1, tc.firstOrNull { it.jour == j }?.couleur ?: "#2F6F4F"))
                    addView(champ(v[0], "Nom de la rando") { v[0] = it }, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(8) })
                })
                if (dv?.trace == true) addView(text("depuis la trace", 14f, muted), lp(2))
                fun case(k: Int, libelle: String, indice: String, type: Int) = LinearLayout(a).apply {
                    orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(dp(4), dp(4), dp(4), dp(4))
                    background = GradientDrawable().apply { cornerRadius = 12 * d; setStroke(dp(2), Color.parseColor("#D9DFDC"), 6 * d, 4 * d) }
                    addView(champ(v[k], indice) { v[k] = it }.apply { gravity = Gravity.CENTER; inputType = type; setTypeface(typeface, Typeface.BOLD); background = null })
                    addView(text(libelle, 14f, muted))
                }
                for (paire in listOf(listOf(1, 2), listOf(3, 4))) addView(LinearLayout(a).apply {
                    for (k in paire) addView(when (k) {
                        1 -> case(1, "départ (7:10)", "—", InputType.TYPE_CLASS_DATETIME or InputType.TYPE_DATETIME_VARIATION_TIME)
                        2 -> case(2, "durée", "5 h 20", InputType.TYPE_CLASS_TEXT)
                        3 -> case(3, "distance (km)", dv?.f?.distance?.let(Carnet::km) ?: "—", InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL)
                        else -> case(4, "montée (m)", dv?.f?.denivele?.let { "+${Carnet.metres(it)}" } ?: "—", InputType.TYPE_CLASS_NUMBER)
                    }, LinearLayout.LayoutParams(0, -2, 1f).apply { rightMargin = dp(6) })
                }, lp(6))
            }, lp(10))
        }
        col.addView(cadre().apply {
            for ((k, l) in listOf("Difficulté" to "T3, PD, 3.1…", "Météo" to "☀️ 4°", "Conditions" to "Neige dure le matin, lac gelé…").withIndex()) {
                addView(text(l.first, 14f, muted), lp(if (k == 0) 0 else 8))
                addView(champ(ecAutres[k], l.second) { ecAutres[k] = it })
            }
        }, lp(10))
        pied.addView(bouton("Enregistrer le carnet", primaire = true) {
            val fiches = mutableListOf<Buddies.Fiche>()
            for ((i, j) in jours.withIndex()) {
                val v = ecSaisies[i]
                val dep = v[1].trim().let { t -> Regex("^(\\d{1,2})\\s*[h:]\\s*(\\d{2})?$").find(t)?.let {
                    "${it.groupValues[1].padStart(2, '0')}:${it.groupValues[2].ifEmpty { "00" }}" } ?: t }
                val f = Buddies.Fiche(j, v[0].trim(), dep, Carnet.lireDuree(v[2]), Carnet.lireKm(v[3]), Carnet.lireMetres(v[4]))
                if ((v[2].isNotBlank() && f.duree == null) || (v[3].isNotBlank() && f.distance == null) || (v[4].isNotBlank() && f.denivele == null) ||
                    (dep.isNotEmpty() && !Regex("^([01]\\d|2[0-3]):[0-5]\\d$").matches(dep))) {
                    toast("Jour ${i + 1} : un chiffre est illisible (départ « 7:10 », durée « 5 h 20 », distance en km, montée en m)"); return@bouton
                }
                val avant = x.carnet.fiches.firstOrNull { it.jour == j }
                if (avant != (if (f.vide) null else f)) fiches += f
            }
            val mien = x.carnet.recits.firstOrNull { buddies.estMoi(it.par) }?.texte ?: ""
            val autres = Triple(ecAutres[0], ecAutres[1], ecAutres[2])
            buddies.enregistrerCarnet(x.id, ecTexte.trim().takeIf { it != mien }, fiches,
                autres.takeIf { it != Triple(x.carnet.difficulte, x.carnet.meteo, x.carnet.conditions) })
            toast(if (enLigne()) "Carnet enregistré" else "Carnet enregistré : il partira au retour du réseau 🕓")
            vue = Vue.LeCarnet(x.id, groupe); afficher(); synchroniser()
        }, lp(8))
    }

    // ---------- Hébergement (spec §5.11, écran 9) ----------
    /** « Où on dort ? » : les idées proposées, un ♥ par buddy, celle qu'on retient (✅). */
    private fun dodo(x: Buddies.Sortie, groupe: String?) {
        val hs = buddies.hebergements().filter { it.sortie == x.id }
        val nuits = maxOf(0, Math.round((jourMs(x.fin) - jourMs(x.debut)) / 86_400_000.0).toInt())
        entete(x.nom, "🏨 ${if (nuits > 0) "$nuits nuit${if (nuits > 1) "s" else ""}" else "sur la journée"} · ${x.participants.size} personne${if (x.participants.size > 1) "s" else ""}",
            retour = true) { if (x.fin < aujourdhui()) vue = Vue.LeCarnet(x.id, groupe) else { onCarte(x, buddies.traces().filter { it.sortie == x.id }); return@entete }; afficher() }
        col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(text("Où on dort ?", 22f, bold = true), LinearLayout.LayoutParams(0, -2, 1f))
            if (hs.isNotEmpty()) addView(text("${hs.size} idée${if (hs.size > 1) "s" else ""}", 15f, muted))
        }, lp(8))
        fun qui(id: String) = x.participants.firstOrNull { it.id == id } ?: Buddies.Buddy(id, "?", null, "membre")
        for (h in hs) col.addView(LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(10), dp(10), dp(10), dp(6))
            background = GradientDrawable().apply { cornerRadius = 16 * d
                if (h.retenu) { setColor(Color.parseColor("#E8F1EC")); setStroke(dp(2), accent) } else { setColor(Color.WHITE); setStroke(dp(2), Color.parseColor("#D9DFDC")) } }
            addView(LinearLayout(a).apply {
                gravity = Gravity.CENTER_VERTICAL; isClickable = true
                setOnClickListener { if (h.url.isNotEmpty()) runCatching { a.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(h.url))) } }
                addView(text(Hebergements.icone(h.nature), 32f).apply {
                    gravity = Gravity.CENTER; background = GradientDrawable().apply { cornerRadius = 12 * d; setColor(Color.parseColor("#E3EEF7")) }
                }, LinearLayout.LayoutParams(dp(64), dp(64)))
                addView(LinearLayout(a).apply {
                    orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, dp(6), 0)
                    addView(text(h.nom, 17f, bold = true))
                    addView(text(listOf(Hebergements.prix(h.prixNuit), h.nature, h.adresse).filter { it.isNotEmpty() }.joinToString(" · "), 15f, muted))
                    if (h.resume.isNotEmpty()) addView(text(h.resume, 15f, muted))
                }, LinearLayout.LayoutParams(0, -2, 1f))
                if (h.retenu) addView(text("✅", 26f))
            })
            val aime = moiId in h.coeurs
            addView(LinearLayout(a).apply {
                gravity = Gravity.CENTER_VERTICAL
                addView(rond(if (aime) "♥" else "♡", 48, Color.WHITE) { buddies.mettreCoeur(h.id, !aime); afficher(); synchroniser() }.apply {
                    setTextColor(Color.parseColor(if (aime) "#D0464F" else "#9AA29E")); contentDescription = if (aime) "Retirer mon ♥" else "Mettre un ♥"
                })
                addView(LinearLayout(a).apply {
                    gravity = Gravity.CENTER_VERTICAL; setPadding(dp(8), 0, 0, 0)
                    for (c in h.coeurs) { val b = qui(c); addView(visage(b.id, b.pseudo, b.photo, 30)) }
                    if (h.coeurs.isEmpty()) addView(text("pas encore de ♥", 15f, muted).apply { isSingleLine = true })
                }, LinearLayout.LayoutParams(0, -2, 1f))
                addView(text(if (h.retenu) "Plus retenu" else "On le prend", 16f, accent, bold = true).apply {
                    minHeight = dp(48); gravity = Gravity.CENTER; setPadding(dp(8), 0, dp(4), 0); isSingleLine = true
                    setOnClickListener {
                        buddies.retenirHebergement(h.id, !h.retenu)
                        toast(if (h.retenu) "« ${h.nom} » n'est plus retenu" else "✅ On dort à « ${h.nom} »"); afficher(); synchroniser()
                    }
                })
            }, lp(6))
            if (h.attente) addView(text("🕓 partira au retour du réseau", 14f, muted))
            if (!h.retenu) addView(text("Retirer l'idée", 15f, muted).apply {
                minHeight = dp(40); gravity = Gravity.CENTER_VERTICAL
                setOnClickListener { buddies.retirerHebergement(h.id); toast("« ${h.nom} » retiré"); afficher(); synchroniser() }
            })
        }, lp(10))
        if (hs.isEmpty()) col.addView(text("Pas encore d'idée : cherche un hébergement, puis « Proposer à mes buddies ». Chacun met un ♥, et vous en retenez un.", 17f, muted), lp(8))
        pied.addView(bouton("🔍 Chercher ${if (hs.isNotEmpty()) "d'autres hébergements" else "un hébergement"}") { onLodging() }, lp(8))
    }

    // ---------- Buddy count (spec §5.10, écran 8) ----------
    private fun depenseCount() { vue = sortieCourante()?.let { Vue.Count(it, groupeCourant()) } ?: Vue.Comptes(groupeCourant()) }
    private fun sortieCourante(): String? = when (val v = vue) {
        is Vue.LeCarnet -> v.id; is Vue.Ecrire -> v.id; is Vue.UnAlbum -> v.id; is Vue.Count -> v.id; is Vue.UneDepense -> v.id; is Vue.Dodo -> v.id; else -> null
    }

    /** Tous les Buddy counts : un par Buddy Time (le plus récent en haut), et l'ancien partage des frais. */
    private fun comptes(groupe: String?) {
        entete("Buddy count", retour = true) { vue = groupe?.let { Vue.UnGroupe(it) } ?: Vue.Liste; afficher() }
        val ds = buddies.depenses()
        val l = buddies.sorties().filter { groupe == null || it.groupe == groupe }.sortedByDescending { it.debut }
        for (x in l) col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL; minimumHeight = dp(64); isClickable = true
            setOnClickListener { vue = Vue.Count(x.id, groupe); afficher() }
            addView(text("💶", 28f).apply { gravity = Gravity.CENTER; layoutParams = LinearLayout.LayoutParams(dp(56), dp(56)) })
            val t = ds.filter { it.sortie == x.id }.sumOf { it.montant }
            addView(LinearLayout(a).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, 0, 0)
                addView(text(x.nom, 17f, bold = true).apply { isSingleLine = true })
                addView(text(if (t > 0) "${BuddyCount.euros(t)} à ${x.participants.size}" else "pas encore de dépense", 15f, muted))
            }, LinearLayout.LayoutParams(0, -2, 1f))
        }, lp(6))
        if (l.isEmpty()) col.addView(text("Chaque Buddy Time a son Buddy count : les dépenses de la sortie, partagées entre vous.", 17f, muted), lp(12))
        pied.addView(bouton("💰 Mes partages de frais hors Buddy Time") { onExpenses() }, lp(8))
    }

    /** Un Buddy count (écran 8) : équilibres en barres, « qui doit à qui », dépenses, « ＋ Dépense ». */
    private fun count(x: Buddies.Sortie, groupe: String?) {
        val ds = buddies.depenses().filter { it.sortie == x.id }
        val c = BuddyCount.compte(x, ds, buddies.moi ?: "moi")
        entete(x.nom, "💶 ${BuddyCount.euros(c.total)} à ${x.participants.size}", retour = true) { vue = Vue.Comptes(groupe); afficher() }
        fun qui(id: String) = x.participants.firstOrNull { it.id == id } ?: Buddies.Buddy(id, "?", null, "membre")
        col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(text("Équilibres", 22f, bold = true), LinearLayout.LayoutParams(0, -2, 1f))
            addView(text("${BuddyCount.euros(c.chacun)} chacun", 15f, muted))
        }, lp(8))
        val max = maxOf(0.01, c.soldes.values.maxOfOrNull { Math.abs(it) } ?: 0.01)
        val vert = Color.parseColor("#2F9E64"); val rouge = Color.parseColor("#E4572E")
        for (p in x.participants) {
            val v = c.soldes[p.id] ?: 0.0
            val l = (Math.abs(v) / max * 50).toFloat().coerceAtLeast(2f)
            col.addView(LinearLayout(a).apply {
                gravity = Gravity.CENTER_VERTICAL
                addView(visage(p.id, p.pseudo, p.photo, 44))
                addView(LinearLayout(a).apply {
                    background = GradientDrawable().apply { cornerRadius = 7 * d; setColor(card) }
                    fun vide(w: Float) = View(a).apply { layoutParams = LinearLayout.LayoutParams(0, -1, w) }
                    val barre = View(a).apply {
                        background = GradientDrawable().apply { cornerRadius = 7 * d; setColor(if (v >= 0) vert else rouge) }
                        layoutParams = LinearLayout.LayoutParams(0, -1, l)
                    }
                    if (v >= 0) { addView(vide(50f)); addView(barre); addView(vide(50f - l)) } else { addView(vide(50f - l)); addView(barre); addView(vide(50f)) }
                }, LinearLayout.LayoutParams(0, dp(14), 1f).apply { setMargins(dp(10), 0, dp(10), 0) })
                val cs = Math.round(v * 100).toInt()
                addView(text((if (cs > 0) "+" else "") + BuddyCount.euros(cs), 19f, if (cs > 0) Color.parseColor("#2F7D4F") else if (cs < 0) Color.parseColor("#C2410C") else ink, bold = true)
                    .apply { gravity = Gravity.END; minWidth = dp(84) })
            }, lp(6))
        }
        for (s in c.virements) col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL; setPadding(dp(12), dp(10), dp(12), dp(10))
            background = GradientDrawable().apply { cornerRadius = 16 * d; setColor(card) }
            val de = qui(s.from); val vers = qui(s.to)
            addView(visage(de.id, de.pseudo, de.photo, 40))
            addView(text(" → ", 17f, muted))
            addView(visage(vers.id, vers.pseudo, vers.photo, 40))
            addView(text("${de.pseudo} doit à ${vers.pseudo}", 17f).apply { setPadding(dp(10), 0, dp(6), 0) }, LinearLayout.LayoutParams(0, -2, 1f))
            addView(text(BuddyCount.euros(Math.round(s.amount * 100).toInt()), 19f, bold = true))
        }, lp(8))
        if (ds.isNotEmpty() && c.virements.isEmpty()) col.addView(text("Tout est équilibré.", 15f, muted), lp(6))
        col.addView(section("Dépenses"), lp(14))
        for (dp0 in ds) col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL; minimumHeight = dp(60); isClickable = true
            setOnClickListener { depenseReset(x, dp0); vue = Vue.UneDepense(x.id, dp0.id, groupe); afficher() }
            addView(text(BuddyCount.icone(dp0.titre), 28f).apply { gravity = Gravity.CENTER; layoutParams = LinearLayout.LayoutParams(dp(44), -2) })
            addView(LinearLayout(a).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(10), 0, dp(6), 0)
                addView(text(dp0.titre, 17f).apply { isSingleLine = true })
                addView(text("payé par ${qui(dp0.payePar).pseudo}" + (if (dp0.pour.size < x.participants.size) " · pour ${dp0.pour.size}" else "") +
                    if (dp0.attente) " · 🕓" else "", 15f, muted).apply { isSingleLine = true })
            }, LinearLayout.LayoutParams(0, -2, 1f))
            addView(text(BuddyCount.euros(dp0.montant), 18f, bold = true))
        }, lp(4))
        if (ds.isEmpty()) col.addView(text("Pas encore de dépense : le gîte, l'essence, les courses… chacun ajoute ce qu'il a payé.", 17f, muted), lp(8))
        pied.addView(bouton("＋ Dépense", primaire = true) { depenseReset(x, null); vue = Vue.UneDepense(x.id, null, groupe); afficher() }, lp(8))
    }

    // Une dépense : ce qui est tapé reste là pendant la synchro.
    private var dpTitre = ""
    private var dpMontant = ""
    private var dpPaye = ""
    private var dpPour = mutableSetOf<String>()
    private var dpJour = ""
    private fun depenseReset(x: Buddies.Sortie, dep: Buddies.Depense?) {
        val moi = buddies.moi ?: "moi"
        dpTitre = dep?.titre ?: ""
        dpMontant = dep?.let { BuddyCount.euros(it.montant).removeSuffix(" €") } ?: ""
        dpPaye = dep?.payePar ?: (if (x.participants.any { it.id == moi }) moi else x.participants.firstOrNull()?.id ?: moi)
        dpPour = (dep?.pour ?: x.participants.map { it.id }).toMutableSet()
        val auj = aujourdhui()
        dpJour = dep?.jour ?: if (auj < x.debut) x.debut else if (auj > x.fin) x.fin else auj
    }

    /** Ajouter ou corriger une dépense : quoi, combien, qui a payé, pour qui, le jour. */
    private fun uneDepense(x: Buddies.Sortie, dep: Buddies.Depense?, groupe: String?) {
        if (dpJour.isEmpty()) depenseReset(x, dep)
        val retour = { dpJour = ""; vue = Vue.Count(x.id, groupe); afficher() }
        entete(if (dep != null) "La dépense" else "Nouvelle dépense", x.nom, retour = true) { retour() }
        col.addView(text("Quoi", 14f, muted), lp(8))
        val icone = text(BuddyCount.icone(dpTitre), 28f)
        col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(icone)
            addView(champ(dpTitre, "Gîte, essence, courses…") { dpTitre = it; icone.text = BuddyCount.icone(it) }, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(8) })
        })
        col.addView(text("Combien (€)", 14f, muted), lp(8))
        val chacun = text("", 14f, muted)
        fun majChacun() { chacun.text = BuddyCount.lireEuros(dpMontant)?.takeIf { dpPour.isNotEmpty() }?.let { " · ${BuddyCount.euros(Math.round(it.toDouble() / dpPour.size).toInt())} chacun" } ?: "" }
        col.addView(champ(dpMontant, "0") { dpMontant = it; majChacun() }.apply {
            textSize = 28f; setTypeface(typeface, Typeface.BOLD); inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
            keyListener = android.text.method.DigitsKeyListener.getInstance("0123456789,.")
        })
        fun visages(choisi: (String) -> Boolean, f: (String) -> Unit) = android.widget.HorizontalScrollView(a).apply {
            addView(LinearLayout(a).apply {
                for (p in x.participants) addView(LinearLayout(a).apply {
                    orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(dp(6), dp(4), dp(6), dp(4)); isClickable = true
                    val oui = choisi(p.id)
                    addView(FrameLayout(a).apply {
                        setPadding(dp(3), dp(3), dp(3), dp(3))
                        if (oui) background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(accent) }
                        addView(visage(p.id, p.pseudo, p.photo, 48, pale = !oui))
                    })
                    addView(text((if (oui) "✓ " else "") + p.pseudo, 14f))
                    setOnClickListener { f(p.id) }
                })
            })
        }
        col.addView(section("Payé par"), lp(12))
        col.addView(visages({ it == dpPaye }) { dpPaye = it; afficher() }, lp(4))
        col.addView(LinearLayout(a).apply { addView(section("Pour qui")); addView(chacun) }, lp(12))
        col.addView(visages({ it in dpPour }) { if (!dpPour.remove(it)) dpPour.add(it); afficher() }, lp(4))
        majChacun()
        col.addView(text("Le jour  ${dateCourte(dpJour)}", 17f, bold = true).apply {
            setPadding(dp(12), dp(12), dp(12), dp(12)); background = GradientDrawable().apply { cornerRadius = 12 * d; setColor(card) }
            setOnClickListener {
                val cal = Calendar.getInstance().apply { timeInMillis = jourMs(dpJour) }
                android.app.DatePickerDialog(a, { _, y, m, j -> dpJour = String.format(Locale.US, "%04d-%02d-%02d", y, m + 1, j); afficher() },
                    cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)).show()
            }
        }, lp(12))
        pied.addView(bouton("Enregistrer", primaire = true) {
            val c = BuddyCount.lireEuros(dpMontant) ?: run { toast("Indique le montant, par exemple 24,50"); return@bouton }
            runCatching { buddies.enregistrerDepense(dep?.id, x.id, dpTitre, c, dpPaye, x.participants.map { it.id }.filter { it in dpPour }, dpJour) }
                .onSuccess { retour(); synchroniser() }.onFailure { toast(it.message ?: "Dépense refusée") }
        }, lp(8))
        if (dep != null) pied.addView(bouton("Retirer la dépense") { buddies.retirerDepense(dep.id); toast("« ${dep.titre} » retirée"); retour(); synchroniser() }, lp(8))
    }

    // En dernier : tout ce qui précède est prêt. Pendant la saisie d'un nouveau groupe, la synchro ne redessine pas l'écran.
    private val desabonner = Buddies.suivre { a.runOnUiThread { if (!saisie) afficher() } }
    private val desabonnerCompte = Compte.suivre { a.runOnUiThread { if (!saisie) afficher() } }
    init { remplirColonne(); afficher() }
    // Ouvert : on regarde les nouveautés toutes les minutes.
    private val minuteur: Job = a.lifecycleScope.launch { while (true) { synchroniser(); delay(60_000) } }
}


/** Pastille de 👥 : nombre de Buddy Groups qui ont bougé (orange, en haut à droite). */
class CountBadge(private val n: Int, private val d: Float) : android.graphics.drawable.Drawable() {
    private val fill = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
    private val txt = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE; textAlign = android.graphics.Paint.Align.CENTER; textSize = 11 * d; isFakeBoldText = true
    }
    override fun draw(c: android.graphics.Canvas) {
        val r = 9 * d
        val cx = bounds.right - r + 3 * d; val cy = bounds.top + r - 3 * d
        fill.color = Color.WHITE; c.drawCircle(cx, cy, r + 2 * d, fill)
        fill.color = Color.parseColor("#E0592A"); c.drawCircle(cx, cy, r, fill)
        c.drawText(if (n > 9) "9+" else "$n", cx, cy + 4 * d, txt)
    }
    override fun setAlpha(alpha: Int) {}
    override fun setColorFilter(cf: android.graphics.ColorFilter?) {}
    @Deprecated("Deprecated in Java")
    override fun getOpacity() = android.graphics.PixelFormat.TRANSLUCENT
}
