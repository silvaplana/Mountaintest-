import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';
import { adresse, garder, preparer } from './album';
import { aujourdhui, deposerPhotos, lire, mettreEtoile, parJour, placerPhoto, retirerPhoto, uuid, type PhotoBuddy, type Sortie } from './store';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Natif, Visage } from './Buddies';

/**
 * Album d'un Buddy Time (spec/buddies.md §5.8, écrans 7 et 11) : chacun dépose ses photos, rangées par jour avec
 * le visage de l'auteur ; vues Toutes, Sur la carte, ⭐ Carnet. Mêmes écrans côté Kotlin (BuddiesPanel.kt, Album.kt).
 */

const JOURS = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const jourLong = (j: string) => JOURS.format(new Date(`${j}T12:00:00`));

/** Choisir des photos du téléphone, les réduire, les garder et les annoncer (elles partent au retour du réseau). */
/** ici : position à donner aux photos qui n'en ont pas (photos qu'on vient de prendre) ; muet : sans bandeau. */
export async function deposer(x: Sortie, files: FileList | File[], onToast: (m: string) => void, ici?: { lon: number; lat: number } | null, muet = false): Promise<string[]> {
  const l: { photo: string; prise_le: string; lon: number | null; lat: number | null }[] = [];
  for (const f of [...files]) {
    if (!f.type.startsWith('image/')) continue;
    try {
      const p = await preparer(f);
      const photo = uuid();
      await garder(photo, 'petite', p.petite); await garder(photo, 'grande', p.grande);
      l.push({ photo, prise_le: p.prise_le, lon: p.lon ?? ici?.lon ?? null, lat: p.lat ?? ici?.lat ?? null });
    } catch { onToast(`Photo illisible : ${f.name}`); }
  }
  deposerPhotos(x.id, l);
  if (l.length && !muet) onToast(navigator.onLine ? `${l.length} photo${l.length > 1 ? 's' : ''} déposée${l.length > 1 ? 's' : ''}` : `${l.length} photo${l.length > 1 ? 's partiront' : ' partira'} au retour du réseau 🕓`);
  return l.map((y) => y.photo);
}

/** Bouton « 📷 … » qui ouvre le choix de photos du téléphone. */
export function BoutonDeposer({ x, onToast, texte, className = 'primary bd-grand' }: { x: Sortie; onToast: (m: string) => void; texte: string; className?: string }) {
  const fichier = useRef<HTMLInputElement>(null);
  const [occupe, setOccupe] = useState(false);
  return <>
    <button className={className} disabled={occupe} onClick={() => fichier.current?.click()}>{occupe ? '🕓 Préparation…' : texte}</button>
    <input ref={fichier} type="file" accept="image/*" multiple hidden onChange={(ev) => {
      const f = ev.target.files; if (!f?.length) return;
      setOccupe(true);
      void deposer(x, f, onToast).finally(() => { setOccupe(false); ev.target.value = ''; });
    }} />
  </>;
}

/** Une photo (petite ou grande) : gardée sur le téléphone, sinon lue sur le serveur ; 🕓 tant qu'elle n'est pas arrivée. */
export function Image({ p, taille = 'petite', className }: { p: PhotoBuddy; taille?: 'petite' | 'grande'; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let vivant = true;
    void adresse(p.id, taille, p.envoyee).then((u) => { if (vivant) setSrc(u); });
    return () => { vivant = false; };
  }, [p.id, p.envoyee, taille]);
  return src ? <img className={className} src={src} alt="" /> : <span className={`${className ?? ''} bd-img-vide`}>🕓</span>;
}

/** Partager, au trait fin (comme les autres icônes de la vue en grand). */
const ShareIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <path d="M8.2 10.9l7.6-4.3M8.2 13.1l7.6 4.3" /><circle cx="18" cy="5.5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="18.5" r="2.5" />
  </svg>
);

