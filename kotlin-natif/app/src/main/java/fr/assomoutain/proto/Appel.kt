package fr.assomoutain.proto

import android.content.Context
import io.livekit.android.LiveKit
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArraySet

/**
 * 📞 Appels de groupe (spec/buddies.md §5.7, écrans 10 et 24) : l'état de l'appel, sans écran (écrans : AppelVue.kt).
 * Le son passe par LiveKit (sur le VPS) ; le serveur des comptes donne le jeton d'entrée et fait sonner les autres
 * (AppelService.kt). Même rôle côté React (src/buddies/appel.ts). Tout se passe sur le fil principal.
 */
object Appel {
    data class Voix(val id: String, val pseudo: String)
    /** phase : sonne (écran 10), connexion, appel (j'appelle, personne n'a encore répondu), en_ligne (on se parle). */
    data class Etat(
        val id: String, val nom: String, val groupe: String?, val sortie: String?, val phase: String,
        val de: String? = null, val debut: Long? = null, val voix: List<Voix> = emptyList(), val parle: List<String> = emptyList(),
        val muet: Boolean = false,
    )

    /** Sans réponse au bout d'une minute, l'appel s'arrête seul. */
    const val ATTENTE_MS = 60_000L

    var etat: Etat? = null
        private set
    private val abonnes = CopyOnWriteArraySet<(Etat?) -> Unit>()
    /** 👉 Un endroit montré du doigt pendant l'appel (qui : vide quand c'est moi). */
    var onDoigt: ((Double, Double, String) -> Unit)? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var salle: Room? = null
    private var ecoute: Job? = null
    private var minuteur: Job? = null
    private lateinit var app: Context
    private lateinit var compte: Compte

    fun init(c: Context, cpt: Compte) { app = c.applicationContext; compte = cpt }
    fun suivre(f: (Etat?) -> Unit): () -> Unit { abonnes.add(f); return { abonnes.remove(f) } }
    private fun changer(e: Etat?) { etat = e; abonnes.forEach { it(e) } }

    /** « 3:12 » */
    fun duree(ms: Long): String {
        val s = maxOf(0L, ms / 1000)
        return "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
    }

    /** « Julie parle… · Luc » : qui parle d'abord, puis les autres en ligne. */
    fun enLigne(e: Etat): String {
        val parle = e.voix.filter { it.id in e.parle }
        val autres = e.voix.filter { it.id !in e.parle }
        return listOf(
            if (parle.isEmpty()) "" else "${parle.joinToString(", ") { it.pseudo }} parle${if (parle.size > 1) "nt" else ""}…",
            autres.joinToString(", ") { it.pseudo },
        ).filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { "personne encore" }
    }

    private fun raison(e: Throwable) = when (e) {
        is Compte.HorsLigne -> "Pas de réseau : pas d'appel possible"
        else -> e.message ?: "Appel impossible"
    }

    /** 📞 J'appelle un Buddy Group ou un Buddy Time (ou je rejoins l'appel déjà en cours). */
    fun appeler(groupe: String?, sortie: String?, nom: String, erreur: (String) -> Unit) {
        if (etat != null) { erreur("Tu es déjà en appel"); return }
        changer(Etat("", nom, groupe, sortie, "connexion"))
        scope.launch {
            try {
                val r = withContext(Dispatchers.IO) {
                    compte.api("POST", "/appels", JSONObject().put("groupe", groupe ?: JSONObject.NULL).put("sortie", sortie ?: JSONObject.NULL))
                }
                if (etat?.phase == "connexion") entrer(r, nom) // sinon : raccroché pendant la connexion
            } catch (e: Exception) { fini(); erreur(raison(e)) }
        }
    }

    /** L'écran 10 : un buddy m'appelle (message Firebase, appli ouverte ou touchée depuis la notification). */
    fun sonner(s: JSONObject) {
        if (etat != null) return // déjà en appel : on ne coupe pas
        changer(Etat(s.optString("appel"), s.optString("nom"), s.optString("groupe").ifEmpty { null }, s.optString("sortie").ifEmpty { null },
            "sonne", de = s.optString("de")))
        minuteur?.cancel()
        minuteur = scope.launch { delay(45_000); if (etat?.phase == "sonne") changer(null) }
    }

