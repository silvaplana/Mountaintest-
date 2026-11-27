import { useEffect, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';
import { Capacitor } from '@capacitor/core';
import { api, connecte } from '../compte/auth';
import { Natif, useBuddies, Visage } from './Buddies';
import {
  appelEnCours, couperMicro, decrocher, duree, enLigne, finSonnerie, montrerMaCarte, raccrocher, reprendreMaCarte, refuser, sonner, suivreAppel, suivreDoigts,
  type EtatAppel, type Sonnerie,
} from './appel';
import { appliquer, vue } from './store';
import { IconeSuisCarte } from './IconeSuisCarte';

/**
 * 📞 Appels (spec/buddies.md §5.7) : l'écran 10 (un buddy m'appelle), la barre d'appel en haut de la carte
 * (écran 24) et 👉 « Julie te montre » sur la carte. Mêmes écrans côté Kotlin (AppelVue.kt).
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
  const [, tic] = useState(0);
  useEffect(() => {
    if (!e || e.phase === 'sonne') return;
    const t = setInterval(() => tic((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [e]);
  if (!e || e.phase === 'sonne' || (e.phase === 'connexion' && e.de)) return null;
  if (e.suit) return <BarreSuivie e={e} />;
  const annonce = e.annonce && e.annonce.jusqua > Date.now() ? e.annonce.texte : '';
  const titre = annonce ? annonce : e.jeMontre ? 'Tu montres ta carte'
    : e.phase === 'en_ligne' ? `En ligne · ${duree(Date.now() - (e.debut ?? Date.now()))}` : e.phase === 'connexion' ? 'Connexion…' : 'Ça sonne…';
  return <div className={`ap-barre${annonce || e.jeMontre ? ' ap-annonce' : ''}`}>
    <span className="ap-icone">📞</span>
    <span className="bd-texte"><b>{titre}</b><small>{e.phase === 'en_ligne' ? enLigne(e) : e.nom}</small>
      {e.phase === 'en_ligne' && !e.jeMontre && <small className="ap-astuce">Appui long sur la carte : tu la montres aux autres 👉</small>}</span>
    {e.phase === 'en_ligne' && <button aria-label={e.jeMontre ? 'Arrêter de montrer ma carte' : 'Montrer ma carte aux autres'}
      className={e.jeMontre ? 'allume' : ''} onClick={() => montrerMaCarte(!e.jeMontre)}>
      <IconeSuisCarte /></button>}
    <button aria-label={e.muet ? 'Remettre le micro' : 'Couper le micro'} className={e.muet ? 'muet' : ''} onClick={() => void couperMicro(!e.muet)}>{e.muet ? '🔇' : '🎙'}</button>
    <button className="ap-rouge" aria-label="Raccrocher" onClick={() => void raccrocher()}>✕</button>
  </div>;
}

/** 🗺 Ma carte suit celle d'un buddy : une seule ligne, son badge, « Carte de Seb », Stop et ✕ (choix A de Seb, 27/11). */
function BarreSuivie({ e }: { e: EtatAppel }) {
  const b = useBuddies();
  const suit = e.suit!;
  const lui = appliquer(b).flatMap((g) => g.membres).find((m) => m.id === suit.id) ?? { id: suit.id, pseudo: suit.pseudo, photo: null };
  return <div className="ap-barre ap-annonce ap-suivie">
    <Visage b={lui} taille={44} />
    <span className="bd-texte"><b>Carte de {suit.pseudo}</b><small>{duree(Date.now() - (e.debut ?? Date.now()))}</small></span>
    <button className="ap-stop" onClick={reprendreMaCarte}>Stop</button>
    <button className="ap-rouge" aria-label="Raccrocher" onClick={() => void raccrocher()}>✕</button>
  </div>;
}

/** 👉 Les endroits montrés du doigt pendant l'appel, quelques secondes : « Julie te montre ». */
export function DoigtsSurCarte({ map, onToast }: { map: MlMap | null; onToast: (m: string) => void }) {
  useEffect(() => {
    if (!map) return;
    return suivreDoigts((p) => {
      const el = document.createElement('div');
      el.className = 'ap-doigt';
      el.textContent = p.qui ? `👉 ${p.qui} te montre` : '👉 Tu montres';
      const m = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lon, p.lat]).addTo(map);
      if (p.qui) { map.easeTo({ center: [p.lon, p.lat], duration: 600 }); onToast(`${p.qui} te montre un endroit`); }
      setTimeout(() => m.remove(), 10_000);
    });
  }, [map, onToast]);
  return null;
}
