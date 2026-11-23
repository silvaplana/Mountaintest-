package fr.assomoutain.proto

import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import kotlin.math.roundToInt

/**
 * Carnet d'un Buddy Time (spec/buddies.md §5.8, écrans 12 à 14) : les calculs, sans écran.
 * Même calcul que capacitor/src/buddies/carnet.ts : les garder identiques.
 *
 * - Photos : les ⭐ de l'album ; sans ⭐, un choix automatique réparti sur tout le Buddy Time (on peut en changer).
 * - Trace : une couleur par jour quand il y a une trace par jour (la 1re trace partagée = jour 1…), sinon une par trace.
 * - Chiffres : distance depuis les traces ; montée, descente, point haut depuis le relief IGN (une fois en ligne, puis
 *   gardés sur le téléphone) ; durée, départ, difficulté, météo, conditions tapés dans le carnet.
 */
object Carnet {
    val COULEURS_JOURS = listOf("#7b3fe4", "#e4572e", "#2f8f5b", "#2c7fb8", "#c9862b", "#b5534a", "#2c8c8c")
    const val MAX_PHOTOS = 12

    /** Les jours du Buddy Time, AAAA-MM-JJ. */
    fun joursDe(x: Buddies.Sortie): List<String> = runCatching {
        val out = mutableListOf<String>()
        var d = LocalDate.parse(x.debut)
        val fin = LocalDate.parse(x.fin)
        while (!d.isAfter(fin) && out.size < 60) { out += d.toString(); d = d.plusDays(1) }
        out.toList()
    }.getOrDefault(listOf(x.debut))

    /** Photos du carnet : les ⭐ ; sans ⭐, au plus 12 réparties dans le temps (second = automatique). */
    fun choixPhotos(photos: List<Buddies.PhotoBuddy>, max: Int = MAX_PHOTOS): Pair<List<Buddies.PhotoBuddy>, Boolean> {
        val l = photos.sortedBy { it.priseLe }
        val et = l.filter { it.etoile }
        if (et.isNotEmpty()) return et to false
        if (l.size <= max) return l to l.isNotEmpty()
        val idx = (0 until max).map { (it * (l.size - 1).toDouble() / (max - 1)).roundToInt() }.toSet()
        return l.filterIndexed { i, _ -> i in idx } to true
    }

    data class TraceCarnet(val t: Buddies.TraceBuddy, val couleur: String, val libelle: String, val jour: String?)
    /** Une couleur par jour quand il y a une trace par jour (dans l'ordre du partage) ; sinon une couleur et le nom par trace. */
    fun tracesDuCarnet(traces: List<Buddies.TraceBuddy>, jours: List<String>): List<TraceCarnet> {
        val l = traces.sortedBy { it.cree }
        val parJour = l.size > 1 && l.size == jours.size
        return l.mapIndexed { i, t ->
            TraceCarnet(t, COULEURS_JOURS[i % COULEURS_JOURS.size], if (parJour) "Jour ${i + 1}" else t.nom,
                if (parJour) jours[i] else if (jours.size == 1 && l.size == 1) jours[0] else null)
        }
    }

    fun longueur(l: List<LonLat>) = l.zipWithNext { a, b -> Trails.distanceM(a, b) }.sum()

    // ---------- relief (montée, descente, point haut, profil) ----------

    /** Relief d'une trace : profil réduit à 200 points au plus (d en m, z en m). */
    data class Relief(val d: List<Int>, val z: List<Int>, val montee: Int, val descente: Int, val haut: Int)
    private const val CLE_RELIEF = "carnet-relief:"

    fun reliefGarde(prefs: SharedPreferences, id: String): Relief? = runCatching {
        val o = JSONObject(prefs.getString(CLE_RELIEF + id, null) ?: return null)
        fun ints(k: String) = o.getJSONArray(k).let { a -> (0 until a.length()).map { a.getInt(it) } }
        Relief(ints("d"), ints("z"), o.getInt("montee"), o.getInt("descente"), o.getInt("haut"))
    }.getOrNull()

    /** Relief gardé, sinon demandé au service d'altitudes IGN (null sans réseau : on réessaiera). Bloquant. */
    fun relief(prefs: SharedPreferences, t: Buddies.TraceBuddy): Relief? {
        reliefGarde(prefs, t.id)?.let { return it }
        return runCatching {
            val el = Trails.elevate(Trail(0, t.nom, "", 0, "", listOf(t.ligne), longueur(t.ligne)))
            reduireRelief(el.segments[0], el.gainM, el.lossM)?.also { r ->
                prefs.edit().putString(CLE_RELIEF + t.id, JSONObject().put("d", JSONArray(r.d)).put("z", JSONArray(r.z))
                    .put("montee", r.montee).put("descente", r.descente).put("haut", r.haut).toString()).apply()
            }
        }.getOrNull()
    }

    fun reduireRelief(pts: List<Pair<LonLat, Double?>>, montee: Double, descente: Double, max: Int = 200): Relief? {
        val d = mutableListOf<Int>(); val z = mutableListOf<Int>()
        var acc = 0.0
        pts.forEachIndexed { i, (p, e) ->
            if (i > 0) acc += Trails.distanceM(pts[i - 1].first, p)
            if (e != null) { d += acc.roundToInt(); z += e.roundToInt() }
        }
        if (d.size < 2) return null
        val pas = maxOf(1, (d.size + max - 1) / max)
        val k = d.indices.filter { it % pas == 0 || it == d.size - 1 }
        return Relief(k.map { d[it] }, k.map { z[it] }, montee.roundToInt(), descente.roundToInt(), z.max())
    }

    // ---------- chiffres ----------

