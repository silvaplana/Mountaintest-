package fr.assomoutain.proto

import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.roundToLong

/**
 * Partage des frais façon Tricount : groupes, participants (nom, e-mail facultatif), dépenses, équilibres.
 * Stocké dans le téléphone (préférences, JSON), même modèle et mêmes calculs que src/expenses/expenses.ts.
 */
data class Member(val id: String, var name: String, var email: String? = null)
data class Expense(val id: String, var title: String, var amount: Double, var paidBy: String, var forIds: List<String>, var date: String)
data class Group(val id: String, var name: String, var emoji: String, var members: MutableList<Member>, var me: String, var expenses: MutableList<Expense>)

object Expenses {
    private const val KEY = "depenses"
    val EMOJIS = listOf("💰", "⛰", "🎿", "🏕", "🚗", "🏖", "🍽", "🏠")

    fun newId(): String = java.util.UUID.randomUUID().toString().take(12)

    fun load(p: SharedPreferences): MutableList<Group> = runCatching {
        val a = JSONArray(p.getString(KEY, "[]"))
        (0 until a.length()).map { i ->
            val g = a.getJSONObject(i)
            val ms = g.getJSONArray("members"); val es = g.getJSONArray("expenses")
            Group(g.getString("id"), g.getString("name"), g.optString("emoji", "💰"),
                (0 until ms.length()).map { j -> ms.getJSONObject(j).let { Member(it.getString("id"), it.getString("name"), it.optString("email").ifEmpty { null }) } }.toMutableList(),
                g.optString("me"),
                (0 until es.length()).map { j -> es.getJSONObject(j).let { e ->
                    val f = e.getJSONArray("forIds")
                    Expense(e.getString("id"), e.getString("title"), e.getDouble("amount"), e.getString("paidBy"),
                        (0 until f.length()).map { f.getString(it) }, e.optString("date"))
                } }.toMutableList())
        }.toMutableList()
    }.getOrDefault(mutableListOf())

    fun save(p: SharedPreferences, gs: List<Group>) {
        val a = JSONArray(gs.map { g ->
            JSONObject().put("id", g.id).put("name", g.name).put("emoji", g.emoji).put("me", g.me)
                .put("members", JSONArray(g.members.map { m -> JSONObject().put("id", m.id).put("name", m.name).apply { m.email?.let { put("email", it) } } }))
                .put("expenses", JSONArray(g.expenses.map { e ->
                    JSONObject().put("id", e.id).put("title", e.title).put("amount", e.amount).put("paidBy", e.paidBy)
                        .put("forIds", JSONArray(e.forIds)).put("date", e.date)
                }))
        })
        p.edit().putString(KEY, a.toString()).apply()
    }

    private fun c(v: Double) = (v * 100).roundToLong()

    /** Solde de chacun en euros : payé − sa part (positif : on lui doit ; négatif : il doit). */
    fun balances(g: Group): Map<String, Double> {
        val b = linkedMapOf<String, Long>().apply { g.members.forEach { put(it.id, 0L) } }
        for (e in g.expenses) {
            val who = e.forIds.filter { it in b }
            if (who.isEmpty() || e.paidBy !in b) continue
            val total = c(e.amount)
            val share = floor(total.toDouble() / who.size).toLong()
            var rest = total - share * who.size // les centimes restants vont aux premiers
            b[e.paidBy] = b[e.paidBy]!! + total
            for (id in who) { b[id] = b[id]!! - share - (if (rest > 0) 1 else 0); rest-- }
        }
        return b.mapValues { it.value / 100.0 }
    }

    data class Transfer(val from: String, val to: String, val amount: Double)

    /** Remboursements pour tout équilibrer (le plus gros débiteur paie le plus gros créancier). */
    fun settlements(g: Group): List<Transfer> {
        val b = balances(g).mapValues { c(it.value) }.toMutableMap()
        val out = mutableListOf<Transfer>()
        while (true) {
            val debt = b.filter { it.value < 0 }.minByOrNull { it.value } ?: break
            val cred = b.filter { it.value > 0 }.maxByOrNull { it.value } ?: break
            val a = min(-debt.value, cred.value)
            out += Transfer(debt.key, cred.key, a / 100.0)
            b[debt.key] = debt.value + a; b[cred.key] = cred.value - a
        }
        return out
    }

    fun total(g: Group) = g.expenses.sumOf { c(it.amount) } / 100.0
    fun paidBy(g: Group, id: String) = g.expenses.filter { it.paidBy == id }.sumOf { c(it.amount) } / 100.0
    fun money(v: Double): String = NumberFormat.getNumberInstance(Locale.FRANCE).apply { minimumFractionDigits = 2; maximumFractionDigits = 2 }.format(v) + " €"
    fun name(g: Group, id: String) = g.members.firstOrNull { it.id == id }?.name ?: "?"
}
