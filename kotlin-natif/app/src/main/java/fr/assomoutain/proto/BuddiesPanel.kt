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
) {
    private val d = a.resources.displayMetrics.density
    private fun dp(v: Int) = (v * d).toInt()
    private val ink = Color.parseColor("#1D2421")
    private val muted = Color.parseColor("#5F6B66")
    private val accent = Color.parseColor("#2F6F4F")
    private val card = Color.parseColor("#F2F4F1")
    private val couleurs = listOf("#2F6F4F", "#3F6FB5", "#8A4FB0", "#C9862B", "#2C8C8C", "#B5534A").map(Color::parseColor)

    private sealed class Vue { object Liste : Vue(); data class UnGroupe(val id: String) : Vue(); object Nouveau : Vue() }
    private var vue: Vue = Vue.Liste

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
        listOf("📞" to bientot("appeler toute la bande"), "📅" to bientot("le planning de saison"), "💬" to bientot("la messagerie de la bande"),
            "📸" to bientot("l’album photo"), "💶" to onExpenses, "🏨" to onLodging,
        ).forEach { (t, f) -> colonne.addView(rond(t, 52) { f() }.apply { (layoutParams as LinearLayout.LayoutParams).bottomMargin = dp(12) }) }
    }

    private fun entete(titre: String, sousTitre: String? = null, retour: Boolean) {
        tete.removeAllViews()
        tete.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL
            if (retour) addView(rond("‹") { vue = Vue.Liste; afficher() }.apply { (layoutParams as LinearLayout.LayoutParams).rightMargin = dp(8) })
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
            is Vue.UnGroupe -> gs.firstOrNull { it.id == v.id }?.let { unGroupe(it) } ?: run { vue = Vue.Liste; liste(gs) }
        }
    }

    private fun liste(gs: List<Buddies.Groupe>) {
        val n = buddies.nbAttente
        entete("Buddies", (if (n > 0) "🕓 $n changement${if (n > 1) "s" else ""} partira au retour du réseau · " else "") + heure(buddies.synchro), retour = false)
        if (buddies.rejointsEnAttente > 0) col.addView(text("🕓 Invitation reçue : tu entreras dans le Buddy Group au retour du réseau.", 15f, Color.parseColor("#6B4A00")).apply {
            setPadding(dp(12), dp(9), dp(12), dp(9)); background = GradientDrawable().apply { cornerRadius = 10 * d; setColor(Color.parseColor("#FDF0D5")) }
        }, lp())
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
        pied.addView(bouton("＋  Buddy Group · une bande", primaire = true) { vue = Vue.Nouveau; afficher() }, lp(8))
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
        col.addView(section("À venir"), lp(10))
        col.addView(text(if (g.meTime) "Tes sorties à toi, seul ou avec un ou deux copains invités, viendront ici."
            else "Les Buddy Times de la bande viendront ici : à venir d’abord, puis les souvenirs en images.", 17f, muted), lp(4))
    }

    /** Les buddies d'un groupe (toucher les visages) : inviter, nommer admin, retirer, quitter (spec §5.3). */
    private fun membres(g: Buddies.Groupe) {
        val admin = buddies.estAdmin(g)
        val boite = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(8), dp(16), dp(8)) }
        val dlg = AlertDialog.Builder(a).setView(ScrollView(a).apply { addView(boite) }).setNegativeButton("Fermer", null).create()
        boite.addView(text("Inviter mes copains", 20f, bold = true))
        boite.addView(inviterRangee(g.nom, g.invitations.firstOrNull { it.canal == "qr" }?.code) { i ->
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
    private fun inviterRangee(nomGroupe: () -> String, qrExistant: () -> String?, onInvite: (Buddies.NouvelleInvitation) -> Unit): View {
        fun pret() = nomGroupe().isNotBlank().also { if (!it) toast("Donne d’abord un nom au Buddy Group") }
        fun texte(code: String) = "${compte.nomAffiche()} t'invite dans « ${nomGroupe()} » sur Mountain Buddies, pour nos sorties montagne : ${Buddies.lien(code)}"
        fun envoyer(c: String, nom: String, contact: String) {
            val code = Buddies.nouveauCode()
            val intent = if (c == "mail") Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:" + Uri.encode(contact))).apply {
                putExtra(Intent.EXTRA_SUBJECT, "${compte.nomAffiche()} t'invite dans « ${nomGroupe()} »"); putExtra(Intent.EXTRA_TEXT, texte(code))
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
                addView(text("Tes copains visent ce code avec l'appareil photo de leur téléphone : il installe l'appli et les fait entrer dans la bande.", 15f, muted), lp())
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
    private fun inviterRangee(nomGroupe: String, qrExistant: String?, onInvite: (Buddies.NouvelleInvitation) -> Unit) =
        inviterRangee({ nomGroupe }, { qrExistant }, onInvite)

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

    // En dernier : tout ce qui précède est prêt. Pendant la saisie d'un nouveau groupe, la synchro ne redessine pas l'écran.
    private val desabonner = Buddies.suivre { a.runOnUiThread { if (vue != Vue.Nouveau) afficher() } }
    private val desabonnerCompte = Compte.suivre { a.runOnUiThread { if (vue != Vue.Nouveau) afficher() } }
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
