import { LngLat, type GeoJSONSource, type Map as MlMap } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { Bbox } from './config';
import { Natif } from './buddies/Buddies';
import { garder, heureLocale, PX, reduire } from './buddies/album';
import { aujourdhui, deposerPhotos, uuid, type Sortie } from './buddies/store';
import { cameraA, debutTrace, heuresOmbres, heureTexte, IMAGES, partPlongee, PITCH_GOPRO, trajectoire, ZOOM_CIEL, type Cam, type Descente, type Hauteur, type Relief, type Style } from './survol/camera';
import { chargerRelief } from './survol/relief';
import { dessinerNuages } from './survol/nuages';
import { cadrage, enregistrer, extension, toileFilm, type Incrustation } from './survol/enregistreur';
import { codecVideo, creerFilm, IPS, preparerSon } from './survol/encodeur';
import { preparerOmbres, type OmbresSurvol } from './survol/ombres';
import type { Trail } from './trails/osmTrails';
import { useSheet } from './useSheet';

/** Réglages du film, gardés d'une fois sur l'autre. */
/** rapide : ⚡ les images n'attendent pas leurs cartes (tournage ≈ durée du film) ; sinon ✨ soigné, chaque image attend.
 *  dessine : ✏ la trace se construit derrière la caméra (comme au Tour de France). */
interface Reglages { duree: number; hauteur: Hauteur; vertical: boolean; trace: boolean; infos: boolean; ombres: boolean; h0: number; h1: number; plongee: boolean; rapide: boolean; dessine: boolean;
  /** 🎬 style de prise de vue, descente du style alpiniste, ◭ pentes dans le film (la carte ne change pas). */
  style: Style; descente: Descente; pentes: boolean }
const CLE = 'survol';
const DEFAUT: Reglages = { duree: 15, hauteur: 'moyen', vertical: true, trace: true, infos: true, ombres: false, h0: 8, h1: 12, plongee: false, rapide: true, dessine: false, style: 'cine', descente: 'gopro', pentes: false };
function lire(): Reglages {
  try { return { ...DEFAUT, ...JSON.parse(localStorage.getItem(CLE) ?? '{}') }; } catch { return DEFAUT; }
}
const DUREES = [5, 10, 15, 30];
const NOMS: Record<Hauteur, string> = { bas: 'Bas', moyen: 'Moyen', haut: 'Haut' };
/** Styles de prise de vue (maquette validée le 25/11) : icône, nom, une phrase. */
const STYLES: Record<Style, { i: string; nom: string; dit: string }> = {
  suivi: { i: '🎥', nom: 'Suivi', dit: 'Derrière toi, la trace droit devant.' },
  cote: { i: '🎞', nom: 'De côté', dit: 'Travelling de côté : le relief de profil, la trace passe devant.' },
  alpi: { i: '🧗', nom: 'Alpiniste', dit: 'On monte, pause panoramique au sommet, puis on redescend vite.' },
  cine: { i: '🎬', nom: 'Ciné', dit: 'Monté tout seul : bas dans les vallées, haut aux crêtes, arrêts sur les beaux points de vue, grand recul à la fin.' },
};
/** Couches de la trace cachées quand « trace » n'est pas coché. */
const COUCHES_TRACE = ['trails', 'trail-sel-casing', 'trail-sel', 'way-types-casing', 'way-types', 'way-gr'];

type Etape = 'reglages' | 'preparation' | 'tournage' | 'pret';

/**
 * 🎥 Survol 3D d'une trace (maquette validée par Seb le 25/11, maquettes/survol-3d/) : réglages en pastilles,
 * ⏺ prépare les cartes puis tourne le film (la carte en 3D le long de la trace, caméra lissée), puis
 * ▶ revoir, partager, refaire ou jeter. Ce qu'on voit sur la carte (fond, pentes) est ce qui est filmé.
 */
