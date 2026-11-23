package fr.assomoutain.proto

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Un Buddy Time sur la carte (écran 4, spec/buddies.md §5.4) : ‹ nom et dates en haut, bandeau rabattable en
 * bas (dans combien de jours, qui vient, chiffres du parcours). Le reste de l'écran reste à la carte.
 * Même écran que BandeauSortie dans src/buddies/Buddies.tsx.
 */
object BandeauSortie {
    /** Bandeau replié ou non : gardé quand le bandeau est redessiné (nouvelles photos). */
    var replie = false
    /** 📍 Écran 15 ouvert (la position des buddies à la place du bandeau). */
    var positions = false

    fun vue(a: androidx.appcompat.app.AppCompatActivity, x: Buddies.Sortie, traces: List<Buddies.TraceBuddy>, haut: Int, bas: Int,
            photos: List<Buddies.PhotoBuddy>, album: Album, depense: Int, reperes: List<Positions.Repere>, epingle: Buddies.Position?,
            hebergements: List<Buddies.Hebergement>, onDodo: () -> Unit,
            onEnfoncer: () -> Unit, onRelever: () -> Unit, onRedessiner: () -> Unit, onAlbum: () -> Unit, onCarnet: () -> Unit, onCount: () -> Unit,
            /** 💬 Écrans 6 et 24 : la conversation ouverte (son fil défile dans `filConv`), à la place du bandeau. */
            conversation: ConversationVue? = null, filConv: View? = null, nonLus: Int = 0, apercu: String = "",
            onParler: () -> Unit = {}, onFinParler: () -> Unit = {},
            /** 📞 Appel en cours dans ce Buddy Time, que je n'ai pas encore rejoint. */
            appel: Buddies.AppelBuddy? = null, onAppel: () -> Unit = {},
            onAjouter: () -> Unit, onRetour: () -> Unit): View {
        val d = a.resources.displayMetrics.density
        fun dp(v: Int) = (v * d).toInt()
        val ink = Color.parseColor("#1D2421"); val muted = Color.parseColor("#5F6B66"); val card = Color.parseColor("#F2F4F1")
        fun text(t: String, size: Float = 17f, color: Int = ink, bold: Boolean = false) = TextView(a).apply {
            text = t; textSize = size; setTextColor(color); if (bold) setTypeface(typeface, Typeface.BOLD)
        }
        val jour = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val auj = jour.format(Date())
        fun ms(s: String) = runCatching { jour.parse(s)!!.time }.getOrDefault(0L)
        fun court(s: String) = SimpleDateFormat("EEE d MMM", Locale.FRANCE).format(Date(ms(s)))
        val n = Math.round((ms(x.debut) - ms(auj)) / 86_400_000.0).toInt()
        val quand = when { x.fin < auj -> "Souvenir"; n <= 0 -> "En cours"; n == 1 -> "Demain"; else -> "Dans $n jours" }
        val dates = if (x.fin == x.debut) court(x.debut) else "${court(x.debut)} – ${court(x.fin)}"
        val km = traces.sumOf { Trails.lineLengthM(it.ligne) } / 1000
        val visibles = reperes.count { it.actif && !it.moi }
        val pendant = Positions.pendant(x, auj)
        if (!pendant) positions = false
        val accent = Color.parseColor("#2F6F4F")

        val racine = FrameLayout(a).apply { elevation = 22 * d; layoutParams = FrameLayout.LayoutParams(-1, -1) }
        // Haut : ‹ nom, dates, lieu
        racine.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL; setPadding(dp(4), dp(4), dp(14), dp(4))
            background = GradientDrawable().apply { cornerRadius = 26 * d; setColor(Color.WHITE) }
            elevation = 4 * d
            addView(Button(a).apply {
                text = "‹"; textSize = 22f; setPadding(0, 0, 0, 0); minWidth = 0; minimumWidth = 0; minHeight = 0; minimumHeight = 0
                background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(card) }
                contentDescription = "Retour aux Buddies"; setOnClickListener { onRetour() }
            }, LinearLayout.LayoutParams(dp(44), dp(44)))
            addView(LinearLayout(a).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(8), 0, 0, 0)
                addView(text(x.nom, 17f, bold = true).apply { isSingleLine = true })
                addView(text(if (conversation != null) "💬 ${x.participants.size} ${if (x.participants.size > 1) "buddies" else "buddy"} + Bud"
                    else if (positions) "📍 ${if (visibles == 0) "aucun" else "$visibles"} ${if (visibles > 1) "buddies visibles" else "buddy visible"}"
                    else dates + if (x.lieu.isNotEmpty()) " · ${x.lieu}" else "", 14f, muted).apply { isSingleLine = true })
            })
        }, FrameLayout.LayoutParams(-1, -2, Gravity.TOP).apply { setMargins(dp(10), haut + dp(10), dp(72), 0) })

        // Bas : bandeau qui se replie en touchant la poignée
        val contenu = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            addView(text(quand, 20f, bold = true))
            val invites = x.invitations.filter { it.canal != "qr" }.joinToString(" · ") { "${it.nom} ?" }
            addView(text("👥 ${x.participants.joinToString(", ") { it.pseudo }}" + if (invites.isNotEmpty()) " · $invites" else "", 15f, muted))
            addView(LinearLayout(a).apply {
                fun chiffre(v: String, l: String) = LinearLayout(a).apply {
                    orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setPadding(dp(8), dp(8), dp(8), dp(8))
                    background = GradientDrawable().apply { cornerRadius = 12 * d; setColor(card) }
                    addView(text(v, 20f, bold = true)); addView(text(l, 14f, muted))
                }
                addView(chiffre(if (traces.isEmpty()) "—" else "%.1f km".format(km), if (traces.size > 1) "${traces.size} traces" else "parcours"),
                    LinearLayout.LayoutParams(0, -2, 1f).apply { rightMargin = dp(8) })
                addView(chiffre(if (x.fin >= auj) "${maxOf(0, n)}" else "✓", if (x.fin >= auj) "jours avant" else "souvenir"), LinearLayout.LayoutParams(0, -2, 1f).apply { rightMargin = dp(8) })
                // 💶 Buddy count (écran 8) : le total, un toucher ouvre les comptes.
                addView(chiffre("💶 " + if (depense > 0) BuddyCount.euros(depense) else "＋", if (depense > 0) "à ${x.participants.size}" else "Buddy count").apply {
                    isClickable = true; setOnClickListener { onCount() }; (getChildAt(0) as TextView).apply { textSize = 18f; isSingleLine = true }
                }, LinearLayout.LayoutParams(0, -2, 1.2f))
            }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) })
            // 💬 La conversation du Buddy Time (écran 6).
            if (x.participants.size > 1) addView(LinearLayout(a).apply {
                gravity = Gravity.CENTER_VERTICAL; isClickable = true; minimumHeight = dp(56)
                setOnClickListener { onParler() }
                addView(text("💬", 28f), LinearLayout.LayoutParams(dp(44), -2))
                addView(LinearLayout(a).apply {
                    orientation = LinearLayout.VERTICAL
                    addView(text("Messagerie" + if (nonLus > 0) " · $nonLus nouveau${if (nonLus > 1) "x" else ""}" else "", 17f, bold = true))
                    addView(text(apercu.ifEmpty { "écrire aux buddies" }, 15f, muted).apply { maxLines = 2 })
                }, LinearLayout.LayoutParams(0, -2, 1f))
                addView(text("›", 26f, muted))
            }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) })
            if (appel != null) addView(LinearLayout(a).apply {
                gravity = Gravity.CENTER_VERTICAL; isClickable = true; minimumHeight = dp(56)
                background = GradientDrawable().apply { cornerRadius = 14 * d; setColor(Color.parseColor("#E3F6EA")) }
                setOnClickListener { onAppel() }
                addView(text("📞", 28f), LinearLayout.LayoutParams(dp(44), -2))
                addView(LinearLayout(a).apply {
                    orientation = LinearLayout.VERTICAL
                    addView(text("Appel en cours · rejoindre", 17f, bold = true)); addView(text("${appel.enLigne.size} en ligne", 15f, muted))
                }, LinearLayout.LayoutParams(0, -2, 1f))
                addView(text("›", 26f, muted))
            }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) })
            // 🏨 Où on dort ? (écran 9) : avant et pendant le Buddy Time.
            if (x.fin >= auj) addView(LinearLayout(a).apply {
                gravity = Gravity.CENTER_VERTICAL; isClickable = true; minimumHeight = dp(56)
                setOnClickListener { onDodo() }
                val retenu = hebergements.firstOrNull { it.retenu }
                addView(text("🏨", 28f), LinearLayout.LayoutParams(dp(44), -2))
                addView(LinearLayout(a).apply {
                    orientation = LinearLayout.VERTICAL
                    addView(text(retenu?.let { "${it.nom} ✅" } ?: "Où on dort ?", 17f, bold = true))
                    addView(text(retenu?.let { Hebergements.prix(it.prixNuit) }
                        ?: if (hebergements.isNotEmpty()) "${hebergements.size} idée${if (hebergements.size > 1) "s" else ""} · mettez vos ♥" else "proposer un hébergement", 15f, muted))
                }, LinearLayout.LayoutParams(0, -2, 1f))
                addView(text("›", 26f, muted))
            }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) })
            // 📍 Position des buddies (écran 15) : pendant le Buddy Time.
            if (pendant) addView(LinearLayout(a).apply {
                gravity = Gravity.CENTER_VERTICAL; isClickable = true; minimumHeight = dp(56)
                setOnClickListener { positions = true; onRedessiner() }
                addView(text("📍", 28f), LinearLayout.LayoutParams(dp(44), -2))
                addView(LinearLayout(a).apply {
                    orientation = LinearLayout.VERTICAL
                    addView(text("Position des buddies", 17f, bold = true))
                    addView(text((if (visibles > 0) "$visibles visible${if (visibles > 1) "s" else ""}" else "qui veut se montrer enfonce son épingle") +
                        if (reperes.any { it.moi && it.actif }) " · tu es visible" else "", 15f, muted))
                }, LinearLayout.LayoutParams(0, -2, 1f))
                addView(text("›", 26f, muted))
            }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) })
            if (traces.isEmpty()) addView(text("Partage une trace dans ce Buddy Time depuis Mes traces (icône de partage) : elle apparaîtra ici chez tout le monde.", 15f, muted))
            // 📸 Les photos de l'album (écran 7), puis « Ajouter », « Album » et « Carnet » une fois parti.
            if (photos.isNotEmpty()) {
                val auteurs = photos.map { it.par.id }.toSet().size
                addView(LinearLayout(a).apply {
                    gravity = Gravity.CENTER_VERTICAL; isClickable = true; setOnClickListener { onAlbum() }
                    addView(text("📸 ${photos.size} photo${if (photos.size > 1) "s" else ""}", 17f, bold = true), LinearLayout.LayoutParams(0, -2, 1f))
                    addView(text("de $auteurs ${if (auteurs > 1) "buddies" else "buddy"}", 15f, muted))
                }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) })
                addView(LinearLayout(a).apply {
                    photos.take(4).forEachIndexed { i, p ->
                        addView(FrameLayout(a).apply {
                            background = GradientDrawable().apply { cornerRadius = 10 * d; setColor(card) }
                            outlineProvider = object : android.view.ViewOutlineProvider() {
                                override fun getOutline(view: View, o: android.graphics.Outline) { o.setRoundRect(0, 0, view.width, view.height, 10 * d) }
                            }
                            clipToOutline = true; isClickable = true; setOnClickListener { onAlbum() }
                            val img = android.widget.ImageView(a).apply { scaleType = android.widget.ImageView.ScaleType.CENTER_CROP }
                            addView(img, FrameLayout.LayoutParams(-1, -1))
                            AlbumVue.charger(a, album, p, "petite", img)
                            if (i == 3 && photos.size > 4) addView(text("+${photos.size - 3}", 20f, Color.WHITE, bold = true).apply {
                                gravity = Gravity.CENTER; setBackgroundColor(Color.parseColor("#77000000"))
                            }, FrameLayout.LayoutParams(-1, -1))
                        }, LinearLayout.LayoutParams(0, dp(76), 1f).apply { if (i < 3) rightMargin = dp(6) })
                    }
                    repeat(4 - minOf(4, photos.size)) { addView(View(a), LinearLayout.LayoutParams(0, 1, 1f).apply { rightMargin = dp(6) }) }
                }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) })
            }
            if (x.debut <= auj) addView(LinearLayout(a).apply {
                fun bouton(t: String, primaire: Boolean, f: () -> Unit) = Button(a).apply {
                    text = t; isAllCaps = false; textSize = 17f; minHeight = dp(52); setTextColor(if (primaire) Color.WHITE else ink)
                    background = GradientDrawable().apply { cornerRadius = 14 * d
                        if (primaire) setColor(Color.parseColor("#2F6F4F")) else { setColor(Color.WHITE); setStroke(dp(1), Color.parseColor("#D9DFDC")) } }
                    setOnClickListener { f() }
                }
                addView(bouton("📷 Ajouter", true, onAjouter), LinearLayout.LayoutParams(0, -2, 1f).apply { rightMargin = dp(8) })
                addView(bouton("📸 Album", false, onAlbum), LinearLayout.LayoutParams(0, -2, 1f).apply { rightMargin = dp(8) })
                addView(bouton("📖 Carnet", false, onCarnet), LinearLayout.LayoutParams(0, -2, 1f))
            }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) })
        }
        // Écran 15 : les buddies visibles, puis l'épingle (enfoncer ou « Arrêter »).
        val bande = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            addView(LinearLayout(a).apply {
                gravity = Gravity.CENTER_VERTICAL
                addView(text("📍 Position des buddies", 22f, bold = true), LinearLayout.LayoutParams(0, -2, 1f))
                addView(text("Retour", 16f, accent, bold = true).apply {
                    gravity = Gravity.CENTER; minHeight = dp(48); setPadding(dp(8), 0, dp(4), 0)
                    setOnClickListener { positions = false; onRedessiner() }
                })
            })
            val moi = reperes.firstOrNull { it.moi }
            val autres = reperes.filter { !it.moi }
            for (r in autres) addView(LinearLayout(a).apply {
                gravity = Gravity.CENTER_VERTICAL; alpha = if (r.actif) 1f else 0.6f; setPadding(0, dp(6), 0, dp(6))
                addView(visage(a, r.b, dp(44)), LinearLayout.LayoutParams(dp(44), dp(44)).apply { rightMargin = dp(12) })
                addView(LinearLayout(a).apply {
                    orientation = LinearLayout.VERTICAL
                    addView(text(r.b.pseudo, 17f, bold = true))
                    addView(text(Positions.detail(r, moi).ifEmpty { " " }, 15f, muted))
                }, LinearLayout.LayoutParams(0, -2, 1f))
                addView(text(Positions.etiquette(r), 17f, bold = true))
            })
            if (autres.isEmpty()) addView(text("Personne n'est visible pour l'instant : chacun choisit d'enfoncer son épingle 📍.", 15f, muted))
            val ici = epingle?.takeIf { it.sortie == x.id }
            if (ici != null) addView(LinearLayout(a).apply {
                gravity = Gravity.CENTER_VERTICAL; setPadding(dp(12), dp(12), dp(12), dp(12))
                background = GradientDrawable().apply { cornerRadius = 16 * d; setColor(Color.parseColor("#E8F1EC")); setStroke(dp(2), accent) }
                addView(text("📍", 28f), LinearLayout.LayoutParams(dp(40), -2))
                addView(LinearLayout(a).apply {
                    orientation = LinearLayout.VERTICAL
                    addView(text("Mes buddies me voient", 18f, accent, bold = true))
                    addView(text("depuis ${Positions.heureCourte(ici.depuis)} · s'arrête seul à ${Positions.heureCourte(ici.jusqu)}", 15f, muted))
                }, LinearLayout.LayoutParams(0, -2, 1f))
                addView(Button(a).apply {
                    text = "Arrêter"; isAllCaps = false; textSize = 17f; minHeight = dp(48); setTextColor(ink)
                    background = GradientDrawable().apply { cornerRadius = 12 * d; setColor(Color.WHITE); setStroke(dp(1), Color.parseColor("#D9DFDC")) }
                    setOnClickListener { onRelever() }
                })
            }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) })
            else addView(Button(a).apply {
                text = "📍 Mes buddies peuvent me voir"; isAllCaps = false; textSize = 17f; minHeight = dp(56); setTextColor(Color.WHITE)
                background = GradientDrawable().apply { cornerRadius = 14 * d; setColor(accent) }
                setOnClickListener { onEnfoncer() }
            }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) })
            addView(text(if (ici != null) "Sans réseau, tes positions sont gardées avec leur heure et partent au retour."
                else "Ta position part toutes les 5 minutes, jusqu'à ce soir, seulement vers les buddies de ce Buddy Time.", 14f, muted).apply {
                setPadding(0, dp(8), 0, 0) })
        }
        // 💬 Écran 6 (déplié) et 24 (replié : les derniers mots, la carte au-dessus).
        val parler = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            if (conversation != null && filConv != null) {
                addView(LinearLayout(a).apply {
                    gravity = Gravity.CENTER_VERTICAL
                    addView(text("💬 Messagerie", 22f, bold = true), LinearLayout.LayoutParams(0, -2, 1f))
                    addView(text("Retour", 16f, accent, bold = true).apply {
                        gravity = Gravity.CENTER; minHeight = dp(48); setPadding(dp(8), 0, dp(4), 0)
                        setOnClickListener { onFinParler() }
                    })
                })
                (filConv.parent as? android.view.ViewGroup)?.removeView(filConv)
                addView(filConv, LinearLayout.LayoutParams(-1, (a.resources.displayMetrics.heightPixels * 0.42).toInt()))
                (conversation.saisie.parent as? android.view.ViewGroup)?.removeView(conversation.saisie)
                addView(conversation.saisie)
            }
        }
        fun montrer() {
            val msg = conversation != null
            contenu.visibility = if (replie || positions || msg) View.GONE else View.VISIBLE
            bande.visibility = if (!replie && positions && !msg) View.VISIBLE else View.GONE
            parler.visibility = if (msg) View.VISIBLE else View.GONE
            if (msg) {
                conversation!!.court = replie
                parler.getChildAt(0)?.visibility = if (replie) View.GONE else View.VISIBLE
                filConv?.layoutParams = LinearLayout.LayoutParams(-1, if (replie) -2 else (a.resources.displayMetrics.heightPixels * 0.42).toInt())
            }
        }
        montrer()
        racine.addView(LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(6), dp(16), bas + dp(16))
            background = GradientDrawable().apply { cornerRadii = floatArrayOf(18 * d, 18 * d, 18 * d, 18 * d, 0f, 0f, 0f, 0f); setColor(Color.WHITE) }
            elevation = 8 * d; isClickable = true
            addView(View(a).apply {
                background = GradientDrawable().apply { cornerRadius = 3 * d; setColor(Color.parseColor("#D9DFDC")) }
                contentDescription = "Replier"
            }, LinearLayout.LayoutParams(dp(44), dp(5)).apply { gravity = Gravity.CENTER_HORIZONTAL; bottomMargin = dp(8) })
            setOnClickListener { replie = !replie; montrer() }
            addView(contenu)
            addView(bande)
            addView(parler)
        }, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
        return racine
    }

    fun visage(a: android.content.Context, b: Buddies.Buddy, taille: Int): View {
        val bmp = b.photo?.takeIf { it.startsWith("data:image/") }?.let {
            runCatching { android.util.Base64.decode(it.substringAfter(","), android.util.Base64.DEFAULT).let { x -> android.graphics.BitmapFactory.decodeByteArray(x, 0, x.size) } }.getOrNull()
        }
        val v: View = if (bmp != null) android.widget.ImageView(a).apply { setImageBitmap(bmp); scaleType = android.widget.ImageView.ScaleType.CENTER_CROP }
        else TextView(a).apply {
            text = b.pseudo.take(1).uppercase(); textSize = 18f; setTextColor(Color.WHITE); gravity = Gravity.CENTER; setTypeface(typeface, Typeface.BOLD)
            val cs = listOf("#2F6F4F", "#3F6FB5", "#8A4FB0", "#C9862B", "#2C8C8C", "#B5534A")
            setBackgroundColor(Color.parseColor(cs[Math.floorMod(b.id.sumOf { it.code }, cs.size)]))
        }
        v.outlineProvider = object : android.view.ViewOutlineProvider() {
            override fun getOutline(view: View, o: android.graphics.Outline) { o.setOval(0, 0, view.width, view.height) }
        }
        v.clipToOutline = true
        return v
    }
}
