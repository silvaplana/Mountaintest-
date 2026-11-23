package fr.assomoutain.proto

import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Buddy count d'un Buddy Time (spec/buddies.md §5.10) : le partage des frais existant (Expenses.kt), partagé entre
 * téléphones. Mêmes calculs que capacitor/src/buddies/count.ts ; les écrans sont dans BuddiesPanel.kt.
 */
object BuddyCount {
    /** Les dépenses d'un Buddy Time vues comme un groupe du partage des frais (montants en euros). */
    fun groupeDe(x: Buddies.Sortie, depenses: List<Buddies.Depense>, moi: String) = Group(x.id, x.nom, "",
        x.participants.map { Member(it.id, it.pseudo) }.toMutableList(), moi,
        depenses.filter { it.sortie == x.id }.map { Expense(it.id, it.titre, it.montant / 100.0, it.payePar, it.pour, it.jour) }.toMutableList())

    data class Compte(val total: Int, val chacun: Int, val soldes: Map<String, Double>, val virements: List<Expenses.Transfer>)
    /** Total (centimes), part moyenne, solde de chacun (euros, + : on lui doit) et remboursements. */
    fun compte(x: Buddies.Sortie, depenses: List<Buddies.Depense>, moi: String): Compte {
        val g = groupeDe(x, depenses, moi)
        val total = depenses.filter { it.sortie == x.id }.sumOf { it.montant }
        return Compte(total, if (x.participants.isEmpty()) 0 else (total.toDouble() / x.participants.size).roundToInt(),
            Expenses.balances(g), Expenses.settlements(g))
    }

    /** « 106 € », « 12,50 € » (centimes). */
    fun euros(c: Int): String {
        val v = abs(c) / 100.0
        val f = java.text.NumberFormat.getNumberInstance(java.util.Locale.FRANCE).apply {
            minimumFractionDigits = if (abs(c) % 100 == 0) 0 else 2; maximumFractionDigits = minimumFractionDigits
        }
        return "${if (c < 0) "−" else ""}${f.format(v)} €"
    }
    /** « 12,5 » ou « 12,50 € » tapé → centimes ; null si illisible. */
    fun lireEuros(s: String): Int? {
        val t = s.replace(Regex("[\\s  €]"), "").replace(',', '.')
        return if (Regex("^\\d+(\\.\\d{1,2})?$").matches(t) && t.toDouble() > 0) (t.toDouble() * 100).roundToInt() else null
    }

    private val ICONES = listOf(
        Regex("forfait|remont[ée]e|location (de )?ski|skis?\\b", RegexOption.IGNORE_CASE) to "🎿",
        Regex("g[iî]te|refuge|h[oô]tel|chambre|nuit|camping|location|appart", RegexOption.IGNORE_CASE) to "🏨",
        Regex("essence|gasoil|carburant|p[ée]age|parking|voiture|autoroute", RegexOption.IGNORE_CASE) to "⛽",
        Regex("train|bus|navette|t[ée]l[ée]ph[ée]rique|avion", RegexOption.IGNORE_CASE) to "🚆",
        Regex("resto|restaurant|repas|pizza|caf[ée]|bi[eè]re|bar\\b|ap[ée]ro", RegexOption.IGNORE_CASE) to "🍽",
        Regex("courses|fromage|pain|march[ée]|supermarch|pique", RegexOption.IGNORE_CASE) to "🧀",
    )
    /** Une icône devinée depuis le titre (gîte 🏨, essence ⛽, courses 🧀…), sinon 💶. */
    fun icone(titre: String) = ICONES.firstOrNull { it.first.containsMatchIn(titre) }?.second ?: "💶"
}