export function Survol({ map, trail, sortie, sorties, onClose, onToast }: {
  map: MlMap; trail: Trail; onClose: () => void; onToast: (t: string) => void;
  /** 📸 Buddy Time ouvert sur la carte : le film va dans son album ; sinon on choisit parmi mes Buddy Times. */
  sortie: Sortie | null; sorties: Sortie[];
}) {
  const [r, setR] = useState<Reglages>(lire);
  // Poignée commune des panneaux ; le survol s'ouvre en grand pour que tous ses boutons se voient.
  const sheet = useSheet('survol', { defaut: 2 });
  const [ouvert, setOuvert] = useState<'duree' | 'hauteur' | 'plage' | 'style' | null>(null);
  const [etape, setEtape] = useState<Etape>('reglages');
  const [avance, setAvance] = useState('');
  const [film, setFilm] = useState<{ blob: Blob; url: string; couverture: ImageBitmap | null } | null>(null);
  const [choixAlbum, setChoixAlbum] = useState(false);
  const [range, setRange] = useState<string | null>(null);
  const [joue, setJoue] = useState(false);
  const panneau = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const arret = useRef<AbortController | null>(null);
  /** Nuages de l'intro plongée, aussi montrés à l'écran pendant le tournage. */
  const voile = useRef<HTMLCanvasElement>(null);
  /** 🎵 Morceau choisi sur le téléphone (pas gardé : on le rechoisit à chaque survol). */
  const [musique, setMusique] = useState<File | null>(null);
  const choixMusique = useRef<HTMLInputElement>(null);
  const [basPanneau, setBasPanneau] = useState(300);

  useEffect(() => { try { localStorage.setItem(CLE, JSON.stringify(r)); } catch { /* ignoré */ } }, [r]);
  useEffect(() => { if (panneau.current) setBasPanneau(panneau.current.offsetHeight); });
  const maj = (p: Partial<Reglages>) => setR((x) => ({ ...x, ...p }));

  // Vue de départ gardée : on y revient en quittant le survol.
  const vueAvant = useRef({ center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() });
  useEffect(() => () => {
    arret.current?.abort();
    for (const l of COUCHES_TRACE) if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', 'visible');
    retirerTraceQuiAvance(map);
    map.jumpTo(vueAvant.current);
  }, [map]);
  useEffect(() => () => { if (film) URL.revokeObjectURL(film.url); }, [film]);

  const line = trail.segments.flat();
  const zone: Bbox = [Math.min(...line.map((p) => p.lon)), Math.min(...line.map((p) => p.lat)), Math.max(...line.map((p) => p.lon)), Math.max(...line.map((p) => p.lat))];

  // Avant le tournage : la trace vue d'ensemble, inclinée.
  useEffect(() => {
    if (etape !== 'reglages') return;
    const c = map.cameraForBounds([[zone[0], zone[1]], [zone[2], zone[3]]], { padding: { top: 60, bottom: basPanneau + 30, left: 40, right: 70 }, pitch: 45 });
    if (c) map.easeTo({ ...c, pitch: 45, bearing: 0, duration: 800 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etape, map]);

  async function tourner() {
    setOuvert(null);
    const ctl = new AbortController();
    arret.current = ctl;
    setEtape('preparation');
    const ens = map.cameraForBounds([[zone[0], zone[1]], [zone[2], zone[3]]], { padding: 50, pitch: 45 });
    const centre = ens?.center ? LngLat.convert(ens.center) : map.getCenter();
    const c0 = { lon: centre.lng, lat: centre.lat };
    // 🧗 et 🎬 ont besoin du relief (sommets, crêtes, points de vue) ; sans lui, le film fait un suivi.
    let relief: Relief | null = null;
    if (r.style === 'alpi' || r.style === 'cine') {
      setAvance('Lecture du relief…');
      relief = await chargerRelief(zone, ctl.signal).catch(() => null);
      if (ctl.signal.aborted) { setEtape('reglages'); return; }
      if (!relief) onToast('Relief indisponible ici : film en suivi');
    }
    const track = trajectoire(line, r.hauteur, { center: c0, zoom: ens?.zoom ?? 13 }, IMAGES, r.plongee ? partPlongee(r.duree) : false, { style: r.style, descente: r.descente, relief });
    const pentesAvant = map.getLayer('slopes') ? map.getLayoutProperty('slopes', 'visibility') : undefined;
    if (pentesAvant !== undefined) map.setLayoutProperty('slopes', 'visibility', r.pentes ? 'visible' : 'none');
    const pitchAvant = map.getMaxPitch();
    if (pitchAvant < PITCH_GOPRO + 2) map.setMaxPitch(PITCH_GOPRO + 2);
    const dessine = r.trace && r.dessine;
    for (const l of COUCHES_TRACE) if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', r.trace && !dessine ? 'visible' : 'none');
    const progression = dessine ? traceQuiAvance(map, trail.color) : null;
    const heures = heuresOmbres(r.h0, r.h1);
    let ombres: OmbresSurvol | null = null;
    try {
      if (r.ombres) {
        setAvance('Calcul des ombres…');
        ombres = await preparerOmbres(map, zone, HAUTEUR_ZOOM[r.hauteur], heures, ctl.signal, (f, t) => setAvance(`Ombres : ${f + 1}/${t}`), !r.rapide);
        if (!ombres && !ctl.signal.aborted) onToast('Relief indisponible ici : film sans les ombres');
      }
      const dessin = { heure: r.ombres && ombres ? heureTexte(heures[0]) : undefined, infos: '', nuages: r.plongee ? 0 : undefined } as Incrustation;
      const texte = () => ({ heure: dessin.heure, infos: r.infos ? dessin.infos : undefined, nuages: dessin.nuages, titre: dessin.titre });
      const ciel = voile.current?.getContext('2d') ?? null;
      if (voile.current) { voile.current.width = voile.current.offsetWidth; voile.current.height = voile.current.offsetHeight; }
      /** Place la caméra au temps t (0 → 1) du film, avec l'heure des ombres, les km · altitude et les nuages. */
      const placer = (t: number) => {
        const cam = cameraA(track, t);
        poser(map, cam);
        if (ombres) {
          const i = Math.round(t * (heures.length - 1));
          ombres.montrer(i);
          dessin.heure = heureTexte(heures[i]);
          // Plongée : les ombres apparaissent en descendant (vues du ciel, on verrait leur bord).
          if (r.plongee) ombres.opacite(Math.max(0, Math.min(1, (cam.zoom - ZOOM_CIEL - 1) / 2.5)));
        }
        dessin.titre = cam.sommet != null ? `▲ Sommet · ${Math.round(cam.sommet)} m` : undefined;
        if (progression) { const pts = debutTrace(line, cam.d); progression(pts, pts.at(-1) ?? null); }
        if (r.infos) {
          const alt = map.queryTerrainElevation([cam.point.lon, cam.point.lat]);
          dessin.infos = `${(cam.d / 1000).toFixed(1).replace('.', ',')} km${alt != null ? ` · ${Math.round(alt)} m` : ''}`;
        }
        if (dessin.nuages != null) {
          dessin.nuages = t / partPlongee(r.duree);
          if (ciel && voile.current) { ciel.clearRect(0, 0, voile.current.width, voile.current.height); dessinerNuages(ciel, voile.current.width, voile.current.height, dessin.nuages); }
        }
        setAvance(`${Math.round(t * 100)} %`);
      };
      // Les cartes du trajet sont chargées d'abord (16 points du film) : moins de tuiles floues.
      const precharger = async () => {
        const N = 16;
        for (let k = 0; k <= N && !ctl.signal.aborted; k++) {
          setAvance(`Préparation des cartes : ${k}/${N}`);
          poser(map, cameraA(track, k / N));
          await attendreCarte(map, 1500);
        }
      };
      const cadre = cadrage(map.getCanvas().width, map.getCanvas().height, r.vertical);
      const codec = await codecVideo(cadre.ow, cadre.oh);
      let blob: Blob, couverture: Promise<ImageBitmap> | null = null;
      if (codec) {
        // Image par image : chaque image attend ses cartes, puis est encodée à sa place exacte dans le film.
        const son = musique ? await preparerSon(musique, r.duree).catch(() => null) : null;
        if (musique && !son) onToast('Morceau illisible : film sans musique');
        const enc = await creerFilm(cadre.ow, cadre.oh, codec, son);
        if (enc.sansSon) onToast('Ce téléphone ne sait pas ajouter la musique : film sans musique');
        if (r.rapide) await precharger();
        if (ctl.signal.aborted) throw new Error('arrêté');
        const fondus = sansFondu(map);
        const toile = toileFilm(map, r.vertical, texte);
        setEtape('tournage');
        try {
          const N = Math.round(r.duree * IPS);
          placer(0);
          await attendreCarte(map, 5000);
          let attente = 2000;
          for (let k = 0; k < N; k++) {
            if (ctl.signal.aborted) throw new Error('arrêté');
            placer(k / (N - 1));
            map.triggerRepaint();
            // ⚡ rapide : l'image suivante dès que la carte est dessinée ; ✨ soigné : quand ses cartes sont chargées.
            if (r.rapide) await attendreDessin(map);
            else attente = (await attendreCarte(map, attente)) ? 2000 : 300;
            await enc.ajouter(toile.toile, k);
            if (!couverture && k >= N * 0.6) couverture = toile.instantane();
          }
          blob = await enc.terminer();
        } catch (e) { enc.abandonner(); throw e; } finally { toile.lacher(); fondus(); }
      } else {
        // En direct (téléphone sans encodeur) : ce que la carte arrive à dessiner, en temps réel.
        await precharger();
        if (ctl.signal.aborted) { setEtape('reglages'); return; }
        poser(map, cameraA(track, 0));
        await attendreCarte(map, 800);
        setEtape('tournage');
        const son = musique ? await jouerMusique(musique, r.duree) : null;
        const rec = enregistrer(map, r.vertical, texte, son?.piste);
        const D = r.duree * 1000;
        const t0 = performance.now();
        await new Promise<void>((fin) => {
          const pas = (now: number) => {
            const t = Math.min(1, (now - t0) / D);
            placer(t);
            if (!couverture && t >= 0.6) couverture = rec.instantane();
            if (t < 1 && !ctl.signal.aborted) requestAnimationFrame(pas); else fin();
          };
          requestAnimationFrame(pas);
        });
        blob = await rec.arreter();
        son?.arreter();
      }
      if (ctl.signal.aborted) { setEtape('reglages'); return; }
      if (!blob.size) throw new Error('vidéo vide');
      setFilm({ blob, url: URL.createObjectURL(blob), couverture: await (couverture as Promise<ImageBitmap> | null)?.catch(() => null) ?? null });
      setRange(null);
      setEtape('pret');
    } catch (e) {
      if (!ctl.signal.aborted) onToast(`Film impossible : ${(e as Error).message}`);
      setEtape('reglages');
    } finally {
      ombres?.retirer();
      retirerTraceQuiAvance(map);
      if (pentesAvant !== undefined && map.getLayer('slopes')) map.setLayoutProperty('slopes', 'visibility', pentesAvant);
      map.setMaxPitch(pitchAvant);
      arret.current = null;
    }
  }

  async function partager() {
    if (!film) return;
    const nom = `survol-${trail.name.replace(/[\\/:*?"<>|]/g, '_')}.${extension(film.blob.type)}`;
    try {
      if (Capacitor.isNativePlatform()) {
        const data = await new Promise<string>((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1] ?? ''); fr.readAsDataURL(film.blob); });
        const chemin = `films/${nom}`;
        await Filesystem.writeFile({ path: chemin, data, directory: Directory.Cache, recursive: true });
        await Natif.partagerFichier({ chemin, mime: film.blob.type, titre: `Survol de ${trail.name}` });
      } else {
        const f = new File([film.blob], nom, { type: film.blob.type });
        if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], title: `Survol de ${trail.name}` });
        else { const a = document.createElement('a'); a.href = film.url; a.download = nom; a.click(); }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') onToast(`Partage impossible : ${(e as Error).message}`);
    }
  }

  /** ← Retour : referme le choix ouvert, sinon revient à l'écran d'avant (film prêt → réglages → menu de la trace). */
  function retour() {
    if (ouvert) setOuvert(null);
    else if (choixAlbum) setChoixAlbum(false);
    else if (etape === 'pret') { setFilm(null); setEtape('reglages'); }
    else if (etape === 'preparation' || etape === 'tournage') arret.current?.abort();
    else onClose();
  }

  /** 📸 Range le film dans l'album : couverture (petite, grande) + film, gardés ici et envoyés au retour du réseau. */
  async function ranger(x: Sortie) {
    if (!film) return;
    setChoixAlbum(false);
    try {
      const id = uuid();
      if (film.couverture) {
        await garder(id, 'petite', await reduire(film.couverture, PX.petite, 0.7));
        await garder(id, 'grande', await reduire(film.couverture, PX.grande, 0.8));
      }
      await garder(id, 'video', film.blob);
      deposerPhotos(x.id, [{ photo: id, prise_le: heureLocale(), lon: line[0].lon, lat: line[0].lat, video: true }]);
      setRange(x.nom);
      onToast(navigator.onLine ? `Film rangé dans l'album « ${x.nom} »` : `Film rangé : il partira au retour du réseau 🕓`);
    } catch (e) {
      onToast(`Album impossible : ${(e as Error).message}`);
    }
  }
  const albums = [...sorties].filter((x) => x.debut <= aujourdhui()).sort((a, b) => b.debut.localeCompare(a.debut));

  const occupe = etape === 'preparation' || etape === 'tournage';
  return (
    <>
      {occupe && <canvas className="survol-voile" ref={voile} />}
      {etape === 'pret' && film && (
        <div className="survol-film" style={{ bottom: basPanneau }}>
          <video ref={video} src={`${film.url}#t=0.1`} playsInline preload="auto" onEnded={() => setJoue(false)} onPause={() => setJoue(false)} onPlay={() => setJoue(true)} />
          {!joue && <button className="survol-play" aria-label="Revoir le film" onClick={() => void video.current?.play()}>▶</button>}
        </div>
      )}
      <section className={`trace-menu survol${sheet.classe}`} ref={panneau}>
        <div {...sheet.prise}><div className="handle" />
        <div className="head">
          <button className="retour" onClick={retour} aria-label="Retour">←</button>
          <b><CameraIcon size={22} /> Survol</b>
          <button className="close" onClick={() => { arret.current?.abort(); onClose(); }} aria-label="Fermer le survol">✕</button>
        </div></div>
        {etape === 'reglages' && <>
          {ouvert === 'duree' ? (
            <div className="survol-choix">{DUREES.map((d) => <button key={d} className={r.duree === d ? 'on' : ''} onClick={() => { maj({ duree: d }); setOuvert(null); }}>{d} s</button>)}</div>
          ) : ouvert === 'hauteur' ? (
            <div className="survol-choix">{(['bas', 'moyen', 'haut'] as Hauteur[]).map((h) => (
              <button key={h} className={r.hauteur === h ? 'on' : ''} onClick={() => { maj({ hauteur: h }); setOuvert(null); }}><HauteurIcon h={h} size={26} /> {NOMS[h]}</button>))}</div>
          ) : ouvert === 'style' ? (
            <div className="survol-styles">
              <div className="survol-choix deux">{(Object.keys(STYLES) as Style[]).map((k) => (
                <button key={k} className={r.style === k ? 'on' : ''} onClick={() => maj({ style: k })}>{STYLES[k].i} {STYLES[k].nom}</button>))}</div>
              <p className="survol-dit">{STYLES[r.style].dit}</p>
              {r.style === 'alpi' && <div className="survol-choix">{([['gopro', '🎯 GoPro'], ['large', '🔭 Large']] as [Descente, string][]).map(([k, t]) => (
                <button key={k} className={r.descente === k ? 'on' : ''} onClick={() => maj({ descente: k })}>{t}</button>))}</div>}
              <div className="survol-bas">
                <button className={`bascule ${r.plongee ? 'on' : ''}`} onClick={() => maj({ plongee: !r.plongee })} aria-label="Intro plongée depuis les nuages">☁ plongée nuages</button>
                <button className={`bascule ${musique ? 'on' : ''}`} aria-label="Musique du film"
                  onClick={() => { if (musique) setMusique(null); else choixMusique.current?.click(); }}>🎵 {musique ? musique.name.replace(/\.[^.]+$/, '').slice(0, 10) : 'musique'}</button>
                <button className="pastille ok" onClick={() => setOuvert(null)}>OK</button>
              </div>
            </div>
          ) : (
            <div className="survol-grille">
              <button className="pastille" onClick={() => setOuvert('style')} aria-label="Style de prise de vue">{STYLES[r.style].i} {STYLES[r.style].nom}</button>
              <button className="pastille" onClick={() => setOuvert('duree')} aria-label="Durée du film">⏱ {r.duree} s</button>
              <button className="pastille" onClick={() => setOuvert('hauteur')} aria-label="Hauteur de la caméra"><HauteurIcon h={r.hauteur} size={26} /> {NOMS[r.hauteur]}</button>
              <button className="bascule-format" onClick={() => maj({ vertical: !r.vertical })} aria-label="Format du film">
                <span className={r.vertical ? '' : 'couche'}>📱</span> {r.vertical ? 'vertical' : 'horiz.'}</button>
              <button className="bascule-format" onClick={() => maj({ rapide: !r.rapide })} aria-label="Rapide ou soigné">
                {r.rapide ? '⚡ rapide' : '✨ soigné'}</button>
              <button className={`bascule ${r.trace ? 'on' : ''}`} onClick={() => maj({ trace: !r.trace })}>〰 trace</button>
              <button className={`bascule ${r.trace && r.dessine ? 'on' : ''}`} disabled={!r.trace} onClick={() => maj({ dessine: !r.dessine })}
                aria-label="La trace se dessine pendant le film">✏ se dessine</button>
              <button className={`bascule ${r.infos ? 'on' : ''}`} onClick={() => maj({ infos: !r.infos })}>km · alt.</button>
              <button className={`bascule ${r.ombres ? 'on' : ''}`} onClick={() => maj({ ombres: !r.ombres })}>🌗 ombres</button>
            </div>
          )}
          {ouvert === 'plage' && (
            <div className="survol-plage">
              {(['h0', 'h1'] as const).map((k) => (
                <div key={k} className="row">
                  <span>{k === 'h0' ? 'Début' : 'Fin'}</span>
                  <button className="step" aria-label="30 min plus tôt" onClick={() => maj(k === 'h0' ? { h0: Math.max(0, r.h0 - 0.5) } : { h1: Math.max(r.h0 + 0.5, r.h1 - 0.5) })}>−</button>
                  <b>{heureTexte(r[k])}</b>
                  <button className="step" aria-label="30 min plus tard" onClick={() => maj(k === 'h0' ? { h0: Math.min(r.h1 - 0.5, r.h0 + 0.5) } : { h1: Math.min(23.5, r.h1 + 0.5) })}>+</button>
                </div>))}
            </div>
          )}
          {r.ombres && !ouvert && <button className="pastille" onClick={() => setOuvert('plage')} aria-label="Heures des ombres">🕘 ombres de {heureTexte(r.h0)} à {heureTexte(r.h1)}</button>}
          {ouvert !== 'style' && <div className="survol-bas">
            {ouvert === 'plage' ? <button className="pastille" onClick={() => setOuvert(null)}>OK</button>
              : ouvert ? <span /> : <>
                <button className={`bascule ${r.pentes ? 'on' : ''}`} onClick={() => maj({ pentes: !r.pentes })} aria-label="Pentes dans le film">◭ pentes</button>
                <span />
              </>}
            <button className="survol-rec" onClick={() => void tourner()} aria-label="Filmer"><i /></button>
          </div>}
          <input ref={choixMusique} type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setMusique(f); e.target.value = ''; }} />
        </>}
        {occupe && <>
          <p className="hint">{etape === 'preparation' ? avance : `Le film se tourne… ${avance}`}</p>
          <div className="survol-bas"><span />
            <button className="survol-rec stop" onClick={() => arret.current?.abort()} aria-label="Arrêter"><i /></button></div>
        </>}
        {etape === 'pret' && choixAlbum && <div className="survol-albums">
          <b>Dans quel album ?</b>
          {albums.slice(0, 6).map((x) => <button key={x.id} onClick={() => void ranger(x)}>📸 {x.nom}</button>)}
          <button onClick={() => setChoixAlbum(false)}>Annuler</button>
        </div>}
        {etape === 'pret' && !choixAlbum && <div className={`survol-fin ${albums.length || sortie ? 'deux' : ''}`}>
          {(sortie || albums.length > 0) && <button className="primary" disabled={range != null}
            onClick={() => { if (sortie) void ranger(sortie); else setChoixAlbum(true); }}>
            <span className="gros">📸</span>{range ? `✓ Dans « ${range} »` : sortie ? `Album « ${sortie.nom} »` : 'Ranger dans un album'}</button>}
          <button onClick={() => void partager()}><ShareIcon />Partager</button>
          <button onClick={() => { setFilm(null); setEtape('reglages'); }}><span className="gros">🔁</span>Refaire</button>
          <button className="danger" onClick={onClose}><TrashIcon />Jeter</button>
        </div>}
      </section>
    </>
  );
}

