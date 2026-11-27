import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';
import { Capacitor } from '@capacitor/core';
import { api, connecte } from '../compte/auth';
import { Natif, useBuddies, Visage } from './Buddies';
import {
  ATTENTE_MS, appelEnCours, couperMicro, decrocher, duree, enLigne, finSonnerie, montrerMaCarte, raccrocher, reprendreMaCarte, refuser, sonner, suivreAppel, suivreDoigts,
  montrerMaCarteDesQue, type EtatAppel, type Sonnerie } from './appel';
import { appliquer, vue } from './store';
import { IconeSuisCarte } from './IconeSuisCarte';

/**
 * 📞 Appels (spec/buddies.md §5.7) : l'écran 10 (un buddy m'appelle), la barre d'appel en haut de la carte
 * (écran 24) et « Julie montre » (doigt au trait) sur la carte. Mêmes écrans côté Kotlin (AppelVue.kt).
 */

export function useAppel(): EtatAppel | null {
  const [e, setE] = useState(appelEnCours);
  useEffect(() => suivreAppel(setE), []);
  return e;
}

/**
 * Sonnerie : le téléphone reçoit l'appel (Firebase) même appli fermée ; appli ouverte, l'écran 10 s'affiche.
 * Le jeton Firebase de ce téléphone part au serveur. À brancher une fois (App).
 */
export function useSonnerie(onToast: (m: string) => void) {
  const compte = connecte();
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !compte) return;
    let fini = false;
    const hs: { remove: () => Promise<void> }[] = [];
    const recu = (s: Sonnerie & { action?: string }) => {
      sonner(s);
      if (s.action === 'decrocher') void decrocher().catch((e: Error) => onToast(e.message));
    };
    void (async () => {
      const j = await Natif.jetonPush().catch(() => ({ jeton: '' }));
      if (j.jeton) void api('POST', '/appareils', { jeton: j.jeton, plateforme: 'android' }).catch(() => undefined);
      // Ouverte depuis la notification d'appel (« Répondre » ou toucher).
      const att = await Natif.appelEnAttente().catch(() => ({}) as { appel?: Sonnerie & { action?: string } });
      if (att.appel) recu(att.appel);
      const a = await Natif.addListener('appel', recu);
      const b = await Natif.addListener('finAppel', (x: { appel: string }) => finSonnerie(x.appel));
      if (fini) { void a.remove(); void b.remove(); } else hs.push(a, b);
    })().catch(() => undefined);
    // L'écran 10 se ferme (réponse, refus, fin) : la sonnerie du téléphone s'arrête.
    const stop = suivreAppel((e) => { if (e?.phase !== 'sonne') void Natif.arreterSonnerie().catch(() => undefined); });
    return () => { fini = true; stop(); hs.forEach((h) => void h.remove()); };
  }, [compte, onToast]);
}

/** Les visages de ceux qu'on appelle (la sortie ou le groupe). */
function useQui(e: EtatAppel | null) {
  const b = useBuddies();
  if (!e) return [];
  if (e.dest.sortie) return vue(b).sorties.find((x) => x.id === e.dest.sortie)?.participants ?? [];
  return appliquer(b).find((g) => g.id === e.dest.groupe)?.membres ?? [];
}

/** Écran 10 : « Week-end Queyras · Julie t'appelle… », Refuser / Répondre. */
export function EcranSonnerie({ onToast }: { onToast: (m: string) => void }) {
  const e = useAppel();
  const qui = useQui(e);
  const b = useBuddies();
  if (!e || (e.phase !== 'sonne' && !(e.phase === 'connexion' && e.de))) return null;
  // Déjà en ligne, d'après la dernière synchro.
  const ligne = new Set((b.appels ?? []).find((a) => a.id === e.id)?.en_ligne ?? []);
  const dejaLa = qui.filter((p) => ligne.has(p.id)).map((p) => p.pseudo);
  return <div className="ap-sonne">
    <small>Mountain Buddies · appel de groupe</small>
    <b className="ap-nom">{e.nom}</b>
    <span>{e.phase === 'connexion' ? 'Connexion…' : `${e.de} t'appelle…`}</span>
    <div className="ap-visages">{qui.filter((p) => p.id !== b.moi).slice(0, 5).map((p) =>
      <span key={p.id} className={ligne.has(p.id) ? 'ap-la' : ''}><Visage b={p} taille={64} /></span>)}</div>
    {dejaLa.length > 0 && <small>{dejaLa.join(' et ')} {dejaLa.length > 1 ? 'sont' : 'est'} déjà en ligne</small>}
    <span style={{ flex: 1 }} />
    <div className="ap-boutons">
      <button className="ap-rouge" aria-label="Refuser" onClick={refuser}>✕<small>Refuser</small></button>
      <button className="ap-vert" aria-label="Répondre" disabled={e.phase === 'connexion'}
        onClick={() => void decrocher().catch((err: Error) => onToast(err.message))}>📞<small>Répondre</small></button>
    </div>
  </div>;
}

