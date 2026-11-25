// Enregistre le film du survol : chaque image de la carte (WebGL) est recopiée, juste après son dessin, dans
// une toile 2D au format choisi (vertical 9:16 ou horizontal 16:9), avec l'heure et les km · altitude par-dessus.
// MediaRecorder en fait une vidéo MP4 si le téléphone sait, sinon WebM.
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
export interface Incrustation { heure?: string; infos?: string; nuages?: number }

/** son : piste de la musique choisie (🎵), mixée dans le film. */
export function enregistrer(map: MlMap, vertical: boolean, texte: () => Incrustation, son?: MediaStreamTrack) {
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
    // L'enregistrement part avec la première vraie image (pas d'image noire au début du film).
    if (rec.state === 'inactive' && !fini) rec.start(500);
  };
  const mime = formatVideo(!!son);
  const flux = toile.captureStream(30);
  if (son) flux.addTrack(son);
  const rec = new MediaRecorder(flux, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const morceaux: Blob[] = [];
  let fini = false;
  rec.ondataavailable = (e) => { if (e.data.size) morceaux.push(e.data); };
  // L'image WebGL n'est lisible que juste après son dessin : on recopie dans l'évènement « render ».
  map.on('render', dessiner);
  map.triggerRepaint();
  return {
    /** Image du moment (couverture du film dans l'album). */
    instantane: () => createImageBitmap(toile),
    arreter: () => new Promise<Blob>((ok) => {
      fini = true;
      map.off('render', dessiner);
      if (rec.state === 'inactive') { ok(new Blob([], { type: mime.split(';')[0] })); return; }
      rec.onstop = () => ok(new Blob(morceaux, { type: mime.split(';')[0] }));
      rec.stop();
    }),
  };
}