/**
 * 🎵 Joue le morceau depuis le début et le rend comme piste son pour l'enregistrement ; il baisse doucement
 * sur les 2 dernières secondes du film.
 */
async function jouerMusique(f: File, duree: number) {
  const ac = new AudioContext();
  const son = await ac.decodeAudioData(await f.arrayBuffer());
  const src = ac.createBufferSource();
  src.buffer = son;
  const volume = ac.createGain();
  const sortie = ac.createMediaStreamDestination();
  src.connect(volume).connect(sortie);
  const t0 = ac.currentTime;
  volume.gain.setValueAtTime(1, t0 + Math.max(0, duree - 2));
  volume.gain.linearRampToValueAtTime(0, t0 + duree);
  src.start();
  return { piste: sortie.stream.getAudioTracks()[0], arreter: () => { try { src.stop(); } catch { /* déjà fini */ } void ac.close(); } };
}

/** Zoom de carte qui donne le relief des ombres (même finesse que ce qu'on filme). */
const HAUTEUR_ZOOM: Record<Hauteur, number> = { bas: 15, moyen: 14, haut: 13 };

function poser(map: MlMap, c: Cam) {
  map.jumpTo({ center: [c.lon, c.lat], zoom: c.zoom, pitch: c.pitch, bearing: c.bearing });
}

