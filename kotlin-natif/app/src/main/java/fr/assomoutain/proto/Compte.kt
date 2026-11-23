package fr.assomoutain.proto

import android.content.SharedPreferences
import android.net.Uri
import android.util.Base64
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Compte Mountain Buddies : connexion par Logto (https://auth.silvaplana.cloud), pensée pour le hors ligne.
 * Même fonctionnement que capacitor/src/compte/auth.ts : les garder identiques.
 *
 * - Se connecter demande du réseau une fois : la page Logto s'ouvre dans le navigateur (code reçu par mail),
 *   puis revient dans l'appli par fr.assomoutain.proto.kotlin://callback (OAuth + PKCE).
 * - Ensuite la session reste sur le téléphone : jeton de renouvellement (180 jours) + profil en cache.
 *   L'appli ne demande jamais le réseau pour s'ouvrir ni pour savoir qui est connecté.
 * - Ce qu'on change hors ligne (pseudo) est mis en attente et envoyé au retour du réseau (synchroniser()).
 * - Une coupure réseau ne déconnecte jamais : seul un refus explicite de Logto demande de se reconnecter.
 *
 * Fonctions réseau bloquantes : à appeler hors du fil principal (Dispatchers.IO).
 */
class Compte(private val prefs: SharedPreferences) {
    companion object {
        const val API_URL = "https://silvaplana.cloud/mountaintest-api"
        const val SCHEMA = "fr.assomoutain.proto.kotlin"
        const val REDIRECT = "$SCHEMA://callback"
        private const val CLE = "compte"
        private val abonnes = mutableSetOf<() -> Unit>()
        fun suivre(f: () -> Unit): () -> Unit { abonnes.add(f); return { abonnes.remove(f) } }
    }

    class HorsLigne : IOException("Pas de réseau")
    class Refuse(m: String) : Exception(m)

    /** État gardé sur le téléphone (JSON dans les préférences, mêmes champs que auth.ts). */
    var etat: JSONObject = runCatching { JSONObject(prefs.getString(CLE, "{}")!!) }.getOrDefault(JSONObject())
        private set

    @Synchronized private fun ecrire(e: JSONObject) {
        etat = e
        prefs.edit().putString(CLE, e.toString()).apply()
        abonnes.toList().forEach { it() }
    }
    private fun modifier(f: JSONObject.() -> Unit) = ecrire(JSONObject(etat.toString()).apply(f))

    val connecte get() = etat.optString("refresh").isNotEmpty()
    val aReconnecter get() = etat.optBoolean("aReconnecter")
    val profil: JSONObject? get() = etat.optJSONObject("profil")
    val email: String get() = profil?.optString("email")?.takeIf { it.isNotEmpty() && it != "null" } ?: etat.optString("email")
    val attentePseudo: String? get() = etat.optJSONObject("attente")?.optString("pseudo")?.takeIf { it.isNotEmpty() }
    val synchro: Long get() = etat.optLong("synchro")
    fun nomAffiche(): String = profil?.optString("pseudo")?.takeIf { it.isNotEmpty() } ?: email.substringBefore("@").ifEmpty { "Moi" }

    // ------------------------------------------------------------ PKCE

    private fun b64(b: ByteArray) = Base64.encodeToString(b, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    private fun aleatoire(n: Int) = ByteArray(n).also { SecureRandom().nextBytes(it) }.let(::b64)
    private fun defi(v: String) = b64(MessageDigest.getInstance("SHA-256").digest(v.toByteArray()))
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
    private fun form(vararg p: Pair<String, String>) = p.joinToString("&") { "${enc(it.first)}=${enc(it.second)}" }

    /** Infos d'un JWT (sans vérifier : le serveur vérifie, ici c'est pour l'affichage). */
    private fun claims(jwt: String) = runCatching {
        JSONObject(String(Base64.decode(jwt.split(".")[1], Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)))
    }.getOrDefault(JSONObject())

    // ------------------------------------------------------------ réseau

    private class Reponse(val code: Int, val corps: String)

    private fun requete(url: String, methode: String = "GET", corps: String? = null, type: String? = null, jeton: String? = null): Reponse {
        try {
            val c = URL(url).openConnection() as HttpURLConnection
            c.requestMethod = methode; c.connectTimeout = 10_000; c.readTimeout = 20_000
            jeton?.let { c.setRequestProperty("Authorization", "Bearer $it") }
            if (corps != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", type ?: "application/json")
                c.outputStream.use { it.write(corps.toByteArray()) }
            }
            val code = c.responseCode
            val txt = (if (code < 400) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            return Reponse(code, txt)
        } catch (e: IOException) { throw HorsLigne() }
    }

    /** Adresse Logto et identifiant de l'appli Kotlin, donnés par le serveur (gardés pour la suite). */
    fun chargerConfig(): JSONObject {
        val r = requete("$API_URL/config")
        if (r.code != 200) throw IOException("Serveur des comptes : erreur ${r.code}")
        val c = JSONObject(r.corps)
        val id = c.optJSONObject("applis")?.optString("kotlin").orEmpty()
        if (id.isEmpty()) throw IOException("Serveur des comptes pas encore configuré")
        return JSONObject().put("logto", c.getString("logto")).put("ressource", c.getString("ressource")).put("appId", id)
            .put("fournisseurs", c.optJSONArray("fournisseurs") ?: org.json.JSONArray())
    }

    /**
     * 1re étape : adresse de la page de connexion Logto (à ouvrir dans le navigateur).
     * Avec un fournisseur ("google", "apple"), Logto envoie tout de suite vers sa page (direct_sign_in).
     */
    fun debutConnexion(config: JSONObject, emailIndique: String?, fournisseur: String? = null): String {
        if (fournisseur != null) {
            val actifs = config.optJSONArray("fournisseurs")
            if (actifs != null && (0 until actifs.length()).none { actifs.optString(it) == fournisseur })
                throw IOException("${if (fournisseur == "google") "Google" else "Apple"} n'est pas encore activé : utilise ton e-mail")
        }
        val verifier = aleatoire(48); val state = aleatoire(16)
        modifier { put("config", config); put("pkce", JSONObject().put("verifier", verifier).put("state", state)) }
        val q = mutableListOf(
            "client_id" to config.getString("appId"), "redirect_uri" to REDIRECT, "response_type" to "code", "state" to state,
            "scope" to "openid offline_access profile email", "resource" to config.getString("ressource"), "prompt" to "consent",
            "code_challenge" to defi(verifier), "code_challenge_method" to "S256", "ui_locales" to "fr",
        )
        if (!emailIndique.isNullOrBlank()) q += "login_hint" to emailIndique.trim()
        if (fournisseur != null) q += "direct_sign_in" to "social:$fournisseur"
        return "${config.getString("logto")}/oidc/auth?${form(*q.toTypedArray())}"
    }

    private fun garderJetons(e: JSONObject, j: JSONObject) {
        e.put("access", j.getString("access_token"))
        e.put("accessExp", System.currentTimeMillis() + (j.optLong("expires_in", 3600) - 60) * 1000)
        e.put("aReconnecter", false)
        j.optString("refresh_token").takeIf { it.isNotEmpty() }?.let { e.put("refresh", it) }
        j.optString("id_token").takeIf { it.isNotEmpty() }?.let { claims(it).optString("email").takeIf { m -> m.isNotEmpty() }?.let { m -> e.put("email", m) } }
    }

    /** 2e étape : retour de la page Logto (fr.assomoutain.proto.kotlin://callback?code=…&state=…). */
    fun finConnexion(uri: Uri) {
        uri.getQueryParameter("error")?.let { throw IOException(uri.getQueryParameter("error_description") ?: it) }
        val config = etat.optJSONObject("config"); val pkce = etat.optJSONObject("pkce")
        if (config == null || pkce == null || uri.getQueryParameter("state") != pkce.optString("state")) throw IOException("Connexion expirée : recommence")
        val r = requete("${config.getString("logto")}/oidc/token", "POST", form(
            "grant_type" to "authorization_code", "code" to (uri.getQueryParameter("code") ?: ""), "redirect_uri" to REDIRECT,
            "client_id" to config.getString("appId"), "code_verifier" to pkce.getString("verifier"), "resource" to config.getString("ressource"),
        ), "application/x-www-form-urlencoded")
        if (r.code != 200) throw IOException("Connexion refusée (${r.code})")
        modifier { remove("pkce"); garderJetons(this, JSONObject(r.corps)) }
        runCatching { synchroniser() }
    }

    /** Jeton d'accès valide, renouvelé si besoin. HorsLigne sans réseau ; Refuse si Logto ne veut plus. */
    fun jetonAcces(): String {
        val e = etat
        val config = e.optJSONObject("config")
        if (!connecte || config == null) throw Refuse("Pas connecté")
        if (e.optString("access").isNotEmpty() && e.optLong("accessExp") > System.currentTimeMillis()) return e.getString("access")
        val r = requete("${config.getString("logto")}/oidc/token", "POST", form(
            "grant_type" to "refresh_token", "refresh_token" to e.getString("refresh"),
            "client_id" to config.getString("appId"), "resource" to config.getString("ressource"),
        ), "application/x-www-form-urlencoded")
        if (r.code == 400 || r.code == 401) {
            // invalid_grant : jeton expiré (180 jours) ou révoqué. On garde le profil, on demande de se reconnecter.
            modifier { remove("access"); put("aReconnecter", true) }
            throw Refuse("Session expirée : reconnecte-toi")
        }
        if (r.code != 200) throw HorsLigne()
        modifier { garderJetons(this, JSONObject(r.corps)) }
        return etat.getString("access")
    }

    fun api(methode: String, chemin: String, corps: JSONObject? = null): JSONObject {
        val r = requete("$API_URL$chemin", methode, corps?.toString(), null, jetonAcces())
        if (r.code == 401) { modifier { remove("access") }; throw Refuse("Jeton refusé") }
        // Refus du serveur (409) : sa raison, à montrer telle quelle (ex. « L'appel est terminé »).
        if (r.code == 409) throw Refuse(runCatching { JSONObject(r.corps).getString("detail") }.getOrDefault("Refusé"))
        if (r.code != 200) throw IOException("Serveur : erreur ${r.code}")
        return JSONObject(r.corps)
    }

    /** Fichier envoyé ou lu (photos de l'album) : même jeton que `api`. Bloquant : hors du fil principal. */
    fun fichier(methode: String, chemin: String, corps: ByteArray? = null): ByteArray {
        val jeton = jetonAcces()
        val (code, octets) = try {
            val c = URL("$API_URL$chemin").openConnection() as HttpURLConnection
            c.requestMethod = methode; c.connectTimeout = 10_000; c.readTimeout = 60_000
            c.setRequestProperty("Authorization", "Bearer $jeton")
            if (corps != null) {
                c.doOutput = true; c.setRequestProperty("Content-Type", "image/jpeg"); c.setFixedLengthStreamingMode(corps.size)
                c.outputStream.use { it.write(corps) }
            }
            val code = c.responseCode
            code to ((if (code < 400) c.inputStream else c.errorStream)?.use { it.readBytes() } ?: ByteArray(0))
        } catch (e: IOException) { throw HorsLigne() }
        if (code == 401) { modifier { remove("access") }; throw Refuse("Jeton refusé") }
        if (code != 200) throw IOException("Serveur : erreur $code")
        return octets
    }

    /** Envoie ce qui attend, puis récupère le profil. Sans réseau : HorsLigne, rien n'est perdu. */
    fun synchroniser() {
        if (!connecte) return
        val attente = attentePseudo
        val p = if (attente != null) {
            api("PUT", "/moi", JSONObject().put("pseudo", attente)).also {
                if (attentePseudo == attente) modifier { optJSONObject("attente")?.remove("pseudo") }
            }
        } else api("GET", "/moi")
        modifier { put("profil", p); put("synchro", System.currentTimeMillis()) }
    }

    /** Changer son pseudo : tout de suite sur le téléphone, envoyé au serveur dès que possible. */
    fun changerPseudo(pseudo: String) {
        val p = pseudo.replace(Regex("\\s+"), " ").trim().take(40)
        require(p.isNotEmpty()) { "Le pseudo ne peut pas être vide" }
        modifier {
            optJSONObject("profil")?.put("pseudo", p)
            put("attente", (optJSONObject("attente") ?: JSONObject()).put("pseudo", p))
        }
        runCatching { synchroniser() }
    }

    /** Se déconnecter : oublie la session (les traces et le reste de l'appli ne bougent pas). */
    fun deconnecter() {
        val e = etat
        ecrire(JSONObject().apply { e.optJSONObject("config")?.let { put("config", it) } })
        val config = e.optJSONObject("config") ?: return
        val refresh = e.optString("refresh").ifEmpty { return }
        // Révocation côté Logto si le réseau est là ; sinon le jeton expirera tout seul.
        runCatching {
            requete("${config.getString("logto")}/oidc/token/revocation", "POST",
                form("token" to refresh, "client_id" to config.getString("appId")), "application/x-www-form-urlencoded")
        }
    }
}
