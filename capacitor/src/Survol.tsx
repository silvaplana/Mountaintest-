import { LngLat, type GeoJSONSource, type Map as MlMap } from 'maplibre-gl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { Bbox } from './config';
import { Natif } from './buddies/Buddies';
import { adresse, garder, heureLocale, PX, reduire } from './buddies/album';
import { Image as Vignette } from './buddies/Album';
import { aujourdhui, deposerPhotos, lire as lireBuddies, uuid, type Sortie } from './buddies/store';
import { horlogePhotos, jourDesOmbres, momentPhoto, photosDeLaTrace } from './survol/photos-film';
import { cameraA, dansLeSens, debutTrace, heuresOmbres, heureTexte, IMAGES, dureeFilm, PITCH_MAX, PLONGEE_NUAGES_S, T_INTRO, T_PLONGEE, trajectoire, VITESSES, ZOOM_CIEL, type Cam, type Descente, type Hauteur, type Relief, type Sens, type Style } from './survol/camera';
import { chargerRelief } from './survol/relief';
import { films as lireFilms, garderFilm, oublierFilm, renommerFilm, videoDe, type FilmGarde } from './survol/films';
import { ambianceCiel, type Ambiance } from './survol/ciel-gl';
import { CREDIT_PHOTO, poserPhoto } from './survol/photo';
import { LIMITES_NEIGE, poserNeige } from './survol/neige';
import { cadrage, enregistrer, extension, toileFilm, type Incrustation } from './survol/enregistreur';
import { codecVideo, creerFilm, IPS, preparerSon } from './survol/encodeur';
import { carteCachee } from './survol/carte-cachee';
import { preparerOmbres, type OmbresSurvol } from './survol/ombres';
import type { Trail } from './trails/osmTrails';
import { useSheet } from './useSheet';
import { PencilIcon, TrashIcon } from './icones';

/** Réglages du film, gardés d'une fois sur l'autre. */
/** rapide : ⚡ les images n'attendent pas leurs cartes (tournage ≈ durée du film) ; sinon ✨ soigné, chaque image attend.
 *  dessine : ✏ la trace se construit derrière la caméra (comme au Tour de France). */
interface Reglages { /** Vitesse du film le long de la trace (km/h) : la durée en découle. */ vitesse: number; hauteur: Hauteur; vertical: boolean; trace: boolean; infos: boolean; ombres: boolean; h0: number; h1: number;
  /** Intro : ⤓ plongée simple (on descend du ciel sur le départ) ou ☁ plongée dans les nuages façon clip. */
  plongee: Plongee; rapide: boolean; dessine: boolean;
  /** ☁ Nuages de la plongée : mer lisse dorée, cumulus dorés ou cumulus bleu-gris. */
  ciel: Ambiance;
  /** Fond du film : la carte affichée, ou les 📷 photos aériennes (chargées pendant le tournage seulement). */
  fond: 'carte' | 'photo';
  /** ❄ Neige posée sur les photos (prises en été) au-dessus de cette altitude, en mètres ; 0 = sans. */
  neige: number;
  /** 🎬 style de prise de vue, descente du style alpiniste, ◭ pentes dans le film (la carte ne change pas). */
  style: Style; descente: Descente; sens: Sens; pentes: boolean }
