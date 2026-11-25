import { LngLat, type Map as MlMap } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { Bbox } from './config';
import { Natif } from './buddies/Buddies';
import { cameraA, heuresOmbres, heureTexte, IMAGES, NUAGES, trajectoire, type Cam, type Hauteur } from './survol/camera';
import { dessinerNuages } from './survol/nuages';
import { enregistrer, extension } from './survol/enregistreur';
import { preparerOmbres, type OmbresSurvol } from './survol/ombres';
import type { Trail } from './trails/osmTrails';

/** Réglages du film, gardés d'une fois sur l'autre. */
interface Reglages { duree: number; hauteur: Hauteur; vertical: boolean; trace: boolean; infos: boolean; ombres: boolean; h0: number; h1: number; plongee: boolean }
const CLE = 'survol';
const DEFAUT: Reglages = { duree: 15, hauteur: 'moyen', vertical: true, trace: true, infos: true, ombres: false, h0: 8, h1: 12, plongee: false };
function lire(): Reglages {
  try { return { ...DEFAUT, ...JSON.parse(localStorage.getItem(CLE) ?? '{}') }; } catch { return DEFAUT; }
}
const DUREES = [5, 10, 15, 30];
const NOMS: Record<Hauteur, string> = { bas: 'Bas', moyen: 'Moyen', haut: 'Haut' };
/** Couches de la trace cachées quand « trace » n'est pas coché. */
const COUCHES_TRACE = ['trails', 'trail-sel-casing', 'trail-sel', 'way-types-casing', 'way-types', 'way-gr'];

type Etape = 'reglages' | 'preparation' | 'tournage' | 'pret';

/**
 * 🎥 Survol 3D d'une trace (maquette validée par Seb le 25/11, maquettes/survol-3d/) : réglages en pastilles,
 * ⏺ prépare les cartes puis tourne le film (la carte en 3D le long de la trace, caméra lissée), puis
 * ▶ revoir, partager, refaire ou jeter. Ce qu'on voit sur la carte (fond, pentes) est ce qui est filmé.
 */
