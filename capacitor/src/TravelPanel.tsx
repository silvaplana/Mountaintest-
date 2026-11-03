import { useEffect, useState } from 'react';
import { searchPlaces, type Place } from './search';
import { costLine } from './trails/webHikes';
import {
  carRoutes, DEFAULT_CONSO, ENERGIES, euros, routeLine, searchCars, tripCost, unitFor,
  type Car, type CarRoute, type Energy, type TripCost,
} from './travel/travel';

interface Spot { label: string; lon: number; lat: number }

const KEY = 'voyage';
interface Saved { tolls: boolean; car: string; energy: Energy; conso: number }
function load(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null;
    if (v && v.energy in ENERGIES) return v;
  } catch { /* ignoré */ }
  return { tolls: true, car: '', energy: 'essence', conso: DEFAULT_CONSO.essence };
}

/** Champ de lieu avec suggestions (Géoplateforme IGN). */
function PlaceField({ label, value, onChange }: { label: string; value: Spot | null; onChange: (s: Spot | null) => void }) {
  const [text, setText] = useState(value?.label ?? '');
  const [list, setList] = useState<Place[]>([]);
  useEffect(() => { setText(value?.label ?? ''); }, [value]);
  useEffect(() => {
    const t = text.trim();
    if (t.length < 2 || t === value?.label) { setList([]); return; }
    const ctrl = new AbortController();
    const timer = setTimeout(() => { searchPlaces(t, ctrl.signal).then(setList).catch(() => setList([])); }, 300);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [text, value]);
  return (
    <label className="field">{label}
      <input value={text} onChange={(e) => { setText(e.target.value); if (value) onChange(null); }} placeholder="Ville, adresse, lieu…" autoCorrect="off" />
      {list.length > 0 && <ul className="search-results">
        {list.map((p, i) => <li key={i}><button type="button" onClick={() => { onChange({ label: p.label, lon: p.lon, lat: p.lat }); setList([]); }}>
          <b>{p.label}</b><span>{p.detail}</span></button></li>)}
      </ul>}
    </label>
  );
}

export interface TravelProps {
  /** Point de départ proposé : ma position, sinon le centre de la carte. */
  here: Spot;
  password: string;
  routes: CarRoute[]; selected: number;
  onRoutes: (r: CarRoute[], sel: number) => void;
  onClose: () => void;
}

/** Préparer un voyage : départ, arrivée, péages, voiture, énergie, conso → itinéraires sur la carte → coût par Claude. */
export function TravelPanel({ here, password, routes, selected, onRoutes, onClose }: TravelProps) {
  const [from, setFrom] = useState<Spot | null>(here);
  const [to, setTo] = useState<Spot | null>(null);
  const [s, setS] = useState<Saved>(load);
  const save = (v: Partial<Saved>) => setS((o) => { const n = { ...o, ...v }; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* ignoré */ } return n; });
  const [cars, setCars] = useState<Car[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [cost, setCost] = useState<TripCost | null>(null);
  // Itinéraires trouvés : le formulaire se replie pour laisser voir la carte (bouton « Modifier »).
  const [editing, setEditing] = useState(false);
  const form = routes.length === 0 || editing;

  async function findCars() {
    if (s.car.trim().length < 2) return;
    setBusy('voiture'); setError(''); setCars([]);
    try {
      const c = await searchCars(s.car.trim(), password);
      setCars(c);
      if (!c.length) setError('Aucun modèle trouvé');
    } catch (e) { setError(`Recherche de la voiture impossible : ${(e as Error).message}`); }
    setBusy('');
  }

  async function findRoutes() {
    if (!from || !to) { setError('Choisis le départ et l’arrivée dans les suggestions'); return; }
    setBusy('routes'); setError(''); setCost(null); onRoutes([], 0);
    try { onRoutes(await carRoutes([from.lon, from.lat], [to.lon, to.lat], s.tolls), 0); setEditing(false); }
    catch (e) { setError(`Itinéraire impossible (pas de réseau ?) : ${(e as Error).message}`); }
    setBusy('');
  }

  async function computeCost() {
    const r = routes[selected];
    if (!r || !from || !to) return;
    setBusy('cout'); setError(''); setCost(null);
    try { setCost(await tripCost({ depart: from.label, arrivee: to.label, route: r, voiture: s.car, energie: s.energy, conso: s.conso }, password)); }
    catch (e) { setError(`Calcul impossible : ${(e as Error).message}`); }
    setBusy('');
  }

  const unit = unitFor(s.energy);
  return (
    <div className="travel">
      <div className="travel-head"><b>🚗 Préparer un voyage</b><button onClick={onClose} aria-label="Fermer">✕</button></div>
      {!form && <div className="summary">
        <span>{from?.label} → {to?.label}<br />{s.car ? `${s.car} · ` : ''}{ENERGIES[s.energy]} {String(s.conso).replace('.', ',')} {unit}{s.tolls ? '' : ' · sans péage'}</span>
        <button onClick={() => setEditing(true)}>Modifier</button>
      </div>}
      {form && <>
      <PlaceField label="Départ" value={from} onChange={setFrom} />
      <PlaceField label="Arrivée" value={to} onChange={setTo} />
      <label className="check"><input type="checkbox" checked={s.tolls} onChange={(e) => save({ tolls: e.target.checked })} /> Autoroutes à péage permises</label>
      <label className="field">Voiture (marque, modèle, année…)
        <span className="row">
          <input value={s.car} onChange={(e) => save({ car: e.target.value })} placeholder="ex. Peugeot 308 2019 1.2 PureTech"
            onKeyDown={(e) => { if (e.key === 'Enter') void findCars(); }} />
          <button disabled={!!busy || !password} onClick={() => void findCars()}>{busy === 'voiture' ? '…' : 'Chercher'}</button>
        </span>
      </label>
      {cars.length > 0 && <ul className="search-results">
        {cars.flatMap((c) => c.energies.map((e, j) => (
          <li key={`${c.nom}-${j}`}><button type="button" onClick={() => { save({ car: c.nom, energy: e.energie, conso: e.conso }); setCars([]); }}>
            <b>{c.nom}</b><span>{ENERGIES[e.energie] ?? e.energie} · {String(e.conso).replace('.', ',')} {e.unite}</span></button></li>
        )))}
      </ul>}
      <span className="row">
        <label className="field">Énergie
          <select value={s.energy} onChange={(e) => { const en = e.target.value as Energy; save({ energy: en, conso: DEFAULT_CONSO[en] }); }}>
            {(Object.keys(ENERGIES) as Energy[]).map((k) => <option key={k} value={k}>{ENERGIES[k]}</option>)}
          </select>
        </label>
        <label className="field">Conso ({unit})
          <input type="number" inputMode="decimal" step="0.1" min="0" value={s.conso} onChange={(e) => save({ conso: Number(e.target.value) })} />
        </label>
      </span>
      <button className="primary" disabled={!!busy} onClick={() => void findRoutes()}>{busy === 'routes' ? 'Recherche des itinéraires…' : 'Trouver les itinéraires'}</button>
      </>}
      {routes.length > 0 && <>
        <p className="hint">{routes.length > 1 ? 'Choisis ton itinéraire (touche une ligne ou un trait sur la carte) :' : 'Itinéraire trouvé, vérifie-le sur la carte :'}</p>
        <ul className="routes">
          {routes.map((r, i) => (
            <li key={i}><button className={i === selected ? 'sel' : ''} onClick={() => { onRoutes(routes, i); setCost(null); }}>
              <i style={{ background: r.color }} /><b>{r.name}</b><span>{routeLine(r)}</span></button></li>
          ))}
        </ul>
        <button className="primary" disabled={!!busy || !password || !(s.conso > 0)} onClick={() => void computeCost()}>
          {busy === 'cout' ? 'Claude calcule le coût…' : 'Calculer le coût (IA)'}</button>
      </>}
      {!password && <p className="hint">Mot de passe IA manquant (onglet Randos) : la recherche de voiture et le coût sont indisponibles.</p>}
      {error && <p className="error">{error}</p>}
      {cost && <div className="cost">
        <p className="total">{euros(cost.total)}</p>
        <p>⛽ Prix moyen {ENERGIES[s.energy].toLowerCase()} : <b>{cost.prix_unitaire.toFixed(2).replace('.', ',')} {cost.unite_prix}</b></p>
        <p>{routes[selected] ? `${Math.round(routes[selected].km)} km` : ''} · {ENERGIES[s.energy].toLowerCase()} {euros(cost.cout_energie)} · péages {euros(cost.peages)}</p>
        {cost.peages_detail && <p className="hint">{cost.peages_detail}</p>}
        <p className="hint">{cost.explication}</p>
        <p className="hint">{costLine({ cout: cost.cout_usd ?? 0, mois: cost.cumul_mois_usd ?? 0, total: cost.cumul_total_usd ?? 0 }, !!cost.cache).replace('Zone déjà cherchée', 'Déjà calculé')}</p>
      </div>}
    </div>
  );
}
