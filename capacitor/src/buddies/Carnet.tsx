import { useEffect, useMemo, useState } from 'react';
import { TracesAssociees } from './Associer';
import { Capacitor } from '@capacitor/core';
import { nomAffiche } from '../compte/auth';
import { Image, Visionneuse } from './Album';
import { dates, Natif, Visage } from './Buddies';
import { MicIcon, Onde, useDictee } from './Dictee';
import {
  carnetDe, chiffres, choixPhotos, duree, fiches as fichesDe, joursDe, km, lireDuree, lireKm, lireMetres, metres, relief, reliefGarde,
  texteCarnet, tracesDuCarnet, type FicheAffichee, type Relief, type TraceCarnet,
} from './carnet';
import { euros } from './count';
import { LAYERS, wmtsTileUrl } from '../config';
import { getTileStore } from '../tiles/offlineStore';
import { enregistrerCarnet, ficheVide, lire, type Depense, type Fiche, type PhotoBuddy, type Sortie, type TraceBuddy } from './store';

/**
 * Carnet d'un Buddy Time (spec/buddies.md §5.8) : le souvenir (écrans 12 et 13) et l'écriture (14).
 * Mêmes écrans côté Kotlin (CarnetVue.kt). Calculs dans carnet.ts.
 */

const JOURS = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const jourLong = (j: string) => JOURS.format(new Date(`${j}T12:00:00`));

function useReliefs(traces: TraceCarnet[]) {
  const [r, setR] = useState(() => new Map(traces.flatMap((t) => { const g = reliefGarde(t.t.id); return g ? [[t.t.id, g] as const] : []; })));
  const cle = traces.map((t) => t.t.id).join();
  useEffect(() => {
    let vivant = true;
    for (const t of traces) if (!r.has(t.t.id)) void relief(t.t).then((x) => { if (x && vivant) setR((m) => new Map(m).set(t.t.id, x)); });
    return () => { vivant = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle]);
  return r;
}

/** La trace sur un petit plan, une couleur par jour ; un toucher l'ouvre sur la carte. */
function PetitPlan({ traces, onCarte }: { traces: TraceCarnet[]; onCarte: () => void }) {
  const pts = traces.flatMap((t) => t.t.ligne);
  // Mercator (pixels du zoom 0) : la trace tombe juste sur les tuiles du fond de carte (Seb, 25/11).
  const xs = pts.map((p) => mercX(p[0])), ys = pts.map((p) => mercY(p[1]));
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const W = 300, H = 200, m = 14, e = Math.min((W - 2 * m) / (x1 - x0 || 1e-9), (H - 2 * m) / (y1 - y0 || 1e-9));
  const ox = (W - (x1 - x0) * e) / 2, oy = (H - (y1 - y0) * e) / 2;
  const fond = useFond(pts.length < 2 ? null : { gauche: x0 - ox / e, haut: y0 - oy / e, e, W, H });
  if (pts.length < 2) return null;
  const chemin = (l: [number, number][]) => l.map((p, i) => `${i ? 'L' : 'M'}${(ox + (mercX(p[0]) - x0) * e).toFixed(1)},${(oy + (mercY(p[1]) - y0) * e).toFixed(1)}`).join('');
  const legende = traces.length > 1 || traces[0]?.jour == null;
  return <button className="bd-petit-plan" onClick={onCarte} aria-label="Voir la trace sur la carte">
    <svg viewBox={`0 0 ${W} ${H}`}>
      {fond.map((t) => <image key={t.cle} href={t.href} x={t.x} y={t.y} width={t.taille} height={t.taille} preserveAspectRatio="none" />)}
      {traces.map((t) => <path key={t.t.id} d={chemin(t.t.ligne)} stroke={t.couleur} />)}
    </svg>
    <span className="bd-agrandir">⤢</span>
    {legende && <span className="bd-legende">{traces.map((t) => <span key={t.t.id}><i style={{ background: t.couleur }} />{t.libelle}</span>)}</span>}
  </button>;
}

const mercX = (lon: number) => (lon + 180) / 360 * 256;
const mercY = (lat: number) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 256; };

type Tuile = { cle: string; href: string; x: number; y: number; taille: number };
/**
 * Fond Plan IGN sous le petit plan : tuiles gardées sur le téléphone d'abord (hors ligne), sinon le réseau.
 * Le plan déborde de son cadre de chaque côté (le SVG est centré dans un cadre plus large) : on couvre large.
 */
