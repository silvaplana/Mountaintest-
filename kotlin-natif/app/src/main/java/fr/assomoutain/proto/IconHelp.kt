package fr.assomoutain.proto

/**
 * Aide en ligne des icônes de la carte : un appui long sur une icône affiche sa bulle.
 * Mêmes textes côté Capacitor (capacitor/src/iconHelp.ts) : les garder identiques.
 */
object IconHelp {
    data class Entry(val title: String, val text: String)

    val ENTRIES: Map<String, Entry> = mapOf(
        "close" to IconHelp.Entry("✕ Quitter", "Ferme l'appli."),
        "locate" to IconHelp.Entry("⌖ Me localiser", "Centre la carte sur ta position GPS et la suit. Appuie de nouveau pour couper le GPS et économiser la batterie."),
        "search" to IconHelp.Entry("🔍 Chercher un lieu", "Tape le nom d'une ville, d'un sommet ou d'un lieu-dit : la carte s'y centre."),
        "photo" to IconHelp.Entry("📷 Appareil photo", "Ouvre l'appareil photo du téléphone ; le bouton Retour ramène à la carte."),
        "layer" to IconHelp.Entry("🗺 Fond de carte", "Chaque appui passe au fond suivant : Carte auto, SCAN 25 (IGN au 1:25 000), Plan IGN."),
        "avion" to IconHelp.Entry("✈ Mode avion", "Android ne laisse pas une appli basculer le mode avion : l'icône est verte quand il est actif et ouvre le réglage. Le GPS marche toujours en mode avion et la batterie dure bien plus longtemps. Le 1er appui montre aussi 👖."),
        "poche" to IconHelp.Entry("👖 Mode poche", "Téléphone vertical 3 s = écran noir, pour ne rien toucher dans la poche (le GPS de « Me localiser » se coupe, l'enregistrement d'une sortie continue). À plat ou deux secousses pour rallumer."),
        "draw" to IconHelp.Entry("✏ Tracer au doigt", "Dessine un parcours sur la carte : sa longueur, son dénivelé et son profil s’affichent."),
        "slopes" to IconHelp.Entry("⛰ Pentes", "Carte IGN des pentes en montagne. Sous 30°, pas de couleur. Le 1er appui montre aussi 🌗."),
        "shade" to IconHelp.Entry("🌗 Ombres du relief", "Film des ombres du soleil sur 24 h, toutes les 30 min, calculé dans le téléphone à partir du relief IGN. Choisis la date et fais glisser l’heure."),
        "ski" to IconHelp.Entry("⛷🗺 Sorties ski de rando", "Sorties de skitour.fr dans la zone affichée ; toucher une sortie ouvre sa fiche. Le 1er appui montre aussi ⛷💬."),
        "skiText" to IconHelp.Entry("⛷💬 Question sur les sorties ski", "Pose une question en texte sur les sorties de skitour.fr (par exemple les conditions récentes dans un massif)."),
        "weatherMountain" to IconHelp.Entry("🏔 Météo montagne", "Ouvre la météo montagne de Météo-France (bulletins, risque d’avalanche)."),
        "travel" to IconHelp.Entry("🚗 Voyage en voiture", "Itinéraires avec km, durée, coût du carburant et péages."),
        "lodging" to IconHelp.Entry("🏨 Hébergement", "Cherche les meilleurs prix près de ta destination (IA)."),
        "expenses" to IconHelp.Entry("Partage des frais", "Façon Tricount : qui a payé quoi, et qui doit combien à qui. Les participants sont invités par mail."),
    )

    /** Légende de la couche IGN « Carte des pentes » (GEOGRAPHICALGRIDSYSTEMS.SLOPES.MOUNTAIN). */
    val SLOPE_LEGEND: List<Pair<String, String>> = listOf(
        "#FFE600" to "30° à 35°",
        "#FF9900" to "35° à 40°",
        "#E3170A" to "40° à 45°",
        "#9B30D9" to "plus de 45°",
    )

    /** Étiquettes de pente le long d'un tracé (mêmes seuils que slopeTagBitmap). */
    const val SLOPE_TAGS_HELP = "Sur un tracé, les étiquettes donnent la pente du chemin : orange dès 9° (16 %), rouge dès 17° (30 %)."
}