export function Survol({ map, trail, onClose, onToast }: { map: MlMap; trail: Trail; onClose: () => void; onToast: (t: string) => void }) {
  const [r, setR] = useState<Reglages>(lire);
  const [ouvert, setOuvert] = useState<'duree' | 'hauteur' | 'plage' | null>(null);
  const [etape, setEtape] = useState<Etape>('reglages');
  const [avance, setAvance] = useState('');
  const [film, setFilm] = useState<{ blob: Blob; url: string } | null>(null);
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
    const track = trajectoire(line, r.hauteur, { center: c0, zoom: ens?.zoom ?? 13 }, IMAGES, r.plongee);
    for (const l of COUCHES_TRACE) if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', r.trace ? 'visible' : 'none');
    const heures = heuresOmbres(r.h0, r.h1);
    let ombres: OmbresSurvol | null = null;
    try {
      if (r.ombres) {
        setAvance('Calcul des ombres…');
        ombres = await preparerOmbres(map, zone, HAUTEUR_ZOOM[r.hauteur], heures, ctl.signal, (f, t) => setAvance(`Ombres : ${f + 1}/${t}`));
        if (!ombres && !ctl.signal.aborted) onToast('Relief indisponible ici : film sans les ombres');
      }
      // Les cartes du trajet sont chargées d'abord : le film ne montre pas de tuiles floues.
      const N = 16;
      for (let k = 0; k <= N && !ctl.signal.aborted; k++) {
        setAvance(`Préparation des cartes : ${k}/${N}`);
        poser(map, cameraA(track, k / N));
        await attendreCarte(map, 1500);
      }
      if (ctl.signal.aborted) return;
      poser(map, cameraA(track, 0));
      await attendreCarte(map, 800);
      setEtape('tournage');
      let infos = '', heure = r.ombres && ombres ? heureTexte(heures[0]) : undefined;
      let nuages = r.plongee ? 0 : undefined;
      const son = musique ? await jouerMusique(musique, r.duree) : null;
      const rec = enregistrer(map, r.vertical, () => ({ heure, infos: r.infos ? infos : undefined, nuages }), son?.piste);
      const ciel = voile.current?.getContext('2d') ?? null;
      if (voile.current) { voile.current.width = voile.current.offsetWidth; voile.current.height = voile.current.offsetHeight; }
      const D = r.duree * 1000;
      const t0 = performance.now();
      await new Promise<void>((fin) => {
        const pas = (now: number) => {
          const t = Math.min(1, (now - t0) / D);
          const cam = cameraA(track, t);
          poser(map, cam);
          if (ombres) { const i = Math.round(t * (heures.length - 1)); ombres.montrer(i); heure = heureTexte(heures[i]); }
          if (r.infos) {
            const alt = map.queryTerrainElevation([cam.point.lon, cam.point.lat]);
            infos = `${(cam.d / 1000).toFixed(1).replace('.', ',')} km${alt != null ? ` · ${Math.round(alt)} m` : ''}`;
          }
          if (nuages != null) {
            nuages = t / NUAGES;
            if (ciel && voile.current) { ciel.clearRect(0, 0, voile.current.width, voile.current.height); dessinerNuages(ciel, voile.current.width, voile.current.height, nuages); }
          }
          setAvance(`${Math.round(t * 100)} %`);
          if (t < 1 && !ctl.signal.aborted) requestAnimationFrame(pas); else fin();
        };
        requestAnimationFrame(pas);
      });
      const blob = await rec.arreter();
      son?.arreter();
      if (!blob.size) throw new Error('vidéo vide');
      setFilm({ blob, url: URL.createObjectURL(blob) });
      setEtape('pret');
    } catch (e) {
      onToast(`Film impossible : ${(e as Error).message}`);
      setEtape('reglages');
    } finally {
      ombres?.retirer();
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
      <section className="trace-menu survol" ref={panneau}>
        <div className="head">
          <b><i className="swatch" style={{ background: trail.color }} /><CameraIcon size={22} /> Survol de {trail.name}</b>
          <button className="close" onClick={() => { arret.current?.abort(); onClose(); }} aria-label="Fermer le survol">✕</button>
        </div>
        {etape === 'reglages' && <>
          {ouvert === 'duree' ? (
            <div className="survol-choix">{DUREES.map((d) => <button key={d} className={r.duree === d ? 'on' : ''} onClick={() => { maj({ duree: d }); setOuvert(null); }}>{d} s</button>)}</div>
          ) : ouvert === 'hauteur' ? (
            <div className="survol-choix">{(['bas', 'moyen', 'haut'] as Hauteur[]).map((h) => (
              <button key={h} className={r.hauteur === h ? 'on' : ''} onClick={() => { maj({ hauteur: h }); setOuvert(null); }}><HauteurIcon h={h} size={26} /> {NOMS[h]}</button>))}</div>
          ) : (
            <div className="survol-grille">
              <button className="pastille" onClick={() => setOuvert('duree')} aria-label="Durée du film">⏱ {r.duree} s</button>
              <button className="pastille" onClick={() => setOuvert('hauteur')} aria-label="Hauteur de la caméra"><HauteurIcon h={r.hauteur} size={26} /> {NOMS[r.hauteur]}</button>
              <button className="bascule-format" onClick={() => maj({ vertical: !r.vertical })} aria-label="Format du film">
                <span className={r.vertical ? '' : 'couche'}>📱</span> {r.vertical ? 'vertical' : 'horiz.'}</button>
              <button className={`bascule ${r.trace ? 'on' : ''}`} onClick={() => maj({ trace: !r.trace })}>〰 trace</button>
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
          <div className="survol-bas">
            {ouvert === 'plage' ? <button className="pastille" onClick={() => setOuvert(null)}>OK</button>
              : ouvert ? <span /> : <>
                <button className={`bascule ${r.plongee ? 'on' : ''}`} onClick={() => maj({ plongee: !r.plongee })} aria-label="Intro plongée depuis les nuages">☁ plongée</button>
                <button className={`bascule ${musique ? 'on' : ''}`} aria-label="Musique du film"
                  onClick={() => { if (musique) setMusique(null); else choixMusique.current?.click(); }}>🎵 {musique ? musique.name.replace(/\.[^.]+$/, '').slice(0, 10) : 'musique'}</button>
              </>}
            <button className="survol-rec" onClick={() => void tourner()} aria-label="Filmer"><i /></button>
          </div>
          <input ref={choixMusique} type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setMusique(f); e.target.value = ''; }} />
        </>}
        {occupe && <>
          <p className="hint">{etape === 'preparation' ? avance : `Le film se tourne… ${avance}`}</p>
          <div className="survol-bas"><span />
            <button className="survol-rec stop" onClick={() => arret.current?.abort()} aria-label="Arrêter"><i /></button></div>
        </>}
        {etape === 'pret' && <div className="survol-fin">
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

function attendreCarte(map: MlMap, maxMs: number) {
  return new Promise<void>((ok) => {
    const fin = () => { clearTimeout(t); map.off('idle', fin); ok(); };
    const t = setTimeout(fin, maxMs);
    map.once('idle', fin);
  });
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
