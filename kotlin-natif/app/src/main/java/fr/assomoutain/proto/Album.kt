package fr.assomoutain.proto

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import java.io.ByteArrayOutputStream
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Album d'un Buddy Time (spec/buddies.md §5.8) : les fichiers des photos. Même fonctionnement que
 * capacitor/src/buddies/album.ts.
 *
 * - Déposer : la photo est réduite sur le téléphone (petite 400 px pour la grille, grande 1600 px pour la voir),
 *   gardée ici (dossier de l'appli) et envoyée au retour du réseau (PUT /buddies/photos/<id>/<taille>).
 * - Voir : petite et grande sont lues une fois sur le serveur puis gardées : l'album s'ouvre sans réseau.
 * - L'heure et le lieu de prise de vue sont lus dans la photo (EXIF) quand le téléphone les y a laissés.
 * Tout est bloquant : à appeler hors du fil principal.
 */
class Album(context: Context, private val compte: Compte) {
    private val dossier = File(context.filesDir, "buddies-photos").apply { mkdirs() }
    private fun f(id: String, taille: String) = File(dossier, "$id-$taille.jpg")

    fun garder(id: String, taille: String, octets: ByteArray) {
        val t = File(dossier, "$id-$taille.tmp"); t.writeBytes(octets); t.renameTo(f(id, taille))
    }
    fun oublier(id: String) { for (t in TAILLES.keys) f(id, t).delete() }

    /** Fichier de la photo : gardé, sinon lu sur le serveur puis gardé ; null sans réseau ou pas encore arrivée. */
    fun fichier(id: String, taille: String, envoyee: Boolean): File? {
        val x = f(id, taille)
        if (x.exists()) return x
        if (!envoyee) return null
        return runCatching { garder(id, taille, compte.fichier("GET", "/buddies/photos/$id/$taille")); x }.getOrNull()
    }
    private val images = object : android.util.LruCache<String, Bitmap>(24 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }
    fun image(id: String, taille: String, envoyee: Boolean): Bitmap? {
        images.get("$id-$taille")?.let { return it }
        val x = fichier(id, taille, envoyee) ?: return null
        return BitmapFactory.decodeFile(x.path)?.also { images.put("$id-$taille", it) }
    }

    /** Envoie le fichier d'une photo (petite puis grande). Un fichier perdu (stockage vidé) est sauté. */
    fun envoyer(id: String) {
        for (t in TAILLES.keys) {
            val x = f(id, t)
            if (!x.exists()) return
            compte.fichier("PUT", "/buddies/photos/$id/$t", x.readBytes())
        }
    }

    data class Preparee(val priseLe: String, val lon: Double?, val lat: Double?, val petite: ByteArray, val grande: ByteArray)

    /** Lit l'heure et le lieu de la photo, la tourne dans le bon sens et la réduit. */
    fun preparer(context: Context, uri: Uri): Preparee {
        val r = context.contentResolver
        val exif = r.openInputStream(uri)!!.use { ExifInterface(it) }
        val quand = (exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL) ?: exif.getAttribute(ExifInterface.TAG_DATETIME))
            ?.let { d -> Regex("^(\\d{4}):(\\d{2}):(\\d{2}) (\\d{2}:\\d{2}:\\d{2})").find(d)?.groupValues?.let { "${it[1]}-${it[2]}-${it[3]}T${it[4]}" } }
            ?: SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).format(Date())
        val ll = FloatArray(2)
        @Suppress("DEPRECATION") val gps = exif.getLatLong(ll) && (ll[0] != 0f || ll[1] != 0f)
        val rotation = when (exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f; ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f; else -> 0f
        }
        // Lecture déjà réduite (puissance de 2), puis taille exacte.
        val dims = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        r.openInputStream(uri)!!.use { BitmapFactory.decodeStream(it, null, dims) }
        var ech = 1
        while (maxOf(dims.outWidth, dims.outHeight) / (ech * 2) >= TAILLES.getValue("grande")) ech *= 2
        val src = r.openInputStream(uri)!!.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = ech }) }
            ?: throw IllegalArgumentException("Photo illisible")
        fun jpeg(px: Int, q: Int): ByteArray {
            val k = minOf(1f, px.toFloat() / maxOf(src.width, src.height))
            val m = Matrix().apply { postScale(k, k); postRotate(rotation) }
            val b = Bitmap.createBitmap(src, 0, 0, src.width, src.height, m, true)
            return ByteArrayOutputStream().also { b.compress(Bitmap.CompressFormat.JPEG, q, it) }.toByteArray()
        }
        return Preparee(quand, if (gps) ll[1].toDouble() else null, if (gps) ll[0].toDouble() else null,
            jpeg(TAILLES.getValue("petite"), 70), jpeg(TAILLES.getValue("grande"), 80))
    }

    companion object {
        val TAILLES = linkedMapOf("petite" to 400, "grande" to 1600)
    }
}
