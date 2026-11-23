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
    /** Revenir sur ce Buddy Group (‹ depuis la carte d'un Buddy Time). */
    depart: String? = null,
    /** Ou ouvrir l'album de ce Buddy Time (📸 Album depuis la carte). */
    departAlbum: String? = null,
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
        data class Albums(val groupe: String?) : Vue(); data class UnAlbum(val id: String, val groupe: String?, val carnet: Boolean = false) : Vue()
    }
    private var vue: Vue = departAlbum?.let { Vue.UnAlbum(it, depart) } ?: depart?.let { Vue.UnGroupe(it) } ?: Vue.Liste
    private val saisie get() = vue == Vue.Nouveau || vue is Vue.NouvelleSortie || vue is Vue.NvPlanning || motOuvert != null

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

    fun fermer() { desabonner(); desabonnerCompte(); minuteur.cancel(); buddies.marquerVu() }

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
        listOf("📞" to bientot("appeler toute la bande"), "📅" to planning, "💬" to bientot("la messagerie de la bande"),
            "📸" to albums, "💶" to onExpenses, "🏨" to onLodging,
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
            setOnClickListener { ouvrir(x) }
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
            paire.forEachIndexed { k, x -> addView(affiche(x, true) { ouvrir(x) }, LinearLayout.LayoutParams(0, dp(120), 1f).apply { if (k == 0) rightMargin = dp(10) }) }
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
    private fun groupeCourant(): String? = when (val v = vue) {
        is Vue.UnGroupe -> v.id; is Vue.Albums -> v.groupe; is Vue.UnAlbum -> v.groupe; else -> bandeCourante()
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
            retour = true) { vue = Vue.Albums(v.groupe); afficher() }
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