/** Attend que la carte ait fini de charger ce qu'elle montre (true), ou maxMs (false). */
function attendreCarte(map: MlMap, maxMs: number) {
  return new Promise<boolean>((ok) => {
    const fin = (pret: boolean) => { clearTimeout(t); map.off('idle', surIdle); ok(pret); };
    const surIdle = () => fin(true);
    const t = setTimeout(() => fin(false), maxMs);
    map.once('idle', surIdle);
  });
}

/** Attend le prochain dessin de la carte (500 ms au plus). */
function attendreDessin(map: MlMap) {
  return new Promise<void>((ok) => {
    const fin = () => { clearTimeout(t); map.off('render', fin); ok(); };
    const t = setTimeout(fin, 500);
    map.once('render', fin);
  });
}

const TRACE_FILM = 'survol-trace';
/** ✏ Trace qui se construit derrière la caméra : la partie parcourue, et un point au bout. Rend la mise à jour. */
function traceQuiAvance(map: MlMap, couleur: string) {
  retirerTraceQuiAvance(map);
  map.addSource(TRACE_FILM, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: `${TRACE_FILM}-bord`, type: 'line', source: TRACE_FILM, filter: ['==', '$type', 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 9 } });
  map.addLayer({ id: TRACE_FILM, type: 'line', source: TRACE_FILM, filter: ['==', '$type', 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': couleur, 'line-width': 5 } });
  map.addLayer({ id: `${TRACE_FILM}-bout`, type: 'circle', source: TRACE_FILM, filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 8, 'circle-color': couleur, 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
  return (pts: { lon: number; lat: number }[], bout: { lon: number; lat: number } | null) => {
    const features: GeoJSON.Feature[] = [];
    if (pts.length > 1) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts.map((p) => [p.lon, p.lat]) } });
    if (bout) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [bout.lon, bout.lat] } });
    (map.getSource(TRACE_FILM) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  };
}
function retirerTraceQuiAvance(map: MlMap) {
  for (const l of [`${TRACE_FILM}-bout`, TRACE_FILM, `${TRACE_FILM}-bord`]) if (map.getLayer(l)) map.removeLayer(l);
  if (map.getSource(TRACE_FILM)) map.removeSource(TRACE_FILM);
}

