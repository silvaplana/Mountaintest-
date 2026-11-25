import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PhotoSwipe from 'photoswipe';
import 'photoswipe/style.css';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';
import { adresse, garder, preparer } from './album';
import { annulerChoix, budChoisit, COMBIEN } from './budPhotos';
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
  // 🐻 Bud choisit les photos du carnet : 'travail' pendant qu'il regarde, puis ce qu'il a changé (pour Annuler).
  const [bud, setBud] = useState<'travail' | { n: number; faits: { id: string; etoile: boolean }[] } | null>(null);
  const nPhotos = photos.filter((p) => !p.video).length;
  const choisir = () => {
    setBud('travail');
    budChoisit(photos).then((r) => { setBud(r); setVue('carnet'); }, (e: Error) => { setBud(null); onToast(e.message); });
  };
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
      <h3 className="bd-section">{j.jour ? <>{j.n >= 1 ? `Jour ${j.n} · ` : ''}{jourLong(j.jour)}<small>{j.photos.length} photo{j.photos.length > 1 ? 's' : ''}</small></>
        : <>Film{j.photos.length > 1 ? 's' : ''}<small>{j.photos.length} film{j.photos.length > 1 ? 's' : ''}</small></>}</h3>
      <div className="bd-grille-photos">{j.photos.map((p) => <Vignette key={p.id} p={p} onClick={() => setOuverte(l.indexOf(p))} onLong={() => setMenu(p)} />)}</div>
    </div>)}
    {!l.length && <p className="bd-vide">{vue === 'carnet' ? 'Touche ⭐ sur une photo pour la garder pour le carnet.' : 'Pas encore de photo : dépose les tiennes, chacun ajoute les siennes.'}</p>}
    {miennes > 0 && <p className="hint">🕓 {miennes} photo{miennes > 1 ? 's' : ''} à toi {miennes > 1 ? 'partiront' : 'partira'} au retour du réseau.</p>}
    <span style={{ flex: 1 }} />
    {bud && bud !== 'travail' && <p className="bd-bud-choix">🐻 Bud a gardé {bud.n} photo{bud.n > 1 ? 's' : ''} pour le carnet. Tu peux en changer avec ⭐.
      <button className="bd-lien" onClick={() => { annulerChoix(bud.faits); setBud(null); }}>Annuler</button></p>}
    {nPhotos > COMBIEN && <button className="bd-grand" disabled={bud === 'travail'} onClick={choisir}>
      {bud === 'travail' ? '🐻 Bud regarde les photos…' : `🐻 Bud choisit les ${COMBIEN} meilleures`}</button>}
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

/** Largeur et hauteur d'une photo, lues une fois sur sa petite image (le plein écran en a besoin pour la cadrer). */
const tailles = new Map<string, { w: number; h: number }>();
async function mesurer(p: PhotoBuddy): Promise<{ w: number; h: number }> {
  const deja = tailles.get(p.id);
  if (deja) return deja;
  const u = await adresse(p.id, 'petite', p.envoyee).catch(() => null);
  const t = await new Promise<{ w: number; h: number }>((ok) => {
    if (!u) { ok({ w: 3, h: 4 }); return; }
    const im = new window.Image();
    im.onload = () => ok({ w: im.naturalWidth || 3, h: im.naturalHeight || 4 });
    im.onerror = () => ok({ w: 3, h: 4 });
    im.src = u;
  });
  if (u) tailles.set(p.id, t);
  return t;
}

const heure = (p: PhotoBuddy) => p.prise_le.slice(11, 16).replace(':', ' h ');

/**
 * Une photo en plein écran, comme dans WhatsApp (Seb, 25/11 : « exactement comme ils font ») : la photo entière, on
 * glisse à gauche ou à droite pour changer, deux doigts ou deux touchers pour zoomer, on la tire vers le bas pour
 * fermer. Les gestes sont ceux de PhotoSwipe (bibliothèque éprouvée) ; nos barres (auteur, Partager, ⭐, Retirer)
 * sont posées dessus, un toucher les cache ou les ramène.
 */
