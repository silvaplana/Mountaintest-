import { useEffect, useState } from 'react';
import { connecte } from '../compte/auth';
import { useCompte } from '../Account';
import { Carre, quandSortie, useBuddies, Visage } from './Buddies';
import { longueur } from './carnet';
import { appliquer, aujourdhui, partagerTrace, vue as vueSorties, type Sortie, type TraceBuddy } from './store';
import { listTraces, readPins, traceLengthM, traceLine, updateTrace, type SavedTrace } from '../trails/savedTraces';
import { derniersOuverts, nomLien, parDernierOuvert, type LienBuddy } from './recents';

/**
 * 👥 Associer une trace à un Buddy Time (maquettes/trace-buddy-time) : en haut le Buddy Time ouvert sur la carte,
 * puis les derniers ouverts ; dessous les Buddy Groups (derniers ouverts d'abord), chacun avec ses Buddy Times.
 */
export function AssocierPanel({ nom, lien, ouverte, onChoisir, onFermer }: {
  nom: string; lien: LienBuddy | null;
  /** Buddy Time ouvert sur la carte : proposé en premier, déjà choisi. */
  ouverte: Sortie | null;
  /** null : la trace n'est plus associée. */
  onChoisir: (l: LienBuddy | null) => void; onFermer: () => void;
}) {
  const e = useBuddies();
  const compte = useCompte();
  const { sorties } = vueSorties(e);
  const groupes = parDernierOuvert(appliquer(e).filter((g) => g.nature !== 'duo'), derniersOuverts('groupes'));
  const auj = aujourdhui();
  const [groupeVu, setGroupeVu] = useState<string | null>(null);
  const [choix, setChoix] = useState<LienBuddy | null>(ouverte && ouverte.id !== lien?.sortie ? { groupe: ouverte.groupe, sortie: ouverte.id } : null);
  // Proposés : l'ouvert, les derniers ouverts, puis ceux à venir ou en cours (du plus proche au plus lointain).
  const recents = derniersOuverts('sorties').map((id) => sorties.find((x) => x.id === id)).filter((x): x is Sortie => !!x);
  const avenir = sorties.filter((x) => x.fin >= auj).sort((a, b) => a.debut.localeCompare(b.debut));
  const proposes = [...(ouverte ? [ouverte] : []), ...recents, ...avenir].filter((x, i, l) => l.findIndex((y) => y.id === x.id) === i).slice(0, 8);
  const pareil = (a: LienBuddy | null, b: LienBuddy | null) => !!a && !!b && a.groupe === b.groupe && a.sortie === b.sortie;
  const prendre = (x: Sortie) => setChoix({ groupe: x.groupe, sortie: x.id });
  const choisi = choix && nomLien(choix, sorties, groupes);
  const actuel = lien && nomLien(lien, sorties, groupes);
  const g = groupeVu ? groupes.find((x) => x.id === groupeVu) : undefined;
  const associer = (l: LienBuddy | null) => { onChoisir(l); onFermer(); };

  const bas = <button className="primary bd-grand" disabled={!choix || pareil(choix, lien)} onClick={() => choix && associer(choix)}>
    {choisi ? `Associer à « ${choisi.titre} »` : 'Choisis un Buddy Time'}</button>;

  return <div className="bd-voile" onClick={onFermer}><div className="bd-feuille bd-partage" onClick={(ev) => ev.stopPropagation()}>
    {!connecte(compte) ? <>
      <div className="xp-head"><h3>Associer « {nom} »</h3><button onClick={onFermer} aria-label="Fermer">✕</button></div>
      <p className="hint">Connecte-toi (👤) pour associer tes traces à tes Buddy Times.</p>
    </> : g ? <>
      <div className="xp-head"><button onClick={() => setGroupeVu(null)} aria-label="Retour">‹</button>
        <h3>{g.nature === 'me_time' ? 'Me Time' : g.nom}</h3><button onClick={onFermer} aria-label="Fermer">✕</button></div>
      <h3 className="bd-section">Ses Buddy Times</h3>
      {(() => {
        const ses = sorties.filter((x) => x.groupe === g.id);
        const l = [...ses.filter((x) => x.fin >= auj).sort((a, b) => a.debut.localeCompare(b.debut)),
          ...ses.filter((x) => x.fin < auj).sort((a, b) => b.debut.localeCompare(a.debut))];
        return l.length ? l.map((x) => <button key={x.id} className={`bd-ligne bd-assoc${choix?.sortie === x.id ? ' oui' : ''}`} onClick={() => prendre(x)}>
          <Carre x={x} taille={56} /><span className="bd-texte"><b>{x.nom}</b><small>{quandSortie(x)} · {x.participants.length} partant{x.participants.length > 1 ? 's' : ''}</small></span>
          {choix?.sortie === x.id && <span className="bd-coche">✓</span>}</button>)
          : <p className="bd-vide">Pas encore de Buddy Time dans ce groupe.</p>;
      })()}
      <button className="bd-grand" disabled={pareil({ groupe: g.id, sortie: null }, lien)} onClick={() => associer({ groupe: g.id, sortie: null })}>Le Buddy Group seulement</button>
      {bas}
    </> : <>
      <div className="xp-head"><h3>Associer « {nom} »</h3><button onClick={onFermer} aria-label="Fermer">✕</button></div>
      {actuel && <div className="bd-ligne petite"><span className="bd-texte"><b>Associée à « {actuel.titre} »</b><small>{actuel.sous}</small></span>
        <button onClick={() => associer(null)}>Enlever</button></div>}
      {proposes.length > 0 && <><h3 className="bd-section">Proposés <small>{ouverte ? 'ouvert, puis derniers ouverts' : 'derniers ouverts'}</small></h3>
        <div className="bd-defile">{proposes.map((x) => <button key={x.id} className={`bd-tuile${choix?.sortie === x.id ? ' oui' : ''}`} onClick={() => prendre(x)}>
          <span className="bd-assoc-carre"><Carre x={x} taille={84} />{x.id === ouverte?.id && <i className="bd-ouvert">ouvert</i>}</span>
          <small>{x.nom}</small></button>)}</div></>}
      {groupes.length > 0 && <h3 className="bd-section">Ou chercher dans un Buddy Group</h3>}
      {groupes.map((x) => {
        const n = sorties.filter((y) => y.groupe === x.id).length;
        return <button key={x.id} className="bd-ligne" onClick={() => setGroupeVu(x.id)}>
          <Visage b={{ id: x.id, nom: x.nature === 'me_time' ? 'Me Time' : x.nom, photo: x.photo }} taille={46} />
          <span className="bd-texte"><b>{x.nature === 'me_time' ? 'Me Time' : x.nom}</b><small>{n} Buddy Time{n > 1 ? 's' : ''}</small></span>
          <span className="bd-fleche">›</span></button>;
      })}
      {bas}
    </>}
  </div></div>;
}