    /** L'appelant a raccroché avant ma réponse. */
    fun finSonnerie(appel: String) { val e = etat; if (e?.phase == "sonne" && e.id == appel) changer(null) }
    fun refuser() { if (etat?.phase == "sonne") changer(null) }

    fun decrocher(erreur: (String) -> Unit) {
        val e = etat ?: return
        if (e.phase != "sonne") return
        changer(e.copy(phase = "connexion"))
        scope.launch {
            try {
                val r = withContext(Dispatchers.IO) { compte.api("POST", "/appels/${e.id}/rejoindre") }
                if (etat?.phase == "connexion") entrer(r, e.nom)
            } catch (x: Exception) { fini(); erreur(raison(x)) }
        }
    }

    private suspend fun entrer(r: JSONObject, nom: String) {
        val room = LiveKit.create(app)
        salle = room
        val id = r.getString("id")
        fun cle(k: String) = r.optString(k).takeIf { it.isNotEmpty() && it != "null" }
        changer(Etat(id, nom, cle("groupe"), cle("sortie"), "appel"))
        ecoute = scope.launch {
            room.events.collect { ev ->
                if (salle !== room) return@collect
                when (ev) {
                    is RoomEvent.ParticipantConnected, is RoomEvent.ParticipantDisconnected -> maj(room)
                    is RoomEvent.ActiveSpeakersChanged -> etat?.let { changer(it.copy(parle = ev.speakers.mapNotNull { p -> p.identity?.value })) }
                    is RoomEvent.DataReceived -> runCatching {
                        val d = JSONObject(String(ev.data, Charsets.UTF_8)).optJSONArray("doigt")
                        if (d != null) onDoigt?.invoke(d.getDouble(0), d.getDouble(1), ev.participant?.name ?: "?")
                    }
                    is RoomEvent.Disconnected -> fini()
                    else -> {}
                }
            }
        }
        room.connect(r.getString("url"), r.getString("jeton"))
        room.localParticipant.setMicrophoneEnabled(true)
        presence(id, true)
        maj(room)
        // J'appelle et personne ne répond : on raccroche seul au bout d'une minute.
        minuteur?.cancel()
        minuteur = scope.launch { delay(ATTENTE_MS); if (etat?.phase == "appel" && salle === room) raccrocher() }
    }

    private fun maj(room: Room) {
        val e = etat ?: return
        if (salle !== room) return
        val v = room.remoteParticipants.values.map { Voix(it.identity?.value ?: "", it.name ?: "?") }
        val ensemble = v.isNotEmpty()
        changer(e.copy(voix = v, phase = if (ensemble || e.phase == "en_ligne") "en_ligne" else "appel",
            debut = e.debut ?: if (ensemble) System.currentTimeMillis() else null))
    }

    private fun presence(id: String, enLigne: Boolean) {
        if (id.isEmpty()) return
        scope.launch { withContext(Dispatchers.IO) { runCatching { compte.api("POST", "/appels/$id/presence", JSONObject().put("en_ligne", enLigne)) } } }
    }

    /** Fin de l'appel : salle oubliée d'abord (la déconnexion qui suit ne refait rien), puis « je ne suis plus en ligne ». */
    private fun fini() {
        val id = etat?.id ?: ""
        val room = salle
        minuteur?.cancel()
        salle = null
        changer(null)
        if (room != null) {
            ecoute?.cancel()
            runCatching { room.disconnect() }
            runCatching { room.release() }
            presence(id, false)
        }
    }

    fun raccrocher() { if (etat?.phase == "sonne") refuser() else fini() }

    fun couperMicro(muet: Boolean) {
        val room = salle ?: return
        scope.launch {
            room.localParticipant.setMicrophoneEnabled(!muet)
            etat?.let { changer(it.copy(muet = muet)) }
        }
    }

    /** 👉 Montrer du doigt un endroit de la carte aux autres (appui long pendant l'appel). */
    fun montrer(lon: Double, lat: Double): Boolean {
        val room = salle ?: return false
        if (etat?.phase != "en_ligne") return false
        val d = JSONObject().put("doigt", JSONArray().put(Math.round(lon * 1e5) / 1e5).put(Math.round(lat * 1e5) / 1e5))
        scope.launch { runCatching { room.localParticipant.publishData(d.toString().toByteArray(Charsets.UTF_8)) } }
        onDoigt?.invoke(lon, lat, "")
        return true
    }
}
