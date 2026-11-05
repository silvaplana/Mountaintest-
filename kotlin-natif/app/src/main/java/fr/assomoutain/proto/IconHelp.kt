package fr.assomoutain.proto

/**
 * Aide en ligne des icônes de la carte : un appui long sur une icône affiche sa bulle.
 * Mêmes textes côté Capacitor (capacitor/src/iconHelp.ts) : les garder identiques.
 */
object IconHelp {
    data class Entry(val title: String, val text: String)

    val ENTRIES: Map<String, Entry> = mapOf(
        "close" to IconHelp.Entry("✕ Quitter", "Ferme l'appli."),
        "locate" to IconHelp.Entry("Me localiser", "Centre la carte sur toi. Encore : coupe le GPS."),
        "search" to IconHelp.Entry("🔍 Chercher un lieu", "Cherche une ville, un sommet…"),
        "photo" to IconHelp.Entry("📷 Appareil photo", "Ouvre l’appareil photo."),
        "layer" to IconHelp.Entry("🗺 Fond de carte", "SCAN 25, Plan IGN ou auto."),
        "avion" to IconHelp.Entry("✈ Mode avion", "Ouvre le réglage. Le GPS marche toujours."),
        "poche" to IconHelp.Entry("👖 Mode poche", "Vertical 3 s = écran noir."),
        "draw" to IconHelp.Entry("✏ Tracer au doigt", "Dessine un parcours : km et dénivelé."),
        "slopes" to IconHelp.Entry("⛰ Pentes", "Carte IGN des pentes :"),
        "shade" to IconHelp.Entry("🌗 Ombres", "Ombres du soleil heure par heure."),
        "ski" to IconHelp.Entry("⛷🗺 Sorties ski", "Sorties skitour.fr sur la carte."),
        "skiText" to IconHelp.Entry("⛷💬 Question ski", "Question sur les sorties skitour.fr."),
        "weatherMountain" to IconHelp.Entry("🏔 Météo montagne", "Météo-France montagne."),
        "travel" to IconHelp.Entry("🚗 Voyage en voiture", "Km, coût, péages."),
        "lodging" to IconHelp.Entry("🏨 Hébergement", "Meilleurs prix (IA)."),
        "expenses" to IconHelp.Entry("Partage des frais", "Qui doit combien à qui."),
    )

    /** Légende de la couche IGN « Carte des pentes » (GEOGRAPHICALGRIDSYSTEMS.SLOPES.MOUNTAIN). */
    val SLOPE_LEGEND: List<Pair<String, String>> = listOf(
        "#FFE600" to "30° à 35°",
        "#FF9900" to "35° à 40°",
        "#E3170A" to "40° à 45°",
        "#9B30D9" to "plus de 45°",
    )

    /** Étiquettes de pente le long d'un tracé (mêmes seuils que slopeTagBitmap). */
    const val SLOPE_TAGS_HELP = "Tracés : orange dès 9°, rouge dès 17°."
}