/** Partage une photo (ou un film) de l'album avec l'appli choisie : WhatsApp, mail… (Seb, 25/11). */
export async function partagerPhoto(p: PhotoBuddy, onToast?: (m: string) => void) {
  try {
    const u = await adresse(p.id, p.video ? 'video' : 'grande', p.envoyee);
    if (!u) throw new Error('pas encore arrivée');
    const b = await (await fetch(u)).blob(), mime = b.type || (p.video ? 'video/mp4' : 'image/jpeg');
    const nom = `mountain-buddies-${p.prise_le.slice(0, 10)}-${p.id.slice(0, 6)}.${p.video ? (mime.includes('webm') ? 'webm' : 'mp4') : 'jpg'}`;
    if (Capacitor.isNativePlatform()) {
      const data = await new Promise<string>((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1] ?? ''); fr.readAsDataURL(b); });
      await Filesystem.writeFile({ path: `partage/${nom}`, data, directory: Directory.Cache, recursive: true });
      await Natif.partagerFichier({ chemin: `partage/${nom}`, mime, titre: 'Partager' });
    } else {
      const f = new File([b], nom, { type: mime });
      if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f] });
      else { const a = document.createElement('a'); a.href = u; a.download = nom; a.click(); }
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') onToast?.(`Partage impossible : ${(e as Error).message}`);
  }
}

function Vignette({ p, onClick, onLong }: { p: PhotoBuddy; onClick: () => void; onLong?: () => void }) {
  // Appui long : le menu de la photo (partager…) ; le toucher qui suit ne l'ouvre pas en grand.
  const appui = useRef<{ t: number; long: boolean }>({ t: 0, long: false });
  const lacher = () => window.clearTimeout(appui.current.t);
  return <button className={`bd-vignette${p.attente ? ' attente' : ''}`} onClick={() => { if (!appui.current.long) onClick(); }}
    onContextMenu={(ev) => ev.preventDefault()} onPointerUp={lacher} onPointerLeave={lacher} onPointerCancel={lacher}
    onPointerDown={() => { appui.current.long = false; lacher(); if (onLong) appui.current.t = window.setTimeout(() => { appui.current.long = true; onLong(); }, 500); }}>
    <Image p={p} />
    {p.video && <span className="bd-film">▶</span>}
    {p.etoile && <span className="bd-etoile">⭐</span>}
    {p.attente && <span className="bd-montre">🕓</span>}
    <span className="bd-auteur"><Visage b={p.par} taille={24} /></span>
  </button>;
}

/** Les albums : un par Buddy Time (le plus récent en haut). */
export function Albums({ sorties, photos, onOuvrir, onRetour, onClose }: {
  sorties: Sortie[]; photos: PhotoBuddy[]; onOuvrir: (x: Sortie) => void; onRetour: () => void; onClose: () => void;
}) {
  const l = [...sorties].filter((x) => x.debut <= aujourdhui()).sort((a, b) => b.debut.localeCompare(a.debut));
  return <div className="bd-corps">
    <div className="xp-head">
      <button onClick={onRetour} aria-label="Retour">‹</button><h2>Albums</h2>
      <button onClick={onClose} aria-label="Fermer">✕</button>
    </div>
    {l.map((x) => {
      const ph = photos.filter((p) => p.sortie === x.id);
      return <button key={x.id} className="bd-ligne" onClick={() => onOuvrir(x)}>
        {ph[0] ? <span className="bd-album-mini"><Image p={ph[0]} /></span> : <span className="bd-album-mini">📸</span>}
        <span className="bd-texte"><b>{x.nom}</b><small>{ph.length ? `${ph.length} photo${ph.length > 1 ? 's' : ''}` : 'pas encore de photo'}</small></span>
      </button>;
    })}
    {!l.length && <p className="bd-vide">L’album d’un Buddy Time s’ouvre le jour du départ : chacun y dépose ses photos.</p>}
  </div>;
}

