package fr.assomoutain.proto

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.Locale

/** Trace dessinée au doigt, enregistrée sur le téléphone (hors ligne, sans compte). */
data class SavedTrace(val id: Long, val name: String, val onPaths: Boolean, val line: List<LonLat>) {
    val distanceM get() = Trails.lineLengthM(line)
}

/** Même format que savedTraces.ts côté Capacitor : une liste JSON dans les préférences. */
class SavedTraces(ctx: Context) {
    private val prefs = ctx.getSharedPreferences("traces", Context.MODE_PRIVATE)

    fun list(): List<SavedTrace> = runCatching {
        val arr = JSONArray(prefs.getString(KEY, "[]"))
        (0 until arr.length()).mapNotNull { i ->
            val o = arr.optJSONObject(i) ?: return@mapNotNull null
            val l = o.optJSONArray("line") ?: return@mapNotNull null
            val line = (0 until l.length()).mapNotNull { k -> l.optJSONArray(k)?.let { LonLat(it.getDouble(0), it.getDouble(1)) } }
            if (line.size < 2) null else SavedTrace(o.getLong("id"), o.optString("name", "Tracé"), o.optBoolean("onPaths"), line)
        }
    }.getOrDefault(emptyList())

    private fun write(all: List<SavedTrace>) {
        val arr = JSONArray()
        all.forEach { t ->
            arr.put(JSONObject().put("id", t.id).put("name", t.name).put("onPaths", t.onPaths).put("line", JSONArray().apply {
                t.line.forEach { p -> put(JSONArray().put(round5(p.lon)).put(round5(p.lat))) }
            }))
        }
        prefs.edit().putString(KEY, arr.toString()).apply()
    }

    fun save(name: String, line: List<LonLat>, onPaths: Boolean): SavedTrace {
        val t = SavedTrace(System.currentTimeMillis(), name, onPaths, line)
        write(listOf(t) + list())
        return t
    }

    fun delete(id: Long) = write(list().filter { it.id != id })

    companion object {
        private const val KEY = "tracesEnregistrees"
        private fun round5(v: Double) = Math.round(v * 1e5) / 1e5

        /** Nom proposé : « Tracé du 5/11 à 14h32 ». */
        fun defaultName(c: Calendar = Calendar.getInstance()) = String.format(Locale.FRANCE, "Tracé du %d/%d à %dh%02d",
            c.get(Calendar.DAY_OF_MONTH), c.get(Calendar.MONTH) + 1, c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE))
    }
}

/**
 * Mes traces affichées sur la carte et le suivi en cours, gardés quand l'appli se ferme (demande de Seb) :
 * à la réouverture, les traces sont toujours là et le suivi reprend. Même format que shownTraces.ts côté Capacitor.
 */
object ShownTraces {
    data class State(val trails: List<Trail>, val navId: Long?, val navPaused: Boolean)
    private const val KEY = "tracesAffichees"

    fun save(ctx: Context, trails: List<Trail>, navId: Long?, navPaused: Boolean) {
        val arr = JSONArray()
        trails.filter { Trails.isMine(it.id) }.forEach { t ->
            arr.put(JSONObject().put("id", t.id).put("name", t.name).put("kind", t.kind).put("color", t.color)
                .put("onPaths", t.onPaths).put("savedId", t.savedId ?: JSONObject.NULL)
                .put("segments", JSONArray().apply {
                    t.segments.forEach { s -> put(JSONArray().apply { s.forEach { p -> put(JSONArray().put(p.lon).put(p.lat)) } }) }
                }))
        }
        val o = JSONObject().put("trails", arr).put("navId", navId ?: JSONObject.NULL).put("navPaused", navPaused)
        ctx.getSharedPreferences("traces", Context.MODE_PRIVATE).edit().putString(KEY, o.toString()).apply()
    }

    fun load(ctx: Context): State = runCatching {
        val o = JSONObject(ctx.getSharedPreferences("traces", Context.MODE_PRIVATE).getString(KEY, null) ?: return State(emptyList(), null, false))
        val arr = o.optJSONArray("trails") ?: JSONArray()
        val trails = (0 until arr.length()).mapNotNull { i ->
            val t = arr.getJSONObject(i)
            val segsJ = t.getJSONArray("segments")
            val segs = (0 until segsJ.length()).map { k ->
                val s = segsJ.getJSONArray(k)
                (0 until s.length()).map { j -> s.getJSONArray(j).let { LonLat(it.getDouble(0), it.getDouble(1)) } }
            }.filter { it.size >= 2 }
            if (segs.isEmpty()) null
            else Trail(t.getLong("id"), t.optString("name", "Tracé"), t.optString("kind", ""), 0, t.optString("color", "#7b3fe4"),
                segs, Trails.lengthM(segs), t.optBoolean("onPaths"), if (t.isNull("savedId")) null else t.getLong("savedId"))
        }
        val nav = if (o.isNull("navId")) null else o.getLong("navId")
        State(trails, nav?.takeIf { id -> trails.any { it.id == id } }, o.optBoolean("navPaused"))
    }.getOrDefault(State(emptyList(), null, false))
}
