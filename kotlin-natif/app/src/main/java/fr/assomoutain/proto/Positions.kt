package fr.assomoutain.proto

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.util.Base64
import java.util.Calendar
import kotlin.math.roundToInt

/**
 * Position des buddies (spec/buddies.md §5.9, écran 15) : les calculs, sans écran.
 * Même calcul que capacitor/src/buddies/positions.ts : les garder identiques.
 *
 * - N'apparaissent que ceux qui ont enfoncé l'épingle dans ce Buddy Time (le serveur ne garde rien d'autre).
 * - Chaque position porte l'heure de la dernière reçue et grise en vieillissant ; épingle relevée : grisée.
 */
object Positions {
    /** Au-delà, une épingle enfoncée sans nouvelle position : « plus de réseau ? ». */
    const val SANS_NOUVELLES_MIN = 20

    /** L'épingle se relève seule ce soir à 22 h (à minuit si on l'enfonce après 21 h). */
    fun finEpingle(t: Long): Long = Calendar.getInstance().apply {
        timeInMillis = t
        val tard = get(Calendar.HOUR_OF_DAY) >= 21
        set(Calendar.HOUR_OF_DAY, if (tard) 23 else 22); set(Calendar.MINUTE, if (tard) 59 else 0)
        set(Calendar.SECOND, if (tard) 59 else 0); set(Calendar.MILLISECOND, 0)
    }.timeInMillis

    data class Repere(val b: Buddies.Buddy, val p: Buddies.Position, val moi: Boolean, val actif: Boolean, val age: Int) {
        val lat get() = p.lat!!
        val lon get() = p.lon!!
    }

    /** Les buddies visibles de ce Buddy Time (moi compris), les plus récents d'abord. */
    fun reperes(x: Buddies.Sortie, ps: List<Buddies.Position>, moi: String?, t: Long = System.currentTimeMillis()): List<Repere> =
        x.participants.mapNotNull { b ->
            val p = ps.firstOrNull { it.sortie == x.id && it.qui == b.id } ?: return@mapNotNull null
            if (p.lat == null || p.lon == null || p.priseLe == null) return@mapNotNull null
            Repere(b, p, b.id == moi || b.id == "moi", p.jusqu > t, maxOf(0, ((t - p.priseLe) / 60_000.0).roundToInt()))
        }.sortedWith(compareByDescending<Repere> { it.actif }.thenByDescending { it.p.priseLe })

    fun heureCourte(ms: Long): String = Calendar.getInstance().apply { timeInMillis = ms }.let {
        "${it.get(Calendar.HOUR_OF_DAY)} h ${it.get(Calendar.MINUTE).toString().padStart(2, '0')}"
    }

    /** « toi », « à l'instant », « il y a 4 min », sinon l'heure : « 10 h 42 ». */
    fun etiquette(r: Repere): String = when {
        r.moi -> "toi"
        r.age < 1 -> "à l'instant"
        r.age < 60 -> "il y a ${r.age} min"
        else -> heureCourte(r.p.priseLe!!)
    }

    /** Grise en vieillissant ; épingle relevée : pâle. */
    fun opacite(r: Repere): Float = when {
        !r.actif -> 0.5f
        r.age <= SANS_NOUVELLES_MIN -> 1f
        r.age <= 60 -> 0.8f
        else -> 0.6f
    }

    /** « à 1,2 km de toi · 2 310 m · plus de réseau ? » */
    fun detail(r: Repere, moi: Repere?): String {
        val d = if (moi != null && !r.moi) Trails.distanceM(LonLat(moi.lon, moi.lat), LonLat(r.lon, r.lat)) else null
        return listOfNotNull(
            d?.let { "à ${if (it < 1000) "${(it / 10).roundToInt() * 10} m" else Carnet.km(it.roundToInt())} de toi" },
            r.p.alt?.let { Carnet.metres(it) },
            "plus de réseau ?".takeIf { r.actif && r.age > SANS_NOUVELLES_MIN },
            "a relevé l'épingle".takeIf { !r.actif },
        ).joinToString(" · ")
    }

    /** Pendant le Buddy Time (le jour même compris) : on peut enfoncer l'épingle. */
    fun pendant(x: Buddies.Sortie, auj: String) = x.debut <= auj && auj <= x.fin

    private val couleurs = listOf("#2F6F4F", "#3F6FB5", "#8A4FB0", "#C9862B", "#2C8C8C", "#B5534A").map(Color::parseColor)

    /** Le visage sur la carte, avec « toi », « il y a 4 min » ou l'heure dessous (écran 15). */
    fun marqueur(r: Repere, d: Float): Bitmap {
        val tv = 44 * d; val bord = 3 * d
        val txt = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textSize = 14 * d; isFakeBoldText = true; textAlign = Paint.Align.CENTER }
        val e = etiquette(r)
        val w = maxOf(tv, txt.measureText(e) + 16 * d); val hEt = 22 * d
        val out = Bitmap.createBitmap(w.toInt() + 2, (tv + 3 * d + hEt).toInt() + 2, Bitmap.Config.ARGB_8888)
        val c = Canvas(out)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        val cx = w / 2
        p.color = Color.WHITE; c.drawCircle(cx, tv / 2, tv / 2, p)
        val photo = r.b.photo?.takeIf { it.startsWith("data:image/") }?.let {
            runCatching { Base64.decode(it.substringAfter(","), Base64.DEFAULT).let { b -> BitmapFactory.decodeByteArray(b, 0, b.size) } }.getOrNull()
        }
        val rond = tv / 2 - bord
        if (photo != null) {
            val s = minOf(photo.width, photo.height)
            val carre = Bitmap.createScaledBitmap(Bitmap.createBitmap(photo, (photo.width - s) / 2, (photo.height - s) / 2, s, s), (2 * rond).toInt(), (2 * rond).toInt(), true)
            p.shader = android.graphics.BitmapShader(carre, android.graphics.Shader.TileMode.CLAMP, android.graphics.Shader.TileMode.CLAMP).apply {
                setLocalMatrix(android.graphics.Matrix().apply { setTranslate(cx - rond, tv / 2 - rond) })
            }
            c.drawCircle(cx, tv / 2, rond, p); p.shader = null
        } else {
            p.color = couleurs[Math.floorMod(r.b.id.sumOf { it.code }, couleurs.size)]
            c.drawCircle(cx, tv / 2, rond, p)
            val ini = Paint(txt).apply { textSize = 20 * d }
            c.drawText(r.b.pseudo.take(1).uppercase(), cx, tv / 2 - (ini.ascent() + ini.descent()) / 2, ini)
        }
        p.color = Color.parseColor(if (r.moi) "#2F6F4F" else if (r.actif) "#1D2421" else "#7A817E")
        val y0 = tv + 3 * d
        c.drawRoundRect(RectF(0f, y0, w, y0 + hEt), 10 * d, 10 * d, p)
        c.drawText(e, cx, y0 + hEt / 2 - (txt.ascent() + txt.descent()) / 2, txt)
        if (opacite(r) < 1f) {
            val o = Bitmap.createBitmap(out.width, out.height, Bitmap.Config.ARGB_8888)
            Canvas(o).drawBitmap(out, 0f, 0f, Paint().apply { alpha = (opacite(r) * 255).toInt() })
            return o
        }
        return out
    }
}
