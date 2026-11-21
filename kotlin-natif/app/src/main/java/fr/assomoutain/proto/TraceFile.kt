package fr.assomoutain.proto

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import androidx.activity.result.contract.ActivityResultContract
import org.json.JSONArray
import org.json.JSONObject
import org.w3c.dom.Document
import org.w3c.dom.Element
import javax.xml.parsers.DocumentBuilderFactory

/**
 * 📥 Trace chargée depuis un fichier du téléphone (GPX, KML ou GeoJSON) : elle s'ajoute aux traces affichées
 * et on peut naviguer dessus. Même lecture que src/trails/traceFile.ts côté Capacitor.
 */
object TraceFile {
    data class Parsed(val name: String, val line: List<LonLat>)

    /** Nom du fichier sans son extension, utilisé quand le fichier ne donne pas de nom. */
    fun baseName(fileName: String) =
        fileName.substringAfterLast('/').substringAfterLast('\\').let { if (it.contains('.')) it.substringBeforeLast('.') else it }
            .trim().ifEmpty { "Trace chargée" }

    private fun ok(p: LonLat) = !p.lon.isNaN() && !p.lat.isNaN() && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180

    private fun tags(n: Any, name: String): List<Element> {
        val list = when (n) { is Document -> n.getElementsByTagNameNS("*", name); is Element -> n.getElementsByTagNameNS("*", name); else -> null }
            ?: return emptyList()
        return (0 until list.length).map { list.item(it) as Element }
    }
    private fun firstText(n: Any, name: String) = tags(n, name).firstOrNull()?.textContent?.trim().orEmpty()
    private fun num(s: String?) = s?.trim()?.toDoubleOrNull() ?: Double.NaN

    private fun fromGpx(doc: Document): Parsed {
        var pts = tags(doc, "trkpt")
        if (pts.isEmpty()) pts = tags(doc, "rtept")
        val line = pts.map { LonLat(num(it.getAttribute("lon")), num(it.getAttribute("lat"))) }
        val holder = tags(doc, "trk").firstOrNull() ?: tags(doc, "rte").firstOrNull() ?: tags(doc, "metadata").firstOrNull()
        return Parsed(holder?.let { firstText(it, "name") }?.ifEmpty { null } ?: firstText(doc, "name"), line)
    }

    private fun fromKml(doc: Document): Parsed {
        val line = ArrayList<LonLat>()
        for (ls in tags(doc, "LineString")) {
            for (c in firstText(ls, "coordinates").split(Regex("\\s+"))) {
                if (c.isEmpty()) continue
                val v = c.split(',')
                line += LonLat(num(v.getOrNull(0)), num(v.getOrNull(1)))
            }
        }
        if (line.isEmpty()) for (c in tags(doc, "coord")) {
            val v = c.textContent.trim().split(Regex("\\s+"))
            line += LonLat(num(v.getOrNull(0)), num(v.getOrNull(1)))
        }
        val pm = tags(doc, "Placemark").firstOrNull { tags(it, "LineString").isNotEmpty() || tags(it, "Track").isNotEmpty() }
        return Parsed(pm?.let { firstText(it, "name") }?.ifEmpty { null } ?: firstText(doc, "name"), line)
    }

    private fun fromGeoJson(text: String): Parsed {
        val line = ArrayList<LonLat>()
        var name = ""
        fun add(cs: JSONArray?) { if (cs != null) for (i in 0 until cs.length()) cs.optJSONArray(i)?.let { line += LonLat(it.optDouble(0), it.optDouble(1)) } }
        fun geom(g: JSONObject?) {
            when (g?.optString("type")) {
                "LineString" -> add(g.optJSONArray("coordinates"))
                "MultiLineString" -> g.optJSONArray("coordinates")?.let { m -> for (i in 0 until m.length()) add(m.optJSONArray(i)) }
                "GeometryCollection" -> g.optJSONArray("geometries")?.let { m -> for (i in 0 until m.length()) geom(m.optJSONObject(i)) }
            }
        }
        fun feat(f: JSONObject?) {
            if (f == null) return
            val before = line.size
            geom(f.optJSONObject("geometry"))
            val n = f.optJSONObject("properties")?.optString("name").orEmpty()
            if (name.isEmpty() && line.size > before && n.isNotEmpty()) name = n
        }
        val root = JSONObject(text)
        when (root.optString("type")) {
            "FeatureCollection" -> root.optJSONArray("features")?.let { fs -> for (i in 0 until fs.length()) feat(fs.optJSONObject(i)) }
            "Feature" -> feat(root)
            else -> geom(root)
        }
        return Parsed(name.ifEmpty { root.optString("name") }, line)
    }

