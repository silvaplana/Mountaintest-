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
    }

    /** Un Buddy Group tel qu'affiché (version du serveur + opérations en attente). */
    data class Buddy(val id: String, val pseudo: String, val photo: String?, val role: String)
    data class Invitation(val id: String, val code: String, val canal: String, val nom: String, val contact: String, val attente: Boolean)
    data class Groupe(
        val id: String, val nom: String, val nature: String, val photo: String?, val modifie: Long,
        val membres: List<Buddy>, val invitations: List<Invitation>, val attente: Boolean,
    ) { val meTime get() = nature == "me_time" }
    data class NouvelleInvitation(val canal: String, val nom: String, val contact: String, val code: String)
    /** Buddy Time (spec §5.4). Dates du calendrier AAAA-MM-JJ. */
    data class Sortie(
        val id: String, val groupe: String, val nom: String, val photo: String?, val debut: String, val fin: String, val lieu: String,
        val modifie: Long, val participants: List<Buddy>, val invitations: List<Invitation>, val attente: Boolean,
    )
    /** Trace partagée dans un Buddy Time ou un Buddy Group (panneau de partage, spec §3.4). */
    data class TraceBuddy(
        val id: String, val sortie: String?, val groupe: String?, val nom: String, val ligne: List<LonLat>, val mot: String,
        val par: Buddy, val cree: Long, val attente: Boolean,
    )

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
            etat.optJSONArray("sorties").objets().count { ms(it.optString("modifie_le")) > vu }
    }

    private fun lireBuddy(b: JSONObject) = Buddy(b.getString("id"), b.optString("pseudo"), b.optString("photo").takeIf { it.isNotEmpty() && it != "null" }, b.optString("role", "membre"))
    private fun lireInvitation(i: JSONObject, attente: Boolean = false) = Invitation(i.getString("id"), i.optString("code"), i.optString("canal", "lien"), i.optString("nom"), i.optString("contact"), attente)
    private fun lireLigne(a: JSONArray?) = a.let { l -> if (l == null) emptyList() else (0 until l.length()).map { l.getJSONArray(it).let { p -> LonLat(p.getDouble(0), p.getDouble(1)) } } }
    private fun lireSortie(x: JSONObject) = Sortie(x.getString("id"), x.optString("groupe"), x.optString("nom"), x.optString("photo").takeIf { it.isNotEmpty() && it != "null" },
        x.optString("debut"), x.optString("fin"), x.optString("lieu"), ms(x.optString("modifie_le")),
        x.optJSONArray("participants").objets().map(::lireBuddy), x.optJSONArray("invitations").objets().map { lireInvitation(it) }, false)
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
            put("attente", JSONArray((optJSONArray("attente") ?: JSONArray()).objets().filter { it.optString("id") !in envoyees }))
            put("moi", r.getString("moi")); put("synchro", System.currentTimeMillis())
            if (manque) remove("curseur") else put("curseur", r.getString("curseur"))
        }
        return r.getJSONArray("refus").objets().map { it.optString("raison") }
    }
}