export function Visionneuse({ l, i, onI, onFermer, onPlacer }: { l: PhotoBuddy[]; i: number; onI: (i: number) => void; onFermer: () => void; onPlacer?: (p: PhotoBuddy) => void }) {
  const p = l[i];
  const moi = p.par.id === (lire().moi ?? 'moi');
  const [plein, setPlein] = useState(false);
  const etat = useRef({ l, i, onI, onFermer });
  etat.current = { l, i, onI, onFermer };
  const ids = l.map((x) => x.id).join();
  useEffect(() => {
    let vivant = true, pswp: PhotoSwipe | null = null;
    void Promise.all(etat.current.l.map(mesurer)).then((t) => {
      if (!vivant) return;
      const photos = etat.current.l, enCours = new WeakSet<object>();
      const basculer = () => setPlein((v) => !v);
      pswp = new PhotoSwipe({
        // Hauteur et largeur à l'échelle de la grande image (2560 px au plus) : la photo s'ouvre entière, on zoome jusqu'à ses vrais points.
        dataSource: photos.map((x, k) => (x.video ? { html: `<div class="bd-pswp-film" data-k="${k}"></div>` }
          : { src: `photo:${k}`, width: Math.round((t[k].w / Math.max(t[k].w, t[k].h)) * 2560), height: Math.round((t[k].h / Math.max(t[k].w, t[k].h)) * 2560) })),
        index: Math.min(etat.current.i, photos.length - 1),
        bgOpacity: 1, showHideAnimationType: 'fade', arrowPrev: false, arrowNext: false, zoom: false, close: false, counter: false,
        initialZoomLevel: 'fit', secondaryZoomLevel: 2.5, maxZoomLevel: 6,
        tapAction: basculer, imageClickAction: basculer, bgClickAction: basculer, doubleTapAction: 'zoom', escKey: true,
      });
      const hote = pswp;
      // La grande image est lue sur le téléphone (ou sur le serveur la première fois) au moment où on arrive dessus.
      hote.on('contentLoadImage', (ev) => {
        ev.preventDefault();
        const c = ev.content, im = c.element as HTMLImageElement | undefined, x = photos[c.index];
        if (!im || !x || enCours.has(c)) return;
        enCours.add(c);
        c.state = 'loading';
        void adresse(x.id, 'grande', x.envoyee).then((u) => u ?? adresse(x.id, 'petite', x.envoyee)).then((u) => {
          if (!u) { c.onError(); return; }
          im.onload = () => c.onLoaded();
          im.onerror = () => c.onError();
          im.src = u;
        });
      });
      // 🎥 Un film : son lecteur se pose quand on arrive dessus, et se met en pause quand on le quitte.
      hote.on('contentActivate', ({ content: c }) => {
        const el = c.element?.querySelector<HTMLElement>('.bd-pswp-film'), x = photos[c.index];
        if (!el || !x || el.firstChild) return;
        void adresse(x.id, 'video', x.envoyee).then((u) => {
          if (!u || el.firstChild) { if (!u) el.textContent = '🕓'; return; }
          const v = document.createElement('video');
          v.src = u; v.controls = true; v.playsInline = true;
          el.appendChild(v);
        });
      });
      hote.on('contentDeactivate', ({ content: c }) => c.element?.querySelector('video')?.pause());
      hote.on('change', () => { if (hote.currIndex !== etat.current.i) etat.current.onI(hote.currIndex); });
      hote.on('destroy', () => { if (vivant) etat.current.onFermer(); });
      hote.init();
    });
    return () => { vivant = false; pswp?.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);
  // Les barres sortent de l'écran des buddies pour passer au-dessus de la photo.
  return createPortal(<div className={`bd-vis-barres${plein ? ' plein' : ''}`}>
    <div className="bd-vis-haut">
      <Visage b={p.par} taille={36} />
      <span className="bd-texte"><b>{p.par.pseudo}</b><small>{jourLong(p.prise_le.slice(0, 10))} · {heure(p)}{l.length > 1 ? ` · ${i + 1}/${l.length}` : ''}</small></span>
      <button aria-label="Fermer" onClick={onFermer}>✕</button>
    </div>
    <div className="bd-vis-bas">
      <button aria-label="Partager" className="bd-vis-icone" onClick={() => void partagerPhoto(p)}><ShareIcon /></button>
      <button className={p.etoile ? 'oui' : ''} onClick={() => mettreEtoile(p.id, !p.etoile)}>{p.etoile ? '⭐ Dans le carnet' : '☆ Pour le carnet'}</button>
      {onPlacer && !p.video && <button onClick={() => onPlacer(p)}>📍 Déplacer</button>}
      {moi && <button onClick={() => { retirerPhoto(p.id); onFermer(); }}>Retirer</button>}
    </div>
  </div>, document.body);
}

/** Une photo de la liste : sa petite image tout de suite, la grande quand elle approche de l'écran. */
function PhotoDefile({ p, onClick }: { p: PhotoBuddy; onClick: () => void }) {
  const el = useRef<HTMLButtonElement>(null);
  const [proche, setProche] = useState(false);
  const [t, setT] = useState(tailles.get(p.id) ?? null);
  useEffect(() => { let vivant = true; if (!t) void mesurer(p).then((x) => { if (vivant) setT(x); }); return () => { vivant = false; }; }, [p.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!el.current || typeof IntersectionObserver === 'undefined') { setProche(true); return; }
    const o = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { setProche(true); o.disconnect(); } }, { rootMargin: '800px 0px' });
    o.observe(el.current);
    return () => o.disconnect();
  }, []);
  return <button ref={el} className="bd-defile-photo" style={{ aspectRatio: t ? `${t.w} / ${t.h}` : '3 / 4' }} onClick={onClick}>
    <Image p={p} taille={proche && !p.video ? 'grande' : 'petite'} />
    {p.video && <i className="bd-film">▶</i>}
    <small>{heure(p)}</small>
  </button>;
}

