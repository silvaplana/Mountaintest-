package fr.assomoutain.proto

import android.app.AlertDialog
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import java.time.format.DateTimeFormatter

/**
 * Partage des frais façon Tricount, plein écran : liste des groupes (+ pour en créer), participants (nom, e-mail,
 * bouton Inviter), dépenses, équilibres. Même écran que src/Expenses.tsx côté Capacitor.
 */
class ExpensesPanel(
    private val a: AppCompatActivity,
    private val prefs: SharedPreferences,
    private val password: String,
    /** Photo d'une facture (JPEG réduit), null si annulée. */
    private val takePhoto: ((ByteArray?) -> Unit) -> Unit,
    private val onClose: () -> Unit,
) {
    private val d = a.resources.displayMetrics.density
    private fun dp(v: Int) = (v * d).toInt()
    private val ink = Color.parseColor("#1D2421")
    private val muted = Color.parseColor("#5F6B66")
    private val accent = Color.parseColor("#2F6F4F")
    private val groups = Expenses.load(prefs)
    private fun save() = Expenses.save(prefs, groups)

    private val col = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(10), dp(16), dp(120)) }
    private val scroll = ScrollView(a).apply { addView(col) }
    private val fab = Button(a).apply {
        text = "+"; textSize = 30f; setTextColor(Color.WHITE); setPadding(0, 0, 0, 0)
        background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(accent) }
        elevation = 8 * d
    }
    val view: View = FrameLayout(a).apply {
        setBackgroundColor(Color.WHITE); isClickable = true; elevation = 30 * d
        addView(scroll, FrameLayout.LayoutParams(-1, -1))
        addView(fab, FrameLayout.LayoutParams(dp(64), dp(64), Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { bottomMargin = dp(40) })
        layoutParams = FrameLayout.LayoutParams(-1, -1)
    }
    /** Marges des barres système (haut, bas). */
    fun insets(top: Int, bottom: Int) {
        col.setPadding(dp(16), top + dp(10), dp(16), bottom + dp(120))
        (fab.layoutParams as FrameLayout.LayoutParams).bottomMargin = bottom + dp(40); fab.requestLayout()
    }

    init { showList() }

    // ---------- petits outils ----------
    private fun text(t: CharSequence, size: Float = 14f, color: Int = ink, bold: Boolean = false) = TextView(a).apply {
        text = t; textSize = size; setTextColor(color); if (bold) setTypeface(typeface, Typeface.BOLD); setPadding(0, dp(4), 0, dp(4))
    }
    private fun lp(top: Int = 8) = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(top) }
    private fun card(v: LinearLayout.() -> Unit = {}) = LinearLayout(a).apply {
        gravity = Gravity.CENTER_VERTICAL; setPadding(dp(14), dp(12), dp(14), dp(12))
        background = GradientDrawable().apply { setColor(Color.parseColor("#F2F4F1")); cornerRadius = 12 * d }
        v()
    }
    private fun head(left: String, title: String, onLeft: () -> Unit, right: String? = null, onRight: (() -> Unit)? = null) {
        col.removeAllViews(); scroll.scrollTo(0, 0)
        col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(Button(a).apply { text = left; setOnClickListener { onLeft() } })
            addView(text(title, 16f, bold = true).apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(0, -2, 1f))
            if (right != null) addView(Button(a).apply { text = right; setOnClickListener { onRight?.invoke() } })
        })
    }
    private fun toast(m: String) = Toast.makeText(a, m, Toast.LENGTH_LONG).show()
    private fun field(label: String, value: String, hint: String, type: Int = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES): EditText {
        col.addView(text(label, 13f, muted))
        return EditText(a).apply { setText(value); this.hint = hint; inputType = type; isSingleLine = true }.also { col.addView(it) }
    }

    // ---------- liste des groupes ----------
    private fun showList() {
        head("✕", "💰 Partage des frais", onClose)
        if (groups.isEmpty()) col.addView(text("Aucun groupe de dépenses : touche + pour en créer un (un voyage, une sortie…).", 13f, muted), lp())
        groups.forEach { g ->
            col.addView(card {
                addView(text(g.name, 17f, bold = true), LinearLayout.LayoutParams(0, -2, 1f))
                addView(text("›", 22f, muted))
                setOnClickListener { showGroup(g, false) }
            }, lp(10))
        }
        fab.visibility = View.VISIBLE
        fab.setOnClickListener { editGroup(null) }
    }

    // ---------- création / modification d'un groupe ----------
    private fun editGroup(orig: Group?) {
        val g = orig?.copy(members = orig.members.map { it.copy() }.toMutableList())
            ?: Group(Expenses.newId(), "", Expenses.EMOJIS[0], mutableListOf(Member(Expenses.newId(), ""), Member(Expenses.newId(), "")), "", mutableListOf())
        if (g.me.isEmpty()) g.me = g.members.first().id
        fab.visibility = View.GONE
        head("Annuler", if (orig == null) "Nouveau groupe" else "Modifier le groupe", { if (orig == null) showList() else showGroup(orig, false) })
        val name = field("Titre", g.name, "ex. Ski 2026")
        val emoji = g.emoji
        col.addView(text("Participants", 16f, bold = true), lp(14))
        col.addView(text("Pour l'instant juste un nom. L'e-mail sert à inviter la personne (lien pour installer l'appli). Coche « moi ».", 13f, muted))
        val used = g.expenses.flatMap { listOf(it.paidBy) + it.forIds }.toSet()
        val rows = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
        val radios = mutableListOf<RadioButton>()
        fun addRow(m: Member) {
            val n = EditText(a).apply { setText(m.name); hint = "Participant ${rows.childCount + 1}"; isSingleLine = true; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS }
            val e = EditText(a).apply { setText(m.email ?: ""); hint = "e-mail (facultatif)"; isSingleLine = true; inputType = InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS or InputType.TYPE_CLASS_TEXT }
            n.tag = m; e.tag = "mail"
            val r = RadioButton(a).apply { isChecked = g.me == m.id; contentDescription = "C'est moi" }
            radios += r
            r.setOnClickListener { g.me = m.id; radios.forEach { it.isChecked = it === r } }
            val row = LinearLayout(a).apply { gravity = Gravity.CENTER_VERTICAL }
            row.addView(r)
            row.addView(LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; addView(n); addView(e) }, LinearLayout.LayoutParams(0, -2, 1f))
            val btns = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
            btns.addView(Button(a).apply {
                text = "Inviter"
                setOnClickListener {
                    val mail = e.text.toString().trim()
                    if (!Regex("\\S+@\\S+\\.\\S+").matches(mail)) { toast("Indique d'abord une adresse e-mail"); return@setOnClickListener }
                    isEnabled = false; text = "…"
                    invite(Member(m.id, n.text.toString().trim(), mail), name.text.toString().trim(), g.members.firstOrNull { it.id == g.me }?.name ?: "") {
                        isEnabled = true; text = "Inviter"
                    }
                }
            })
            if (m.id !in used) btns.addView(Button(a).apply { text = "✕"; setOnClickListener { rows.removeView(row); radios.remove(r) } })
            row.addView(btns)
            rows.addView(row, lp(6))
        }
        g.members.forEach { addRow(it) }
        col.addView(rows)
        col.addView(Button(a).apply { text = "+ Ajouter un participant"; setOnClickListener { addRow(Member(Expenses.newId(), "")) } }, lp())
        col.addView(Button(a).apply {
            text = "Enregistrer"; setTextColor(Color.WHITE); backgroundTintList = android.content.res.ColorStateList.valueOf(accent)
            setOnClickListener {
                val members = (0 until rows.childCount).mapNotNull { i ->
                    val box = (rows.getChildAt(i) as LinearLayout).getChildAt(1) as LinearLayout
                    val n = box.getChildAt(0) as EditText; val e = box.getChildAt(1) as EditText
                    val m = n.tag as Member
                    n.text.toString().trim().ifEmpty { null }?.let { Member(m.id, it, e.text.toString().trim().ifEmpty { null }) }
                }
                // Toujours enregistrable : sans titre, la date du jour ; il faut juste au moins un nom.
                val title = name.text.toString().trim().ifEmpty { "Dépenses du " + LocalDate.now().format(DateTimeFormatter.ofPattern("dd/MM/yyyy")) }
                if (members.isEmpty()) { toast("Écris au moins un nom de participant"); return@setOnClickListener }
                g.name = title; g.emoji = emoji; g.members = members.toMutableList()
                if (members.none { it.id == g.me }) g.me = members.first().id
                val i = groups.indexOfFirst { it.id == g.id }
                if (i >= 0) groups[i] = g else groups += g
                save(); showGroup(g, false)
            }
        }, lp(14))
        if (orig != null) col.addView(Button(a).apply {
            text = "Supprimer le groupe"; setTextColor(Color.parseColor("#C0392B"))
            setOnClickListener {
                AlertDialog.Builder(a).setMessage("Supprimer le groupe « ${orig.name} » et ses dépenses ?")
                    .setPositiveButton("Supprimer") { _, _ -> groups.removeAll { it.id == orig.id }; save(); showList() }
                    .setNegativeButton("Annuler", null).show()
            }
        }, lp())
    }

    /** Invitation par e-mail via le relais (Brevo, comme contretemps) ; sinon l'appli mail du téléphone, pré-remplie. */
    private fun invite(m: Member, groupe: String, de: String, done: () -> Unit) {
        a.lifecycleScope.launch {
            val ok = withContext(Dispatchers.IO) {
                runCatching {
                    password.split('\n').filter { it.isNotEmpty() }.firstNotNullOfOrNull { p ->
                        val c = URL(WebHikes.RELAIS_URL.removeSuffix("/randos") + "/invitation").openConnection() as HttpURLConnection
                        c.requestMethod = "POST"; c.doOutput = true; c.connectTimeout = 15_000; c.readTimeout = 40_000
                        c.setRequestProperty("Content-Type", "application/json"); c.setRequestProperty("X-Mot-De-Passe", p)
                        c.outputStream.use { it.write(JSONObject().put("email", m.email).put("nom", m.name).put("groupe", groupe).put("de", de).toString().toByteArray()) }
                        when (c.responseCode) { 401 -> null; 200 -> true; else -> false }
                    } ?: false
                }.getOrDefault(false)
            }
            done()
            if (ok) { toast("Invitation envoyée à ${m.email}"); return@launch }
            val body = "Bonjour ${m.name},\n\n$de t'invite à partager les frais du groupe « $groupe » dans l'appli Mountain Buddies.\n\n" +
                "Pour l'installer (Android) : https://silvaplana.cloud/mountaintest/apk/"
            runCatching {
                a.startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:")).putExtra(Intent.EXTRA_EMAIL, arrayOf(m.email))
                    .putExtra(Intent.EXTRA_SUBJECT, "Partage des frais « $groupe »").putExtra(Intent.EXTRA_TEXT, body))
                toast("Envoi direct impossible : ton appli mail s'ouvre avec le message prêt")
            }.onFailure { toast("Envoi impossible : aucune appli mail") }
        }
    }

    // ---------- un groupe : dépenses et équilibres ----------
    private fun showGroup(g: Group, balancesTab: Boolean) {
        head("←", "", { showList() }, "Modifier") { editGroup(g) }
        col.addView(text(g.name, 22f, bold = true).apply { gravity = Gravity.CENTER }, lp(0))
        col.addView(text(g.members.joinToString(", ") { it.name }, 13f, muted).apply { gravity = Gravity.CENTER }, lp(0))
        col.addView(LinearLayout(a).apply {
            listOf("Dépenses" to false, "Équilibres" to true).forEach { (t, eq) ->
                addView(Button(a).apply {
                    text = t
                    if (eq == balancesTab) { setTextColor(Color.WHITE); backgroundTintList = android.content.res.ColorStateList.valueOf(accent) }
                    setOnClickListener { showGroup(g, eq) }
                }, LinearLayout.LayoutParams(0, -2, 1f))
            }
        }, lp())
        if (!balancesTab) {
            col.addView(LinearLayout(a).apply {
                listOf("Mes dépenses" to Expenses.paidBy(g, g.me), "Total des dépenses" to Expenses.total(g)).forEach { (t, v) ->
                    addView(LinearLayout(a).apply {
                        orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
                        addView(text(t, 13f, muted)); addView(text(Expenses.money(v), 20f, bold = true))
                    }, LinearLayout.LayoutParams(0, -2, 1f))
                }
            }, lp())
            if (g.expenses.isEmpty()) col.addView(text("Aucune dépense : touche + pour en ajouter une.", 13f, muted), lp())
            val fmt = DateTimeFormatter.ofPattern("dd/MM/yyyy")
            g.expenses.forEach { e ->
                col.addView(card {
                    addView(LinearLayout(a).apply {
                        orientation = LinearLayout.VERTICAL
                        addView(text(e.title, 16f, bold = true))
                        val date = runCatching { LocalDate.parse(e.date).format(fmt) }.getOrDefault(e.date)
                        addView(text("Payé par ${Expenses.name(g, e.paidBy)}${if (e.paidBy == g.me) " (moi)" else ""} · $date", 13f, muted))
                    }, LinearLayout.LayoutParams(0, -2, 1f))
                    addView(text(Expenses.money(e.amount), 16f, bold = true))
                    setOnClickListener { editExpense(g, e) }
                }, lp(8))
            }
            fab.visibility = View.VISIBLE
            fab.setOnClickListener { editExpense(g, null) }
        } else {
            fab.visibility = View.GONE
            val b = Expenses.balances(g)
            g.members.forEach { m ->
                val v = b[m.id] ?: 0.0
                col.addView(LinearLayout(a).apply {
                    addView(text(m.name + if (m.id == g.me) " (moi)" else "", 15f), LinearLayout.LayoutParams(0, -2, 1f))
                    addView(text((if (v > 0) "+" else "") + Expenses.money(v), 15f,
                        if (v > 0.004) Color.parseColor("#2F9E44") else if (v < -0.004) Color.parseColor("#C0392B") else ink, true))
                }, lp(4))
            }
            col.addView(text("Comment équilibrer", 16f, bold = true), lp(14))
            val s = Expenses.settlements(g)
            if (s.isEmpty()) col.addView(text("Tout est équilibré.", 13f, muted))
            s.forEach { t ->
                col.addView(card {
                    addView(text("${Expenses.name(g, t.from)} doit à ${Expenses.name(g, t.to)}", 15f), LinearLayout.LayoutParams(0, -2, 1f))
                    addView(text(Expenses.money(t.amount), 15f, bold = true))
                }, lp(8))
            }
        }
    }

    // ---------- une dépense ----------
    private fun editExpense(g: Group, orig: Expense?) {
        fab.visibility = View.GONE
        head("Annuler", if (orig == null) "Nouvelle dépense" else "Modifier la dépense", { showGroup(g, false) })
        // 📷 Photo de la facture : Claude lit le titre, le montant et la date.
        val photo = Button(a).apply { text = "📷 Photo de la facture (remplit titre et montant)"; isEnabled = password.isNotEmpty() }
        col.addView(photo, lp())
        val title = field("Titre", orig?.title ?: "", "ex. Courses, essence, gîte…")
        val amount = field("Montant (€)", orig?.amount?.toString()?.replace('.', ',') ?: "", "0,00", InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL)
        col.addView(text("Payé par", 13f, muted))
        val by = Spinner(a).apply {
            adapter = ArrayAdapter(a, android.R.layout.simple_spinner_dropdown_item, g.members.map { it.name + if (it.id == g.me) " (moi)" else "" })
            setSelection(g.members.indexOfFirst { it.id == (orig?.paidBy ?: g.me) }.coerceAtLeast(0))
        }
        col.addView(by)
        val date = field("Date (AAAA-MM-JJ)", orig?.date ?: LocalDate.now().toString(), "2026-11-03", InputType.TYPE_CLASS_DATETIME or InputType.TYPE_DATETIME_VARIATION_DATE)
        photo.setOnClickListener {
            takePhoto { bytes ->
                if (bytes == null) return@takePhoto
                photo.isEnabled = false; photo.text = "Claude lit la facture…"
                a.lifecycleScope.launch {
                    runCatching { withContext(Dispatchers.IO) {
                        Travel.post("facture", JSONObject().put("image", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)).put("type", "image/jpeg"), password)
                    } }.onSuccess { o ->
                        o.optString("titre").takeIf { it.isNotEmpty() }?.let { title.setText(it) }
                        if (!o.isNull("montant")) amount.setText(o.optDouble("montant").toString().replace('.', ','))
                        else toast("Montant illisible sur la photo : tape-le")
                        if (!o.isNull("date")) runCatching { date.setText(LocalDate.parse(o.optString("date")).toString()) }
                    }.onFailure { toast("Lecture impossible : ${if (it is java.io.IOException) "pas de réseau" else it.message}") }
                    photo.isEnabled = true; photo.text = "📷 Photo de la facture (remplit titre et montant)"
                }
            }
        }
        col.addView(text("Pour qui", 16f, bold = true), lp(14))
        val checks = g.members.map { m -> CheckBox(a).apply { text = m.name; isChecked = orig?.forIds?.contains(m.id) ?: true }.also { col.addView(it) } }
        col.addView(Button(a).apply {
            text = "Enregistrer"; setTextColor(Color.WHITE); backgroundTintList = android.content.res.ColorStateList.valueOf(accent)
            setOnClickListener {
                val v = amount.text.toString().replace(',', '.').replace(" ", "").toDoubleOrNull() ?: 0.0
                val forIds = g.members.filterIndexed { i, _ -> checks[i].isChecked }.map { it.id }
                if (v <= 0) { toast("Indique le montant"); return@setOnClickListener }
                if (forIds.isEmpty()) { toast("Coche au moins une personne"); return@setOnClickListener }
                val day = runCatching { LocalDate.parse(date.text.toString().trim()).toString() }.getOrDefault(LocalDate.now().toString())
                val e = Expense(orig?.id ?: Expenses.newId(), title.text.toString().trim().ifEmpty { "Dépense" }, Math.round(v * 100) / 100.0,
                    g.members[by.selectedItemPosition].id, forIds, day)
                val i = g.expenses.indexOfFirst { it.id == e.id }
                if (i >= 0) g.expenses[i] = e else g.expenses.add(0, e)
                save(); showGroup(g, false)
            }
        }, lp(14))
        if (orig != null) col.addView(Button(a).apply {
            text = "Supprimer la dépense"; setTextColor(Color.parseColor("#C0392B"))
            setOnClickListener {
                AlertDialog.Builder(a).setMessage("Supprimer cette dépense ?")
                    .setPositiveButton("Supprimer") { _, _ -> g.expenses.removeAll { it.id == orig.id }; save(); showGroup(g, false) }
                    .setNegativeButton("Annuler", null).show()
            }
        }, lp())
    }
}
