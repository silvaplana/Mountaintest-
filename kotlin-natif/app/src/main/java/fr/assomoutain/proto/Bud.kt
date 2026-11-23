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
    /** Ce que Bud propose de faire (§7.12) : depense, buddy_time ou dispo. */
    data class Action(val type: String, val titre: String?, val montantEuros: Double?, val payePar: String?, val pour: List<String>,
                      val nom: String?, val debut: String?, val fin: String?, val lieu: String?, val etat: String?)
    data class Reponse(val texte: String, val hebergements: List<Hebergement>, val point: Point?, val actions: List<Action> = emptyList())

    private val JOUR = Regex("\\d{4}-\\d{2}-\\d{2}")
    private fun meme(a: String, b: String) = a.trim().equals(b.trim(), ignoreCase = true)

    /**
     * 🐻 Fait ce que Bud propose, en mon nom (choix de Seb, 23 novembre) : seulement une dépense du Buddy count de ce
     * Buddy Time, un Buddy Time dans cette bande, ou ma propre dispo à un planning de la bande. Le reste est écarté.
     * Rend ce qui est fait (pour « Annuler ») et ce qui ne l'est pas (à dire). Même règle côté React (bud.ts, agir).
     */
    fun agir(b: Buddies, actions: List<Action>, groupe: Buddies.Groupe?, sortie: Buddies.Sortie?, moi: String, auj: String):
        Pair<List<Buddies.ActionBud>, List<String>> {
        val faites = mutableListOf<Buddies.ActionBud>(); val refus = mutableListOf<String>()
        fun ids(noms: List<String>, parmi: List<Buddies.Buddy>) = noms.map { n -> parmi.firstOrNull { meme(it.pseudo, n) }?.id }
        for (a in actions.take(3)) try {
            when (a.type) {
                "depense" -> {
                    val so = sortie ?: throw IllegalArgumentException("une dépense va dans un Buddy Time")
                    val montant = Math.round((a.montantEuros ?: 0.0) * 100).toInt()
                    val paye = if (a.payePar != null) ids(listOf(a.payePar), so.participants)[0] else moi
                    val pour = if (a.pour.isNotEmpty()) ids(a.pour, so.participants) else so.participants.map { it.id }
                    if (paye == null || pour.any { it == null }) throw IllegalArgumentException("seuls les buddies du Buddy Time partagent ses frais")
                    val titre = (a.titre ?: "Dépense").take(80)
                    val id = b.enregistrerDepense(null, so.id, titre, montant, paye, pour.filterNotNull(), auj)
                    faites += Buddies.ActionBud("depense", id, "💶 $titre · ${BuddyCount.euros(montant)}")
                }
                "buddy_time" -> {
                    val g = groupe
                    if (g == null || a.nom.isNullOrBlank() || a.debut == null || !JOUR.matches(a.debut)) throw IllegalArgumentException("il faut une bande, un nom et une date")
                    val qui = if (g.meTime) emptyList() else (if (a.pour.isNotEmpty()) ids(a.pour, g.membres) else g.membres.map { it.id }).filterNotNull()
                    val fin = if (a.fin != null && JOUR.matches(a.fin) && a.fin >= a.debut) a.fin else a.debut
                    val id = b.creerSortie(g.id, a.nom, null, a.debut, fin, (a.lieu ?: "").take(120), qui)
                    faites += Buddies.ActionBud("sortie", id, "📅 Buddy Time « ${a.nom} » · ${a.debut}")
                }
                "dispo" -> {
                    val gid = sortie?.groupe ?: groupe?.id
                    val p = b.plannings().firstOrNull { it.groupe == gid && (a.nom == null || meme(it.nom, a.nom)) }
                    if (p == null || a.debut == null || p.dates.none { it.first == a.debut } || a.etat == null) throw IllegalArgumentException("date hors du planning")
                    val avant = p.dispos.firstOrNull { it.qui == moi && it.debut == a.debut }
                    b.repondre(p.id, a.debut, a.etat, avant?.mot ?: "")
                    faites += Buddies.ActionBud("dispo", "", "🗓 ${p.nom} · ${a.debut} : ${mapOf("oui" to "oui", "peut" to "peut-être", "non" to "non")[a.etat]}",
                        p.id, a.debut, avant?.etat ?: "", avant?.mot ?: "")
                }
            }
        } catch (e: Exception) { refus += e.message ?: "action impossible" }
        return faites to refus
    }

    /** « Annuler » sous la réponse de Bud : défait ce qu'il a fait, dans l'ordre inverse. */
    fun annuler(b: Buddies, faites: List<Buddies.ActionBud>) {
        for (a in faites.reversed()) when (a.genre) {
            "depense" -> b.retirerDepense(a.id)
            "sortie" -> b.retirerSortie(a.id)
            else -> b.repondre(a.planning, a.debut, a.avantEtat, a.avantMot)
        }
    }

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
        fun texte(o: JSONObject, k: String) = if (o.isNull(k)) null else o.optString(k)
        val actions = r.optJSONArray("actions")?.let { a -> (0 until a.length()).map { a.getJSONObject(it) } }.orEmpty().map { o ->
            val pour = o.optJSONArray("pour")?.let { a -> (0 until a.length()).map { a.getString(it) } }.orEmpty()
            Action(o.optString("type"), texte(o, "titre"), nombre(o, "montant_euros"), texte(o, "paye_par"), pour, texte(o, "nom"),
                texte(o, "debut"), texte(o, "fin"), texte(o, "lieu"), texte(o, "etat"))
        }
        return Reponse(r.optString("texte"), hs, p, actions)
    }
}