/** Écran 24 : la barre d'appel en haut, la carte reste à l'écran. */
export function BarreAppel() {
  const e = useAppel();
  const b = useBuddies();
  const qui = useQui(e);
  // Depuis quand on attend qu'ils décrochent (au-delà d'une minute : « pas répondu »).
  const depuis = useRef<{ id: string; t: number }>({ id: '', t: 0 });
  if (e && e.id && depuis.current.id !== e.id) depuis.current = { id: e.id, t: Date.now() };
  const [, tic] = useState(0);
  useEffect(() => {
    if (!e || e.phase === 'sonne') return;
    const t = setInterval(() => tic((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [e]);
  if (!e || e.phase === 'sonne' || (e.phase === 'connexion' && e.de)) return null;
  // 🗺 Carte montrée ou suivie depuis la messagerie (sans appel) : juste l'icône carte, ou le badge de celui qu'on suit.
  if (e.muette) {
    const g = e.suit ? appliquer(b).flatMap((x) => x.membres).find((m) => m.id === e.suit!.id) ?? { id: e.suit.id, pseudo: e.suit.pseudo, photo: null } : null;
    return <div className="ap-pastille">
      {g ? <button className="ap-guide" aria-label={`Arrêter de suivre la carte de ${g.pseudo}`} onClick={reprendreMaCarte}>
        <Visage b={g} taille={44} /><span className="ap-guide-carte"><IconeSuisCarte /></span></button>
        : <button className={e.jeMontre ? 'allume' : 'attente'} aria-label={e.jeMontre ? 'Arrêter de montrer ma carte' : 'Ne plus attendre la carte'}
          onClick={() => (e.jeMontre ? montrerMaCarte(false) : void raccrocher())}><IconeSuisCarte /></button>}
    </div>;
  }
  const annonce = e.annonce && e.annonce.jusqua > Date.now() ? e.annonce.texte : '';
  const titre = annonce ? annonce : e.jeMontre ? 'Tu montres ta carte'
    : e.phase === 'connexion' ? 'Connexion…' : `Appel pour ${e.nom}`; // Seb, 27/11 : « Appel pour La Ciotat ski club », pas « Ça sonne… »
  // 👥 Qui a décroché (Seb, 27/11, maquette B) : petits visages dans la barre ; couleur + point vert = en ligne,
  // grisé = ça sonne, barré = pas répondu (après une minute, ou parti). Ceux en ligne d'abord, 6 au plus puis « +N ».
  const moi = b.moi;
  const enLigneIds = new Set(e.voix.map((v) => v.id));
  const attend = Date.now() - depuis.current.t < ATTENTE_MS;
  const visages = qui.filter((m) => m.id !== moi && m.id !== 'moi')
    .map((m) => ({ m, etat: enLigneIds.has(m.id) ? 'on' : attend ? 'sonne' : 'non' }))
    .sort((x, y) => (x.etat === 'on' ? 0 : x.etat === 'sonne' ? 1 : 2) - (y.etat === 'on' ? 0 : y.etat === 'sonne' ? 1 : 2));
  // 🗺 Une seule personne montre sa carte : chez les autres, l'icône carte devient son badge (un appui : on arrête de suivre).
  const suit = e.suit;
  const guide = suit ? appliquer(b).flatMap((g) => g.membres).find((m) => m.id === suit.id) ?? { id: suit.id, pseudo: suit.pseudo, photo: null } : null;
  return <div className={`ap-barre${annonce || e.jeMontre || suit ? ' ap-annonce' : ''}`}>
    <span className="ap-icone">📞</span>
    <span className="bd-texte"><b>{titre}</b><span className="ap-visages" aria-label={enLigne(e)}>
        {visages.slice(0, 6).map(({ m, etat }) => <span key={m.id} className={`ap-v ${etat}`}><Visage b={m} taille={26} /></span>)}
        {visages.length > 6 && <small>+{visages.length - 6}</small>}
        {e.phase === 'en_ligne' && <small>{duree(Date.now() - (e.debut ?? Date.now()))}</small>}</span>
      {e.phase === 'en_ligne' && !e.jeMontre && !suit && <small className="ap-astuce">Appui long sur la carte : tu la montres aux autres 👉</small>}</span>
    {e.phase === 'en_ligne' && guide && <button className="ap-guide" aria-label={`Arrêter de suivre la carte de ${guide.pseudo}`} onClick={reprendreMaCarte}>
      <Visage b={guide} taille={44} /><span className="ap-guide-carte"><IconeSuisCarte /></span></button>}
    {e.phase !== 'en_ligne' && <button aria-label={e.carteDesQue ? 'Ne pas montrer ma carte' : 'Montrer ma carte dès qu\'ils décrochent'}
      className={e.carteDesQue ? 'allume' : ''} onClick={montrerMaCarteDesQue}><IconeSuisCarte /></button>}
    {e.phase === 'en_ligne' && !guide && <button aria-label={e.jeMontre ? 'Arrêter de montrer ma carte' : 'Montrer ma carte aux autres'}
      className={e.jeMontre ? 'allume' : ''} onClick={() => montrerMaCarte(!e.jeMontre)}>
      <IconeSuisCarte /></button>}
    <button aria-label={e.muet ? 'Remettre le micro' : 'Couper le micro'} className={e.muet ? 'muet' : ''} onClick={() => void couperMicro(!e.muet)}>{e.muet ? '🔇' : '🎙'}</button>
    <button className="ap-rouge" aria-label="Raccrocher" onClick={() => void raccrocher()}>✕</button>
  </div>;
}

/** Main au trait, index vers le bas : le bout du doigt est au milieu du bas de l'image. */
const DOIGT = '<svg class="ap-doigt-main" viewBox="0 0 34 52" width="40" height="61" aria-hidden="true" fill="#fff" stroke="#22303d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M9 3 H28 V12 H9 Z"/><path d="M7 14 a3 3 0 0 1 3 -2 H28 a3 3 0 0 1 3 3 V28 a3 3 0 0 1 -3 3 H7 Z"/>'
  + '<path d="M13.5 28 V47 a3.5 3.5 0 0 0 7 0 V28"/><path d="M20.5 31 V35 a2.5 2.5 0 0 0 5 0 V31 M25.5 31 V34 a2.5 2.5 0 0 0 5 0 V30"/>'
  + '<path d="M7 14 V24 Q12 25 16 21"/></svg>';

/** 👉 Les endroits montrés du doigt pendant l'appel, quelques secondes : « Julie montre » et un doigt. */
export function DoigtsSurCarte({ map, onToast }: { map: MlMap | null; onToast: (m: string) => void }) {
  useEffect(() => {
    if (!map) return;
    return suivreDoigts((p) => {
      const el = document.createElement('div');
      el.className = 'ap-doigt';
      // « Sébastien montre » des deux côtés, et un doigt au trait dont le bout touche l'endroit (Seb, 27/11).
      const t = document.createElement('div');
      t.className = 'ap-doigt-nom';
      t.textContent = `${p.qui} montre`;
      el.append(t);
      el.insertAdjacentHTML('beforeend', DOIGT);
      const m = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lon, p.lat]).addTo(map);
      if (!p.moi) { map.easeTo({ center: [p.lon, p.lat], duration: 600 }); onToast(`${p.qui} te montre un endroit`); }
      setTimeout(() => m.remove(), 10_000);
    });
  }, [map, onToast]);
  return null;
}
