package fr.assomoutain.proto

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/**
 * Messagerie (spec/buddies.md §5.6, écrans 6 et 24) : les calculs, sans écran.
 * Même calcul que capacitor/src/buddies/messages.ts : les garder identiques.
 *
 * Une conversation par Buddy Group et par Buddy Time. Le fil mêle les messages et, en cartes cliquables,
 * les traces partagées et les hébergements proposés au même endroit : on les retrouve plus tard.
 */
object Messages {
    sealed class Bulle(val quand: Long) {
        class Message(val m: Buddies.MessageBuddy) : Bulle(m.cree)
        class Trace(val t: Buddies.TraceBuddy) : Bulle(t.cree)
        class Heberg(val h: Buddies.Hebergement) : Bulle(h.cree)
    }

    /** Le fil d'une conversation (groupe ou sortie), du plus ancien au plus récent. */
    fun fil(groupe: String?, sortie: String?, messages: List<Buddies.MessageBuddy>, traces: List<Buddies.TraceBuddy>,
            hebergements: List<Buddies.Hebergement>): List<Bulle> {
        fun ici(g: String?, s: String?) = if (sortie != null) s == sortie else s == null && g == groupe
        return (messages.filter { ici(it.groupe, it.sortie) }.map { Bulle.Message(it) } +
            traces.filter { ici(it.groupe, it.sortie) }.map { Bulle.Trace(it) } +
            (if (sortie != null) hebergements.filter { it.sortie == sortie }.map { Bulle.Heberg(it) } else emptyList()))
            .sortedBy { it.quand }
    }

    /** Le dernier mot d'une conversation, pour la liste : « Julie : On part à 7 h ? ». */
    fun apercu(b: Bulle?, nom: (String) -> String, moi: String?): String {
        fun qui(id: String) = if (id == moi || id == "moi") "Toi" else nom(id)
        return when (b) {
            null -> ""
            is Bulle.Trace -> "〰 ${if (b.t.par.id == moi) "Toi" else b.t.par.pseudo} : ${b.t.nom}"
            is Bulle.Heberg -> "🏨 ${qui(b.h.par)} : ${b.h.nom}"
            is Bulle.Message -> if (b.m.bud) "🐻 Bud : " + (if (b.m.nature == "point") "📍 ${b.m.texte}" else b.m.texte) else "${qui(b.m.par)} : " + when (b.m.nature) { "point" -> "📍 je suis ici"; "photo" -> "📷 une photo"; else -> b.m.texte }
        }
    }

    /** « 10 h 42 » aujourd'hui, « hier 10 h 42 », sinon « 12 nov. ». */
    fun heure(ms: Long, maintenant: Long = System.currentTimeMillis()): String {
        val d = Calendar.getInstance().apply { timeInMillis = ms }
        val h = "${d.get(Calendar.HOUR_OF_DAY)} h ${d.get(Calendar.MINUTE).toString().padStart(2, '0')}"
        fun jour(c: Calendar) = c.get(Calendar.YEAR) * 1000 + c.get(Calendar.DAY_OF_YEAR)
        val auj = Calendar.getInstance().apply { timeInMillis = maintenant }
        val hier = (auj.clone() as Calendar).apply { add(Calendar.DAY_OF_YEAR, -1) }
        return when (jour(d)) {
            jour(auj) -> h
            jour(hier) -> "hier $h"
            else -> SimpleDateFormat("d MMM", Locale.FRANCE).format(d.time)
        }
    }

    /** Longueur d'une trace partagée : « 14 km ». */
    fun longueur(l: List<LonLat>): String = Carnet.km((1 until l.size).sumOf { Trails.distanceM(l[it - 1], l[it]) }.toInt())
}
