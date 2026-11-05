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
