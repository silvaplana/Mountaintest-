package fr.assomoutain.proto

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * 🚵 / 🥾 Circuits VisuGPX (visugpx.com), à côté de Camptocamp dans la liste des itinéraires.
 * L'API demande une clé personnelle : elle reste sur le VPS, l'appli passe par le relais (/visugpx-liste, /visugpx-trace).
 * Comme Camptocamp : toutes dates, du plus proche au plus loin. Même code que src/topos/visugpx.ts côté Capacitor.
 */
object VisuGpx {
    const val ATTRIBUTION = "Circuits © leurs auteurs sur VisuGPX"
    fun link(vid: String) = "https://www.visugpx.com/$vid"

    /** Numéro négatif tiré de l'identifiant VisuGPX : ne croise jamais un numéro Camptocamp (positif). */
    fun num(vid: String): Long {
        var h = 0L
        for (c in vid) h = (h * 31 + c.code) % 2147483647L
        return -(h + 1)
    }

    private fun JSONObject.dbl(k: String) = if (isNull(k) || !has(k)) null else optDouble(k).takeIf { !it.isNaN() }

    fun route(x: JSONObject): Camptocamp.Route {
        val vid = x.getString("id")
        return Camptocamp.Route(num(vid), x.optString("titre", "Circuit $vid"), "", x.getDouble("lon"), x.getDouble("lat"),
            x.optString("duree", ""), x.dbl("denivele_m")?.let { Math.round(it).toInt() }, null, x.dbl("distance_m"), emptyList(),
            src = "visugpx", vid = vid, vdesc = x.optString("description", ""))
    }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("visugpx", Context.MODE_PRIVATE)

    /** Circuits à moins de 25 km du centre de l'écran (VTT en 🚵, randonnée pédestre en 🥾). Réseau : hors du fil principal. */
    fun fetchRoutes(ctx: Context, center: LonLat, vtt: Boolean, password: String): List<Camptocamp.Route> {
        val r = Travel.post("visugpx-liste", JSONObject().put("lat", center.lat).put("lon", center.lon).put("activite", if (vtt) "vtt" else "rando"), password)
        val a = r.optJSONArray("circuits") ?: JSONArray()
        prefs(ctx).edit().putString("liste:$vtt", a.toString()).apply()
        return (0 until a.length()).mapNotNull { runCatching { route(a.getJSONObject(it)) }.getOrNull() }
    }

    /** Dernière liste chargée (hors ligne). */
    fun savedRoutes(ctx: Context, vtt: Boolean): List<Camptocamp.Route>? = runCatching {
        val a = JSONArray(prefs(ctx).getString("liste:$vtt", null) ?: return null)
        (0 until a.length()).mapNotNull { runCatching { route(a.getJSONObject(it)) }.getOrNull() }
    }.getOrNull()

    fun savedSheet(ctx: Context, r: Camptocamp.Route): Camptocamp.Sheet? = runCatching {
        val a = JSONArray(prefs(ctx).getString("trace:${r.vid}", null) ?: return null)
        Camptocamp.Sheet(r, r.vdesc, (0 until a.length()).map { a.getJSONArray(it).let { p -> LonLat(p.getDouble(0), p.getDouble(1)) } })
    }.getOrNull()

    /** Fiche : la description de la liste et le tracé (relais), gardée sur le téléphone. Réseau : hors du fil principal. */
    fun fetchSheet(ctx: Context, r: Camptocamp.Route, password: String): Camptocamp.Sheet {
        savedSheet(ctx, r)?.let { return it }
        val t = Travel.post("visugpx-trace", JSONObject().put("id", r.vid), password).optJSONArray("trace") ?: JSONArray()
        prefs(ctx).edit().putString("trace:${r.vid}", t.toString()).apply()
        return Camptocamp.Sheet(r, r.vdesc, (0 until t.length()).map { t.getJSONArray(it).let { p -> LonLat(p.getDouble(0), p.getDouble(1)) } })
    }
}
