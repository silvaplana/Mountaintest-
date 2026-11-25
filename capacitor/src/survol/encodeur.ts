// Film image par image (retour de Seb du 25/11 : « des fois ça saccade ») : chaque image est encodée avec son
// heure exacte (30 images par seconde), quel que soit le temps que le téléphone met à la dessiner. Le film est
// donc fluide même si le tournage prend plus longtemps que le film. La musique est ajoutée au fichier MP4.
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';

export const IPS = 30;
const CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.42001f'];
const DEBIT = 6_000_000;
const TAUX_SON = 48_000;

/** Codec H.264 que le téléphone sait encoder à cette taille, ou null (on filme alors en direct). */
export async function codecVideo(w: number, h: number): Promise<string | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  for (const codec of CODECS) {
    try {
      if ((await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate: DEBIT, framerate: IPS })).supported) return codec;
    } catch { /* codec suivant */ }
  }
  return null;
}

async function codecSon(canaux: number): Promise<{ muxer: 'aac' | 'opus'; codec: string } | null> {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const [muxer, codec] of [['aac', 'mp4a.40.2'], ['opus', 'opus']] as const) {
    try {
      if ((await AudioEncoder.isConfigSupported({ codec, sampleRate: TAUX_SON, numberOfChannels: canaux, bitrate: 128_000 })).supported) return { muxer, codec };
    } catch { /* codec suivant */ }
  }
  return null;
}

/** 🎵 Le morceau, du début, coupé à la durée du film et baissé doucement sur les 2 dernières secondes. */
export async function preparerSon(f: File, duree: number): Promise<AudioBuffer> {
  const ac = new AudioContext({ sampleRate: TAUX_SON });
  try {
    const son = await ac.decodeAudioData(await f.arrayBuffer());
    const n = Math.min(son.length, Math.round(duree * TAUX_SON));
    const out = new AudioBuffer({ length: n, numberOfChannels: Math.min(2, son.numberOfChannels), sampleRate: TAUX_SON });
    for (let ch = 0; ch < out.numberOfChannels; ch++) {
      const d = son.getChannelData(ch).slice(0, n);
      baisserFin(d, TAUX_SON * 2);
      out.copyToChannel(d, ch);
    }
    return out;
  } finally { void ac.close(); }
}

/** Volume qui descend à zéro sur les `n` derniers échantillons. */
export function baisserFin(d: Float32Array, n: number) {
  const debut = Math.max(0, d.length - n);
  for (let i = debut; i < d.length; i++) d[i] *= (d.length - i) / (d.length - debut);
  return d;
}

/** Film MP4 : ajouter() chaque image dans l'ordre, puis terminer(). son : le morceau, déjà coupé. */
export async function creerFilm(w: number, h: number, codec: string, son: AudioBuffer | null) {
  const cs = son ? await codecSon(son.numberOfChannels) : null;
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target, fastStart: 'in-memory', firstTimestampBehavior: 'offset',
    video: { codec: 'avc', width: w, height: h, frameRate: IPS },
    audio: son && cs ? { codec: cs.muxer, numberOfChannels: son.numberOfChannels, sampleRate: TAUX_SON } : undefined,
  });
  let erreur: Error | null = null;
  const video = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { erreur = e; } });
  video.configure({ codec, width: w, height: h, bitrate: DEBIT, framerate: IPS, latencyMode: 'quality' });
  const verifier = () => { if (erreur) throw erreur; };

  if (son && cs) {
    const audio = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { erreur = e; } });
    audio.configure({ codec: cs.codec, sampleRate: TAUX_SON, numberOfChannels: son.numberOfChannels, bitrate: 128_000 });
    const pas = 4800;
    for (let i = 0; i < son.length; i += pas) {
      const n = Math.min(pas, son.length - i), data = new Float32Array(n * son.numberOfChannels);
      for (let ch = 0; ch < son.numberOfChannels; ch++) data.set(son.getChannelData(ch).subarray(i, i + n), ch * n);
      const a = new AudioData({ format: 'f32-planar', sampleRate: TAUX_SON, numberOfFrames: n, numberOfChannels: son.numberOfChannels, timestamp: Math.round((i / TAUX_SON) * 1e6), data });
      audio.encode(a);
      a.close();
    }
    await audio.flush();
    audio.close();
    verifier();
  }

  return {
    /** Sans son possible sur ce téléphone alors qu'un morceau était choisi. */
    sansSon: !!son && !cs,
    ajouter: async (image: CanvasImageSource, k: number) => {
      verifier();
      while (video.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5));
      const f = new VideoFrame(image, { timestamp: Math.round((k * 1e6) / IPS), duration: Math.round(1e6 / IPS) });
      video.encode(f, { keyFrame: k % (2 * IPS) === 0 });
      f.close();
    },
    terminer: async () => {
      await video.flush();
      video.close();
      verifier();
      muxer.finalize();
      return new Blob([target.buffer], { type: 'video/mp4' });
    },
    abandonner: () => { try { video.close(); } catch { /* déjà fermé */ } },
  };
}
