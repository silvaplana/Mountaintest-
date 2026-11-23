package fr.assomoutain.proto

import android.content.SharedPreferences
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/**
 * Buddies, bloc 1 : copie locale des Buddy Groups et file d'attente (spec/buddies.md §3.1).
 * Même fonctionnement que capacitor/src/buddies/store.ts : les garder identiques. Serveur : deploy/comptes/buddies.py.
 *
 * - L'appli n'affiche que la copie locale : sans réseau tout s'ouvre, avec l'heure de la dernière synchro.
 * - Chaque action (créer un groupe, inviter, quitter…) est une opération gardée sur le téléphone, appliquée
 *   tout de suite à l'écran (marquée 🕓), et envoyée au serveur dès qu'il y a du réseau.
 * - Ce qu'on voit = la dernière version du serveur + les opérations pas encore envoyées.
 * - Identifiants et codes d'invitation choisis par le téléphone : on peut inviter par SMS sans réseau,
 *   et renvoyer une opération ne fait jamais de doublon.
 *
 * synchroniser() est bloquante : à appeler hors du fil principal (Dispatchers.IO).
 */
class Buddies(private val prefs: SharedPreferences, private val compte: Compte) {
    companion object {
        const val LIEN_INVITATION = "https://silvaplana.cloud/mountaintest/rejoindre.html?c="
        private const val CLE = "buddies"
        private val abonnes = mutableSetOf<() -> Unit>()
        fun suivre(f: () -> Unit): () -> Unit { abonnes.add(f); return { abonnes.remove(f) } }
        fun lien(code: String) = LIEN_INVITATION + code
        /** Code d'invitation : 20 caractères au hasard (120 bits), assez pour ne pas être deviné. */
        fun nouveauCode(): String = ByteArray(15).also { SecureRandom().nextBytes(it) }
            .let { Base64.encodeToString(it, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP) }
        fun iso(ms: Long): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(ms))
        /** Date ISO du serveur (avec fuseau) → ms ; 0 si illisible. */
        fun ms(iso: String): Long = runCatching { java.time.OffsetDateTime.parse(iso).toInstant().toEpochMilli() }
            .recoverCatching { java.time.Instant.parse(iso).toEpochMilli() }.getOrDefault(0L)