/**
 * L'autre sens (Seb, 25/11) : depuis un Buddy Time, ses traces associées, et « ＋ Associer une de mes traces »
 * qui ouvre 📂 Mes traces (celles enregistrées sur le téléphone).
 */
export function TracesAssociees({ x, traces, onVoir, onToast }: {
  x: Sortie; traces: TraceBuddy[]; onVoir: (t: TraceBuddy) => void; onToast: (m: string) => void;
}) {
  const [choisir, setChoisir] = useState(false);
  return <>
    <div className="bd-section bd-entre"><b>〰 Traces associées</b><small>{traces.length || ''}</small></div>
    {traces.map((t) => <button key={t.id} className="bd-ligne petite" onClick={() => onVoir(t)}>
      <span className="bd-icone">〰</span>
      <span className="bd-texte"><b>{t.nom}</b><small>{(longueur(t.ligne) / 1000).toFixed(1)} km · par {t.par.pseudo}{t.attente ? ' · 🕓' : ''}</small></span>
      <span className="bd-fleche">›</span></button>)}
    <button className="bd-ligne petite" onClick={() => setChoisir(true)}>
      <span className="bd-ajout">＋</span>
      <span className="bd-texte"><b>Associer une de mes traces</b><small>choisir dans 📂 Mes traces</small></span></button>
    {choisir && <ChoisirMaTrace x={x} onFermer={() => setChoisir(false)} onToast={onToast} />}
  </>;
}

function ChoisirMaTrace({ x, onFermer, onToast }: { x: Sortie; onFermer: () => void; onToast: (m: string) => void }) {
  const [l, setL] = useState<SavedTrace[] | null>(null);
  useEffect(() => { void listTraces().then(setL); }, []);
  const associer = (t: SavedTrace) => {
    partagerTrace(t.name, t.line, '', { sorties: [x.id], groupes: [] });
    void updateTrace(t.id, traceLine(t), readPins(t.pins), { groupe: x.groupe, sortie: x.id });
    onToast(navigator.onLine ? `✓ « ${t.name} » est dans « ${x.nom} »` : `« ${t.name} » ira dans « ${x.nom} » au retour du réseau 🕓`);
    onFermer();
  };
  return <div className="bd-voile" onClick={onFermer}><div className="bd-feuille bd-partage" onClick={(ev) => ev.stopPropagation()}>
    <div className="xp-head"><h3>📂 Mes traces</h3><button onClick={onFermer} aria-label="Fermer">✕</button></div>
    <p className="hint">Touche une trace pour l'associer à « {x.nom} ».</p>
    {l && !l.length && <p className="bd-vide">Aucune trace enregistrée. Dessine une trace (✏), touche-la puis « 💾 Sauvegarder ».</p>}
    {l?.map((t) => {
      const deja = t.lien?.sortie === x.id;
      return <button key={t.id} className={`bd-ligne bd-assoc${deja ? ' oui' : ''}`} disabled={deja} onClick={() => associer(t)}>
        <span className="bd-icone">〰</span>
        <span className="bd-texte"><b>{t.name}</b><small>{(traceLengthM(t) / 1000).toFixed(1)} km{deja ? ' · déjà associée' : ''}</small></span>
        {deja && <span className="bd-coche">✓</span>}</button>;
    })}
  </div></div>;
}

export type NomLien = ReturnType<typeof nomLien>;

/** Ligne « 👥 Associer à un Buddy Time » (menu de la trace et panneau « Modifier »), ou le Buddy Time associé. */
export function LigneLien({ lien, onClick }: { lien: NomLien | null; onClick: () => void }) {
  return <button className={`trace-lien${lien ? ' oui' : ''}`} onClick={onClick}>
    {lien?.sortie ? <Carre x={lien.sortie} taille={44} /> : <span className="trace-lien-ic">👥</span>}
    <span className="bd-texte"><b>{lien ? lien.titre : 'Associer à un Buddy Time'}</b>
      <small>{lien ? `${lien.sous} · changer` : 'ses photos iront dans le film'}</small></span>
    <span className="bd-fleche">›</span>
  </button>;
}