    private fun espace(n: Int) = n.toString().reversed().chunked(3).joinToString(" ").reversed()
    fun km(m: Int): String = String.format(java.util.Locale.FRANCE, if (m < 10_000) "%.1f km" else "%.0f km", m / 1000.0)
    fun metres(m: Int) = "${espace(m)} m"
    fun duree(min: Int) = "${min / 60} h ${(min % 60).toString().padStart(2, '0')}"
    /** « 5 h 20 », « 5h20 », « 5 h », « 320 » (minutes) → minutes ; null si vide ou illisible. */
    fun lireDuree(s: String): Int? {
        val t = s.trim().lowercase()
        if (t.isEmpty()) return null
        Regex("^(\\d{1,2})\\s*h\\s*(\\d{0,2})$").find(t)?.let { return it.groupValues[1].toInt() * 60 + (it.groupValues[2].toIntOrNull() ?: 0) }
        return if (Regex("^\\d{1,4}$").matches(t)) t.toInt() else null
    }
    /** « 11 », « 11,5 » (km) → mètres. */
    fun lireKm(s: String): Int? {
        val t = s.trim().replace(',', '.').replace(Regex("\\s*km$"), "")
        return if (t.isNotEmpty() && Regex("^\\d+(\\.\\d+)?$").matches(t)) (t.toDouble() * 1000).roundToInt() else null
    }
    fun lireMetres(s: String): Int? {
        val t = s.replace(Regex("[\\s  +m]"), "")
        return if (t.isNotEmpty() && Regex("^\\d+$").matches(t)) t.toInt() else null
    }

    /** Fiche d'un jour telle qu'affichée : ce qui est tapé, sinon pris dans la trace du jour. */
    data class FicheAffichee(val f: Buddies.Fiche, val n: Int, val couleur: String, val trace: Boolean)
    fun fiches(x: Buddies.Sortie, traces: List<TraceCarnet>, reliefs: Map<String, Relief>): List<FicheAffichee> =
        joursDe(x).mapIndexed { i, jour ->
            val f = x.carnet.fiches.firstOrNull { it.jour == jour }
            val tc = traces.firstOrNull { it.jour == jour }
            val r = tc?.let { reliefs[it.t.id] }
            FicheAffichee(Buddies.Fiche(jour, f?.nom ?: "", f?.depart ?: "", f?.duree,
                f?.distance ?: tc?.let { longueur(it.t.ligne).roundToInt() }, f?.denivele ?: r?.montee),
                i + 1, tc?.couleur ?: COULEURS_JOURS[i % COULEURS_JOURS.size], tc != null)
        }.filter { !it.f.vide }

    data class Tuile(val v: String, val l: String, val vide: Boolean = false)
    /** Les chiffres du carnet (écran 13), seulement ceux qu'on connaît ; les conditions en pointillé tant qu'elles manquent. */
    fun chiffres(x: Buddies.Sortie, traces: List<TraceCarnet>, reliefs: Map<String, Relief>, fs: List<FicheAffichee>): List<Tuile> {
        val c = x.carnet
        val out = mutableListOf<Tuile>()
        val dist = traces.sumOf { longueur(it.t.ligne) }
        if (dist > 0) out += Tuile(km(dist.roundToInt()), "distance")
        val rs = traces.mapNotNull { reliefs[it.t.id] }
        val tous = traces.isNotEmpty() && rs.size == traces.size
        if (tous) { out += Tuile("+${metres(rs.sumOf { it.montee })}", "montée"); out += Tuile("−${metres(rs.sumOf { it.descente })}", "descente") }
        val min = fs.sumOf { it.f.duree ?: 0 }
        if (min > 0) out += Tuile(duree(min), "durée")
        if (tous) out += Tuile(metres(rs.maxOf { it.haut }), "point haut")
        val nj = joursDe(x).size
        out += Tuile("$nj jour${if (nj > 1) "s" else ""}", if (nj > 1) "${nj - 1} nuit${if (nj > 2) "s" else ""}" else "sur la journée")
        out += Tuile("${x.participants.size}", if (x.participants.size > 1) "buddies" else "buddy")
        if (c.difficulte.isNotEmpty()) out += Tuile(c.difficulte, "difficulté")
        if (c.meteo.isNotEmpty()) out += Tuile(c.meteo, "météo")
        if (c.conditions.isEmpty()) out += Tuile("+", "conditions", vide = true)
        return out
    }

    /** Le carnet en texte, pour le partager par message ou par mail. */
    fun texte(x: Buddies.Sortie, dates: String, tuiles: List<Tuile>, fs: List<FicheAffichee>): String {
        val c = x.carnet
        val l = mutableListOf("📖 ${x.nom}", "$dates · ${x.participants.joinToString(", ") { it.pseudo }}", "")
        for (r in c.recits) { l += "${r.texte}\n— ${r.par.pseudo}"; l += "" }
        val t = tuiles.filter { !it.vide }.map { "${it.v} ${it.l}" }
        if (t.isNotEmpty()) { l += t.joinToString(" · "); l += "" }
        if (c.conditions.isNotEmpty()) { l += "Conditions : ${c.conditions}"; l += "" }
        for (a in fs) {
            val f = a.f
            val d = listOfNotNull(f.depart.takeIf { it.isNotEmpty() }?.let { "départ ${it.replace(":", " h ")}" }, f.duree?.let { duree(it) },
                f.distance?.let { km(it) }, f.denivele?.let { "+${metres(it)}" }).joinToString(" · ")
            l += "Jour ${a.n}${if (f.nom.isNotEmpty()) " · ${f.nom}" else ""}${if (d.isNotEmpty()) " : $d" else ""}"
        }
        return l.joinToString("\n").trim()
    }
}