/** Cartes affichées d'un coup pendant le tournage image par image (pas d'image à moitié en fondu). Rend le retour. */
function sansFondu(map: MlMap) {
  const avant: [string, unknown][] = [];
  for (const l of map.getStyle().layers) {
    if (l.type !== 'raster') continue;
    avant.push([l.id, map.getPaintProperty(l.id, 'raster-fade-duration')]);
    map.setPaintProperty(l.id, 'raster-fade-duration', 0);
  }
  return () => { for (const [id, v] of avant) if (map.getLayer(id)) map.setPaintProperty(id, 'raster-fade-duration', v as number | undefined); };
}

/** Caméra au trait (rectangle + objectif), comme le partage et la poubelle. */
export function CameraIcon({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <rect x="2.5" y="6.5" width="13" height="11" rx="2.5" /><path d="M15.5 10.5l6-3.5v10l-6-3.5z" />
    </svg>
  );
}

/** Hauteur de la caméra : petite caméra posée en bas, au milieu ou en haut, à côté d'une montagne. */
function HauteurIcon({ h, size }: { h: Hauteur; size: number }) {
  const y = { bas: 16, moyen: 9, haut: 2 }[h];
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 22l5-8 3 3 2-3 4 8z" /><path d="M1 22h22" /><rect x="1.5" y={y} width="6" height="4.5" rx="1" /><path d={`M7.5 ${y + 1}l3-1.2v4.4l-3-1.2`} />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
      <path d="M8 12L17 6M8 12L17 18" stroke="#1565c0" strokeWidth="2.2" fill="none" />
      <circle cx="18" cy="5" r="3" fill="#1565c0" /><circle cx="6" cy="12" r="3" fill="#1565c0" /><circle cx="18" cy="19" r="3" fill="#1565c0" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true" fill="none" stroke="#c62828" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M9 6V4h6v2M5.5 6l1 14h11l1-14M10 10v6M14 10v6" />
    </svg>
  );
}
