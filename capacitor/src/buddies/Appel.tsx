import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';
import { Capacitor } from '@capacitor/core';
import { api, connecte } from '../compte/auth';
import { Natif, useBuddies, Visage, type PropositionCarte } from './Buddies';
import {
  ATTENTE_MS, appelEnCours, couperMicro, decrocher, duree, enLigne, finSonnerie, raccrocher, reprendreMaCarte, refuser, sonner, suivreAppel, suivreDoigts, effacerDoigt,
  montrer, suivreUneCarte, type Doigt, type EtatAppel, type Sonnerie } from './appel';
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
  // Je montre ma carte : c'est l'icône sous la loupe qui est verte (Seb, 27/11), rien d'autre à l'écran.
  if (e.muette && e.jeMontre) return null;
  if (e.muette) {
    const g = e.suit ? appliquer(b).flatMap((x) => x.membres).find((m) => m.id === e.suit!.id) ?? { id: e.suit.id, pseudo: e.suit.pseudo, photo: null } : null;
    return <div className="ap-pastille">
      {g ? <button className="ap-guide" aria-label={`Arrêter de suivre la carte de ${g.pseudo}`} onClick={reprendreMaCarte}>
        <Visage b={g} taille={44} /><span className="ap-guide-carte"><IconeSuisCarte /></span></button>
        : <button className="attente" aria-label="Ne plus attendre la carte" onClick={() => void raccrocher()}><IconeSuisCarte /></button>}
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
      {e.phase === 'en_ligne' && !e.jeMontre && !suit && <small className="ap-astuce">Appui long sur la carte : tu montres un endroit</small>}</span>
    {e.phase === 'en_ligne' && guide && <button className="ap-guide" aria-label={`Arrêter de suivre la carte de ${guide.pseudo}`} onClick={reprendreMaCarte}>
      <Visage b={guide} taille={44} /><span className="ap-guide-carte"><IconeSuisCarte /></span></button>}
    <button aria-label={e.muet ? 'Remettre le micro' : 'Couper le micro'} className={e.muet ? 'muet' : ''} onClick={() => void couperMicro(!e.muet)}>{e.muet ? '🔇' : '🎙'}</button>
    <button className="ap-rouge" aria-label="Raccrocher" onClick={() => void raccrocher()}>✕</button>
  </div>;
}

/**
 * 🗺 « Sébastien partage sa carte » (Seb, 27/11) : la seule proposition, une fenêtre dans l'appli par-dessus l'écran en
 * cours, sans rien fermer (appli fermée : la notification ouvre l'appli sur cette fenêtre). Suivre fait exactement ce
 * que faisait le Suivre de la messagerie : la carte suivie s'affiche. Pendant un appel : Rejoindre entre dans l'appel.
 */
export function PropositionCarteAppli({ onToast }: { onToast: (m: string) => void }) {
  const [p, setP] = useState<PropositionCarte | null>(null);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let h: { remove: () => Promise<void> } | null = null, fini = false;
    void Natif.carteEnAttente().then((r) => { if (!fini && r.carte) setP(r.carte); }).catch(() => undefined);
    void Natif.addListener('carte', (x) => setP(x)).then((r) => { if (fini) void r.remove(); else h = r; }).catch(() => undefined);
    return () => { fini = true; void h?.remove(); };
  }, []);
  const appel = p?.type === 'carte_appel';
  // Comme avant : 4 h pour une carte partagée, 10 min pendant un appel.
  useEffect(() => { if (!p) return; const t = setTimeout(() => setP(null), appel ? 600_000 : 4 * 3_600_000); return () => clearTimeout(t); }, [p, appel]);
  if (!p) return null;
  const dest = { groupe: p.groupe || undefined, sortie: p.sortie || undefined };
  const oui = () => {
    setP(null);
    if (appel) {
      sonner({ appel: p.appel ?? '', de: p.de ?? '', nom: p.nom ?? '', ...dest });
      void decrocher().catch((e: Error) => onToast(e.message));
    } else void suivreUneCarte(p.message ?? '', dest, p.de ?? '').catch((e: Error) => onToast(e.message || 'Impossible de suivre sa carte'));
  };
  return <div className="ap-propose-voile">
    <div className="ap-propose" role="dialog" aria-label="Carte partagée">
      <span className="ap-propose-icone"><IconeSuisCarte /></span>
      <div className="ap-propose-texte"><b>{p.de} montre sa carte</b>
        <div>{appel ? `pendant l'appel · ${p.titre ?? ''}` : p.titre}</div></div>
      <div className="ap-propose-boutons">
        <button className="ap-propose-non" onClick={() => setP(null)}>Non merci</button>
        <button className="ap-propose-oui" onClick={oui}>{appel ? 'Rejoindre' : 'Suivre'}</button>
      </div>
    </div>
  </div>;
}