/** Un album (écran 11) : Toutes, Sur la carte, ⭐ Carnet ; « Déposer mes photos ». */
export function UnAlbum({ x, photos, carnet = false, onCarte, onRetour, onClose, onToast }: {
  x: Sortie; photos: PhotoBuddy[]; carnet?: boolean; onCarte: () => void; onRetour: () => void; onClose: () => void; onToast: (m: string) => void;
}) {
  const [vue, setVue] = useState<'toutes' | 'carnet'>(carnet ? 'carnet' : 'toutes');
  const [ouverte, setOuverte] = useState<number | null>(null);
  const [menu, setMenu] = useState<PhotoBuddy | null>(null);
  const l = vue === 'carnet' ? photos.filter((p) => p.etoile) : photos;
  const auteurs = new Set(photos.map((p) => p.par.id)).size;
  const miennes = photos.filter((p) => p.attente).length;
  return <div className="bd-corps">
    <div className="xp-head">
      <button onClick={onRetour} aria-label="Retour">‹</button>
      <span className="bd-titre"><b>{x.nom}</b><small>📸 {photos.length} photo{photos.length > 1 ? 's' : ''}{auteurs ? ` · ${auteurs} ${auteurs > 1 ? 'buddies' : 'buddy'}` : ''}</small></span>
      <button onClick={onClose} aria-label="Fermer">✕</button>
    </div>
    <div className="bd-segment">
      <button className={vue === 'toutes' ? 'oui' : ''} onClick={() => setVue('toutes')}>Toutes</button>
      <button onClick={onCarte}>Sur la carte</button>
      <button className={vue === 'carnet' ? 'oui' : ''} onClick={() => setVue('carnet')}>⭐ Carnet</button>
    </div>
    {parJour(l, x).map((j) => <div key={j.jour} className="bd-jour-album">
      <h3 className="bd-section">{j.n >= 1 ? `Jour ${j.n} · ` : ''}{jourLong(j.jour)}<small>{j.photos.length} photo{j.photos.length > 1 ? 's' : ''}</small></h3>
      <div className="bd-grille-photos">{j.photos.map((p) => <Vignette key={p.id} p={p} onClick={() => setOuverte(l.indexOf(p))} onLong={() => setMenu(p)} />)}</div>
    </div>)}
    {!l.length && <p className="bd-vide">{vue === 'carnet' ? 'Touche ⭐ sur une photo pour la garder pour le carnet.' : 'Pas encore de photo : dépose les tiennes, chacun ajoute les siennes.'}</p>}
    {miennes > 0 && <p className="hint">🕓 {miennes} photo{miennes > 1 ? 's' : ''} à toi {miennes > 1 ? 'partiront' : 'partira'} au retour du réseau.</p>}
    <span style={{ flex: 1 }} />
    <BoutonDeposer x={x} onToast={onToast} texte="📷 Déposer mes photos" />
    {ouverte != null && l[ouverte] && <Visionneuse l={l} i={ouverte} onI={setOuverte} onFermer={() => setOuverte(null)} />}
    {menu && <div className="bd-recues-fond" onClick={() => setMenu(null)}>
      <div className="bd-recues" onClick={(ev) => ev.stopPropagation()}>
        <button onClick={() => { void partagerPhoto(menu, onToast); setMenu(null); }}>Partager</button>
        <button onClick={() => { mettreEtoile(menu.id, !menu.etoile); setMenu(null); }}>{menu.etoile ? 'Retirer du carnet' : '⭐ Garder pour le carnet'}</button>
        {menu.par.id === (lire().moi ?? 'moi') && <button onClick={() => { retirerPhoto(menu.id); setMenu(null); }}>Retirer de l'album</button>}
        <button onClick={() => setMenu(null)}>Annuler</button>
      </div>
    </div>}
  </div>;
}

/** 🎥 Film d'un survol 3D : lu sur le serveur la première fois, puis gardé sur le téléphone. */
function Film({ p }: { p: PhotoBuddy }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let vivant = true;
    void adresse(p.id, 'video', p.envoyee).then((u) => { if (vivant) setSrc(u); });
    return () => { vivant = false; };
  }, [p.id, p.envoyee]);
  return src ? <video className="bd-vis-image" src={src} controls playsInline onClick={(ev) => ev.stopPropagation()} />
    : <span className="bd-vis-image bd-img-vide">🕓</span>;
}

/**
 * Photo qu'on agrandit avec deux doigts et qu'on déplace quand elle est agrandie ; deux touchers rapides : ×2,5 ou
 * retour à l'écran. Un toucher simple appelle onToucher (plein écran).
 */