/**
 * Les photos à la suite, en pleine largeur, qu'on fait défiler de bas en haut comme dans WhatsApp (Seb, 25/11) ;
 * une photo touchée s'ouvre en plein écran. `i` : celle sur laquelle la liste s'ouvre.
 */
export function Defile({ titre, l, i, onFermer }: { titre: string; l: PhotoBuddy[]; i: number; onFermer: () => void }) {
  const [ouverte, setOuverte] = useState<number | null>(null);
  const liste = useRef<HTMLDivElement>(null);
  // La liste s'ouvre sur la photo touchée, une fois les hauteurs connues (sinon elle glisserait pendant le chargement).
  useEffect(() => {
    let vivant = true;
    void Promise.all(l.map(mesurer)).then(() => requestAnimationFrame(() => { if (vivant) liste.current?.children[i]?.scrollIntoView({ block: 'start' }); }));
    return () => { vivant = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const nPhotos = l.filter((p) => !p.video).length, nFilms = l.length - nPhotos;
  const jours = [...new Set(l.filter((p) => !p.video).map((p) => p.prise_le.slice(0, 10)))].sort();
  return <div className="bd-defile">
    <div className="bd-defile-haut">
      <button aria-label="Retour" onClick={onFermer}>‹</button>
      <span className="bd-texte"><b>{titre}</b>
        <small>{nPhotos} photo{nPhotos > 1 ? 's' : ''}{nFilms ? ` · ${nFilms} film${nFilms > 1 ? 's' : ''}` : ''}{jours.length ? ` · ${jourLong(jours[0])}` : ''}</small></span>
    </div>
    <div className="bd-defile-liste" ref={liste}>
      {l.map((p, k) => <PhotoDefile key={p.id} p={p} onClick={() => setOuverte(k)} />)}
    </div>
    {ouverte != null && l[ouverte] && <Visionneuse l={l} i={ouverte} onI={setOuverte} onFermer={() => setOuverte(null)} />}
  </div>;
}

/** Sur la carte (écran 7) : chaque photo là où elle a été prise. Un toucher l'ouvre en grand. */
export function PhotosSurCarte({ map, photos }: { map: MlMap | null; photos: PhotoBuddy[] }) {
  const [ouverte, setOuverte] = useState<number | null>(null);
  // 📍 Photos sans position (vieilles photos, position retirée par le téléphone) : on en choisit une, puis on touche la carte.
  const [liste, setListe] = useState(false);
  const [aPlacer, setAPlacer] = useState<PhotoBuddy | null>(null);
  // La photo choisie s'ouvre d'abord en grand, pour voir ce que c'est ; un toucher la réduit, puis on touche la carte.
  const [grande, setGrande] = useState(false);
  const placees = photos.filter((p) => p.lon != null && p.lat != null);
  const sansPlace = photos.filter((p) => !p.video && (p.lon == null || p.lat == null));
  useEffect(() => {
    if (!map || !aPlacer || grande) return;
    const poser = (ev: maplibregl.MapMouseEvent) => { placerPhoto(aPlacer.id, ev.lngLat.lng, ev.lngLat.lat); setAPlacer(null); };
    map.once('click', poser);
    return () => { map.off('click', poser); };
  }, [map, aPlacer, grande]);
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
      <button className="bd-placer-vignette" aria-label="Agrandir la photo" onClick={() => setGrande(true)}><Image p={aPlacer} /></button>
      <b>Touche la carte là où la photo a été prise</b>
      <button onClick={() => setAPlacer(null)}>Annuler</button>
    </div> : sansPlace.length > 0 && <div className="bd-placer">
      {liste ? <><div className="bd-placer-photos">{sansPlace.map((p) => <button key={p.id} aria-label="Placer cette photo" onClick={() => { setAPlacer(p); setGrande(true); }}><Image p={p} /></button>)}</div>
        <button onClick={() => setListe(false)}>Fermer</button></>
        : <button className="bd-placer-ouvrir" onClick={() => setListe(true)}>📍 {sansPlace.length} photo{sansPlace.length > 1 ? 's' : ''} à placer</button>}
    </div>}
    {aPlacer && grande && <button className="bd-placer-grande" aria-label="Réduire la photo" onClick={() => setGrande(false)}>
      <Image p={aPlacer} taille="grande" /><b>Touche la photo pour la réduire, puis la carte pour la placer</b>
    </button>}
    {ouverte != null && placees[ouverte] && <Visionneuse l={placees} i={ouverte} onI={setOuverte} onFermer={() => setOuverte(null)}
      onPlacer={(p) => { setOuverte(null); setAPlacer(p); }} />}
  </>;
}