    /** Lit un fichier de trace d'après son contenu (le nom du fichier sert de secours pour le nom). */
    fun parse(text: String, fileName: String = ""): Parsed {
        val t = text.removePrefix("﻿").trimStart()
        val res = if (t.startsWith("{")) fromGeoJson(t) else {
            val doc = runCatching {
                DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder()
                    .parse(t.byteInputStream(Charsets.UTF_8))
            }.getOrElse { throw IllegalArgumentException("fichier illisible") }
            when (doc.documentElement.localName?.lowercase() ?: doc.documentElement.tagName.lowercase()) {
                "gpx" -> fromGpx(doc)
                "kml" -> fromKml(doc)
                else -> throw IllegalArgumentException("format inconnu (GPX, KML ou GeoJSON attendu)")
            }
        }
        val line = res.line.filter { ok(it) }
        if (line.size < 2) throw IllegalArgumentException("aucune trace dans ce fichier")
        return Parsed(res.name.ifEmpty { baseName(fileName) }, line)
    }

    // ---------- Sélecteur de fichier : dernier dossier utilisé, sinon Téléchargements ----------

    private const val PREFS = "traceFile"
    private const val LAST = "dernierDossier"

    /** Dossier du dernier fichier choisi, sinon Téléchargements (même règle que TraceFilePlugin.java côté Capacitor). */
    fun initialUri(ctx: Context): Uri {
        val last = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(LAST, null)
        if (last != null) {
            val u = Uri.parse(last)
            // Stockage interne : on remonte au dossier du fichier. Ailleurs, Android ouvre le dossier du fichier donné.
            if (u.authority == "com.android.externalstorage.documents") runCatching {
                val id = DocumentsContract.getDocumentId(u)
                val cut = id.lastIndexOf('/')
                val parent = if (cut > 0) id.substring(0, cut) else id.substring(0, id.indexOf(':') + 1)
                return DocumentsContract.buildDocumentUri(u.authority, parent)
            }
            return u
        }
        return DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:Download")
    }

    fun remember(ctx: Context, uri: Uri) =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(LAST, uri.toString()).apply()

    fun displayName(ctx: Context, uri: Uri): String =
        runCatching {
            ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0) else null
            }
        }.getOrNull() ?: uri.lastPathSegment.orEmpty()

    /** Lit le fichier choisi (30 Mo au plus) et retient son dossier pour la prochaine fois. */
    fun read(ctx: Context, uri: Uri, rememberFolder: Boolean = true): Pair<String, String> {
        val bytes = ctx.contentResolver.openInputStream(uri)?.use { input ->
            val out = java.io.ByteArrayOutputStream()
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf); if (n <= 0) break
                out.write(buf, 0, n)
                if (out.size() > 30 * 1024 * 1024) throw IllegalArgumentException("fichier trop gros")
            }
            out.toByteArray()
        } ?: throw IllegalArgumentException("fichier inaccessible")
        // Fichier venu de Gmail ou d'une autre appli : ce n'est pas un dossier où revenir.
        if (rememberFolder) remember(ctx, uri)
        return displayName(ctx, uri) to String(bytes, Charsets.UTF_8)
    }

    /** Fichier reçu par « Ouvrir avec » (VIEW) ou « Partager » (SEND). */
    @Suppress("DEPRECATION")
    fun sharedUri(intent: Intent?): Uri? = when (intent?.action) {
        Intent.ACTION_VIEW -> intent.data
        Intent.ACTION_SEND -> intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri
        else -> null
    }

    /** Contrat du sélecteur : ACTION_OPEN_DOCUMENT ouvert dans le dossier initial. */
    class Pick : ActivityResultContract<Unit, Uri?>() {
        override fun createIntent(context: Context, input: Unit) = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            // Beaucoup de téléphones ne connaissent pas le type « GPX » : on accepte tout, la lecture trie.
            type = "*/*"
            if (Build.VERSION.SDK_INT >= 26) putExtra(DocumentsContract.EXTRA_INITIAL_URI, initialUri(context))
        }
        override fun parseResult(resultCode: Int, intent: Intent?) = if (resultCode == Activity.RESULT_OK) intent?.data else null
    }
}