/** Petite main au trait, index vers le bas, devant « Sébastien montre ». */
const MAIN = '<svg viewBox="0 0 34 52" width="14" height="21" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M7 14 a3 3 0 0 1 3 -2 H28 a3 3 0 0 1 3 3 V28 a3 3 0 0 1 -3 3 H7 Z"/><path d="M13.5 31 V47 a3.5 3.5 0 0 0 7 0 V31"/></svg>';
/** Épingle fine : la pointe, au milieu du bas de l'image, est l'endroit exact. */
const epingle = (c: string) => `<svg class="ap-doigt-epingle" viewBox="0 0 20 46" width="20" height="46" aria-hidden="true">`
  + `<path d="M10 15 V45" stroke="#22303d" stroke-width="2.5" stroke-linecap="round"/>`
  + `<circle cx="10" cy="9" r="7" fill="${c}" stroke="#fff" stroke-width="2"/></svg>`;
/** Une couleur par buddy, toujours la même. */
const COULEURS = ['#c2410c', '#1d4ed8', '#047857', '#7c3aed', '#be123c', '#0e7490'];
const couleurDe = (id: string) => COULEURS[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COULEURS.length];

/**
 * 📍 Les repères montrés du doigt (spec/buddies.md §7.10) : un par buddy, de sa couleur, « Sébastien montre ».
 * Le mien : appui long puis glisser = le déplacer (les autres le voient bouger) ; appui bref = ✕ pour l'enlever.
 */
export function DoigtsSurCarte({ map, onToast }: { map: MlMap | null; onToast: (m: string) => void }) {
  useEffect(() => {
    if (!map) return;
    const reperes = new Map<string, maplibregl.Marker>();
    const enlever = (id: string) => { reperes.get(id)?.remove(); reperes.delete(id); };
    const creer = (d: Doigt) => {
      const el = document.createElement('div');
      el.className = `ap-doigt${d.moi ? ' ap-doigt-moi' : ''}`;
      const c = couleurDe(d.id);
      const t = document.createElement('div');
      t.className = 'ap-doigt-nom';
      t.style.background = c;
      t.innerHTML = MAIN;
      t.append(` ${d.qui} montre`);
      el.append(t);
      el.insertAdjacentHTML('beforeend', epingle(c));
      const m = new maplibregl.Marker({ element: el, anchor: 'bottom' });
      if (d.moi) mesGestes(el, m);
      return m;
    };
    const mesGestes = (el: HTMLElement, m: maplibregl.Marker) => {
      const croix = document.createElement('button');
      croix.className = 'ap-doigt-croix';
      croix.setAttribute('aria-label', 'Enlever mon repère');
      croix.textContent = '✕';
      croix.addEventListener('click', (ev) => { ev.stopPropagation(); effacerDoigt(); });
      el.prepend(croix);
      // La carte ne bouge pas sous le repère : c'est lui qu'on touche.
      for (const n of ['mousedown', 'touchstart', 'click', 'dblclick'] as const) el.addEventListener(n, (ev) => ev.stopPropagation());
      let a: { x0: number; y0: number; dx: number; dy: number; actif: boolean; bouge: boolean; minuteur: ReturnType<typeof setTimeout>; t: number } | null = null;
      el.addEventListener('pointerdown', (ev) => {
        if (ev.target instanceof Element && ev.target.closest('.ap-doigt-croix')) return;
        ev.stopPropagation();
        const r = map.getContainer().getBoundingClientRect(), pointe = map.project(m.getLngLat());
        const x = { x0: ev.clientX, y0: ev.clientY, dx: pointe.x - (ev.clientX - r.left), dy: pointe.y - (ev.clientY - r.top), actif: false, bouge: false, t: 0,
          minuteur: setTimeout(() => { x.actif = true; el.classList.add('glisse'); navigator.vibrate?.(30); }, 400) };
        a = x;
        el.setPointerCapture(ev.pointerId);
      });
      el.addEventListener('pointermove', (ev) => {
        if (!a) return;
        if (!a.actif) {
          if (Math.hypot(ev.clientX - a.x0, ev.clientY - a.y0) > 8) { a.bouge = true; clearTimeout(a.minuteur); }
          return;
        }
        const r = map.getContainer().getBoundingClientRect();
        const p = map.unproject([ev.clientX - r.left + a.dx, ev.clientY - r.top + a.dy]);
        m.setLngLat(p);
        const n = Date.now();
        if (n - a.t > 120) { a.t = n; montrer(p.lng, p.lat, false); }
      });
      const fin = () => {
        if (!a) return;
        clearTimeout(a.minuteur);
        if (a.actif) { const p = m.getLngLat(); montrer(p.lng, p.lat, true); el.classList.remove('glisse'); }
        else if (!a.bouge) el.classList.toggle('croix');
        a = null;
      };
      el.addEventListener('pointerup', fin);
      el.addEventListener('pointercancel', fin);
    };
    const stop = suivreDoigts((d) => {
      if (d.id === '*') { [...reperes.keys()].forEach(enlever); return; }
      if (!d.pos) { enlever(d.id); return; }
      const nouveau = !reperes.has(d.id);
      const m = reperes.get(d.id) ?? creer(d);
      reperes.set(d.id, m);
      m.setLngLat(d.pos);
      if (nouveau) m.addTo(map);
      if (!d.moi && (nouveau || !map.getBounds().contains(d.pos))) {
        map.easeTo({ center: d.pos, duration: 600 });
        if (nouveau) onToast(`${d.qui} te montre un endroit`);
      }
    });
    return () => { stop(); [...reperes.keys()].forEach(enlever); };
  }, [map, onToast]);
  return null;
}