type Plongee = 'non' | 'simple' | 'nuages';
const CLE = 'survol';
const DEFAUT: Reglages = { vitesse: 400, hauteur: 'moyen', vertical: true, trace: true, infos: true, ombres: false, h0: 8, h1: 12, plongee: 'non', ciel: 'dore', fond: 'carte', neige: 0, rapide: true, dessine: false, style: 'cine', descente: 'gopro', sens: 'deux', pentes: false };
function lire(): Reglages {
  try {
    const r = { ...DEFAUT, ...JSON.parse(localStorage.getItem(CLE) ?? '{}') };
    // Avant le 25/11, plongee était oui/non (oui = dans les nuages).
    return { ...r, plongee: r.plongee === true ? 'nuages' : r.plongee === false ? 'non' : r.plongee };
  } catch { return DEFAUT; }
}
/** 75 → « 1 min 15 ». */
const minutes = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`);
const NOMS: Record<Hauteur, string> = { bas: 'Bas', moyen: 'Moyen', haut: 'Haut' };
/** Styles de prise de vue (maquette validée le 25/11) : icône, nom, une phrase. */
const STYLES: Record<Style, { i: string; nom: string; dit: string }> = {
  suivi: { i: '🎥', nom: 'Suivi', dit: 'Derrière toi, la trace droit devant.' },
  cote: { i: '🎞', nom: 'De côté', dit: 'Travelling de côté : le relief de profil, la trace passe devant.' },
  alpi: { i: '🧗', nom: 'Alpiniste', dit: 'On monte, pause panoramique au sommet, puis on redescend vite.' },
  cine: { i: '🎬', nom: 'Ciné', dit: 'Monté tout seul : bas dans les vallées, haut aux crêtes, arrêts sur les beaux points de vue, grand recul à la fin.' },
};
/** Couches de la trace cachées quand « trace » n'est pas coché. */
const COUCHES_TRACE = ['trails-casing', 'trails', 'trail-sel-halo', 'trail-sel-casing', 'trail-sel', 'way-types-casing', 'way-types', 'way-gr'];

type Etape = 'reglages' | 'preparation' | 'tournage' | 'pret';

/**
 * 🎥 Survol 3D d'une trace (maquette validée par Seb le 25/11, maquettes/survol-3d/) : réglages en pastilles,
 * ⏺ prépare les cartes puis tourne le film (la carte en 3D le long de la trace, caméra lissée), puis
 * ▶ revoir, partager, refaire ou jeter. Ce qu'on voit sur la carte (fond, pentes) est ce qui est filmé.
 */
export function Survol({ map, trail, sortie, sorties, reduit, onFilm, onOuvrir, onClose, onToast }: {
  map: MlMap; trail: Trail; onClose: () => void; onToast: (t: string) => void;
  /** Panneau fermé pendant qu'un film se fabrique (ou attend d'être vu) : il ne reste qu'un bandeau, qui rouvre le panneau. */
  reduit: boolean; onFilm: (enCours: boolean) => void; onOuvrir: () => void;
  /** 📸 Buddy Time ouvert sur la carte : le film va dans son album ; sinon on choisit parmi mes Buddy Times. */
  sortie: Sortie | null; sorties: Sortie[];
}) {
  const [r, setR] = useState<Reglages>(lire);
  // Poignée commune des panneaux ; le survol s'ouvre en grand pour que tous ses boutons se voient.
  const sheet = useSheet('survol', { defaut: 2 });
  const [ouvert, setOuvert] = useState<'duree' | 'hauteur' | 'plage' | 'style' | 'films' | 'photos' | 'nom' | null>(null);
  // Nom du film, demandé au moment de filmer (Seb, 26/11) ; vide = le nom de la trace.
  const [nom, setNom] = useState('');
  const nomDuFilm = nom.trim() || trail.name || 'Survol';
  // 📷 Photos de la sortie montrées dans le film, là où elles ont été prises ; `sans` = celles qu'on a décochées.
  const [sans, setSans] = useState<Set<string>>(new Set());
  /** 📁 Derniers films gardés sur le téléphone, et celui qu'on regarde (pour le retirer si on le jette). */
  const [garde, setGarde] = useState<FilmGarde[]>([]);
  const [filmId, setFilmId] = useState<string | null>(null);
  useEffect(() => { void lireFilms().then(setGarde); }, []);
  useEffect(() => { setNom(''); }, [trail.id]);
  const [etape, setEtape] = useState<Etape>('reglages');
  const [avance, setAvance] = useState('');
  const [film, setFilm] = useState<{ blob: Blob; url: string; couverture: ImageBitmap | null } | null>(null);
  const [choixAlbum, setChoixAlbum] = useState(false);
  const [range, setRange] = useState<string | null>(null);
  const [telecharge, setTelecharge] = useState<string | null>(null);
  const [joue, setJoue] = useState(false);
  /** Film revu en plein écran (couché si le film est horizontal). */
  const [plein, setPlein] = useState(false);
  const boite = useRef<HTMLDivElement>(null);
  const panneau = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const arret = useRef<AbortController | null>(null);
  /** Le film en train de se faire, montré au-dessus du panneau. */
  const [apercu, setApercu] = useState<HTMLCanvasElement | null>(null);
  const reduitRef = useRef(reduit);
  reduitRef.current = reduit;
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
    if (!reduitRef.current) map.jumpTo(vueAvant.current);
  }, [map]);
  // Panneau fermé pendant le film : la carte revient où elle était, et reste libre. Rouvert : on repart de là.
  const dejaReduit = useRef(reduit);
  useEffect(() => {
    if (reduit === dejaReduit.current) return;
    dejaReduit.current = reduit;
    if (reduit) map.jumpTo(vueAvant.current);
    else vueAvant.current = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
  }, [reduit, map]);
  useEffect(() => () => { if (film) URL.revokeObjectURL(film.url); }, [film]);

  const line = trail.segments.flat();
  const photos = useMemo(() => photosDeLaTrace(lireBuddies().photos.filter((p) => !sortie || p.sortie === sortie.id), line),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trail, sortie]);
  // 🌗 Les ombres sont celles du jour du Buddy Time de la trace (sinon d'aujourd'hui).
  const jour = jourDesOmbres(sortie, photos);
  const jourTexte = jour ? ` · ${new Date(`${jour}T12:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}` : '';
  const zone: Bbox = [Math.min(...line.map((p) => p.lon)), Math.min(...line.map((p) => p.lat)), Math.max(...line.map((p) => p.lon)), Math.max(...line.map((p) => p.lat))];

  // Avant le tournage : la trace vue d'ensemble, inclinée.
  useEffect(() => {
    if (etape !== 'reglages' || reduit) return;
    const c = map.cameraForBounds([[zone[0], zone[1]], [zone[2], zone[3]]], { padding: { top: 60, bottom: basPanneau + 30, left: 40, right: 70 }, pitch: 45 });
    if (c) map.easeTo({ ...c, pitch: 45, bearing: 0, duration: 800 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etape, map]);

  async function tourner() {
    setOuvert(null);
    const ctl = new AbortController();
    const ecran = await ecranAllume();
    arret.current = ctl;
    setEtape('preparation');
    const ens = map.cameraForBounds([[zone[0], zone[1]], [zone[2], zone[3]]], { padding: 50, pitch: 45 });
    const centre = ens?.center ? LngLat.convert(ens.center) : map.getCenter();
    const c0 = { lon: centre.lng, lat: centre.lat };
    // 🧗 et 🎬 ont besoin du relief (sommets, crêtes, points de vue) ; sans lui, le film fait un suivi.
    // Tous les styles s'en servent aussi pour que la caméra ne passe jamais dans la montagne.
    redresse = 0;
    ambianceCiel(r.ciel, !r.rapide);
    setAvance('Lecture du relief…');
    const relief: Relief | null = await chargerRelief(zone, ctl.signal, r.style === 'alpi').catch(() => null);
    if (ctl.signal.aborted) { ecran(); arret.current = null; setEtape('reglages'); return; }
    if (!relief && (r.style === 'alpi' || r.style === 'cine')) onToast('Relief indisponible ici : film en suivi');
    // On choisit une vitesse, pas une durée (Seb, 25/11) : le film dure ce que demande la trace, plus l'intro.
    const corps = dureeFilm(line, r.vitesse, { style: r.style, sens: r.sens, relief });
    const tIntro = r.plongee === 'nuages' ? PLONGEE_NUAGES_S : r.plongee === 'simple' ? T_PLONGEE : T_INTRO;
    const duree = corps.corps + tIntro, debut = tIntro / duree;
    const track = trajectoire(line, r.hauteur, { center: c0, zoom: ens?.zoom ?? 13 }, Math.max(IMAGES, Math.min(3000, Math.round(duree * 20))), r.plongee !== 'non',
      { style: r.style, descente: r.descente, sens: r.sens, relief, nuages: r.plongee === 'nuages', hauteurPx: map.getContainer().clientHeight, debut, temps: corps.temps });
    // 📷 Les photos cochées : leur image, et le moment où le film passe à leur endroit.
    const tirages: { image: HTMLImageElement; moment: number }[] = [];
    for (const p of photos.filter((x) => !sans.has(x.id))) {
      const moment = momentPhoto(track, { lon: p.lon!, lat: p.lat! }, debut), u = moment == null ? null : await adresse(p.id, 'grande', p.envoyee);
      if (!u) continue;
      const image = new window.Image();
      image.src = u;
      if (await image.decode().then(() => true, () => false)) tirages.push({ image, moment: moment! });
    }
    const horloge = horlogePhotos(duree, tirages.map((x) => x.moment));
    const dureeFilmee = horloge.total;
    // 🎥 Le film se fabrique sur une carte cachée : la carte de l'appli reste libre (Seb, 25/11).
    setAvance('Préparation…');
    const cache = await carteCachee(map, ctl.signal).catch((e: Error) => { if (!ctl.signal.aborted) onToast(`Film impossible : ${e.message}`); return null; });
    if (!cache) { ecran(); arret.current = null; setEtape('reglages'); return; }
    const carte = cache.carte;
    const photo = r.fond === 'photo' && navigator.onLine;
    if (r.fond === 'photo' && !photo) onToast('Pas de réseau : film sur la carte');
    const retirerPhoto = photo ? poserPhoto(carte) : null;
    if (carte.getLayer('slopes')) carte.setLayoutProperty('slopes', 'visibility', r.pentes ? 'visible' : 'none');
    // 🧗 La caméra au sol lève les yeux au-dessus de l'horizon : il faut un ciel, et on impose l'altitude du point visé.
    const auSol = track.some((x) => x.elevation != null);
    if (carte.getMaxPitch() < PITCH_MAX + 2) carte.setMaxPitch(PITCH_MAX + 2);
    // Au ras du sol, la caméra est plus près que le zoom le plus fort de la carte : on le relève le temps du film.
    if (auSol) { carte.setCenterClampedToGround(false); carte.setSky(CIEL_FILM); carte.setMaxZoom(22); }
    const dessine = r.trace && r.dessine;
    for (const l of COUCHES_TRACE) if (carte.getLayer(l)) carte.setLayoutProperty(l, 'visibility', r.trace && !dessine ? 'visible' : 'none');
    const progression = dessine ? traceQuiAvance(carte, trail.color) : null;
    const heures = heuresOmbres(r.h0, r.h1);
    let ombres: OmbresSurvol | null = null, retirerNeige: (() => void) | null = null;
    try {
      if (photo && r.neige) {
        setAvance('Neige…');
        retirerNeige = await poserNeige(carte, zone, r.neige, ctl.signal).catch(() => null);
      }
      if (r.ombres) {
        setAvance('Calcul des ombres…');
        ombres = await preparerOmbres(carte, zone, HAUTEUR_ZOOM[r.hauteur], heures, ctl.signal, (f, t) => setAvance(`Ombres : ${f + 1}/${t}`), !r.rapide, jour);
        if (!ombres && !ctl.signal.aborted) onToast('Relief indisponible ici : film sans les ombres');
      }
      const dessin = { heure: r.ombres && ombres ? heureTexte(heures[0]) : undefined, infos: '', nuages: r.plongee === 'nuages' ? 0 : undefined } as Incrustation;
      const texte = () => ({ heure: dessin.heure, infos: r.infos ? dessin.infos : undefined, nuages: dessin.nuages, titre: dessin.titre, photo: dessin.photo, credit: photo ? CREDIT_PHOTO : undefined });
      /** Place la caméra au temps t (0 → 1) du film, avec l'heure des ombres, les km · altitude et les nuages. */
      const placer = (u: number) => {
        const { t, photo: tirage, q } = horloge.a(u);
        dessin.photo = tirage != null ? { image: tirages[tirage].image, q } : undefined;
        const cam = cameraA(track, t);
        poser(carte, cam);
        if (ombres) {
          const i = Math.round(t * (heures.length - 1));
          ombres.montrer(i);
          dessin.heure = heureTexte(heures[i]);
          // Plongée : les ombres apparaissent en descendant (vues du ciel, on verrait leur bord).
          if (r.plongee !== 'non') ombres.opacite(Math.max(0, Math.min(1, (cam.zoom - ZOOM_CIEL - 1) / 2.5)));
        }
        dessin.titre = cam.sommet != null ? `▲ Sommet · ${Math.round(cam.sommet)} m` : undefined;
        if (progression) { const pts = debutTrace(r.style === 'alpi' && relief ? dansLeSens(line, r.sens) : line, cam.d); progression(pts, pts.at(-1) ?? null); }
        if (r.infos) {
          const alt = carte.queryTerrainElevation([cam.point.lon, cam.point.lat]);
          dessin.infos = `${(cam.d / 1000).toFixed(1).replace('.', ',')} km${alt != null ? ` · ${Math.round(alt)} m` : ''}`;
        }
        if (dessin.nuages != null) dessin.nuages = t / debut;
        setAvance(`${Math.round(u * 100)} %`);
      };
      // Les cartes du trajet sont chargées d'abord (16 points du film) : moins de tuiles floues.
      const precharger = async () => {
        const N = 16;
        for (let k = 0; k <= N && !ctl.signal.aborted; k++) {
          setAvance(`Préparation des cartes : ${k}/${N}`);
          poser(carte, cameraA(track, k / N));
          await attendreCarte(carte, 1500);
        }
      };
      const cadre = cadrage(carte.getCanvas().width, carte.getCanvas().height, r.vertical);
      const codec = await codecVideo(cadre.ow, cadre.oh);
      let blob: Blob, couverture: Promise<ImageBitmap> | null = null;
      if (codec) {
        // Image par image : chaque image attend ses cartes, puis est encodée à sa place exacte dans le film.
        const son = musique ? await preparerSon(musique, dureeFilmee).catch(() => null) : null;
        if (musique && !son) onToast('Morceau illisible : film sans musique');
        const enc = await creerFilm(cadre.ow, cadre.oh, codec, son);
        if (enc.sansSon) onToast('Ce téléphone ne sait pas ajouter la musique : film sans musique');
        if (r.rapide) await precharger();
        if (ctl.signal.aborted) throw new Error('arrêté');
        const fondus = sansFondu(carte);
        const toile = toileFilm(carte, r.vertical, texte);
        setApercu(toile.toile);
        setEtape('tournage');
        try {
          const N = Math.round(dureeFilmee * IPS);
          placer(0);
          await attendreCarte(carte, 5000);
          let attente = 2000;
          for (let k = 0; k < N; k++) {
            if (ctl.signal.aborted) throw new Error('arrêté');
            placer(k / (N - 1));
            carte.triggerRepaint();
            // ⚡ rapide : l'image suivante dès que la carte est dessinée ; ✨ soigné : quand ses cartes sont chargées.
            if (r.rapide) await attendreDessin(carte);
            else attente = (await attendreCarte(carte, attente)) ? 2000 : 300;
            await enc.ajouter(toile.toile, k);
            if (!couverture && k >= N * 0.6) couverture = toile.instantane();
          }
          blob = await enc.terminer();
        } catch (e) { enc.abandonner(); throw e; } finally { toile.lacher(); fondus(); }
      } else {
        // En direct (téléphone sans encodeur) : ce que la carte arrive à dessiner, en temps réel.
        await precharger();
        if (ctl.signal.aborted) { setEtape('reglages'); return; }
        poser(carte, cameraA(track, 0));
        await attendreCarte(carte, 800);
        setEtape('tournage');
        const son = musique ? await jouerMusique(musique, dureeFilmee) : null;
        const rec = enregistrer(carte, r.vertical, texte, son?.piste);
        const D = dureeFilmee * 1000;
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
      const image = await (couverture as Promise<ImageBitmap> | null)?.catch(() => null) ?? null;
      setFilm({ blob, url: URL.createObjectURL(blob), couverture: image });
      // 📁 Gardé tout de suite parmi les derniers films.
      setFilmId(await garderFilm(blob, { nom: nomDuFilm, secondes: dureeFilmee, vertical: r.vertical,
        couverture: image ? await reduire(image, PX.grande, 0.8).catch(() => null) : null }));
      void lireFilms().then(setGarde);
      setRange(null); setTelecharge(null);
      setEtape('pret');
      if (reduitRef.current) onToast('Ton film est prêt');
    } catch (e) {
      if (!ctl.signal.aborted) onToast(`Film impossible : ${(e as Error).message}`);
      setEtape('reglages');
    } finally {
      ombres?.retirer();
      retirerNeige?.();
      retirerPhoto?.();
      cache.retirer();
      ecran();
      setApercu(null);
      arret.current = null;
    }
  }

  function nomFilm(f: { blob: Blob }) {
    return `survol-${nomDuFilm.replace(/[\\/:*?"<>|]/g, '_')}.${extension(f.blob.type)}`;
  }

  /** Copie le film dans le cache de l'appli, d'où le code Android le lit (partage, téléchargement). */
  async function dansLeCache(f: { blob: Blob }, nom: string) {
    const data = await new Promise<string>((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1] ?? ''); fr.readAsDataURL(f.blob); });
    const chemin = `films/${nom}`;
    await Filesystem.writeFile({ path: chemin, data, directory: Directory.Cache, recursive: true });
    return chemin;
  }

  /** ⬇ Enregistre le film dans la galerie du téléphone, album « Mountain Buddies » (Seb, 25/11). */
  async function telecharger() {
    if (!film) return;
    const nom = nomFilm(film);
    try {
      if (Capacitor.isNativePlatform()) {
        const { dossier } = await Natif.enregistrerFilm({ chemin: await dansLeCache(film, nom), nom, mime: film.blob.type });
        setTelecharge(dossier);
        onToast(`Film enregistré dans ${dossier}`);
      } else {
        const a = document.createElement('a'); a.href = film.url; a.download = nom; a.click();
        setTelecharge('Téléchargements');
      }
    } catch (e) {
      onToast(`Téléchargement impossible : ${(e as Error).message}`);
    }
  }

  async function partager() {
    if (!film) return;
    const nom = nomFilm(film);
    try {
      if (Capacitor.isNativePlatform()) {
        const chemin = await dansLeCache(film, nom);
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

  /** 📁 Revoit un film gardé : même écran qu'à la fin du tournage (plein écran, album, partage). */
  async function revoir(f: FilmGarde) {
    const blob = await videoDe(f.id);
    if (!blob) { onToast('Film introuvable'); await oublierFilm(f.id); setGarde(await lireFilms()); return; }
    setFilm({ blob, url: URL.createObjectURL(blob), couverture: f.couverture ? await createImageBitmap(f.couverture).catch(() => null) : null });
    setFilmId(f.id);
    setRange(null); setTelecharge(null);
    setOuvert(null);
    setEtape('pret');
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

  async function pleinEcran() {
    setPlein(true);
    try { await boite.current?.requestFullscreen(); } catch { /* sinon le film couvre quand même tout l'écran */ }
    if (!r.vertical) {
      try { await (screen.orientation as ScreenOrientation & { lock: (o: string) => Promise<void> }).lock('landscape'); } catch { /* pas possible ici */ }
    }
    void video.current?.play();
  }
  async function quitterPlein() {
    setPlein(false);
    try { screen.orientation.unlock(); } catch { /* rien */ }
    if (document.fullscreenElement) try { await document.exitFullscreen(); } catch { /* rien */ }
  }
  // Retour du téléphone ou geste système : le plein écran se ferme, on suit (seulement s'il s'était vraiment ouvert).
  const entre = useRef(false);
  useEffect(() => {
    const suivre = () => {
      if (document.fullscreenElement) { entre.current = true; return; }
      if (entre.current && plein) { entre.current = false; void quitterPlein(); }
    };
    document.addEventListener('fullscreenchange', suivre);
    return () => document.removeEventListener('fullscreenchange', suivre);
  });

  const occupe = etape === 'preparation' || etape === 'tournage';
  // L'appli garde ce composant en vie tant qu'un film se fabrique, ou attend d'être vu panneau fermé.
  const enCours = occupe || (etape === 'pret' && reduit);
  useEffect(() => { onFilm(enCours); }, [enCours]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onFilm(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  if (reduit) {
    return enCours ? (
      <button className="survol-bandeau" onClick={onOuvrir}>
        <CameraIcon size={24} />
        <span><b>{occupe ? `Film en cours${/%$/.test(avance) ? ` · ${avance}` : ''}` : 'Ton film est prêt'}</b>
          <small>{occupe ? 'Ne ferme pas l\u2019appli' : 'Touche pour le voir'}</small></span>
      </button>
    ) : null;
  }
  return (
    <>
      {occupe && <div className="survol-apercu" style={{ bottom: basPanneau }} ref={(el) => { if (el && apercu && apercu.parentElement !== el) el.replaceChildren(apercu); }} />}
      {etape === 'pret' && film && (
        <div className={`survol-film${plein ? ' plein' : ''}`} ref={boite} style={{ bottom: plein ? 0 : basPanneau }}>
          <video ref={video} src={`${film.url}#t=0.1`} playsInline preload="auto" controls={plein} onEnded={() => setJoue(false)} onPause={() => setJoue(false)} onPlay={() => setJoue(true)} />
          {!joue && <button className="survol-play" aria-label="Revoir le film" onClick={() => void video.current?.play()}>▶</button>}
          <button className="survol-plein" aria-label={plein ? 'Quitter le plein écran' : 'Plein écran'} onClick={() => void (plein ? quitterPlein() : pleinEcran())}>{plein ? '✕' : '⛶'}</button>
        </div>
      )}
      <section className={`trace-menu survol${sheet.classe}`} ref={panneau}>
        <div {...sheet.prise}><div className="handle" />
        <div className="head">
          <button className="retour" onClick={retour} aria-label="Retour">←</button>
          <b><CameraIcon size={22} /> Survol</b>
          <button className="close" onClick={() => { if (!occupe) arret.current?.abort(); onClose(); }} aria-label="Fermer le survol">✕</button>
        </div></div>
        {etape === 'reglages' && <>
          {ouvert === 'duree' ? (
            <div className="survol-choix">{VITESSES.map((v) => <button key={v} className={r.vitesse === v ? 'on' : ''} onClick={() => { maj({ vitesse: v }); setOuvert(null); }}>{v} km/h<br /><small>≈ {minutes(dureeFilm(line, v).corps)}</small></button>)}</div>
          ) : ouvert === 'photos' ? (
            <div className="survol-styles">
              <p className="survol-dit">Chaque photo cochée s'ouvre dans le film là où elle a été prise.</p>
              <div className="survol-photos">{photos.map((p) => (
                <button key={p.id} className={sans.has(p.id) ? '' : 'on'} aria-label={sans.has(p.id) ? 'Mettre cette photo dans le film' : 'Retirer cette photo du film'}
                  onClick={() => setSans((x) => { const y = new Set(x); if (!y.delete(p.id)) y.add(p.id); return y; })}>
                  <Vignette p={p} />{!sans.has(p.id) && <span>✓</span>}</button>))}</div>
              <div className="survol-bas"><button className="pastille ok" onClick={() => setOuvert(null)}>OK</button></div>
            </div>
          ) : ouvert === 'hauteur' ? (
            <div className="survol-choix">{(['bas', 'moyen', 'haut'] as Hauteur[]).map((h) => (
              <button key={h} className={r.hauteur === h ? 'on' : ''} onClick={() => { maj({ hauteur: h }); setOuvert(null); }}><HauteurIcon h={h} size={26} /> {NOMS[h]}</button>))}</div>
          ) : ouvert === 'nom' ? (
            <label className="survol-nom">Nom du film (si tu veux)
              <input value={nom} placeholder={trail.name || 'Survol'} maxLength={60} enterKeyHint="go"
                onChange={(e) => setNom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void tourner(); }} /></label>
          ) : ouvert === 'films' ? (
            <div className="survol-films">
              {garde.map((f) => <FilmLigne key={f.id} f={f} revoir={() => void revoir(f)} renommer={(n) => void renommerFilm(f.id, n).then(lireFilms).then(setGarde)} jeter={() => void oublierFilm(f.id).then(lireFilms).then(setGarde)} />)}
              <button className="pastille ok" onClick={() => setOuvert(null)}>OK</button>
            </div>
          ) : ouvert === 'style' ? (
            <div className="survol-styles">
              <div className="survol-choix deux">{(Object.keys(STYLES) as Style[]).map((k) => (
                <button key={k} className={r.style === k ? 'on' : ''} onClick={() => maj({ style: k })}>{STYLES[k].i} {STYLES[k].nom}</button>))}</div>
              <p className="survol-dit">{STYLES[r.style].dit}</p>
              <div className="survol-choix">{([['carte', '🗺 Carte'], ['photo', '📷 Photo aérienne']] as [Reglages['fond'], string][]).map(([k, t]) => (
                <button key={k} className={r.fond === k ? 'on' : ''} onClick={() => maj({ fond: k })}>{t}</button>))}</div>
              {r.fond === 'photo' && <p className="survol-dit">❄ Neige ajoutée sur les photos, à partir de quelle altitude ?</p>}
              {r.fond === 'photo' && <div className="survol-choix">
                <button className={r.neige ? '' : 'on'} onClick={() => maj({ neige: 0 })}>Sans neige</button>
                {LIMITES_NEIGE.map((m) => <button key={m} className={r.neige === m ? 'on' : ''} onClick={() => maj({ neige: m })}>{m} m</button>)}</div>}
              {r.style === 'alpi' && <div className="survol-choix">{([['montee', '→ Aller'], ['deux', '⇄ Aller-retour'], ['descente', '← Retour']] as [Sens, string][]).map(([k, t]) => (
                <button key={k} className={r.sens === k ? 'on' : ''} onClick={() => maj({ sens: k })}>{t}</button>))}</div>}
              {r.style === 'alpi' && r.sens !== 'montee' && <div className="survol-choix">{([['gopro', '🎯 GoPro'], ['large', '🔭 Large']] as [Descente, string][]).map(([k, t]) => (
                <button key={k} className={r.descente === k ? 'on' : ''} onClick={() => maj({ descente: k })}>{t}</button>))}</div>}
              <div className="survol-bas">
                <button className={`bascule ${r.plongee === 'simple' ? 'on' : ''}`} onClick={() => maj({ plongee: r.plongee === 'simple' ? 'non' : 'simple' })}
                  aria-label="Intro plongée depuis le ciel">⤓ plongée</button>
                <button className={`bascule ${r.plongee === 'nuages' ? 'on' : ''}`} onClick={() => maj({ plongee: r.plongee === 'nuages' ? 'non' : 'nuages' })}
                  aria-label="Intro plongée dans les nuages">☁ plongée nuages</button>
              </div>
              {r.plongee === 'nuages' && <div className="survol-choix">{([['lisse', '🌅 Mer dorée'], ['dore', '☁ Cumulus dorés'], ['bleu', '🌫 Bleu-gris']] as [Ambiance, string][]).map(([k, t]) => (
                <button key={k} className={r.ciel === k ? 'on' : ''} onClick={() => maj({ ciel: k })}>{t}</button>))}</div>}
              <div className="survol-bas">
                <button className={`bascule ${musique ? 'on' : ''}`} aria-label="Musique du film"
                  onClick={() => { if (musique) setMusique(null); else choixMusique.current?.click(); }}>🎵 {musique ? musique.name.replace(/\.[^.]+$/, '').slice(0, 10) : 'musique'}</button>
                <button className="pastille ok" onClick={() => setOuvert(null)}>OK</button>
              </div>
            </div>
          ) : (
            <div className="survol-grille">
              <button className="pastille" onClick={() => setOuvert('style')} aria-label="Style de prise de vue">{STYLES[r.style].i} {STYLES[r.style].nom}</button>
              <button className="pastille" onClick={() => setOuvert('duree')} aria-label="Vitesse du film">⏱ {r.vitesse} km/h</button>
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
              {photos.length > 0 && <button className={`bascule ${sans.size < photos.length ? 'on' : ''}`} onClick={() => setOuvert('photos')}
                aria-label="Photos de la sortie dans le film">📷 {photos.length - sans.size} photo{photos.length - sans.size > 1 ? 's' : ''}</button>}
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
          {r.ombres && !ouvert && <button className="pastille" onClick={() => setOuvert('plage')} aria-label="Heures des ombres">🕘 ombres de {heureTexte(r.h0)} à {heureTexte(r.h1)}{jourTexte}</button>}
          {ouvert !== 'style' && <div className="survol-bas">
            {ouvert === 'plage' ? <button className="pastille" onClick={() => setOuvert(null)}>OK</button>
              : ouvert ? <span /> : <>
                <button className={`bascule ${r.pentes ? 'on' : ''}`} onClick={() => maj({ pentes: !r.pentes })} aria-label="Pentes dans le film">◭ pentes</button>
                <button className="pastille" disabled={!garde.length} onClick={() => setOuvert('films')} aria-label="Mes derniers films">📁 {garde.length}</button>
              </>}
            <button className="survol-rec" onClick={() => { if (ouvert === 'nom') void tourner(); else setOuvert('nom'); }} aria-label="Filmer"><i /><span>Filmer</span></button>
          </div>}
          <input ref={choixMusique} type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setMusique(f); e.target.value = ''; }} />
        </>}
        {occupe && <>
          <p className="hint">{etape === 'preparation' ? avance : `Le film se fabrique… ${avance}`}<br />Tu peux fermer ce panneau et continuer. Ne ferme pas l’appli.</p>
          <div className="survol-bas"><span />
            <button className="survol-rec stop" onClick={() => arret.current?.abort()} aria-label="Arrêter"><i /><span>Arrêter</span></button></div>
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
          <button className="danger" onClick={() => { if (filmId) void oublierFilm(filmId); onClose(); }}><TrashIcon size={30} />Jeter</button>
          <button className="survol-dl" disabled={telecharge != null} onClick={() => void telecharger()}>
            <DownloadIcon />{telecharge ? `✓ Dans ${telecharge}` : `Télécharger dans ${Capacitor.isNativePlatform() ? GALERIE : 'Téléchargements'}`}</button>
        </div>}
      </section>
    </>
  );
}

/**
 * 🎵 Joue le morceau depuis le début et le rend comme piste son pour l'enregistrement ; il baisse doucement
 * sur les 2 dernières secondes du film.
 */
/** Garde l'écran allumé le temps du film (s'il s'éteint, le film s'arrête). Rend de quoi le relâcher. */
async function ecranAllume(): Promise<() => void> {
  type Verrou = { release: () => Promise<void> };
  const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Verrou> } };
  let verrou: Verrou | null = null, fini = false;
  const prendre = async () => { if (!fini && document.visibilityState === 'visible') verrou = await nav.wakeLock?.request('screen').catch(() => null) ?? null; };
  // Le téléphone relâche le verrou quand on quitte l'appli : on le reprend au retour.
  const retour = () => void prendre();
  document.addEventListener('visibilitychange', retour);
  await prendre();
  return () => { fini = true; document.removeEventListener('visibilitychange', retour); void verrou?.release().catch(() => undefined); };
}

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

/** Garde-fou pendant le tournage : redressement en cours (°), qui retombe doucement quand le relief le permet. */
let redresse = 0;

/** Ciel du film quand la caméra voit l'horizon (🧗 au sol) : bleu en haut, brume claire au loin. */
const CIEL_FILM = { 'sky-color': '#6fa8e0', 'horizon-color': '#e4edf3', 'fog-color': '#e4edf3', 'sky-horizon-blend': 0.7,
  'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.75, 'atmosphere-blend': 0 };

/** La caméra est-elle sous le relief que MapLibre dessine, à `marge` mètres près ? */
function sousRelief(map: MlMap, marge: number): boolean {
  // Position de la caméra : interne à MapLibre 6 (map._camera.transform) ; absente, pas de garde-fou.
  const t = (map as unknown as { _camera?: { transform?: { getCameraLngLat?: () => LngLat; getCameraAltitude?: () => number } } })._camera?.transform;
  if (!t?.getCameraLngLat || !t.getCameraAltitude) return false;
  const sol = map.queryTerrainElevation(t.getCameraLngLat());
  return sol != null && t.getCameraAltitude() < sol + marge;
}

/**
 * Pose la caméra ; si, malgré la trajectoire calculée, elle tombe dans la montagne, on la redresse encore.
 * 🧗 Au sol : on frôle (marge de la trajectoire, 1,5 m, pas de 0,5°) ; ailleurs 25 m, pas de 3°.
 */
function poser(map: MlMap, c: Cam) {
  const marge = c.garde ?? 25, pas = marge < 10 ? 0.5 : 3;
  let r = Math.max(0, redresse - (marge < 10 ? 0.1 : 0.4));
  for (let i = 0; i < 40; i++) {
    map.jumpTo({ center: [c.lon, c.lat], zoom: c.zoom, pitch: Math.max(0, c.pitch - r), bearing: c.bearing, ...(c.elevation != null ? { elevation: c.elevation } : {}) });
    if (c.pitch - r <= 0 || !sousRelief(map, marge)) break;
    r += pas;
  }
  redresse = r;
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

/** Dossier où ⬇ range le film (Android : Movies/Mountain Buddies, vu comme un album de la galerie). */
const GALERIE = 'Galerie › Mountain Buddies';

/** Flèche vers un plateau, au trait fin comme la poubelle. */
function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.5v11.5" /><path d="M7 10.5l5 5 5-5" /><path d="M4 16.5v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
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


/** Une ligne du 📁 : vignette, nom, date ; appui = revoir, crayon = changer le nom, poubelle = retirer. */
function FilmLigne({ f, revoir, renommer, jeter }: { f: FilmGarde; revoir: () => void; renommer: (nom: string) => void; jeter: () => void }) {
  const [img, setImg] = useState<string | null>(null);
  const [nom, setNom] = useState<string | null>(null);
  const valider = () => { const n = nom?.trim(); if (n && n !== f.nom) renommer(n); setNom(null); };
  useEffect(() => {
    if (!f.couverture) return;
    const u = URL.createObjectURL(f.couverture);
    setImg(u);
    return () => URL.revokeObjectURL(u);
  }, [f.couverture]);
  const le = new Date(f.le);
  if (nom != null) return (
    <div className="survol-film-ligne">
      <input autoFocus value={nom} maxLength={60} enterKeyHint="done" aria-label="Nom du film" onChange={(e) => setNom(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') valider(); }} />
      <button className="pastille ok" onClick={valider}>OK</button>
    </div>
  );
  return (
    <div className="survol-film-ligne">
      <button onClick={revoir} aria-label={`Revoir ${f.nom}`}>
        {img ? <img src={img} alt="" /> : <span className="vide">🎬</span>}
        <span><b>{f.nom}</b><small>{le.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} {le.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · {f.secondes} s</small></span>
      </button>
      <button className="crayon" onClick={() => setNom(f.nom)} aria-label={`Renommer ${f.nom}`}><PencilIcon size={24} /></button>
      <button className="jeter" onClick={jeter} aria-label={`Retirer ${f.nom}`}><TrashIcon size={24} /></button>
    </div>
  );
}
