// Enregistre le film du survol : chaque image de la carte (WebGL) est recopiée, juste après son dessin, dans
// une toile 2D au format choisi (vertical 9:16 ou horizontal 16:9), avec l'heure et les km · altitude par-dessus.
// Image par image (encodeur.ts) si le téléphone sait encoder ; sinon en direct avec MediaRecorder (MP4 ou WebM).
import type { Map as MlMap } from 'maplibre-gl';
import { dessinerNuages } from './nuages';

export function formatVideo(avecSon = false): string {
  const l = avecSon
    ? ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return l.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? 'video/webm';
}
export const extension = (mime: string) => (mime.startsWith('video/mp4') ? 'mp4' : 'webm');

/** Partie de l'image de la carte gardée : centrée, au rapport voulu (largeur / hauteur). */
export function cadrage(w: number, h: number, vertical: boolean) {
  const r = vertical ? 9 / 16 : 16 / 9;
  const cw = Math.min(w, h * r), ch = cw / r;
  const k = Math.min(1, (vertical ? 720 : 1280) / cw);
  // Dimensions paires : certains encodeurs vidéo les exigent.
  return { sx: (w - cw) / 2, sy: (h - ch) / 2, sw: cw, sh: ch, ow: Math.round(cw * k / 2) * 2, oh: Math.round(ch * k / 2) * 2 };
}

/** nuages : avancée dans les nuages de l'intro plongée (0 → 1), absente sans plongée. */
/** credit : mention de la source du fond (« © IGN » sur les photos aériennes), en petit en bas à droite. */
export interface Incrustation { heure?: string; infos?: string; nuages?: number; titre?: string; credit?: string;
  /** 📷 Photo de la sortie posée sur l'image, comme un tirage ; q de 0 à 1 : elle s'ouvre, reste, se referme. */
  photo?: { image: HTMLImageElement; q: number } }

/**
 * Toile du film : chaque image de la carte y est recopiée juste après son dessin (l'image WebGL n'est lisible
 * qu'à ce moment-là, dans l'évènement « render »), recadrée, avec l'heure, les km · altitude et les nuages.
 */
export function toileFilm(map: MlMap, vertical: boolean, texte: () => Incrustation, apres?: () => void) {
  const src = map.getCanvas();
  const c = cadrage(src.width, src.height, vertical);
  const toile = document.createElement('canvas');
  toile.width = c.ow; toile.height = c.oh;
  const ctx = toile.getContext('2d')!;
  const echelle = c.ow / 360;
  const pastille = (t: string, x: number, y: number) => {
    ctx.font = `600 ${Math.round(17 * echelle)}px system-ui, sans-serif`;
    const w = ctx.measureText(t).width, p = 8 * echelle, hh = 30 * echelle;
    ctx.fillStyle = '#000000a8';
    ctx.beginPath(); ctx.roundRect(x, y, w + 2 * p, hh, 9 * echelle); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
    ctx.fillText(t, x + p, y + hh / 2 + echelle);
  };
  const dessiner = () => {
    ctx.drawImage(src, c.sx, c.sy, c.sw, c.sh, 0, 0, c.ow, c.oh);
    const t = texte();
    if (t.nuages != null) dessinerNuages(ctx, c.ow, c.oh, t.nuages);
    if (t.heure) pastille(`🕘 ${t.heure}`, 12 * echelle, 12 * echelle);
    if (t.infos) pastille(t.infos, 12 * echelle, c.oh - 42 * echelle);
    if (t.credit) {
      ctx.font = `500 ${Math.round(11 * echelle)}px system-ui, sans-serif`;
      ctx.textBaseline = 'alphabetic'; ctx.shadowColor = '#000'; ctx.shadowBlur = 3 * echelle; ctx.fillStyle = '#fffc';
      ctx.fillText(t.credit, c.ow - ctx.measureText(t.credit).width - 8 * echelle, c.oh - 8 * echelle);
      ctx.shadowBlur = 0;
    }
    if (t.photo) {
      const { image, q } = t.photo, a = Math.min(1, q / 0.12, (1 - q) / 0.12), o = a * a * (3 - 2 * a);
      const k = Math.min((c.ow * 0.84) / image.naturalWidth, (c.oh * 0.6) / image.naturalHeight) * (0.55 + 0.45 * o);
      const w = image.naturalWidth * k, hh = image.naturalHeight * k, b = 7 * echelle;
      ctx.save();
      ctx.fillStyle = `rgba(0,0,0,${0.35 * o})`; ctx.fillRect(0, 0, c.ow, c.oh);
      ctx.globalAlpha = o;
      ctx.translate(c.ow / 2, c.oh * 0.46); ctx.rotate((-2 * Math.PI) / 180);
      ctx.shadowColor = '#000a'; ctx.shadowBlur = 18 * echelle; ctx.shadowOffsetY = 6 * echelle;
      ctx.fillStyle = '#fff'; ctx.fillRect(-w / 2 - b, -hh / 2 - b, w + 2 * b, hh + 2 * b);
      ctx.shadowColor = 'transparent';
      ctx.drawImage(image, -w / 2, -hh / 2, w, hh);
      ctx.restore();
    }
    if (t.titre) {
      // « ▲ Sommet · 2 153 m » au milieu, en grand (🧗).
      ctx.font = `700 ${Math.round(24 * echelle)}px system-ui, sans-serif`;
      const w = ctx.measureText(t.titre).width, p = 14 * echelle, hh = 46 * echelle, x = (c.ow - w) / 2 - p, y = c.oh * 0.38 - hh / 2;
      ctx.fillStyle = '#000000b0'; ctx.beginPath(); ctx.roundRect(x, y, w + 2 * p, hh, 14 * echelle); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(t.titre, x + p, y + hh / 2 + echelle);
    }
    apres?.();
  };
  map.on('render', dessiner);
  map.triggerRepaint();
  return {
    toile,
    /** Image du moment (couverture du film dans l'album). */
    instantane: () => createImageBitmap(toile),
    lacher: () => map.off('render', dessiner),
  };
}

/**
 * Film en direct (téléphones sans encodeur vidéo) : MediaRecorder garde ce que la carte arrive à dessiner.
 * son : piste de la musique choisie (🎵), mixée dans le film.
 */
export function enregistrer(map: MlMap, vertical: boolean, texte: () => Incrustation, son?: MediaStreamTrack) {
  // L'enregistrement part avec la première vraie image (pas d'image noire au début du film).
  const t = toileFilm(map, vertical, texte, () => { if (rec.state === 'inactive' && !fini) rec.start(500); });
  const mime = formatVideo(!!son);
  const flux = t.toile.captureStream(30);
  if (son) flux.addTrack(son);
  const rec = new MediaRecorder(flux, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const morceaux: Blob[] = [];
  let fini = false;
  rec.ondataavailable = (e) => { if (e.data.size) morceaux.push(e.data); };
  return {
    instantane: t.instantane,
    arreter: () => new Promise<Blob>((ok) => {
      fini = true;
      t.lacher();
      if (rec.state === 'inactive') { ok(new Blob([], { type: mime.split(';')[0] })); return; }
      rec.onstop = () => ok(new Blob(morceaux, { type: mime.split(';')[0] }));
      rec.stop();
    }),
  };
}