        /**
         * Planning de saison : dates proposées d'un mois à l'autre (« 2026-12 » à « 2027-03 »), les week-ends
         * (samedi-dimanche) ou tous les jours (« à la carte » part de tous les jours, aucun coché). Comme store.ts.
         */
        fun datesPlanning(de: String, a: String, weekends: Boolean): List<Pair<String, String>> {
            val debut = java.time.YearMonth.parse(de).atDay(1)
            val fin = java.time.YearMonth.parse(a).atEndOfMonth()
            val out = mutableListOf<Pair<String, String>>()
            var d = debut
            while (!d.isAfter(fin)) {
                if (!weekends) out += d.toString() to d.toString()
                else if (d.dayOfWeek == java.time.DayOfWeek.SATURDAY) out += d.toString() to d.plusDays(1).toString()
                d = d.plusDays(1)
            }
            return out
        }
        /** Mes dates encore à remplir (pas passées). */
        fun aRemplir(p: Planning, moi: String, auj: String) = p.dates.count { (d, f) -> f >= auj && p.dispos.none { it.qui == moi && it.debut == d } }
        /** Une ligne du planning devenue Buddy Time : le Buddy Time du groupe qui part ce jour-là. */
        fun sortieDeLigne(sorties: List<Sortie>, p: Planning, debut: String) = sorties.firstOrNull { it.groupe == p.groupe && it.debut == debut }
    }

    /** Un Buddy Group tel qu'affiché (version du serveur + opérations en attente). */
    data class Buddy(val id: String, val pseudo: String, val photo: String?, val role: String)
    data class Invitation(val id: String, val code: String, val canal: String, val nom: String, val contact: String, val attente: Boolean)
    data class Groupe(
        val id: String, val nom: String, val nature: String, val photo: String?, val modifie: Long,
        val membres: List<Buddy>, val invitations: List<Invitation>, val attente: Boolean,
    ) { val meTime get() = nature == "me_time" }
    data class NouvelleInvitation(val canal: String, val nom: String, val contact: String, val code: String)
    /** Carnet d'un Buddy Time (spec §5.8) : le texte de chaque buddy, une fiche par jour (facultative), ce que la trace ne dit pas. */
    data class Recit(val par: Buddy, val texte: String, val attente: Boolean)
    /** Ce qui est tapé à la main : duree en minutes, distance et denivele en mètres (null : pris dans la trace du jour). */
    data class Fiche(val jour: String, val nom: String, val depart: String, val duree: Int?, val distance: Int?, val denivele: Int?) {
        val vide get() = nom.isBlank() && depart.isEmpty() && duree == null && distance == null && denivele == null
    }
    data class CarnetBuddy(val difficulte: String = "", val meteo: String = "", val conditions: String = "",
                           val recits: List<Recit> = emptyList(), val fiches: List<Fiche> = emptyList())
    /** Buddy Time (spec §5.4). Dates du calendrier AAAA-MM-JJ. */
    data class Sortie(
        val id: String, val groupe: String, val nom: String, val photo: String?, val debut: String, val fin: String, val lieu: String,
        val modifie: Long, val participants: List<Buddy>, val invitations: List<Invitation>, val attente: Boolean,
        val carnet: CarnetBuddy = CarnetBuddy(),
    )
    /** Trace partagée dans un Buddy Time ou un Buddy Group (panneau de partage, spec §3.4). */
    data class TraceBuddy(
        val id: String, val sortie: String?, val groupe: String?, val nom: String, val ligne: List<LonLat>, val mot: String,
        val par: Buddy, val cree: Long, val attente: Boolean,
    )

    /** Planning de saison (spec §5.5) : etat = oui, peut (peut-être) ou non. */
    data class Dispo(val qui: String, val debut: String, val etat: String, val mot: String)
    data class Planning(
        val id: String, val groupe: String, val nom: String, val par: Buddy, val dates: List<Pair<String, String>>, val limite: String,
        val modifie: Long, val dispos: List<Dispo>, val attente: Boolean,
    )

    /** Photo de l'album d'un Buddy Time (spec §5.8). priseLe : heure locale AAAA-MM-JJTHH:MM:SS. */
    data class PhotoBuddy(
        val id: String, val sortie: String, val par: Buddy, val priseLe: String, val lon: Double?, val lat: Double?,
        val etoile: Boolean, val envoyee: Boolean, val modifie: Long, val attente: Boolean,
    )
    /** Buddy count (spec §5.10) : une dépense d'un Buddy Time ; montant en centimes, pour = identifiants des buddies. */
    data class Depense(
        val id: String, val sortie: String, val titre: String, val montant: Int, val payePar: String, val pour: List<String>, val jour: String,
        val modifie: Long, val attente: Boolean,
    )
    /** 🏨 Hébergement proposé dans un Buddy Time (spec §5.11) : ♥ de chacun (identifiants), retenu. Prix par nuit en euros. */
    data class Hebergement(
        val id: String, val sortie: String, val nom: String, val nature: String, val prixNuit: Int?, val adresse: String, val url: String,
        val resume: String, val lon: Double?, val lat: Double?, val retenu: Boolean, val coeurs: List<String>, val attente: Boolean = false,
        val par: String = "", val cree: Long = 0,
    )
    /** 💬 Message d'un Buddy Group ou d'un Buddy Time (spec §5.6) : nature texte, point (« je suis ici ») ou photo de l'album. */
    data class MessageBuddy(
        val id: String, val groupe: String?, val sortie: String?, val par: String, val nature: String, val texte: String,
        val lon: Double?, val lat: Double?, val photo: String?, val cree: Long, val attente: Boolean = false,
    )
    /** 📍 Position d'un buddy dans un Buddy Time (spec §5.9) : son épingle (ms) et sa dernière position. */
    data class Position(
        val sortie: String, val qui: String, val depuis: Long, val jusqu: Long, val lon: Double?, val lat: Double?, val alt: Int?,
        val priseLe: Long?, val attente: Boolean = false,
    )
    /** Fichiers des photos (posé par MainActivity) : envoyés après chaque synchro. */
    var album: Album? = null

    /** État gardé sur le téléphone (JSON dans les préférences, mêmes champs que store.ts). */
    var etat: JSONObject = runCatching { JSONObject(prefs.getString(CLE, "{}")!!) }.getOrDefault(JSONObject())
        private set

    @Synchronized private fun ecrire(e: JSONObject) {
        etat = e
        prefs.edit().putString(CLE, e.toString()).apply()
        abonnes.toList().forEach { it() }
    }
    @Synchronized private fun modifier(f: JSONObject.() -> Unit) = ecrire(JSONObject(etat.toString()).apply(f))

    private fun serveur() = etat.optJSONArray("serveur") ?: JSONArray()
    private fun attente() = etat.optJSONArray("attente") ?: JSONArray()
    val moi: String? get() = etat.optString("moi").ifEmpty { null }

    /** 📞 Appel en cours dans un de mes Buddy Groups ou Buddy Times (d'après la dernière synchro). */
    data class AppelBuddy(val id: String, val groupe: String?, val sortie: String?, val enLigne: List<String>)
    fun appels(): List<AppelBuddy> = etat.optJSONArray("appels").objets().filter { !it.optBoolean("fini") }.map { o ->
        fun cle(k: String) = o.optString(k).takeIf { it.isNotEmpty() && it != "null" }
        val l = o.optJSONArray("en_ligne")
        AppelBuddy(o.getString("id"), cle("groupe"), cle("sortie"), if (l == null) emptyList() else (0 until l.length()).map { l.getString(it) })
    }
    val synchro: Long get() = etat.optLong("synchro")
    val nbAttente: Int get() = attente().length()
    val rejointsEnAttente: Int get() = (0 until attente().length()).count { attente().getJSONObject(it).optString("type") == "rejoindre" }

    /** Déconnexion : on oublie les Buddies de ce compte. */
    fun oublierSiDeconnecte() { if (!compte.connecte && (serveur().length() > 0 || attente().length() > 0)) ecrire(JSONObject()) }

    private fun moiBuddy() = Buddy(moi ?: "moi", compte.nomAffiche(), compte.profil?.optString("photo")?.takeIf { it.isNotEmpty() && it != "null" }, "admin")

    private fun lireGroupe(g: JSONObject) = Groupe(
        g.getString("id"), g.optString("nom"), g.optString("nature", "bande"), g.optString("photo").takeIf { it.isNotEmpty() && it != "null" },
        ms(g.optString("modifie_le")),
        g.optJSONArray("membres").objets().map { Buddy(it.getString("id"), it.optString("pseudo"), it.optString("photo").takeIf { p -> p.isNotEmpty() && p != "null" }, it.optString("role", "membre")) },
        g.optJSONArray("invitations").objets().map { Invitation(it.getString("id"), it.optString("code"), it.optString("canal", "lien"), it.optString("nom"), it.optString("contact"), false) },
        false,
    )
    private fun JSONArray?.objets(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).map { getJSONObject(it) }

    /** Applique les opérations en attente à la version du serveur : ce que montre l'écran. */
    fun groupes(): List<Groupe> {
        val gs = serveur().objets().map(::lireGroupe).toMutableList()
        fun idx(id: Any?) = gs.indexOfFirst { it.id == id?.toString() }
        for (op in attente().objets()) {
            val i = idx(op.opt("groupe"))
            when (op.optString("type")) {
                "creer_groupe" -> if (i < 0) gs += Groupe(op.getString("groupe"), op.optString("nom"), "bande",
                    op.optString("photo").takeIf { it.isNotEmpty() && it != "null" }, op.optLong("t"), listOf(moiBuddy()), emptyList(), true)
                "inviter" -> if (!op.has("sortie") && i >= 0 && gs[i].invitations.none { it.id == op.optString("invitation") }) gs[i] = gs[i].copy(
                    invitations = gs[i].invitations + Invitation(op.getString("invitation"), op.optString("code"), op.optString("canal"), op.optString("nom"), op.optString("contact"), true),
                    modifie = op.optLong("t"))
                "annuler_invitation" -> for (k in gs.indices) gs[k] = gs[k].copy(invitations = gs[k].invitations.filter { it.id != op.optString("invitation") })
                "quitter" -> if (i >= 0) gs.removeAt(i)
                "retirer" -> if (i >= 0) gs[i] = gs[i].copy(membres = gs[i].membres.filter { it.id != op.optString("buddy") })
                "nommer_admin" -> if (i >= 0) gs[i] = gs[i].copy(membres = gs[i].membres.map { if (it.id == op.optString("buddy")) it.copy(role = "admin") else it })
            }
        }
        // Me Time existe toujours, même avant la première synchro.
        if (gs.none { it.meTime }) gs += Groupe("me-time", "Me Time", "me_time", null, 0L, listOf(moiBuddy()), emptyList(), false)
        // Façon WhatsApp : le plus récemment actif en haut.
        return gs.sortedByDescending { it.modifie }
    }

    /** Nombre de Buddy Groups et Buddy Times qui ont bougé depuis la dernière ouverture de Buddies (pastille de 👥). */
    fun nouveautes(): Int {
        val vu = etat.optLong("vu")
        return serveur().objets().count { it.optString("nature") == "bande" && ms(it.optString("modifie_le")) > vu } +
            etat.optJSONArray("sorties").objets().count { ms(it.optString("modifie_le")) > vu } +
            etat.optJSONArray("plannings").objets().count { ms(it.optString("modifie_le")) > vu }
    }

    private fun lireBuddy(b: JSONObject) = Buddy(b.getString("id"), b.optString("pseudo"), b.optString("photo").takeIf { it.isNotEmpty() && it != "null" }, b.optString("role", "membre"))
    private fun lireInvitation(i: JSONObject, attente: Boolean = false) = Invitation(i.getString("id"), i.optString("code"), i.optString("canal", "lien"), i.optString("nom"), i.optString("contact"), attente)
    private fun lireLigne(a: JSONArray?) = a.let { l -> if (l == null) emptyList() else (0 until l.length()).map { l.getJSONArray(it).let { p -> LonLat(p.getDouble(0), p.getDouble(1)) } } }
    private fun lireSortie(x: JSONObject) = Sortie(x.getString("id"), x.optString("groupe"), x.optString("nom"), x.optString("photo").takeIf { it.isNotEmpty() && it != "null" },
        x.optString("debut"), x.optString("fin"), x.optString("lieu"), ms(x.optString("modifie_le")),
        x.optJSONArray("participants").objets().map(::lireBuddy), x.optJSONArray("invitations").objets().map { lireInvitation(it) }, false,
        x.optJSONObject("carnet")?.let(::lireCarnet) ?: CarnetBuddy())
    private fun entierOuNul(o: JSONObject, k: String) = if (o.isNull(k) || !o.has(k)) null else o.optInt(k)
    private fun lireFiche(f: JSONObject) = Fiche(f.optString("jour"), f.optString("nom"), f.optString("depart"),
        entierOuNul(f, "duree"), entierOuNul(f, "distance"), entierOuNul(f, "denivele"))
    private fun lireCarnet(c: JSONObject) = CarnetBuddy(c.optString("difficulte"), c.optString("meteo"), c.optString("conditions"),
        c.optJSONArray("recits").objets().map { Recit(lireBuddy(it.optJSONObject("par") ?: JSONObject().put("id", "?")), it.optString("texte"), false) },
        c.optJSONArray("fiches").objets().map(::lireFiche))
    private fun lireTrace(t: JSONObject) = TraceBuddy(t.getString("id"), t.optString("sortie").takeIf { it.isNotEmpty() && it != "null" },
        t.optString("groupe").takeIf { it.isNotEmpty() && it != "null" }, t.optString("nom"), lireLigne(t.optJSONArray("ligne")), t.optString("mot"),
        lireBuddy(t.optJSONObject("par") ?: JSONObject().put("id", "?")), ms(t.optString("cree_le")), false)

    /** Buddy Times tels qu'affichés (version du serveur + opérations en attente), le plus récemment actif en haut. */
    fun sorties(): List<Sortie> {
        val groupes = groupes()
        val meTime = groupes.first { it.meTime }
        val l = etat.optJSONArray("sorties").objets().map(::lireSortie).toMutableList()
        for (op in attente().objets()) when (op.optString("type")) {
            "creer_sortie" -> if (l.none { it.id == op.optString("sortie") }) {
                val g = groupes.firstOrNull { it.id == op.optString("groupe") } ?: meTime
                val qui = op.optJSONArray("participants").let { a -> if (a == null) emptySet() else (0 until a.length()).map { a.getString(it) }.toSet() }
                l += Sortie(op.getString("sortie"), g.id, op.optString("nom"), op.optString("photo").takeIf { it.isNotEmpty() && it != "null" },
                    op.optString("debut"), op.optString("fin"), op.optString("lieu"), op.optLong("t"),
                    listOf(moiBuddy()) + g.membres.filter { it.id in qui && !estMoi(it) }, emptyList(), true)
            }
            "inviter" -> if (op.has("sortie")) {
                val k = l.indexOfFirst { it.id == op.optString("sortie") }
                if (k >= 0 && l[k].invitations.none { it.id == op.optString("invitation") })
                    l[k] = l[k].copy(invitations = l[k].invitations + Invitation(op.optString("invitation"), op.optString("code"),
                        op.optString("canal"), op.optString("nom"), op.optString("contact"), true))
            }
            "partager_trace" -> {
                val k = l.indexOfFirst { it.id == op.optString("sortie") }
                if (k >= 0) l[k] = l[k].copy(modifie = op.optLong("t"))
            }
            "recit", "fiche", "carnet" -> l.indexOfFirst { it.id == op.optString("sortie") }.takeIf { it >= 0 }?.let { k ->
                val c = l[k].carnet
                val c2 = when (op.optString("type")) {
                    "recit" -> c.copy(recits = c.recits.filter { !estMoi(it.par) } +
                        listOfNotNull(op.optString("texte").takeIf { it.isNotEmpty() }?.let { Recit(moiBuddy(), it, true) }))
                    "fiche" -> lireFiche(op).let { f -> c.copy(fiches = (c.fiches.filter { it.jour != f.jour } + listOfNotNull(f.takeIf { !it.vide })).sortedBy { it.jour }) }
                    else -> c.copy(difficulte = op.optString("difficulte"), meteo = op.optString("meteo"), conditions = op.optString("conditions"))
                }
                l[k] = l[k].copy(carnet = c2, modifie = op.optLong("t"), attente = true)
            }
        }
        return l.sortedByDescending { it.modifie }
    }

    /** Traces partagées telles qu'affichées (version du serveur + partages en attente). */
    fun traces(): List<TraceBuddy> {
        val l = etat.optJSONArray("traces").objets().map(::lireTrace).toMutableList()
        for (op in attente().objets()) if (op.optString("type") == "partager_trace" && l.none { it.id == op.optString("trace") })
            l += TraceBuddy(op.getString("trace"), op.optString("sortie").takeIf { it.isNotEmpty() }, op.optString("groupe").takeIf { it.isNotEmpty() },
                op.optString("nom"), lireLigne(op.optJSONArray("ligne")), op.optString("mot"), moiBuddy(), op.optLong("t"), true)
        return l
    }
    private fun lireDates(a: JSONArray?) = a.let { l -> if (l == null) emptyList() else (0 until l.length()).map { l.getJSONArray(it).let { p -> p.getString(0) to p.getString(1) } } }
    private fun lirePlanning(p: JSONObject) = Planning(p.getString("id"), p.optString("groupe"), p.optString("nom"),
        lireBuddy(p.optJSONObject("par") ?: JSONObject().put("id", "?")), lireDates(p.optJSONArray("dates")), p.optString("limite"),
        ms(p.optString("modifie_le")), p.optJSONArray("dispos").objets().map { Dispo(it.optString("qui"), it.optString("debut"), it.optString("etat"), it.optString("mot")) }, false)

    /** Plannings de saison tels qu'affichés (version du serveur + mes réponses en attente). */
    fun plannings(): List<Planning> {
        val l = etat.optJSONArray("plannings").objets().map(::lirePlanning).toMutableList()
        val m = moi ?: "moi"
        for (op in attente().objets()) when (op.optString("type")) {
            "creer_planning" -> if (l.none { it.id == op.optString("planning") }) l += Planning(op.getString("planning"), op.optString("groupe"),
                op.optString("nom"), moiBuddy(), lireDates(op.optJSONArray("dates")), op.optString("limite"), op.optLong("t"), emptyList(), true)
            "dispo" -> {
                val k = l.indexOfFirst { it.id == op.optString("planning") }
                if (k >= 0) {
                    val debut = op.optString("debut")
                    val autres = l[k].dispos.filter { !(it.qui == m && it.debut == debut) }
                    val e = op.optString("etat")
                    l[k] = l[k].copy(dispos = if (e.isEmpty()) autres else autres + Dispo(m, debut, e, op.optString("mot")), attente = true)
                }
            }
        }
        return l.sortedByDescending { it.modifie }
    }
    private fun lirePhoto(p: JSONObject) = PhotoBuddy(p.getString("id"), p.optString("sortie"),
        lireBuddy(p.optJSONObject("par") ?: JSONObject().put("id", "?")), p.optString("prise_le"),
        if (p.isNull("lon")) null else p.optDouble("lon"), if (p.isNull("lat")) null else p.optDouble("lat"),
        p.optBoolean("etoile"), p.optBoolean("envoyee"), ms(p.optString("modifie_le")), false)
    private fun envois() = etat.optJSONArray("envois").let { a -> if (a == null) emptyList() else (0 until a.length()).map { a.getString(it) } }

    /** Photos telles qu'affichées (version du serveur + mes dépôts, ⭐ et retraits en attente), dans l'ordre de prise de vue. */
    fun photos(): List<PhotoBuddy> {
        val l = etat.optJSONArray("photos").objets().map(::lirePhoto).toMutableList()
        for (op in attente().objets()) when (op.optString("type")) {
            "ajouter_photo" -> if (l.none { it.id == op.optString("photo") }) l += PhotoBuddy(op.getString("photo"), op.optString("sortie"), moiBuddy(),
                op.optString("prise_le"), if (op.isNull("lon")) null else op.optDouble("lon"), if (op.isNull("lat")) null else op.optDouble("lat"),
                false, false, op.optLong("t"), true)
            "etoile" -> { val k = l.indexOfFirst { it.id == op.optString("photo") }; if (k >= 0) l[k] = l[k].copy(etoile = op.optBoolean("etoile")) }
            "retirer_photo" -> l.removeAll { it.id == op.optString("photo") }
        }
        val e = envois().toSet()
        return l.map { if (it.id in e) it.copy(attente = true) else it }.sortedBy { it.priseLe }
    }
    private fun chaines(a: JSONArray?) = if (a == null) emptyList() else (0 until a.length()).map { a.getString(it) }
    private fun lireDepense(x: JSONObject, attente: Boolean = false, t: Long? = null) = Depense(x.optString("depense").ifEmpty { x.getString("id") },
        x.optString("sortie"), x.optString("titre"), x.optInt("montant"), x.optString("paye_par"), chaines(x.optJSONArray("pour")), x.optString("jour"),
        t ?: ms(x.optString("modifie_le")), attente)

    /** Dépenses telles qu'affichées (version du serveur + mes ajouts, corrections et retraits en attente), le dernier jour en haut. */
    fun depenses(): List<Depense> {
        val l = etat.optJSONArray("depenses").objets().map { lireDepense(it) }.toMutableList()
        for (op in attente().objets()) when (op.optString("type")) {
            "depense" -> {
                val avant = l.firstOrNull { it.id == op.optString("depense") }
                l.removeAll { it.id == op.optString("depense") }
                l += lireDepense(op, true, op.optLong("t")).let { if (avant != null) it.copy(sortie = avant.sortie) else it }
            }
            "retirer_depense" -> l.removeAll { it.id == op.optString("depense") }
        }
        return l.sortedWith(compareByDescending<Depense> { it.jour }.thenByDescending { it.modifie })
    }
    private fun nombre(o: JSONObject, k: String) = if (o.isNull(k) || !o.has(k)) null else o.optDouble(k)
    private fun lirePosition(o: JSONObject) = Position(o.optString("sortie"), o.optString("qui"), o.optLong("depuis"), o.optLong("jusqu"),
        nombre(o, "lon"), nombre(o, "lat"), nombre(o, "alt")?.let { Math.round(it).toInt() }, if (o.isNull("prise_le")) null else o.optLong("prise_le"))

    private fun lireHebergement(o: JSONObject) = Hebergement(o.getString("id"), o.optString("sortie"), o.optString("nom"), o.optString("nature"),
        nombre(o, "prix_nuit")?.let { Math.round(it).toInt() }, o.optString("adresse"), o.optString("url"), o.optString("resume"),
        nombre(o, "lon"), nombre(o, "lat"), o.optBoolean("retenu"), chaines(o.optJSONArray("coeurs")), par = o.optString("par"),
        cree = o.optString("cree_le").takeIf { it.isNotEmpty() && it != "null" }?.let { ms(it) } ?: ms(o.optString("modifie_le")))
    private fun texteOuNul(o: JSONObject, k: String) = o.optString(k).takeIf { it.isNotEmpty() && it != "null" }
    private fun lireMessage(o: JSONObject) = MessageBuddy(o.getString("id"), texteOuNul(o, "groupe"), texteOuNul(o, "sortie"), o.optString("par"),
        o.optString("nature", "texte"), o.optString("texte"), nombre(o, "lon"), nombre(o, "lat"), texteOuNul(o, "photo"), ms(o.optString("cree_le")))
    /** 💬 Messages tels qu'affichés (version du serveur + mes envois en attente), du plus ancien au plus récent. */
    fun messages(): List<MessageBuddy> {
        val me = moi ?: "moi"
        val l = etat.optJSONArray("messages").objets().map(::lireMessage).toMutableList()
        for (op in attente().objets()) when (op.optString("type")) {
            "message" -> if (l.none { it.id == op.optString("message") })
                l += lireMessage(JSONObject(op.toString()).put("id", op.optString("message")).put("par", me)).copy(cree = op.optLong("t"), attente = true)
            "retirer_message" -> l.removeAll { it.id == op.optString("message") }
        }
        return l.sortedBy { it.cree }
    }
    /** 🏨 Hébergements tels qu'affichés : le retenu en haut, puis les plus aimés, puis les moins chers. */
    fun hebergements(): List<Hebergement> {
        val me = moi ?: "moi"
        var l = etat.optJSONArray("hebergements").objets().map { lireHebergement(it) }
        for (op in attente().objets()) {
            val h = op.optString("hebergement")
            when (op.optString("type")) {
                "proposer_hebergement" -> if (l.none { it.id == h }) l = l + lireHebergement(JSONObject(op.toString()).put("id", h)).copy(attente = true, par = me, cree = op.optLong("t"))
                "coeur" -> l = l.map { if (it.id != h) it else it.copy(coeurs = it.coeurs.filter { c -> c != me } + if (op.optBoolean("coeur")) listOf(me) else emptyList(), attente = true) }
                "retenir_hebergement" -> l.firstOrNull { it.id == h }?.let { x ->
                    l = l.map { if (it.id == h) it.copy(retenu = op.optBoolean("retenu"), attente = true) else if (it.sortie == x.sortie && op.optBoolean("retenu")) it.copy(retenu = false) else it }
                }
                "retirer_hebergement" -> l = l.filter { it.id != h }
            }
        }
        return l.sortedWith(compareByDescending<Hebergement> { it.retenu }.thenByDescending { it.coeurs.size }.thenBy { it.prixNuit ?: Int.MAX_VALUE })
    }
    /** 📍 Positions telles qu'affichées : celles du serveur, avec mon épingle et ma dernière position en attente. */
    fun positions(): List<Position> {
        val me = moi ?: "moi"
        val l = etat.optJSONArray("positions").objets().map { lirePosition(it) }.toMutableList()
        for (op in attente().objets()) {
            val type = op.optString("type")
            if (type != "epingle" && type != "position") continue
            val sortie = op.optString("sortie")
            val i = l.indexOfFirst { it.sortie == sortie && it.qui == me }
            val p = l.getOrNull(i)
            if (type == "epingle" && op.optBoolean("enfoncee")) {
                val n = Position(sortie, me, op.optLong("quand"), op.optLong("jusqu"), p?.lon, p?.lat, p?.alt, p?.priseLe, true)
                if (i >= 0) l.removeAt(i)
                l += n
            } else if (type == "epingle" && p != null) {
                l[i] = p.copy(jusqu = minOf(p.jusqu, op.optLong("quand")), attente = true)
            } else if (type == "position" && p != null) {
                val t = op.optLong("prise_le")
                if (t > (p.priseLe ?: 0) && t >= p.depuis - 60_000 && t <= p.jusqu + 60_000)
                    l[i] = p.copy(lon = op.optDouble("lon"), lat = op.optDouble("lat"), alt = nombre(op, "alt")?.toInt(), priseLe = t, attente = true)
            }
        }
        return l
    }
    /** Le Buddy Time où mon épingle est enfoncée en ce moment (un seul à la fois). */
    fun monEpingle(t: Long = System.currentTimeMillis()): Position? {
        val me = moi ?: "moi"
        return positions().filter { it.qui == me && it.depuis <= t + 60_000 && it.jusqu > t }.maxByOrNull { it.depuis }
    }
    fun marquerVu() = modifier { put("vu", System.currentTimeMillis()) }

    fun estAdmin(g: Groupe) = g.membres.any { (it.id == moi || it.id == "moi") && it.role == "admin" }
    fun estMoi(b: Buddy) = b.id == moi || b.id == "moi"

    // ------------------------------------------------------------ actions (tout de suite à l'écran)

    private fun ajouter(vararg ops: JSONObject) {
        val t = System.currentTimeMillis()
        modifier {
            val a = optJSONArray("attente") ?: JSONArray()
            for (o in ops) a.put(o.put("id", UUID.randomUUID().toString()).put("t", t))
            put("attente", a)
        }
    }

    private fun invitationOp(groupe: String, i: NouvelleInvitation) = JSONObject().put("type", "inviter").put("groupe", groupe)
        .put("invitation", UUID.randomUUID().toString()).put("canal", i.canal).put("nom", i.nom).put("contact", i.contact).put("code", i.code)

    /** Nouveau Buddy Group avec ses premières invitations (déjà envoyées par SMS, mail ou QR). */
    fun creerGroupe(nom: String, photo: String?, invitations: List<NouvelleInvitation>): String {
        val n = nom.replace(Regex("\\s+"), " ").trim().take(80)
        require(n.isNotEmpty()) { "Donne un nom au Buddy Group" }
        val groupe = UUID.randomUUID().toString()
        ajouter(JSONObject().put("type", "creer_groupe").put("groupe", groupe).put("nom", n).put("photo", photo ?: JSONObject.NULL),
            *invitations.map { invitationOp(groupe, it) }.toTypedArray())
        return groupe
    }
    fun inviter(groupe: String, i: NouvelleInvitation) = ajouter(invitationOp(groupe, i))

    /** Nouveau Buddy Time ; dans Me Time, les copains invités à l'unité (`invitations`). */
    fun creerSortie(groupe: String, nom: String, photo: String?, debut: String, fin: String, lieu: String, participants: List<String>,
                    invitations: List<NouvelleInvitation> = emptyList()): String {
        val n = nom.replace(Regex("\\s+"), " ").trim().take(80)
        require(n.isNotEmpty()) { "Donne un nom au Buddy Time" }
        require(Regex("\\d{4}-\\d{2}-\\d{2}").matches(debut)) { "Choisis la date de départ" }
        val f = if (fin >= debut) fin else debut
        val sortie = UUID.randomUUID().toString()
        ajouter(JSONObject().put("type", "creer_sortie").put("sortie", sortie).put("groupe", groupe).put("nom", n)
            .put("photo", photo ?: JSONObject.NULL).put("debut", debut).put("fin", f).put("lieu", lieu.trim().take(120))
            .put("participants", JSONArray(participants)),
            *invitations.map { invitationOp(groupe, it).put("sortie", sortie) }.toTypedArray())
        return sortie
    }

    /** Partager une trace dans des Buddy Times et des Buddy Groups (un envoi par destination). */
    fun partagerTrace(nom: String, ligne: List<LonLat>, mot: String, sorties: List<String>, groupes: List<String>) {
        fun pts() = JSONArray(ligne.map { JSONArray().put(Math.round(it.lon * 1e5) / 1e5).put(Math.round(it.lat * 1e5) / 1e5) })
        ajouter(*(sorties.map { JSONObject().put("type", "partager_trace").put("trace", UUID.randomUUID().toString()).put("sortie", it) } +
            groupes.map { JSONObject().put("type", "partager_trace").put("trace", UUID.randomUUID().toString()).put("groupe", it) })
            .map { it.put("nom", nom).put("ligne", pts()).put("mot", mot) }.toTypedArray())
    }
    /** Publier un planning de saison pour une bande. */
    fun creerPlanning(groupe: String, nom: String, dates: List<Pair<String, String>>, limite: String): String {
        val n = nom.replace(Regex("\\s+"), " ").trim().take(80)
        require(n.isNotEmpty()) { "Donne un nom au planning" }
        require(dates.isNotEmpty()) { "Coche au moins une date" }
        val planning = UUID.randomUUID().toString()
        ajouter(JSONObject().put("type", "creer_planning").put("planning", planning).put("groupe", groupe).put("nom", n)
            .put("dates", JSONArray(dates.sortedBy { it.first }.map { JSONArray().put(it.first).put(it.second) })).put("limite", limite))
        return planning
    }
    /** Ma réponse pour une date (etat vide : j'efface). */
    fun repondre(planning: String, debut: String, etat: String, mot: String = "") = ajouter(JSONObject().put("type", "dispo")
        .put("planning", planning).put("debut", debut).put("etat", etat).put("mot", mot.trim().take(200)))
    /** Déposer des photos déjà réduites et gardées sur le téléphone (Album) : elles partent au retour du réseau. */
    fun deposerPhotos(sortie: String, l: List<Triple<String, String, Pair<Double?, Double?>>>) {
        if (l.isEmpty()) return
        modifier { put("envois", JSONArray(envois() + l.map { it.first })) }
        ajouter(*l.map { (id, quand, pos) -> JSONObject().put("type", "ajouter_photo").put("sortie", sortie).put("photo", id).put("prise_le", quand)
            .put("lon", pos.first ?: JSONObject.NULL).put("lat", pos.second ?: JSONObject.NULL) }.toTypedArray())
    }
    fun mettreEtoile(photo: String, etoile: Boolean) = ajouter(JSONObject().put("type", "etoile").put("photo", photo).put("etoile", etoile))
    fun retirerPhoto(photo: String) {
        modifier { put("envois", JSONArray(envois().filter { it != photo })) }
        ajouter(JSONObject().put("type", "retirer_photo").put("photo", photo))
        album?.oublier(photo)
    }
    /**
     * Enregistrer le carnet (écran 14) : seulement ce qui a changé. Mon texte (vide : je l'efface), les fiches des jours
     * (toute vide : elle disparaît), difficulté, météo et conditions.
     */
    fun enregistrerCarnet(sortie: String, recit: String?, fiches: List<Fiche>, autres: Triple<String, String, String>?) {
        val ops = mutableListOf<JSONObject>()
        if (recit != null) ops += JSONObject().put("type", "recit").put("sortie", sortie).put("texte", recit.trim().take(5000))
        for (f in fiches) ops += JSONObject().put("type", "fiche").put("sortie", sortie).put("jour", f.jour).put("nom", f.nom.trim().take(80))
            .put("depart", f.depart).put("duree", f.duree ?: JSONObject.NULL).put("distance", f.distance ?: JSONObject.NULL)
            .put("denivele", f.denivele ?: JSONObject.NULL)
        if (autres != null) ops += JSONObject().put("type", "carnet").put("sortie", sortie).put("difficulte", autres.first.trim())
            .put("meteo", autres.second.trim()).put("conditions", autres.third.trim())
        if (ops.isNotEmpty()) ajouter(*ops.toTypedArray())
    }
    /** Buddy count : ajouter (depense = null) ou corriger une dépense ; montant en centimes. Rend son identifiant. */
    fun enregistrerDepense(depense: String?, sortie: String, titre: String, montant: Int, payePar: String, pour: List<String>, jour: String): String {
        require(montant > 0) { "Indique le montant" }
        require(pour.isNotEmpty()) { "Coche au moins un buddy" }
        val id = depense ?: UUID.randomUUID().toString()
        ajouter(JSONObject().put("type", "depense").put("depense", id).put("sortie", sortie)
            .put("titre", titre.replace(Regex("\\s+"), " ").trim().take(80).ifEmpty { "Dépense" }).put("montant", montant)
            .put("paye_par", payePar).put("pour", JSONArray(pour)).put("jour", jour))
        return id
    }
    /** 📍 Enfoncer l'épingle dans ce Buddy Time jusqu'à ce soir (et la relever ailleurs : une seule à la fois). */
    fun enfoncerEpingle(sortie: String, t: Long = System.currentTimeMillis()) {
        val autre = monEpingle(t)
        val ops = mutableListOf<JSONObject>()
        if (autre != null && autre.sortie != sortie) ops += JSONObject().put("type", "epingle").put("sortie", autre.sortie).put("enfoncee", false).put("quand", t)
        ops += JSONObject().put("type", "epingle").put("sortie", sortie).put("enfoncee", true).put("quand", t).put("jusqu", Positions.finEpingle(t))
        ajouter(*ops.toTypedArray())
    }
    fun releverEpingle(sortie: String, t: Long = System.currentTimeMillis()) =
        ajouter(JSONObject().put("type", "epingle").put("sortie", sortie).put("enfoncee", false).put("quand", t))
    /** Une position du GPS pendant que l'épingle est enfoncée : seule la dernière attend le réseau. */
    fun envoyerPosition(lat: Double, lon: Double, alt: Double?, t: Long) {
        val p = monEpingle(t) ?: return
        val op = JSONObject().put("type", "position").put("sortie", p.sortie).put("lat", Math.round(lat * 1e6) / 1e6)
            .put("lon", Math.round(lon * 1e6) / 1e6).put("alt", alt?.let { Math.round(it) } ?: JSONObject.NULL).put("prise_le", t)
            .put("id", UUID.randomUUID().toString()).put("t", System.currentTimeMillis())
        modifier { put("attente", JSONArray((optJSONArray("attente") ?: JSONArray()).objets().filter { it.optString("type") != "position" } + op)) }
    }
    /** 🏨 Proposer un hébergement (trouvé par la recherche) dans un ou plusieurs Buddy Times. */
    fun proposerHebergement(sorties: List<String>, l: Lodging, lon: Double?, lat: Double?) {
        if (sorties.isEmpty()) return
        ajouter(*sorties.map { sortie ->
            JSONObject().put("type", "proposer_hebergement").put("hebergement", UUID.randomUUID().toString()).put("sortie", sortie)
                .put("nom", l.nom.trim().take(80)).put("nature", l.type.take(40)).put("prix_nuit", l.prixNuit?.let { Math.round(it) } ?: JSONObject.NULL)
                .put("adresse", l.adresse.take(160)).put("url", if (Regex("^https?://").containsMatchIn(l.url)) l.url.take(500) else "")
                .put("resume", l.resume.take(300)).put("lon", lon ?: JSONObject.NULL).put("lat", lat ?: JSONObject.NULL)
        }.toTypedArray())
    }
    /** 💬 Envoyer dans la conversation d'un Buddy Group ou d'un Buddy Time ; part au retour du réseau. */
    fun envoyerMessage(groupe: String?, sortie: String?, nature: String = "texte", texte: String = "", lon: Double? = null, lat: Double? = null, photo: String? = null) {
        val t = texte.trim().take(2000)
        if (nature == "texte" && t.isEmpty()) return
        val op = JSONObject().put("type", "message").put("message", UUID.randomUUID().toString()).put("nature", nature).put("texte", t)
        if (sortie != null) op.put("sortie", sortie) else op.put("groupe", groupe)
        if (lon != null && lat != null) op.put("lon", Math.round(lon * 1e6) / 1e6).put("lat", Math.round(lat * 1e6) / 1e6)
        if (photo != null) op.put("photo", photo)
        ajouter(op)
    }
    fun retirerMessage(message: String) = ajouter(JSONObject().put("type", "retirer_message").put("message", message))
    /** Conversation lue jusqu'à maintenant. */
    fun marquerLu(cle: String, t: Long = System.currentTimeMillis()) = modifier { put("lus", (optJSONObject("lus") ?: JSONObject()).put(cle, t)) }
    /** Messages des autres arrivés depuis ma dernière lecture de cette conversation. */
    fun nonLus(cle: String, l: List<MessageBuddy> = messages()): Int {
        val me = moi ?: "moi"
        val lu = etat.optJSONObject("lus")?.optLong(cle) ?: 0L
        return l.count { (it.groupe == cle || it.sortie == cle) && it.par != me && it.cree > lu }
    }
    fun mettreCoeur(h: String, coeur: Boolean) = ajouter(JSONObject().put("type", "coeur").put("hebergement", h).put("coeur", coeur))
    fun retenirHebergement(h: String, retenu: Boolean) = ajouter(JSONObject().put("type", "retenir_hebergement").put("hebergement", h).put("retenu", retenu))
    fun retirerHebergement(h: String) = ajouter(JSONObject().put("type", "retirer_hebergement").put("hebergement", h))
    fun retirerDepense(depense: String) = ajouter(JSONObject().put("type", "retirer_depense").put("depense", depense))
    fun annulerInvitation(invitation: String) = ajouter(JSONObject().put("type", "annuler_invitation").put("invitation", invitation))
    fun quitter(groupe: String) = ajouter(JSONObject().put("type", "quitter").put("groupe", groupe))
    fun retirer(groupe: String, buddy: String) = ajouter(JSONObject().put("type", "retirer").put("groupe", groupe).put("buddy", buddy))
    fun nommerAdmin(groupe: String, buddy: String) = ajouter(JSONObject().put("type", "nommer_admin").put("groupe", groupe).put("buddy", buddy))
    /** Lien d'invitation ouvert (fr.assomoutain.proto.kotlin://rejoindre?c=…). */
    fun rejoindre(code: String) {
        if (code.isEmpty() || attente().objets().any { it.optString("type") == "rejoindre" && it.optString("code") == code }) return
        ajouter(JSONObject().put("type", "rejoindre").put("code", code))
    }

    // ------------------------------------------------------------ synchro

    /**
     * Envoie la file d'attente et reçoit les nouveautés. Rend les raisons des opérations refusées (à montrer).
     * Sans réseau : Compte.HorsLigne, rien n'est perdu.
     */
    private val verrouSynchro = Any()
    fun synchroniser(): List<String> = synchronized(verrouSynchro) { envoyerEtRecevoir() }

    private fun envoyerEtRecevoir(): List<String> {
        if (!compte.connecte) return emptyList()
        val ops = attente().objets()
        val corps = JSONObject().put("ops", JSONArray(ops.map { JSONObject(it.toString()).apply { remove("t") } }))
            .put("depuis", etat.optString("curseur").ifEmpty { JSONObject.NULL })
        val r = compte.api("POST", "/buddies/sync", corps)
        val envoyees = ops.map { it.optString("id") }.toSet()
        modifier {
            // Garde la version reçue de chaque objet encore visible. Un objet connu du serveur mais jamais reçu :
            // on redemandera tout à la prochaine synchro.
            var manque = false
            fun fusion(cle: String, recus: String, idsCle: String) {
                val parId = LinkedHashMap<String, JSONObject>()
                (optJSONArray(cle) ?: JSONArray()).objets().forEach { parId[it.getString("id")] = it }
                r.optJSONArray(recus).objets().forEach { parId[it.getString("id")] = it }
                val ids = r.optJSONArray(idsCle).let { a -> if (a == null) emptyList() else (0 until a.length()).map { a.getString(it) } }
                if (ids.any { it !in parId }) manque = true
                put(cle, JSONArray(ids.mapNotNull { parId[it] }))
            }
            fusion("serveur", "groupes", "ids"); fusion("sorties", "sorties", "ids_sorties"); fusion("traces", "traces", "ids_traces")
            fusion("plannings", "plannings", "ids_plannings")
            fusion("photos", "photos", "ids_photos")
            fusion("depenses", "depenses", "ids_depenses")
            fusion("hebergements", "hebergements", "ids_hebergements")
            fusion("messages", "messages", "ids_messages")
            r.optJSONArray("positions")?.let { put("positions", it) }
            put("appels", r.optJSONArray("appels") ?: JSONArray())
            put("attente", JSONArray((optJSONArray("attente") ?: JSONArray()).objets().filter { it.optString("id") !in envoyees }))
            put("moi", r.getString("moi")); put("synchro", System.currentTimeMillis())
            if (manque) remove("curseur") else put("curseur", r.getString("curseur"))
        }
        // Fichiers de mes photos acceptées ; une photo refusée est oubliée. Sans réseau : au prochain tour.
        val connues = r.optJSONArray("ids_photos").let { a -> if (a == null) emptySet() else (0 until a.length()).map { a.getString(it) }.toSet() }
        runCatching {
            for (id in envois()) {
                if (id in connues) album?.envoyer(id)
                else if (attente().objets().any { it.optString("type") == "ajouter_photo" && it.optString("photo") == id }) continue
                modifier { put("envois", JSONArray(envois().filter { it != id })) }
            }
        }
        return r.getJSONArray("refus").objets().map { it.optString("raison") }
    }
}
