import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';
import { adresse, garder, preparer } from './album';
import { aujourdhui, deposerPhotos, lire, mettreEtoile, parJour, retirerPhoto, uuid, type PhotoBuddy, type Sortie } from './store';
import { Visage } from './Buddies';

/**
 * Album d'un Buddy Time (spec/buddies.md §5.8, écrans 7 et 11) : chacun dépose ses photos, rangées par jour avec
 * le visage de l'auteur ; vues Toutes, Sur la carte, ⭐ Carnet. Mêmes écrans côté Kotlin (BuddiesPanel.kt, Album.kt).
 */

const JOURS = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const jourLong = (j: string) => JOURS.format(new Date(`${j}T12:00:00`));

/** Choisir des photos du téléphone, les réduire, les garder et les annoncer (elles partent au retour du réseau). */
export async function deposer(x: Sortie, files: FileList | File[], onToast: (m: string) => void): Promise<string[]> {
  const l: { photo: string; prise_le: string; lon: number | null; lat: number | null }[] = [];
  for (const f of [...files]) {
    if (!f.type.startsWith('image/')) continue;
    try {
      const p = await preparer(f);
      const photo = uuid();
      await garder(photo, 'petite', p.petite); await garder(photo, 'grande', p.grande);
      l.push({ photo, prise_le: p.prise_le, lon: p.lon, lat: p.lat });
    } catch { onToast(`Photo illisible : ${f.name}`); }
  }
  deposerPhotos(x.id, l);
  if (l.length) onToast(navigator.onLine ? `${l.length} photo${l.length > 1 ? 's' : ''} déposée${l.length > 1 ? 's' : ''}` : `${l.length} photo${l.length > 1 ? 's partiront' : ' partira'} au retour du réseau 🕓`);
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

function Vignette({ p, onClick }: { p: PhotoBuddy; onClick: () => void }) {
  return <button className={`bd-vignette${p.attente ? ' attente' : ''}`} onClick={onClick}>
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
      <div className="bd-grille-photos">{j.photos.map((p) => <Vignette key={p.id} p={p} onClick={() => setOuverte(l.indexOf(p))} />)}</div>
    </div>)}
    {!l.length && <p className="bd-vide">{vue === 'carnet' ? 'Touche ⭐ sur une photo pour la garder pour le carnet.' : 'Pas encore de photo : dépose les tiennes, chacun ajoute les siennes.'}</p>}
    {miennes > 0 && <p className="hint">🕓 {miennes} photo{miennes > 1 ? 's' : ''} à toi {miennes > 1 ? 'partiront' : 'partira'} au retour du réseau.</p>}
    <span style={{ flex: 1 }} />
    <BoutonDeposer x={x} onToast={onToast} texte="📷 Déposer mes photos" />
    {ouverte != null && l[ouverte] && <Visionneuse l={l} i={ouverte} onI={setOuverte} onFermer={() => setOuverte(null)} />}
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

/** Une photo en grand : ‹ ›, ⭐ pour le carnet, « Retirer » pour l'auteur. */
function Visionneuse({ l, i, onI, onFermer }: { l: PhotoBuddy[]; i: number; onI: (i: number) => void; onFermer: () => void }) {
  const p = l[i];
  const moi = p.par.id === (lire().moi ?? 'moi');
  return <div className="bd-visionneuse" onClick={onFermer}>
    <div className="bd-vis-haut" onClick={(ev) => ev.stopPropagation()}>
      <Visage b={p.par} taille={36} />
      <span className="bd-texte"><b>{p.par.pseudo}</b><small>{jourLong(p.prise_le.slice(0, 10))} · {p.prise_le.slice(11, 16).replace(':', ' h ')}</small></span>
      <button aria-label="Fermer" onClick={onFermer}>✕</button>
    </div>
    {p.video ? <Film p={p} /> : <Image p={p} taille="grande" className="bd-vis-image" />}
    <div className="bd-vis-bas" onClick={(ev) => ev.stopPropagation()}>
      <button aria-label="Précédente" disabled={i === 0} onClick={() => onI(i - 1)}>‹</button>
      <button className={p.etoile ? 'oui' : ''} onClick={() => mettreEtoile(p.id, !p.etoile)}>{p.etoile ? '⭐ Dans le carnet' : '☆ Pour le carnet'}</button>
      {moi && <button onClick={() => { retirerPhoto(p.id); onFermer(); }}>Retirer</button>}
      <button aria-label="Suivante" disabled={i === l.length - 1} onClick={() => onI(i + 1)}>›</button>
    </div>
  </div>;
}

/** Sur la carte (écran 7) : chaque photo là où elle a été prise. Un toucher l'ouvre en grand. */
export function PhotosSurCarte({ map, photos }: { map: MlMap | null; photos: PhotoBuddy[] }) {
  const [ouverte, setOuverte] = useState<number | null>(null);
  const placees = photos.filter((p) => p.lon != null && p.lat != null);
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
  return ouverte != null && placees[ouverte] ? <Visionneuse l={placees} i={ouverte} onI={setOuverte} onFermer={() => setOuverte(null)} /> : null;
}
