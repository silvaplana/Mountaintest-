package fr.assomoutain.proto

/**
 * Hébergement d'un Buddy Time (spec/buddies.md §5.11, écrans 9 et 23) : petits outils communs à l'écran
 * « Où on dort ? » (BuddiesPanel.kt), au bandeau de la carte et au panneau de partage. Même rôle que
 * capacitor/src/buddies/Hebergements.tsx.
 */
object Hebergements {
    /** Une image selon la nature : refuge, gîte, hôtel, camping… */
    fun icone(nature: String): String {
        val n = nature.lowercase()
        return when {
            Regex("refuge|cabane").containsMatchIn(n) -> "🏔"
            Regex("camping|bivouac").containsMatchIn(n) -> "⛺"
            Regex("hôtel|hotel").containsMatchIn(n) -> "🏨"
            n.contains("chalet") -> "🛖"
            else -> "🏠"
        }
    }
    fun prix(prixNuit: Int?) = if (prixNuit != null) "$prixNuit € / nuit" else "prix à voir"

    /** Écran 23 : proposer un hébergement trouvé dans des Buddy Times, placé sur la carte par son adresse (si on la trouve). Bloquant. */
    fun proposer(buddies: Buddies, sorties: List<String>, l: Lodging) {
        val p = runCatching { Search.search(l.adresse.ifEmpty { l.nom }.trim()).firstOrNull() }.getOrNull()
        buddies.proposerHebergement(sorties, l, p?.let { Math.round(it.lon * 1e5) / 1e5 }, p?.let { Math.round(it.lat * 1e5) / 1e5 })
    }
}
