package fr.assomoutain.proto

import android.content.SharedPreferences
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale
import kotlin.math.roundToInt

/** Lieu choisi pour le départ ou l'arrivée. */
data class Spot(val label: String, val lon: Double, val lat: Double)

/**
 * Menu Voyage : départ, arrivée, péages, voiture (recherche par l'IA), énergie, conso → itinéraires sur la carte
 * (on choisit le bon) → coût par Claude. Même panneau que src/TravelPanel.tsx côté Capacitor.
 */
class TravelPanel(
    private val a: AppCompatActivity,
    private val prefs: SharedPreferences,
    here: Spot,
    private val password: String,
    private val onRoutes: (List<CarRoute>, Int) -> Unit,
    private val onClose: () -> Unit,
) {
    private val d = a.resources.displayMetrics.density
    private fun dp(v: Int) = (v * d).toInt()
    private var from: Spot? = here
    private var to: Spot? = null
    var routes: List<CarRoute> = emptyList(); private set
    var selected = 0; private set
    private var busy = false

    private val col = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(8), dp(12), dp(16)) }
    val view: View = ScrollView(a).apply {
        addView(col)
        elevation = 10 * d
        background = GradientDrawable().apply { setColor(Color.WHITE); cornerRadii = floatArrayOf(14 * d, 14 * d, 14 * d, 14 * d, 0f, 0f, 0f, 0f) }
        layoutParams = FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM)
        isClickable = true
    }

    private fun text(t: String, size: Float = 13f, color: Int = Color.parseColor("#5F6B66")) =
        TextView(a).apply { this.text = t; textSize = size; setTextColor(color); setPadding(0, dp(4), 0, dp(2)) }
    private fun lp(top: Int = 6) = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(top) }

    /** Formulaire, replié une fois les itinéraires trouvés (résumé + « Modifier ») pour laisser voir la carte. */
    private val formBox = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private val summaryText = TextView(a).apply { textSize = 14f; setTextColor(Color.parseColor("#1D2421")) }
    private val summary = LinearLayout(a).apply {
        gravity = Gravity.CENTER_VERTICAL; visibility = View.GONE
        addView(summaryText, LinearLayout.LayoutParams(0, -2, 1f))
        addView(Button(a).apply { text = "Modifier"; setOnClickListener { fold(false) } })
    }
    private val carList = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private val routeList = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private val routeHint = text("")
    private val error = text("", 13f, Color.parseColor("#C0392B"))
    private val result = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private val car = EditText(a)
    private val conso = EditText(a)
    private val energy = Spinner(a)
    private val energyKeys = Travel.ENERGIES.keys.toList()
    private val consoLabel = text("")
    private val btnRoutes = Button(a)
    private val btnCost = Button(a)
    private val btnCar = Button(a)

    private fun suggestion(title: String, detail: String, onPick: () -> Unit) = LinearLayout(a).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(10), dp(8), dp(10), dp(8))
        addView(TextView(a).apply { text = title; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.parseColor("#1D2421")) })
        addView(text(detail))
        setOnClickListener { onPick() }
        setBackgroundColor(Color.parseColor("#F2F4F1"))
        layoutParams = lp(2)
    }

    /** Champ de lieu avec suggestions (Géoplateforme IGN). */
    private fun placeField(label: String, initial: Spot?, set: (Spot?) -> Unit) {
        formBox.addView(text(label))
        val box = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
        val input = EditText(a).apply { setText(initial?.label ?: ""); hint = "Ville, adresse, lieu…"; isSingleLine = true }
        var job: Job? = null
        var chosen = initial?.label
        input.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, st: Int, c: Int, af: Int) {}
            override fun onTextChanged(s: CharSequence?, st: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable?) {
                val t = s.toString().trim()
                job?.cancel(); box.removeAllViews()
                if (t == chosen) return
                set(null); chosen = null
                if (t.length < 2) return
                job = a.lifecycleScope.launch {
                    delay(300)
                    val list = runCatching { withContext(Dispatchers.IO) { Search.search(t) } }.getOrDefault(emptyList())
                    box.removeAllViews()
                    list.forEach { p ->
                        box.addView(suggestion(p.label, p.detail) {
                            chosen = p.label; set(Spot(p.label, p.lon, p.lat)); input.setText(p.label); box.removeAllViews()
                        })
                    }
                }
            }
        })
        formBox.addView(input, lp(0)); formBox.addView(box)
    }

    private fun save() = prefs.edit().putString("voyageVoiture", car.text.toString())
        .putString("voyageEnergie", energyKeys[energy.selectedItemPosition])
        .putFloat("voyageConso", conso.text.toString().replace(',', '.').toFloatOrNull() ?: 0f).apply()

    private var lastEnergy = ""
    private fun setEnergy(e: String, c: Double) {
        lastEnergy = e
        energy.setSelection(energyKeys.indexOf(e).coerceAtLeast(0))
        conso.setText(String.format(Locale.FRANCE, "%s", c).replace(',', '.'))
        consoLabel.text = "Conso (${Travel.unitFor(e)})"
    }

    init {
        col.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(TextView(a).apply { text = "🚗 Préparer un voyage"; textSize = 16f; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.parseColor("#1D2421")) },
                LinearLayout.LayoutParams(0, -2, 1f))
            addView(Button(a).apply { text = "✕"; setOnClickListener { onClose() } }, LinearLayout.LayoutParams(dp(48), dp(44)))
        })
        placeField("Départ", from) { from = it }
        placeField("Arrivée", null) { to = it }
        formBox.addView(CheckBox(a).apply {
            text = "Autoroutes à péage permises"
            isChecked = prefs.getBoolean("voyagePeages", true)
            setOnCheckedChangeListener { _, on -> prefs.edit().putBoolean("voyagePeages", on).apply() }
        }, lp())

        formBox.addView(text("Voiture (marque, modèle, année…)"))
        car.apply {
            hint = "ex. Peugeot 308 2019 1.2 PureTech"; isSingleLine = true
            setText(prefs.getString("voyageVoiture", ""))
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            setOnEditorActionListener { _, _, _ -> findCars(); true }
        }
        btnCar.apply { text = "Chercher"; isEnabled = password.isNotEmpty(); setOnClickListener { findCars() } }
        formBox.addView(LinearLayout(a).apply {
            addView(car, LinearLayout.LayoutParams(0, -2, 1f)); addView(btnCar, LinearLayout.LayoutParams(-2, -2))
        })
        formBox.addView(carList)

        energy.adapter = ArrayAdapter(a, android.R.layout.simple_spinner_dropdown_item, Travel.ENERGIES.values.toList())
        conso.inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
        formBox.addView(LinearLayout(a).apply {
            addView(LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; addView(text("Énergie")); addView(energy) }, LinearLayout.LayoutParams(0, -2, 1f))
            addView(LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; addView(consoLabel); addView(conso) }, LinearLayout.LayoutParams(0, -2, 1f))
        }, lp())
        val e0 = prefs.getString("voyageEnergie", "essence")!!.takeIf { it in Travel.ENERGIES } ?: "essence"
        setEnergy(e0, prefs.getFloat("voyageConso", Travel.DEFAULT_CONSO[e0]!!.toFloat()).toDouble().let { (it * 10).roundToInt() / 10.0 })
        energy.onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
            override fun onItemSelected(p: android.widget.AdapterView<*>?, v: View?, pos: Int, id: Long) {
                val e = energyKeys[pos]
                if (e == lastEnergy) return // choix fait par le programme (modèle de voiture) : on garde sa conso
                lastEnergy = e
                // Nouvelle énergie : on repart de la conso type, que l'on peut corriger.
                conso.setText(Travel.DEFAULT_CONSO[e]!!.toString()); consoLabel.text = "Conso (${Travel.unitFor(e)})"
                save()
            }
            override fun onNothingSelected(p: android.widget.AdapterView<*>?) {}
        }
        conso.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, st: Int, c: Int, af: Int) {}
            override fun onTextChanged(s: CharSequence?, st: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable?) { save() }
        })

        btnRoutes.apply { text = "Trouver les itinéraires"; setOnClickListener { findRoutes() } }
        formBox.addView(btnRoutes, lp(10))
        col.addView(summary); col.addView(formBox)
        col.addView(routeHint); col.addView(routeList)
        btnCost.apply { text = "Calculer le coût (IA)"; visibility = View.GONE; setOnClickListener { computeCost() } }
        col.addView(btnCost, lp())
        if (password.isEmpty()) col.addView(text("Mot de passe IA manquant (onglet Randos) : la recherche de voiture et le coût sont indisponibles."))
        col.addView(error); col.addView(result)
        // Le panneau ne prend jamais plus de 58 % de l'écran : la carte reste visible au-dessus.
        view.addOnLayoutChangeListener { v, _, _, _, _, _, _, _, _ ->
            val max = (a.resources.displayMetrics.heightPixels * 0.58).toInt()
            if (v.height > max) v.layoutParams = v.layoutParams.apply { height = max }
        }
    }

    private fun fold(on: Boolean) {
        formBox.visibility = if (on) View.GONE else View.VISIBLE
        summary.visibility = if (on) View.VISIBLE else View.GONE
        if (on) summaryText.text = "${from?.label} → ${to?.label}\n" +
            (car.text.toString().ifEmpty { null }?.let { "$it · " } ?: "") +
            "${Travel.ENERGIES[energyKeys[energy.selectedItemPosition]]} ${conso.text.toString().replace('.', ',')} ${Travel.unitFor(energyKeys[energy.selectedItemPosition])}" +
            if (prefs.getBoolean("voyagePeages", true)) "" else " · sans péage"
        // Le panneau peut avoir été borné à 58 % : on le laisse reprendre sa hauteur naturelle.
        view.layoutParams = view.layoutParams.apply { height = ViewGroup.LayoutParams.WRAP_CONTENT }
    }

    private fun setBusy(b: Boolean) { busy = b; btnRoutes.isEnabled = !b; btnCost.isEnabled = !b && password.isNotEmpty(); btnCar.isEnabled = !b && password.isNotEmpty() }

    private fun findCars() {
        val q = car.text.toString().trim()
        if (q.length < 2 || busy) return
        save(); setBusy(true); btnCar.text = "…"; error.text = ""; carList.removeAllViews()
        a.lifecycleScope.launch {
            runCatching { withContext(Dispatchers.IO) { Travel.searchCars(q, password) } }
                .onSuccess { list ->
                    if (list.isEmpty()) error.text = "Aucun modèle trouvé"
                    list.forEach { m ->
                        carList.addView(suggestion(m.nom, "${Travel.ENERGIES[m.energie]} · ${m.conso.toString().replace('.', ',')} ${m.unite}") {
                            car.setText(m.nom); setEnergy(m.energie, m.conso); save(); carList.removeAllViews()
                        })
                    }
                }
                .onFailure { error.text = "Recherche de la voiture impossible : ${it.message}" }
            btnCar.text = "Chercher"; setBusy(false)
        }
    }

    private fun findRoutes() {
        val f = from; val t = to
        if (f == null || t == null) { error.text = "Choisis le départ et l'arrivée dans les suggestions"; return }
        setBusy(true); btnRoutes.text = "Recherche des itinéraires…"; error.text = ""; result.removeAllViews()
        routes = emptyList(); showRoutes()
        a.lifecycleScope.launch {
            runCatching { withContext(Dispatchers.IO) { Travel.carRoutes(f.lon, f.lat, t.lon, t.lat, prefs.getBoolean("voyagePeages", true)) } }
                .onSuccess { routes = it; selected = 0; showRoutes(); fold(true); onRoutes(routes, 0) }
                .onFailure { error.text = "Itinéraire impossible (pas de réseau ?) : ${it.message}" }
            btnRoutes.text = "Trouver les itinéraires"; setBusy(false)
        }
    }

    /** Choix fait en touchant un trait sur la carte. */
    fun select(i: Int) { if (i in routes.indices) { selected = i; result.removeAllViews(); showRoutes(); onRoutes(routes, i) } }

    private fun showRoutes() {
        routeList.removeAllViews()
        btnCost.visibility = if (routes.isEmpty()) View.GONE else View.VISIBLE
        routeHint.text = when { routes.isEmpty() -> ""; routes.size > 1 -> "Choisis ton itinéraire (touche une ligne ou un trait sur la carte) :"; else -> "Itinéraire trouvé, vérifie-le sur la carte :" }
        routes.forEachIndexed { i, r ->
            routeList.addView(LinearLayout(a).apply {
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(8), dp(8), dp(8), dp(8))
                background = GradientDrawable().apply {
                    setColor(Color.parseColor("#F2F4F1")); cornerRadius = 8 * d
                    if (i == selected) setStroke(dp(3), Color.parseColor("#2F6F4F"))
                }
                addView(View(a).apply { background = GradientDrawable().apply { setColor(Color.parseColor(r.color)); cornerRadius = 3 * d } },
                    LinearLayout.LayoutParams(dp(16), dp(6)).apply { marginEnd = dp(8) })
                addView(LinearLayout(a).apply {
                    orientation = LinearLayout.VERTICAL
                    addView(TextView(a).apply { text = r.name; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.parseColor("#1D2421")) })
                    addView(text(Travel.routeLine(r)))
                })
                setOnClickListener { select(i) }
            }, lp(4))
        }
    }

    private fun computeCost() {
        val r = routes.getOrNull(selected) ?: return
        val f = from ?: return; val t = to ?: return
        val c = conso.text.toString().replace(',', '.').toDoubleOrNull()
        if (c == null || c <= 0) { error.text = "Indique la consommation"; return }
        setBusy(true); btnCost.text = "Claude calcule le coût…"; error.text = ""; result.removeAllViews()
        a.lifecycleScope.launch {
            runCatching { withContext(Dispatchers.IO) {
                Travel.tripCost(f.label, t.label, r, car.text.toString(), energyKeys[energy.selectedItemPosition], c, password) } }
                .onSuccess { k ->
                    result.addView(TextView(a).apply { text = Travel.euros(k.total); textSize = 28f; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.parseColor("#1D2421")) })
                    result.addView(text("${r.km.roundToInt()} km · énergie ${Travel.euros(k.coutEnergie)} (${k.prixUnitaire.toString().replace('.', ',')} ${k.unitePrix}) · péages ${Travel.euros(k.peages)}", 14f, Color.parseColor("#1D2421")))
                    if (k.peagesDetail.isNotEmpty()) result.addView(text(k.peagesDetail))
                    result.addView(text(k.explication))
                    result.addView(text(WebHikes.costLine(k.cost, k.cache).replace("Zone déjà cherchée", "Déjà calculé")))
                    (view as ScrollView).post { view.fullScroll(View.FOCUS_DOWN) }
                }
                .onFailure { error.text = "Calcul impossible : ${it.message}" }
            btnCost.text = "Calculer le coût (IA)"; setBusy(false)
        }
    }
}