function useFond(v: { gauche: number; haut: number; e: number; W: number; H: number } | null): Tuile[] {
  const [l, setL] = useState<Tuile[]>([]);
  const cle = v ? [v.gauche, v.haut, v.e].map((n) => n.toFixed(4)).join() : '';
  useEffect(() => {
    if (!v) return;
    const z = Math.max(0, Math.min(16, Math.ceil(Math.log2(1.5 * v.e)))), n = 2 ** z, taille = 256 / n * v.e;
    const g = v.gauche - v.W / 2 / v.e, d = v.gauche + 1.5 * v.W / v.e, h = v.haut - v.H / 2 / v.e, b = v.haut + 1.5 * v.H / v.e;
    const tuiles: { z: number; x: number; y: number }[] = [];
    for (let x = Math.floor(g / 256 * n); x <= Math.floor(d / 256 * n); x++)
      for (let y = Math.max(0, Math.floor(h / 256 * n)); y <= Math.min(n - 1, Math.floor(b / 256 * n)); y++) tuiles.push({ z, x, y });
    let fini = false;
    const urls: string[] = [];
    void getTileStore(LAYERS.planign).then((store) => Promise.all(tuiles.map(async (t) => {
      const local = await store.read(t).catch(() => null);
      const href = local ? URL.createObjectURL(new Blob([local], { type: LAYERS.planign.format })) : wmtsTileUrl(LAYERS.planign, t.z, t.x, t.y, '');
      if (local) urls.push(href);
      return { cle: `${t.z}/${t.x}/${t.y}`, href, x: (t.x * 256 / n - v.gauche) * v.e, y: (t.y * 256 / n - v.haut) * v.e, taille };
    }))).then((r) => { if (!fini) setL(r); }).catch(() => undefined);
    return () => { fini = true; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [cle]); // eslint-disable-line react-hooks/exhaustive-deps
  return l;
}

/** Profil de tout le Buddy Time, jour après jour (écran 13). */
function ProfilCarnet({ traces, reliefs }: { traces: TraceCarnet[]; reliefs: Map<string, Relief> }) {
  const rs = traces.map((t) => ({ t, r: reliefs.get(t.t.id) })).filter((x): x is { t: TraceCarnet; r: Relief } => !!x.r);
  if (!rs.length) return null;
  const total = rs.reduce((n, x) => n + x.r.d[x.r.d.length - 1], 0) || 1;
  const zs = rs.flatMap((x) => x.r.z), zmin = Math.min(...zs), zmax = Math.max(...zs), dz = Math.max(50, zmax - zmin);
  const W = 300, H = 90, X = (d: number) => d / total * W, Y = (z: number) => 12 + (1 - (z - zmin) / dz) * (H - 22);
  let o = 0;
  const parts = rs.map(({ t, r }) => {
    const d0 = o; o += r.d[r.d.length - 1];
    const ligne = r.d.map((d, i) => `${X(d0 + d).toFixed(1)},${Y(r.z[i]).toFixed(1)}`).join(' L');
    return { t, d0, ligne, aire: `M${X(d0).toFixed(1)},${H} L${ligne} L${X(o).toFixed(1)},${H}Z` };
  });
  return <svg className="bd-profil-carnet" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
    {parts.map((p) => <g key={p.t.t.id}><path d={p.aire} fill={p.t.couleur} fillOpacity={0.18} /><path d={`M${p.ligne}`} stroke={p.t.couleur} fill="none" strokeWidth={2} vectorEffect="non-scaling-stroke" /></g>)}
    {parts.slice(1).map((p) => <line key={p.t.t.id} x1={X(p.d0)} x2={X(p.d0)} y1={0} y2={H} stroke="#888" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />)}
    <text x={4} y={10}>{metres(zmax)}</text>
  </svg>;
}

function Tuiles({ l }: { l: { v: string; l: string; vide?: boolean }[] }) {
  return <div className="bd-tuiles">{l.map((t) => <span key={t.l} className={t.vide ? 'vide' : ''}><b>{t.v}</b><small>{t.l}</small></span>)}</div>;
}

const chiffresFiche = (f: Pick<Fiche, 'depart' | 'duree' | 'distance' | 'denivele'>) => [
  { v: f.depart ? f.depart.replace(':', ' h ') : '—', l: 'départ', vide: !f.depart },
  { v: f.duree != null ? duree(f.duree) : '—', l: 'durée', vide: f.duree == null },
  { v: f.distance != null ? km(f.distance) : '—', l: 'distance', vide: f.distance == null },
  { v: f.denivele != null ? `+${metres(f.denivele)}` : '—', l: 'montée', vide: f.denivele == null },
];

/** Le carnet (écrans 12 et 13) : photos choisies, récits signés, trace, profil et chiffres, fiches des jours, « Le pratique ». */
export function UnCarnet({ x, photos, traces, depenses, onRetour, onClose, onEcrire, onChanger, onCarte, onCount, onToast }: {
  x: Sortie; photos: PhotoBuddy[]; traces: TraceBuddy[]; depenses: Depense[]; onRetour: () => void; onClose: () => void; onEcrire: () => void;
  onChanger: () => void; onCarte: () => void; onCount: () => void; onToast: (m: string) => void;
}) {
  const c = carnetDe(x);
  const jours = joursDe(x);
  const tc = useMemo(() => tracesDuCarnet(traces, jours), [traces, jours.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const reliefs = useReliefs(tc);
  const choix = choixPhotos(photos);
  // Une photo touchée s'ouvre en grand, plein écran ; on glisse vers les autres photos choisies.
  const [ouverte, setOuverte] = useState<number | null>(null);
  const fs = fichesDe(x, tc, reliefs);
  const tuiles = chiffres(x, tc, reliefs, fs);
  const [pratique, setPratique] = useState(false);
  const dist = tuiles.find((t) => t.l === 'distance'), montee = tuiles.find((t) => t.l === 'montée');
  const couverture = choix.photos[0];
  const partager = async () => {
    const texte = texteCarnet(x, dates(x), tuiles, fs);
    try {
      if (Capacitor.isNativePlatform()) await Natif.partager({ titre: x.nom, texte });
      else if (navigator.share) await navigator.share({ title: x.nom, text: texte });
      else { await navigator.clipboard.writeText(texte); onToast('Carnet copié : colle-le dans un message'); }
    } catch { /* annulé */ }
  };
  return <div className="bd-corps bd-carnet">
    <div className="bd-couverture" style={x.photo ? { background: `linear-gradient(#0000 35%, #000a), center/cover url("${x.photo}")` } : undefined}>
      {!x.photo && couverture && <Image p={couverture} taille="grande" className="bd-couverture-image" />}
      <button onClick={onRetour} aria-label="Retour">‹</button>
      <button className="bd-fermer" onClick={onClose} aria-label="Fermer">✕</button>
      <span className="bd-texte"><b>{x.nom}</b><small>{dates(x)} · {x.participants.map((p) => p.pseudo).join(', ')}</small></span>
    </div>
    {photos.length > 0 && <>
      <div className="bd-section bd-entre"><b>{choix.auto ? '✨' : '⭐'} {choix.photos.length} photo{choix.photos.length > 1 ? 's' : ''} choisie{choix.photos.length > 1 ? 's' : ''} sur {photos.length}</b>
        <button className="bd-lien" onClick={onChanger}>Changer</button></div>
      <div className="bd-mosaique">
        {choix.photos.slice(0, 3).map((p, i) => <span key={p.id} className={i === 0 ? 'grande' : ''} onClick={() => setOuverte(i)}>
          <Image p={p} taille="grande" />
          {i === 2 && choix.photos.length > 3 && <b>+{choix.photos.length - 3}</b>}</span>)}
      </div>
    </>}
    {c.recits.map((r) => <div key={r.par.id} className="bd-recit">
      <p>{r.texte}</p>
      <span className="bd-signe"><Visage b={r.par} taille={26} /><small>{r.par.pseudo}{r.attente ? ' · 🕓' : ''}</small></span>
    </div>)}
    {!c.recits.length && <button className="bd-recit vide" onClick={onEcrire}>🎤 Raconte la sortie : chacun ajoute son texte, à la voix ou au clavier.</button>}
    {tc.length > 0 && <>
      <div className="bd-section bd-entre"><b>〰 La trace</b><small>{[dist?.v, montee?.v].filter(Boolean).join(' · ')}</small></div>
      <PetitPlan traces={tc} onCarte={onCarte} />
      <ProfilCarnet traces={tc} reliefs={reliefs} />
    </>}
    <Tuiles l={tuiles.map((t) => t.vide ? { ...t, v: '+' } : t)} />
    <TracesAssociees x={x} traces={traces} onVoir={() => onCarte()} onToast={onToast} />
    {c.conditions && <p className="bd-conditions"><b>Conditions</b> {c.conditions}</p>}
    {fs.map((f) => <FicheJour key={f.jour} f={f} photos={(choix.auto ? photos : choix.photos).filter((p) => p.prise_le.startsWith(f.jour))} />)}
    {ouverte != null && choix.photos[ouverte] && <Visionneuse l={choix.photos} i={ouverte} onI={setOuverte} onFermer={() => setOuverte(null)} />}
    <button className="bd-pratique" onClick={() => setPratique(!pratique)} aria-expanded={pratique}>
      <span>📍 💶 〰</span><b>Le pratique</b><span>{pratique ? '▾' : '▸'}</span></button>
    {pratique && <div className="bd-pratique-corps">
      {x.lieu && <p>📍 {x.lieu}</p>}
      <p>👥 {x.participants.map((p) => p.pseudo).join(', ')}</p>
      <button className="bd-lien" onClick={onCount}>💶 {depenses.length ? `${euros(depenses.reduce((n, d) => n + d.montant, 0))} à ${x.participants.length} · les comptes ›` : 'Buddy count ›'}</button>
      <p className="hint">L’hébergement et les messages s’ajouteront ici.</p>
    </div>}
    <span style={{ flex: 1 }} />
    <div className="bd-plus">
      <button onClick={onEcrire}>✏️ Modifier</button>
      <button className="primary" onClick={() => void partager()}>Partager</button>
    </div>
  </div>;
}

function FicheJour({ f, photos }: { f: FicheAffichee; photos: PhotoBuddy[] }) {
  const [ouverte, setOuverte] = useState<number | null>(null);
  return <div className="bd-fiche">
    <div className="bd-fiche-titre"><span className="bd-jour" style={{ background: f.couleur }}>Jour {f.n}</span><b>{f.nom || jourLong(f.jour)}</b></div>
    <Tuiles l={chiffresFiche(f)} />
    {photos.length > 0 && <div className="bd-fiche-photos">{photos.slice(0, 3).map((p, i) => <span key={p.id} onClick={() => setOuverte(i)}><Image p={p} /></span>)}</div>}
    {ouverte != null && photos[ouverte] && <Visionneuse l={photos} i={ouverte} onI={setOuverte} onFermer={() => setOuverte(null)} />}
  </div>;
}

// ------------------------------------------------------------------ écrire le carnet (écran 14)

type Saisie = { nom: string; depart: string; duree: string; distance: string; denivele: string };
const versSaisie = (f?: Fiche): Saisie => ({ nom: f?.nom ?? '', depart: f?.depart ?? '', duree: f?.duree != null ? duree(f.duree) : '',
  distance: f?.distance != null ? String(f.distance / 1000).replace('.', ',') : '', denivele: f?.denivele != null ? String(f.denivele) : '' });

/** Écrire le carnet (écran 14) : mon récit (dicté, puis corrigé au clavier), les fiches des jours, ce que la trace ne dit pas. */
export function EcrireCarnet({ x, traces, onRetour, onClose, onToast }: {
  x: Sortie; traces: TraceBuddy[]; onRetour: () => void; onClose: () => void; onToast: (m: string) => void;
}) {
  const c = carnetDe(x);
  const moi = lire().moi ?? 'moi';
  const jours = joursDe(x);
  const tc = useMemo(() => tracesDuCarnet(traces, jours), [traces, jours.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const reliefs = useReliefs(tc);
  const derives = fichesDe({ ...x, carnet: { ...c, fiches: [] } }, tc, reliefs);
  const monRecit = c.recits.find((r) => r.par.id === moi)?.texte ?? '';
  const [texte, setTexte] = useState(monRecit);
  const [saisies, setSaisies] = useState<Saisie[]>(() => jours.map((j) => versSaisie(c.fiches.find((f) => f.jour === j))));
  const [autres, setAutres] = useState({ difficulte: c.difficulte, meteo: c.meteo, conditions: c.conditions });
  const [debut] = useState(Date.now());
  const [, tic] = useState(0);
  useEffect(() => { const t = setInterval(() => tic((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const dictee = useDictee((t) => setTexte((v) => (v.trim() ? `${v.trim()} ${t}` : t)), onToast);
  const s = Math.floor((Date.now() - debut) / 1000);
  const changer = (i: number, k: keyof Saisie, v: string) => setSaisies((l) => l.map((f, j) => j === i ? { ...f, [k]: v } : f));
  const enregistrer = () => {
    const fiches: Fiche[] = [];
    for (const [i, j] of jours.entries()) {
      const v = saisies[i];
      const f: Fiche = { jour: j, nom: v.nom, depart: v.depart, duree: lireDuree(v.duree), distance: lireKm(v.distance), denivele: lireMetres(v.denivele) };
      if ((v.duree.trim() && f.duree == null) || (v.distance.trim() && f.distance == null) || (v.denivele.trim() && f.denivele == null)) {
        onToast(`Jour ${i + 1} : un chiffre est illisible (durée « 5 h 20 », distance en km, montée en m)`); return;
      }
      const avant = c.fiches.find((y) => y.jour === j);
      if (JSON.stringify(avant ?? null) !== JSON.stringify(ficheVide(f) ? null : { ...f, nom: f.nom.trim() })) fiches.push(f);
    }
    const autresChange = autres.difficulte !== c.difficulte || autres.meteo !== c.meteo || autres.conditions !== c.conditions;
    enregistrerCarnet(x.id, { recit: texte.trim() !== monRecit ? texte : undefined, fiches, carnet: autresChange ? autres : undefined });
    onToast(navigator.onLine ? 'Carnet enregistré' : 'Carnet enregistré : il partira au retour du réseau 🕓');
    onRetour();
  };
  return <div className="bd-corps bd-carnet">
    <div className="xp-head">
      <button onClick={onRetour} aria-label="Retour">‹</button>
      <span className="bd-titre"><b>{x.nom}</b><small>📖 écrire le carnet</small></span>
      <button onClick={onClose} aria-label="Fermer">✕</button>
    </div>
    <div className="bd-section bd-entre"><b>Le récit</b><small>{nomAffiche()}{dictee.ecoute ? ` · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : ''}</small></div>
    <textarea className="bd-recit-saisie" rows={6} value={texte} onChange={(e) => setTexte(e.target.value)}
      placeholder="Ce que tu veux raconter : le départ, le temps, les rires du soir…" />
    <button className={`bd-micro${dictee.ecoute ? ' ecoute' : ''}`} onClick={() => void dictee.basculer()} aria-label={dictee.ecoute ? 'Arrêter la dictée' : 'Dicter'}><MicIcon size={48} /></button>
    {dictee.ecoute && <Onde niveau={dictee.niveau} partiel={dictee.partiel} />}
    <p className="hint bd-centre">{dictee.ecoute ? 'Je t’écoute… touche pour arrêter, puis corrige le texte.' : 'Touche le micro et raconte : tes mots sont écrits tels quels.'}</p>
    {jours.map((j, i) => {
      const d = derives.find((f) => f.jour === j), v = saisies[i];
      const couleur = tc.find((t) => t.jour === j)?.couleur ?? '#2f6f4f';
      return <div key={j} className="bd-fiche">
        <div className="bd-fiche-titre"><span className="bd-jour" style={{ background: couleur }}>Jour {i + 1}</span>
          <input value={v.nom} onChange={(e) => changer(i, 'nom', e.target.value)} placeholder="Nom de la rando" maxLength={80} />
          {d?.trace && <small>depuis la trace</small>}</div>
        <div className="bd-tuiles saisie">
          <label><input type="time" value={v.depart} onChange={(e) => changer(i, 'depart', e.target.value)} /><small>départ</small></label>
          <label><input value={v.duree} onChange={(e) => changer(i, 'duree', e.target.value)} placeholder="—" inputMode="text" /><small>durée</small></label>
          <label><input value={v.distance} onChange={(e) => changer(i, 'distance', e.target.value)} inputMode="decimal"
            placeholder={d?.distance != null ? km(d.distance) : '—'} /><small>distance (km)</small></label>
          <label><input value={v.denivele} onChange={(e) => changer(i, 'denivele', e.target.value)} inputMode="numeric"
            placeholder={d?.denivele != null ? `+${metres(d.denivele)}` : '—'} /><small>montée (m)</small></label>
        </div>
      </div>;
    })}
    <div className="bd-fiche">
      <label className="bd-champ"><small>Difficulté</small><input value={autres.difficulte} maxLength={20} placeholder="T3, PD, 3.1…"
        onChange={(e) => setAutres({ ...autres, difficulte: e.target.value })} /></label>
      <label className="bd-champ"><small>Météo</small><input value={autres.meteo} maxLength={40} placeholder="☀️ 4°"
        onChange={(e) => setAutres({ ...autres, meteo: e.target.value })} /></label>
      <label className="bd-champ"><small>Conditions</small><input value={autres.conditions} maxLength={300} placeholder="Neige dure le matin, lac gelé…"
        onChange={(e) => setAutres({ ...autres, conditions: e.target.value })} /></label>
    </div>
    <button className="primary bd-grand" onClick={enregistrer}>Enregistrer le carnet</button>
  </div>;
}