export function Zoom({ children, onToucher, onGlisser }: { children: React.ReactNode; onToucher?: () => void; onGlisser?: (sens: 1 | -1) => void }) {
  const [v, setV] = useState({ k: 1, x: 0, y: 0 });
  const doigts = useRef(new Map<number, { x: number; y: number }>());
  const geste = useRef({ d: 0, k: 1, bouge: false, dernier: 0, x0: 0, deux: false });
  const borner = (k: number, x: number, y: number, el: HTMLElement) => {
    const mx = (el.clientWidth * (k - 1)) / 2, my = (el.clientHeight * (k - 1)) / 2;
    return { k, x: Math.max(-mx, Math.min(mx, x)), y: Math.max(-my, Math.min(my, y)) };
  };
  return <div className="bd-zoom"
    onPointerDown={(ev) => { ev.currentTarget.setPointerCapture(ev.pointerId); doigts.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY }); geste.current.bouge = doigts.current.size > 1; geste.current.d = 0;
      if (doigts.current.size === 1) { geste.current.x0 = ev.clientX; geste.current.deux = false; } else geste.current.deux = true; }}
    onPointerMove={(ev) => {
      const a = doigts.current.get(ev.pointerId); if (!a) return;
      const dx = ev.clientX - a.x, dy = ev.clientY - a.y, el = ev.currentTarget;
      doigts.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (Math.abs(dx) + Math.abs(dy) > 3) geste.current.bouge = true;
      const l = [...doigts.current.values()];
      if (l.length === 2) {
        const d = Math.hypot(l[0].x - l[1].x, l[0].y - l[1].y);
        if (geste.current.d) setV((o) => borner(Math.max(1, Math.min(6, (o.k * d) / geste.current.d)), o.x, o.y, el));
        geste.current.d = d;
      } else if (l.length === 1) setV((o) => (o.k > 1 ? borner(o.k, o.x + dx, o.y + dy, el) : o));
    }}
    onPointerUp={(ev) => {
      doigts.current.delete(ev.pointerId); geste.current.d = 0;
      if (doigts.current.size) return;
      // Photo à sa taille : glisser d'un doigt vers la gauche ou la droite passe à la suivante ou à la précédente.
      const dx = ev.clientX - geste.current.x0;
      if (geste.current.bouge) { if (v.k === 1 && !geste.current.deux && Math.abs(dx) > 60) onGlisser?.(dx < 0 ? 1 : -1); return; }
      const t = Date.now(), el = ev.currentTarget;
      if (t - geste.current.dernier < 300) { geste.current.dernier = 0; setV((o) => (o.k > 1 ? { k: 1, x: 0, y: 0 } : borner(2.5, 0, 0, el))); }
      else { geste.current.dernier = t; onToucher?.(); }
    }}
    onPointerCancel={(ev) => { doigts.current.delete(ev.pointerId); geste.current.d = 0; }}>
    <div style={{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.k})` }}>{children}</div>
  </div>;
}

/** Une photo en grand : ‹ ›, ⭐ pour le carnet, « Retirer » pour l'auteur. */
export function Visionneuse({ l, i, onI, onFermer, onPlacer }: { l: PhotoBuddy[]; i: number; onI: (i: number) => void; onFermer: () => void; onPlacer?: (p: PhotoBuddy) => void }) {
  const p = l[i];
  const moi = p.par.id === (lire().moi ?? 'moi');
  // La photo prend tout l'écran, les barres sont posées dessus : un toucher les cache ou les ramène ; deux doigts pour
  // zoomer ; glisser pour la suivante (Seb, 25/11 : « chaque fois la photo doit être à son mieux »).
  const [plein, setPlein] = useState(false);
  return <div className={`bd-visionneuse${plein ? ' plein' : ''}`}>
    <div className="bd-vis-haut" onClick={(ev) => ev.stopPropagation()}>
      <Visage b={p.par} taille={36} />
      <span className="bd-texte"><b>{p.par.pseudo}</b><small>{jourLong(p.prise_le.slice(0, 10))} · {p.prise_le.slice(11, 16).replace(':', ' h ')}</small></span>
      <button aria-label="Fermer" onClick={onFermer}>✕</button>
    </div>
    {i > 0 && <button className="bd-vis-fleche" aria-label="Précédente" onClick={() => onI(i - 1)}>‹</button>}
    {i < l.length - 1 && <button className="bd-vis-fleche droite" aria-label="Suivante" onClick={() => onI(i + 1)}>›</button>}
    {p.video ? <Film p={p} /> : <Zoom key={p.id} onToucher={() => setPlein((v) => !v)} onGlisser={(d) => { if (i + d >= 0 && i + d < l.length) onI(i + d); }}><Image p={p} taille="grande" className="bd-vis-image" /></Zoom>}
    <div className="bd-vis-bas" onClick={(ev) => ev.stopPropagation()}>
      <button aria-label="Partager" className="bd-vis-icone" onClick={() => void partagerPhoto(p)}><ShareIcon /></button>
      <button className={p.etoile ? 'oui' : ''} onClick={() => mettreEtoile(p.id, !p.etoile)}>{p.etoile ? '⭐ Dans le carnet' : '☆ Pour le carnet'}</button>
      {onPlacer && !p.video && <button onClick={() => onPlacer(p)}>📍 Déplacer</button>}
      {moi && <button onClick={() => { retirerPhoto(p.id); onFermer(); }}>Retirer</button>}
    </div>
  </div>;
}

/** Sur la carte (écran 7) : chaque photo là où elle a été prise. Un toucher l'ouvre en grand. */
export function PhotosSurCarte({ map, photos }: { map: MlMap | null; photos: PhotoBuddy[] }) {
  const [ouverte, setOuverte] = useState<number | null>(null);
  // 📍 Photos sans position (vieilles photos, position retirée par le téléphone) : on en choisit une, puis on touche la carte.
  const [liste, setListe] = useState(false);
  const [aPlacer, setAPlacer] = useState<PhotoBuddy | null>(null);
  const placees = photos.filter((p) => p.lon != null && p.lat != null);
  const sansPlace = photos.filter((p) => !p.video && (p.lon == null || p.lat == null));
  useEffect(() => {
    if (!map || !aPlacer) return;
    const poser = (ev: maplibregl.MapMouseEvent) => { placerPhoto(aPlacer.id, ev.lngLat.lng, ev.lngLat.lat); setAPlacer(null); };
    map.once('click', poser);
    return () => { map.off('click', poser); };
  }, [map, aPlacer]);
  const cle = placees.map((p) => `${p.id}${p.envoyee}`).join();
  useEffect(() => {
    if (!map || !placees.length) return;
    const ms = placees.map((p, i) => {
      const el = document.createElement('button');
      el.className = 'bd-photo-carte';
      el.onclick = () => setOuverte(i);
      void adresse(p.id, 'petite', p.envoyee).then((u) => { if (u) el.style.backgroundImage = `url("${u}")`; else el.textContent = '🕓'; });
      return new maplibregl.Marker({ element: el }).setLngLat([p.lon!, p.lat!]).addTo(map);
    });
    return () => ms.forEach((m) => m.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, cle]);
  return <>
    {aPlacer ? <div className="bd-placer">
      <Image p={aPlacer} /><b>Touche la carte là où la photo a été prise</b>
      <button onClick={() => setAPlacer(null)}>Annuler</button>
    </div> : sansPlace.length > 0 && <div className="bd-placer">
      {liste ? <><div className="bd-placer-photos">{sansPlace.map((p) => <button key={p.id} aria-label="Placer cette photo" onClick={() => setAPlacer(p)}><Image p={p} /></button>)}</div>
        <button onClick={() => setListe(false)}>Fermer</button></>
        : <button className="bd-placer-ouvrir" onClick={() => setListe(true)}>📍 {sansPlace.length} photo{sansPlace.length > 1 ? 's' : ''} à placer</button>}
    </div>}
    {ouverte != null && placees[ouverte] && <Visionneuse l={placees} i={ouverte} onI={setOuverte} onFermer={() => setOuverte(null)}
      onPlacer={(p) => { setOuverte(null); setAPlacer(p); }} />}
  </>;
}
