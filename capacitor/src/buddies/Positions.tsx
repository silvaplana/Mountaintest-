import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';
import { Capacitor } from '@capacitor/core';
import { EcoLocation } from '../gps/ecoLocation';
import { initialesDe, lire as lireCompte } from '../compte/auth';
import { epingleSurCarte, rangerEtiquettes } from '../PinLayer';
import { couleur, Natif, useBuddies, Visage } from './Buddies';
import { maPosition } from './Messages';
import { COULEURS, dessinVoiture, FORMES, NOMS_COULEURS, type Couleur, type Forme } from './voitureDessin';
import { detail, etiquette, heureCourte, opacite, reperes, reperesTous, type Repere } from './positions';
import {
  aDeux, appliquer, heureServeur, nomDiscussion, enfoncerEpingle, enleverVoiture, envoyerPosition, finEpingle, garerVoiture, maVoiture, mesEpingles, moiBuddy, monEpingle, positions, releverEpingle, synchroniser, voitures, vue,
  type CiblePosition, type Etat, type Groupe, type Sortie,
} from './store';

/**
 * Position des buddies (spec/buddies.md §5.9, écran 15) : 📍 une épingle qu'on enfonce (« mes buddies me voient »),
 * les visages sur la carte avec l'heure de leur dernière position, et la liste en bas. Mêmes écrans côté Kotlin
 * (BandeauSortie.kt, MainActivity.kt).
 */

function useReperes(x: Sortie) {
  const e = useBuddies();
  return reperes(x, positions(e), e.moi ?? 'moi');
}

/** « Marc Dupont » → « MD », « Seb » → « S ». */
export const initiales = (pseudo: string) => initialesDe(pseudo);

/** Les buddies sur la carte : une tête d'épingle à leurs initiales et l'heure de leur dernière position. */
export function PositionsSurCarte({ map, x }: { map: MlMap | null; x: Sortie }) {
  return <VisagesSurCarte map={map} rs={useReperes(x)} />;
}

