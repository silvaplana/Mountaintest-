package fr.assomoutain.proto

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * 🐻 Bud (spec/buddies.md §5.12, écran 25) : le buddy à part qui connaît l'appli. Il ne parle que si on l'appelle
 * (« Bud, … ») ; sa réponse est un message de la conversation, vu de tous, dans sa propre bulle. Il propose (gîtes
 * et endroits posés sur la carte), les buddies décident. Même rôle côté React (src/buddies/bud.ts) : garder les deux pareils.
 */
object Bud {
    /** Mot de passe des recherches (posé par MainActivity : celui de l'APK, sinon celui tapé). */
    var motDePasse: () -> String = { "" }
    /** « Bud, … », « bud : … », « Les Baladins 👍 Bud, la pente ? » : Bud est appelé. */
    fun pourBud(texte: String) = Regex("(^|[\\s.!?👍])bud\\s*[,:]", RegexOption.IGNORE_CASE).containsMatchIn(texte) ||
        Regex("^\\s*bud\\b", RegexOption.IGNORE_CASE).containsMatchIn(texte)

    private fun f5(v: Double) = "%.5f".format(java.util.Locale.US, v)

    /** Ce que Bud sait de la conversation : la sortie ou la bande, en texte court. */
    fun contexte(groupe: String?, sortie: Buddies.Sortie?, nomGroupe: String, membres: List<Buddies.Buddy>, moi: String,
                 traces: List<Buddies.TraceBuddy>, hebergements: List<Buddies.Hebergement>, depenses: List<Buddies.Depense>,
                 plannings: List<Buddies.Planning>, messages: List<Buddies.MessageBuddy>): String {
        fun nom(id: String) = if (id == moi) "${membres.firstOrNull { it.id == id }?.pseudo ?: "moi"} (celui qui te parle)"
            else membres.firstOrNull { it.id == id }?.pseudo ?: "?"
        val l = mutableListOf<String>()
        if (sortie != null) {
            l += "Buddy Time « ${sortie.nom} » du ${sortie.debut} au ${sortie.fin}${if (sortie.lieu.isNotEmpty()) ", lieu : ${sortie.lieu}" else ""}."
            l += "Qui vient : ${sortie.participants.joinToString(", ") { it.pseudo }}."
            val inv = sortie.invitations.filter { it.canal != "qr" }.map { it.nom }.filter { it.isNotEmpty() }
            if (inv.isNotEmpty()) l += "Invités sans réponse : ${inv.joinToString(", ")}."
        } else l += "Buddy Group « $nomGroupe » : ${membres.joinToString(", ") { it.pseudo }}."
        fun ici(s: String?, g: String?) = if (sortie != null) s == sortie.id else g == groupe
        val ts = traces.filter { ici(it.sortie, it.groupe) }
        if (ts.isNotEmpty()) {
            l += "Traces partagées :"
            for (t in ts) {
                val a = t.ligne.firstOrNull(); val b = t.ligne.lastOrNull()
                l += "- « ${t.nom} » par ${t.par.pseudo}, ${Messages.longueur(t.ligne)}" +
                    (if (a != null && b != null) ", départ ${f5(a.lat)}, ${f5(a.lon)}, arrivée ${f5(b.lat)}, ${f5(b.lon)}" else "") +
                    " (pas d'altitude connue)" + if (t.mot.isNotEmpty()) ", mot : ${t.mot}" else ""
            }
        }
        val hs = if (sortie != null) hebergements.filter { it.sortie == sortie.id } else emptyList()
        if (hs.isNotEmpty()) {
            l += "Hébergements proposés :"
            for (h in hs) l += "- ${h.nom}${if (h.retenu) " (RETENU)" else ""}, ${h.prixNuit?.let { "$it € la nuit" } ?: "prix inconnu"}, ${h.adresse}, ♥ de ${h.coeurs.joinToString(", ") { nom(it) }.ifEmpty { "personne" }}"
        }
        if (sortie != null) {
            val dep = depenses.filter { it.sortie == sortie.id }
            if (dep.isNotEmpty()) {
                val c = BuddyCount.compte(sortie, dep, moi)
                l += "Dépenses (Buddy count) : total ${BuddyCount.euros(c.total)}, ${dep.size} dépense(s) : " +
                    dep.joinToString(" ; ") { "${it.titre} ${BuddyCount.euros(it.montant)} payé par ${nom(it.payePar)}" } + "."
                l += if (c.virements.isEmpty()) "Les comptes sont équilibrés."
                    else "Pour équilibrer : " + c.virements.joinToString(" ; ") { "${nom(it.from)} doit ${"%.2f".format(java.util.Locale.US, it.amount)} € à ${nom(it.to)}" } + "."
            }
        }
        val g = sortie?.groupe ?: groupe
        for (p in plannings.filter { it.groupe == g }) {
            l += "Planning « ${p.nom} » (réponses avant le ${p.limite}) :"
            for ((debut, fin) in p.dates) {
                val ds = p.dispos.filter { it.debut == debut }
                fun de(e: String) = ds.filter { it.etat == e }.joinToString(", ") { nom(it.qui) }.ifEmpty { "personne" }
                l += "- $debut au $fin : oui ${de("oui")} ; peut-être ${de("peut")} ; non ${de("non")}"
            }
        }
        val ms = messages.filter { ici(it.sortie, it.groupe) }.takeLast(30)
        if (ms.isNotEmpty()) {
            l += "Derniers messages :"
            for (m in ms) l += "- ${if (m.bud) "Bud" else nom(m.par)} : " + when (m.nature) {
                "point" -> "📍 point ${m.lat}, ${m.lon}"; "photo" -> "📷 une photo"; else -> m.texte
            }
        }
        return l.joinToString("\n")
    }