function VisagesSurCarte({ map, rs }: { map: MlMap | null; rs: Repere[] }) {
  const cle = rs.map((r) => `${r.b.id}${r.b.pseudo}${r.b.photo}${r.b.initiales}${r.p.lat}${r.p.lon}${etiquette(r)}${r.actif}`).join();
  useEffect(() => {
    if (!map || !rs.length) return;
    const ms = rs.map((r) => {
      // Une épingle toute simple, et le pseudo en entier avec l'heure (Seb, 27/11).
      const mk = epingleSurCarte(map, r.p.lon, r.p.lat, r.moi ? 'toi' : `${r.b.pseudo} · ${heureCourte(r.p.prise_le)}`,
        r.moi ? 'moi' : r.actif ? '' : 'vieux',
        r.moi ? undefined : { photo: r.b.photo, initiales: r.b.initiales || initialesDe(r.b.pseudo), couleur: couleur(r.b.id) });
      mk.getElement().style.opacity = String(opacite(r));
      return mk;
    });
    rangerEtiquettes(map);
    return () => ms.forEach((m) => m.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, cle]);
  return null;
}

/** Le bas de l'écran 15 : les buddies visibles, puis l'épingle (enfoncer ou « Arrêter »). */
export function BandePositions({ x, onToast }: { x: Sortie; onToast: (m: string) => void }) {
  const e = useBuddies();
  const rs = useReperes(x);
  const moi = rs.find((r) => r.moi);
  const autres = rs.filter((r) => !r.moi);
  const ici = mesEpingles(e).find((p) => p.sortie === x.id);
  const enfoncer = async () => {
    if (!(await autoriser(onToast))) return;
    enfoncerEpingle([{ sortie: x.id }]);
    onToast(messagePartage(x.nom));
  };
  return <>
    {autres.map((r) => <div key={r.b.id} className={`bd-pos-ligne${r.actif ? '' : ' vieux'}`}>
      <Visage b={r.b} taille={44} />
      <span className="bd-texte"><b>{r.b.pseudo}</b><small>{detail(r, moi) || ' '}</small></span>
      <b>{etiquette(r)}</b>
    </div>)}
    {!autres.length && <p className="hint">Personne n'est visible pour l'instant : chacun choisit de partager sa position.</p>}
    {ici ? <div className="bd-epingle oui">
      <span className="bd-epingle-icone"><PositionIcon on /></span>
      <span className="bd-texte"><b>Mes buddies me voient</b><small>depuis {heureCourte(ici.depuis)} · s'arrête seul à {heureCourte(ici.jusqu)}</small></span>
      <button onClick={() => { releverEpingle({ sortie: x.id }); onToast(MESSAGE_ARRET); }}>Arrêter</button>
    </div> : <button className="primary bd-grand" onClick={() => void enfoncer()}>Partager ma position</button>}
    <p className="hint">{ici ? 'Sans réseau, tes positions sont gardées avec leur heure et partent au retour.'
      : 'Ta position part toutes les 5 minutes, jusqu\'à 19 h, seulement vers les buddies de cette sortie.'}</p>
  </>;
}

/** « 19 h », « 23 h 59 ». */
const heureRonde = (ms: number) => heureCourte(ms).replace(/ h 00$/, ' h');

/** Le message de 3 secondes quand ma position part (Seb, 26/11). */
export const messagePartage = (nom: string, jusqu = finEpingle()) =>
  `Ta position est partagée : les buddies de ${nom} te voient jusqu'à ${heureRonde(jusqu)}, s'il y a du réseau.`;
const MESSAGE_ARRET = "Ta position n'est plus partagée : plus personne ne te voit.";

/**
 * Avec qui partager (Seb, 26/11) : la sortie ouverte, sinon le groupe ouvert, sinon tous mes groupes (sans le
 * Groupe perso ni les discussions à deux). Rend aussi les noms, pour le message.
 */
export function ciblesIci(e: Etat, groupes: Groupe[], sorties: Sortie[], sortie?: string, groupe?: string): { cibles: CiblePosition[]; nom: string } {
  const x = sortie ? sorties.find((y) => y.id === sortie) : undefined;
  if (x) return { cibles: [{ sortie: x.id }], nom: x.nom };
  const g = groupe ? groupes.find((y) => y.id === groupe && y.nature !== 'me_time') : undefined;
  if (g) return { cibles: [{ groupe: g.id }], nom: aDeux(g) ? nomDiscussion(g, e) : g.nom };
  const bandes = groupes.filter((y) => y.nature === 'bande');
  return { cibles: bandes.map((y) => ({ groupe: y.id })), nom: bandes.length > 1 ? 'tous tes groupes' : bandes[0]?.nom ?? '' };
}

/** Le bouton de la colonne, un interrupteur (Seb, 26/11) : allumée, on l'éteint partout ; éteinte, on partage (ciblesIci). */
/** Allume ou éteint ma position ; vrai si elle vient d'être allumée. */
export async function basculerPosition(e: Etat, ici: { cibles: CiblePosition[]; nom: string }, onToast: (m: string) => void): Promise<boolean> {
  if (mesEpingles(e).length) { releverEpingle(); onToast(MESSAGE_ARRET); return false; }
  if (!ici.cibles.length) { onToast("Crée d'abord un groupe avec tes copains"); return false; }
  if (!(await autoriser(onToast))) return false;
  enfoncerEpingle(ici.cibles);
  onToast(messagePartage(ici.nom));
  return true;
}

async function autoriser(onToast: (m: string) => void) {
  if (!Capacitor.isNativePlatform()) return true;
  const p = await EcoLocation.requestPermissions().catch(() => null);
  if (p?.location !== 'granted') onToast('Autorise la localisation pour que tes buddies te voient');
  return p?.location === 'granted';
}

/** Tous les buddies que je connais (membres de mes groupes, participants de mes sorties). */
function useTous() {
  const e = useBuddies();
  const gens = [...appliquer(e).flatMap((g) => g.membres), ...vue(e).sorties.flatMap((x) => x.participants)];
  return reperesTous(positions(e), gens, e.moi ?? 'moi');
}

/**
 * Ma position (choix P1 de Seb, 26/11) : un point et des ondes de chaque côté, immobiles (Seb) ; éteinte, les ondes
 * sont grisées ; allumée, en gras bien marqué.
 */
export function PositionIcon({ on, size = 30 }: { on: boolean; size?: number }) {
  return <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor"
    strokeWidth="2.6" strokeLinecap="round" overflow="visible">
    <circle cx="24" cy="24" r="5" fill="currentColor" stroke="none" />
    {/* Allumé : même fond clair, ondes en noir gras (Seb, 26/11 : le rond ardoise était trop sombre). */}
    <g opacity={on ? undefined : 0.35} strokeWidth={on ? 4.2 : 2.6}>
      <path d="M15 15a13 13 0 0 0 0 18M33 15a13 13 0 0 1 0 18" />
      <path d="M9 10a20 20 0 0 0 0 28M39 10a20 20 0 0 1 0 28" />
    </g>
  </svg>;
}

/**
 * L'appui long sur Ma position (spec §7.14, simplifié avec Seb le 26/11) : ma position partagée ou non, un seul
 * bouton pour l'allumer ou l'éteindre (comme l'icône), et les buddies qui me montrent la leur.
 */
export function MaPosition({ ici, onVoir, onRetour, onClose, onToast }: {
  ici: { cibles: CiblePosition[]; nom: string }; onVoir: (r: Repere) => void; onRetour: () => void; onClose: () => void; onToast: (m: string) => void;
}) {
  const e = useBuddies();
  const rs = useTous();
  const moi = rs.find((r) => r.moi);
  const autres = rs.filter((r) => !r.moi && r.actif);
  const mes = mesEpingles(e);
  const noms = mes.map((p) => appliquer(e).find((g) => g.id === p.groupe)?.nom ?? vue(e).sorties.find((x) => x.id === p.sortie)?.nom).filter(Boolean);
  return <div className="bd-corps">
    <div className="xp-head"><button onClick={onRetour} aria-label="Retour">‹</button><h2>Ma position</h2><button onClick={onClose} aria-label="Fermer">✕</button></div>
    <div className={`bd-epingle${mes.length ? ' oui' : ''}`}>
      <span className="bd-epingle-icone"><PositionIcon on={!!mes.length} /></span>
      <span className="bd-texte">{mes.length
        ? <><b>Ta position est partagée</b><small>{noms.join(', ')} · jusqu'à {heureRonde(mes[0].jusqu)}, s'il y a du réseau</small></>
        : <><b>Ta position n'est pas partagée</b><small>Personne ne te voit</small></>}</span>
    </div>
    <h3 className="bd-section">Qui me montre sa position</h3>
    {autres.map((r) => <button key={r.b.id} className="bd-ligne bd-pos-ligne" onClick={() => onVoir(r)}>
      <Visage b={r.b} taille={44} />
      <span className="bd-texte"><b>{r.b.pseudo}</b><small>{detail(r, moi) || ' '}</small></span>
      <b>{etiquette(r)}</b>
    </button>)}
    {!autres.length && <p className="hint">Personne pour l'instant.</p>}
    <span style={{ flex: 1 }} />
    <button className="primary bd-grand" onClick={() => void basculerPosition(e, ici, onToast)}>{mes.length ? 'Arrêter de partager' : 'Partager ma position'}</button>
    <p className="hint">Un appui sur l'icône fait pareil. Ta position part toutes les 5 minutes, jusqu'à 19 h ; sans réseau, elle part au retour.</p>
  </div>;
}

/** Sur la carte, après un toucher dans la liste : tous les visages visibles, centrée sur celui choisi. */
export function PositionsBuddiesSurCarte({ map, centre }: { map: MlMap | null; centre: string }) {
  const rs = useTous();
  const fait = useRef(false);
  const r = rs.find((x) => x.b.id === centre);
  useEffect(() => {
    if (!map || !r || fait.current) return;
    fait.current = true;
    map.flyTo({ center: [r.p.lon, r.p.lat], zoom: Math.max(map.getZoom(), 14), duration: 600 });
  }, [map, r]);
  return <VisagesSurCarte map={map} rs={rs} />;
}

/**
 * Sur la carte principale, toujours (comme les voitures) : les buddies qui me montrent leur position en ce moment
 * (Seb, 27/11 : partagée depuis le PC, il ne la voyait pas sur le téléphone sans passer par la liste).
 */
export function BuddiesVisiblesSurCarte({ map }: { map: MlMap | null }) {
  const rs = useTous().filter((r) => r.actif && !r.moi);
  // Toutes les 2 minutes, appli ouverte : les positions et les voitures garées des buddies arrivent sans rouvrir
  // l'appli (Seb, 27/11 : sa voiture garée n'arrivait pas chez les autres).
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') void synchroniser().catch(() => undefined); }, 2 * 60_000);
    return () => clearInterval(t);
  }, []);
  return <VisagesSurCarte map={map} rs={rs} />;
}

export const nombreVisibles = (rs: Repere[]) => rs.filter((r) => r.actif && !r.moi).length;
export { useReperes };

/**
 * Tant que mon épingle est enfoncée : le service natif envoie une position toutes les 5 minutes, écran éteint
 * compris ; dans un navigateur, toutes les 5 minutes tant que la page est ouverte. À brancher une fois (App).
 */
export function useEpingle() {
  const e = useBuddies();
  const jusqu = monEpingle(e)?.jusqu;
  useEffect(() => {
    if (!jusqu) return;
    if (Capacitor.isNativePlatform()) {
      let h: { remove: () => Promise<void> } | undefined, fini = false;
      void (async () => {
        const d = await Natif.derniere().catch(() => ({ position: undefined }));
        if (d.position) envoyerPosition(d.position);
        await Natif.epingler({ jusqu });
        const l = await Natif.addListener('position', (p) => envoyerPosition(p));
        if (fini) void l.remove(); else h = l;
      })().catch(() => undefined);
      return () => { fini = true; void h?.remove(); void Natif.relever().catch(() => undefined); };
    }
    const prendre = () => navigator.geolocation?.getCurrentPosition(
      (p) => envoyerPosition({ lat: p.coords.latitude, lon: p.coords.longitude, alt: p.coords.altitude, t: p.timestamp }),
      () => undefined, { maximumAge: 60_000, timeout: 30_000 });
    prendre();
    const t = setInterval(prendre, 5 * 60_000);
    const fin = setTimeout(() => clearInterval(t), Math.max(0, jusqu - heureServeur()));
    return () => { clearInterval(t); clearTimeout(fin); };
  }, [jusqu]);
}

/**
 * 🚗 Appui long sur la voiture de la colonne (Seb, 26/11) : la garer là où je suis, ou l'enlever. Mes buddies la
 * voient aussi ; elle s'efface seule à minuit.
 */
export async function basculerVoiture(onToast: (m: string) => void) {
  if (maVoiture()) { enleverVoiture(); onToast("Ta voiture n'est plus sur la carte."); return; }
  try {
    const { lon, lat } = await maPosition();
    garerVoiture({ lon, lat });
    onToast('Ta voiture est garée ici. Tes buddies la voient aussi, jusqu\'à minuit.');
  } catch { onToast('Position introuvable : autorise la localisation et réessaie'); }
}

/** Les voitures garées sur la carte : chacun sa voiture (silhouette et couleur du profil), badge des initiales, heure
 * au-dessus ; un appui montre à qui elle est, la marque et le modèle (Seb, 27/11, maquette voiture-modele, style A). */
export function VoituresSurCarte({ map }: { map: MlMap | null }) {
  const e = useBuddies();
  const moi = e.moi ?? 'moi';
  const gens = new Map([...appliquer(e).flatMap((g) => g.membres), ...vue(e).sorties.flatMap((x) => x.participants)].map((b) => [b.id, b]));
  // Ma voiture : celle de mon profil sur ce téléphone, sans attendre le serveur.
  const p = lireCompte().profil;
  const vs = voitures(e).map((v) => v.qui === moi && p ? { ...v, modele: p.voiture_modele, forme: p.voiture_forme, couleur: p.voiture_couleur } : v);
  const cle = vs.map((v) => `${v.qui}${v.lat}${v.lon}${v.garee_le}${v.modele}${v.forme}${v.couleur}`).join();
  useEffect(() => {
    if (!map || !vs.length) return;
    const ms = vs.map((v) => {
      const el = document.createElement('div');
      el.className = 'bd-voiture-carte';
      const h = document.createElement('b');
      h.textContent = heureCourte(v.garee_le);
      const auto = document.createElement('span');
      auto.className = 'bd-auto';
      const forme = FORMES.includes(v.forme as Forme) ? v.forme as Forme : null;
      const couleur = (v.couleur && v.couleur in COULEURS ? v.couleur : 'rouge') as Couleur;
      // Sans silhouette choisie : la voiture rouge d'avant.
      if (forme) { auto.classList.add('dessin'); auto.innerHTML = dessinVoiture(forme, couleur, 96); } else auto.textContent = '🚗';
      const badge = document.createElement('i');
      if (v.qui === moi) badge.className = 'moi';
      const b = gens.get(v.qui) ?? (v.qui === moi ? moiBuddy(e) : undefined);
      const pseudo = b?.pseudo ?? '?';
      badge.textContent = b?.initiales || initiales(pseudo);
      auto.append(badge);
      // Un appui : « Julie · garée à 9 h 05 » et « Dacia Duster bleue », quelques secondes.
      const info = document.createElement('em');
      const qui = document.createElement('strong');
      qui.textContent = `${v.qui === moi ? 'Ma voiture' : pseudo} · garée à ${heureCourte(v.garee_le)}`;
      info.append(qui);
      const quoi = [v.modele, forme && v.couleur ? NOMS_COULEURS[couleur] : ''].filter(Boolean).join(' ');
      if (quoi) info.append(document.createElement('br'), quoi);
      let minuterie = 0;
      auto.addEventListener('click', (ev) => {
        ev.stopPropagation();
        el.classList.toggle('ouvert');
        clearTimeout(minuterie);
        minuterie = window.setTimeout(() => el.classList.remove('ouvert'), 5000);
      });
      el.append(info, h, auto);
      return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([v.lon, v.lat]).addTo(map);
    });
    rangerEtiquettes(map);
    return () => ms.forEach((m) => m.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, cle]);
  return null;
}