    data class Hebergement(val lodging: Lodging, val lon: Double?, val lat: Double?)
    data class Point(val nom: String, val lon: Double, val lat: Double)
    data class Reponse(val texte: String, val hebergements: List<Hebergement>, val point: Point?)

    /** Pose la question à Bud (réseau ; bloquant : hors du fil principal). Lève une erreur lisible. */
    fun demander(motDePasse: String, question: String, contexte: String): Reponse {
        val (code, corps) = try {
            val c = URL(WebHikes.RELAIS_URL.removeSuffix("/randos") + "/bud").openConnection() as HttpURLConnection
            c.requestMethod = "POST"; c.connectTimeout = 15_000; c.readTimeout = 180_000; c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json"); c.setRequestProperty("X-Mot-De-Passe", motDePasse)
            c.outputStream.use { it.write(JSONObject().put("question", question).put("contexte", contexte).toString().toByteArray()) }
            val code = c.responseCode
            code to ((if (code < 400) c.inputStream else c.errorStream)?.use { String(it.readBytes()) } ?: "")
        } catch (e: IOException) { throw IOException("Pas de réseau : redemande à Bud quand tu en auras") }
        val r = runCatching { JSONObject(corps) }.getOrDefault(JSONObject())
        if (code != 200) throw IOException(if (code == 401) "Bud ne te reconnaît pas (mot de passe des recherches)" else r.optString("erreur", "Bud ne répond pas"))
        fun nombre(o: JSONObject, k: String) = if (o.isNull(k)) null else o.optDouble(k).takeIf { !it.isNaN() }
        val hs = r.optJSONArray("hebergements")?.let { a -> (0 until a.length()).map { a.getJSONObject(it) } }.orEmpty().map {
            Hebergement(Lodging(it.optString("nom"), it.optString("type"), nombre(it, "prix_nuit"), it.optString("adresse"), it.optString("url"),
                it.optString("resume")), nombre(it, "lon"), nombre(it, "lat"))
        }
        val p = r.optJSONObject("point")?.let { o -> nombre(o, "lon")?.let { lon -> nombre(o, "lat")?.let { lat -> Point(o.optString("nom"), lon, lat) } } }
        return Reponse(r.optString("texte"), hs, p)
    }
}
