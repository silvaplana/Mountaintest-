// Mer de nuages de l'intro plongée, rendue en volume sur la carte graphique (WebGL) : on lance un rayon par pixel
// à travers une couche de nuages faite de bruit, éclairée par un soleil bas et doré. La caméra vole au-dessus,
// bascule vers le bas, traverse le gris et ressort par le dessous effiloché : là, les rayons ne touchent plus
// rien et la carte apparaît (image transparente). Si WebGL manque, nuages.ts garde un dessin plus simple.

import { CIEL } from './nuages';

const VS = 'attribute vec2 p; varying vec2 v; void main(){ v = p; gl_Position = vec4(p, 0.0, 1.0); }';

const FS = `
precision highp float;
varying vec2 v;
uniform vec3 cam; uniform vec3 cx; uniform vec3 cy; uniform vec3 cz;
uniform float aspect, temps, dessous, ouvert, dechire, graine, froid;
const vec3 SOLEIL = normalize(vec3(0.2, 0.1, -0.97));
// Soleil bas : lumière dorée ; les ombres tirent sur le bleu-violet du ciel.
// Ambiance bleu-gris (froid = 1) : soleil pâle derrière un voile, lumière blanche et froide, brume ardoise.
#define OR mix(vec3(1.0, 0.63, 0.33) * 1.7, vec3(0.80, 0.86, 0.96) * 1.15, froid)
#define OMBRE mix(vec3(0.40, 0.42, 0.62), vec3(0.30, 0.36, 0.48), froid)
#define BRUME mix(vec3(1.0, 0.72, 0.48), vec3(0.62, 0.69, 0.80), froid)

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float bruit(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p, float n) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { if (float(i) >= n) { s += a * 0.5; break; } s += a * bruit(p); p = p * 2.03 + vec3(1.7, 0.3, 2.9); a *= 0.5; } return s; }
// Bruit « en boules » : des bosses rondes séparées par des creux marqués, comme un chou-fleur.
float boules(vec3 p, float n) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { if (float(i) >= n) { s += a * 0.5; break; } s += a * abs(2.0 * bruit(p) - 1.0); p = p * 2.07 + vec3(3.1, 1.3, 0.7); a *= 0.5; } return s * 1.9; }

// Hauteur du sommet des cumulus : de grandes houles, et dessus des dômes ronds qui dépassent (tours de cumulus).
float sommet(vec2 xz) {
  float houle = fbm(vec3(xz * 0.3, 0.0), 2.0);
  float domes = boules(vec3(xz * 0.75, 7.0), 3.0);
  float tours = smoothstep(0.42, 0.7, bruit(vec3(xz * 0.2 + 5.0, 3.0)));
  return 0.22 + 0.42 * smoothstep(0.3, 0.75, houle) + domes * (0.2 + 0.42 * tours);
}
// Densité : pleine sous les sommets, rongée par des boules fines qui font les volutes ; dessous effiloché (y < 0).
// lod : nombre d'octaves du détail (moins au loin, sinon ça scintille). lod < 3 : version légère, pour les ombres.
float densite(vec3 p, float lod, float flou, out float prof) {
  vec3 q = p + vec3(temps * 0.25, 0.0, temps * 0.1);
  float top = sommet(q.xz);
  prof = top - p.y;
  if (prof < -0.12) return 0.0;
  float detail = boules(q * vec3(2.6, 3.2, 2.6) + vec3(0.0, temps * 0.05, 0.0), lod - 1.0);
  if (lod < 3.0) return smoothstep(0.0, 0.16 + flou, prof - 0.1 + (detail - 0.5) * 0.3) * (p.y < 0.35 ? clamp(1.0 - (0.35 - p.y) * 0.7, 0.3, 1.0) : 1.0);
  float fin = fbm(q * 7.0, max(1.0, lod - 2.0));
  float d = smoothstep(0.0, 0.16 + flou, prof - 0.1 + (detail - 0.5) * 0.3 + (fin - 0.5) * 0.09);
  // Dedans, la purée de pois n'est pas uniforme (Seb, 25/11) : des poches où le nuage s'éclaircit et laisse voir plus loin.
  float poches = fbm(q * vec3(2.0, 2.6, 2.0) + vec3(11.0, 0.0, 5.0), 2.0);
  d *= mix(1.0, 0.12 + 0.88 * smoothstep(0.4, 0.62, poches), smoothstep(0.12, 0.45, prof));
  if (p.y < 0.35) {
    // Dessous : des paquets de plus en plus rares en descendant, séparés par de grands trous.
    float k = clamp((0.35 - p.y) / 1.1, 0.0, 1.0);
    float lambeaux = fbm(q * vec3(3.5, 0.7, 3.5) + vec3(0.0, 3.0, 0.0), 4.0) + (detail - 0.5) * 0.2;
    d *= smoothstep(0.0, 0.12, lambeaux - 0.3 - k * 0.05 - dechire * 0.45);
  }
  return d;
}

float hg(float mu, float g) { return (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) / 4.0; }

vec3 ciel(vec3 rd) {
  float h = max(rd.y, 0.0);
  vec3 c = mix(vec3(1.0, 0.58, 0.26), vec3(0.98, 0.62, 0.42), smoothstep(0.0, 0.08, h));
  c = mix(c, vec3(0.52, 0.52, 0.70), smoothstep(0.04, 0.3, h));
  c = mix(c, vec3(0.16, 0.27, 0.55), smoothstep(0.2, 0.75, h));
  vec3 gris = mix(vec3(0.74, 0.79, 0.86), vec3(0.50, 0.58, 0.70), smoothstep(0.0, 0.25, h));
  c = mix(c, mix(gris, vec3(0.22, 0.30, 0.44), smoothstep(0.2, 0.8, h)), froid);
  float s = max(dot(rd, SOLEIL), 0.0);
  // Halo du soleil : large lueur, couronne, disque.
  c += mix(vec3(1.0, 0.72, 0.42), vec3(0.85, 0.90, 1.0) * 0.55, froid) * (0.35 * pow(s, 6.0) + 0.45 * pow(s, 40.0) + 0.6 * pow(s, 400.0));
  c += mix(vec3(1.0, 0.96, 0.88) * 3.0, vec3(0.95, 0.97, 1.0) * 0.9, froid) * smoothstep(0.99972, 0.99988, s);
  // Voile de cirrus très haut, étiré par le vent, éclairé par en dessous.
  if (rd.y > 0.02) {
    vec2 uv = cam.xz + rd.xz * (7.0 - cam.y) / rd.y;
    uv += vec2(temps * 0.4, 0.0);
    float f = fbm(vec3(uv.x * 0.045 + uv.y * 0.02, uv.y * 0.16, 1.0), 4.0);
    float fil = fbm(vec3(uv.x * 0.1, uv.y * 0.9, 4.0), 3.0);
    float ci = smoothstep(0.46, 0.78, f + (fil - 0.5) * 0.35) * smoothstep(0.02, 0.2, rd.y);
    vec3 lumiere = mix(mix(vec3(1.0, 0.66, 0.46), vec3(1.0, 0.93, 0.86), smoothstep(0.1, 0.6, rd.y)), vec3(0.82, 0.86, 0.92), froid) * (0.9 + 1.2 * pow(s, 5.0) * (1.0 - 0.6 * froid));
    c = mix(c, lumiere, ci * 0.5);
  }
  return c;
}

void main() {
  vec3 rd = normalize(cz + v.x * aspect * 0.55 * cx + v.y * 0.55 * cy);
  vec3 fond = rd.y > 0.0 ? ciel(rd) : mix(mix(vec3(0.28, 0.30, 0.34), vec3(0.24, 0.29, 0.38), froid), BRUME, pow(1.0 + rd.y, 12.0));
  vec3 or = OR, ombre = OMBRE, brume = BRUME;
  // Tranche de rayon dans la couche [-0.8 ; 1.3], limitée au loin.
  float t0 = 0.0, t1 = 0.0;
  if (abs(rd.y) > 1e-4) {
    float a = (-0.8 - cam.y) / rd.y, b = (1.3 - cam.y) / rd.y;
    t0 = max(0.0, min(a, b)); t1 = max(a, b);
  } else if (cam.y > -0.8 && cam.y < 1.3) t1 = 40.0;
  t1 = min(t1, t0 + 40.0);
  vec3 lum = vec3(0.0); float tr = 1.0;
  if (t1 > t0) {
    // Pas courts près de nous, plus longs au loin (la brume y lisse tout). Le départ du rayon est décalé d'une
    // fraction de pas qui change à chaque passe (graine) : plusieurs passes moyennées effacent le grain.
    const int N = 120;
    float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy + graine * vec2(5.588238, 3.137), vec2(0.06711056, 0.00583715))) + graine * 0.61803399);
    float t = t0 + (0.014 + t0 * 0.03) * jit;
    float mu = dot(rd, SOLEIL);
    // Vers le soleil, les bords minces s'allument (lisere d'argent) ; à l'opposé, un peu de lumière revient.
    float phase = 0.55 + 1.1 * hg(mu, 0.72) + 0.25 * hg(mu, -0.3);
    for (int i = 0; i < N; i++) {
      if (tr < 0.01 || t > t1) break;
      float pas = 0.014 + t * 0.03;
      vec3 p = cam + rd * t;
      float prof, pr2;
      float lod = clamp(5.2 - t * 0.45, 2.0, 5.0);
      float d = densite(p, lod, t * 0.012, prof);
      if (d > 0.01) {
        // Épaisseur de nuage vers le soleil (deux prises, en version légère).
        float o = densite(p + SOLEIL * 0.1, 2.5, 0.1, pr2) * 0.8 + densite(p + SOLEIL * 0.34, 2.0, 0.2, pr2) * 1.0;
        float pf = max(prof, 0.0);
        // Lumière directe, plus une part qui a rebondi dans le nuage (elle va plus profond et se teinte).
        float direct = exp(-o * 2.6 - pf * 2.0), diffus = exp(-o * 0.7 - pf * 1.5);
        // Les creux entre les boules sont plus sombres que les bosses.
        float poudre = 1.0 - exp(-d * 5.0 - pf * 9.0) * 0.5;
        float lisere = pow(max(mu, 0.0), 4.0) * exp(-o * 5.0) * 3.2;
        // Dessous, la lumière revient du sol : le gris s'éclaircit vers la sortie.
        float noir = min(pf, max(p.y + 0.6, 0.0) * 1.3);
        vec3 amb = mix(ombre, vec3(0.74, 0.78, 0.90), exp(-noir * 1.6)) * (0.62 + 0.3 * clamp(p.y, 0.0, 1.0));
        // Sous la couche, les lambeaux sont éclairés par le sol : gris clair, pas noirs.
        amb *= 1.0 + 1.1 * (1.0 - smoothstep(-0.3, 0.35, p.y));
        // Par endroits la lumière perce (blanc), ailleurs le nuage reste bleu et sombre.
        float perce = smoothstep(0.42, 0.7, fbm(p * vec3(1.6, 2.2, 1.6) + vec3(temps * 0.2, 3.0, 20.0), 2.0));
        amb = mix(amb * vec3(0.72, 0.82, 1.05), vec3(1.0, 0.98, 0.96) * 0.95, perce * smoothstep(0.1, 0.5, pf));
        vec3 c = amb * (0.66 + 0.2 * froid) + or * (1.5 * direct * phase * poudre + 0.55 * diffus + lisere * (1.0 - 0.5 * froid));
        // Brume dorée au loin (perspective aérienne).
        c = mix(c, brume, 1.0 - exp(-t * 0.06 * (1.0 + 0.6 * froid)));
        float a = 1.0 - exp(-d * 10.0 * pas);
        lum += tr * a * c; tr *= 1.0 - a;
      }
      t += pas;
    }
  }
  // Au-dessus des nuages, ce qui passe à travers garde le fond ; dessous (dessous = 1), c'est la carte.
  float alpha = 1.0 - tr * (rd.y < 0.0 ? dessous : 0.0);
  vec3 col = lum + tr * fond * (1.0 - (rd.y < 0.0 ? dessous : 0.0));
  col = vec3(1.0) - exp(-col * 1.35);
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.6);
  alpha *= ouvert;
  gl_FragColor = vec4(col * ouvert, alpha);
}`;

/** La mer de nuages lisse d'origine (ambiance « lisse »), gardée telle quelle : Seb veut le choix (25/11). */
const FS_LISSE = `
precision highp float;
varying vec2 v;
uniform vec3 cam; uniform vec3 cx; uniform vec3 cy; uniform vec3 cz;
uniform float aspect, temps, dessous, ouvert, dechire;
const vec3 SOLEIL = normalize(vec3(0.2, 0.1, -0.97));
const vec3 OR = vec3(1.0, 0.66, 0.36) * 1.5;

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float bruit(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p, float n) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { if (float(i) >= n) { s += a * 0.5; break; } s += a * bruit(p); p = p * 2.03 + vec3(1.7, 0.3, 2.9); a *= 0.5; } return s; }

// Hauteur du sommet des cumulus : de grosses bosses, plus petites en se rapprochant.
float sommet(vec2 xz) {
  float b = fbm(vec3(xz * 0.32, 0.0), 4.0);
  return 0.35 + 0.75 * smoothstep(0.3, 0.75, b);
}
// Densité : pleine sous les sommets, rongée par un bruit fin qui fait les volutes ; dessous effiloché (y < 0).
// lod : nombre d'octaves du détail (moins au loin, sinon ça scintille).
float densite(vec3 p, float lod, float flou, out float prof) {
  vec3 q = p + vec3(temps * 0.25, 0.0, temps * 0.1);
  float top = sommet(q.xz);
  prof = top - p.y;
  if (prof < 0.0) return 0.0;
  float detail = fbm(q * vec3(2.2, 2.8, 2.2), lod);
  float d = smoothstep(0.0, 0.22 + flou, prof - (detail - 0.45) * 0.35);
  if (p.y < 0.35) {
    // Dessous : des paquets de plus en plus rares en descendant, séparés par de grands trous.
    float k = clamp((0.35 - p.y) / 1.1, 0.0, 1.0);
    float lambeaux = fbm(q * vec3(3.5, 0.7, 3.5) + vec3(0.0, 3.0, 0.0), 4.0) + (detail - 0.5) * 0.3;
    d *= smoothstep(0.0, 0.12, lambeaux - 0.3 - k * 0.05 - dechire * 0.45);
  }
  return d;
}

vec3 ciel(vec3 rd) {
  float h = max(rd.y, 0.0);
  vec3 c = mix(vec3(1.0, 0.76, 0.46), vec3(0.88, 0.66, 0.50), smoothstep(0.0, 0.18, h));
  c = mix(c, vec3(0.30, 0.40, 0.58), smoothstep(0.08, 0.5, h));
  float s = max(dot(rd, SOLEIL), 0.0);
  c += vec3(1.0, 0.78, 0.5) * (0.3 * pow(s, 8.0) + 0.3 * pow(s, 80.0)) + vec3(1.0, 0.97, 0.9) * smoothstep(0.99975, 0.99985, s) * 2.0;
  return c;
}

void main() {
  vec3 rd = normalize(cz + v.x * aspect * 0.55 * cx + v.y * 0.55 * cy);
  vec3 fond = rd.y > 0.0 ? ciel(rd) : mix(vec3(0.28, 0.30, 0.34), vec3(1.0, 0.80, 0.56), pow(1.0 + rd.y, 12.0));
  // Tranche de rayon dans la couche [-0.8 ; 1.15], limitée au loin.
  float t0 = 0.0, t1 = 0.0;
  if (abs(rd.y) > 1e-4) {
    float a = (-0.8 - cam.y) / rd.y, b = (1.15 - cam.y) / rd.y;
    t0 = max(0.0, min(a, b)); t1 = max(a, b);
  } else if (cam.y > -0.8 && cam.y < 1.15) t1 = 40.0;
  t1 = min(t1, t0 + 40.0);
  vec3 lum = vec3(0.0); float tr = 1.0;
  if (t1 > t0) {
    // Pas courts près de nous, plus longs au loin (la brume y lisse tout) ; décalage en bruit doux contre les bandes.
    const int N = 128;
    float jit = hash(vec3(gl_FragCoord.xy, 1.0));
    float t = t0 + (0.015 + t0 * 0.028) * jit;
    float g = 0.62, mu = dot(rd, SOLEIL);
    float phase = 0.6 + 0.9 * (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) / 4.0;
    for (int i = 0; i < N; i++) {
      if (tr < 0.01 || t > t1) break;
      float pas = 0.015 + t * 0.028;
      vec3 p = cam + rd * t;
      float prof, pr2;
      float lod = clamp(5.2 - t * 0.5, 1.5, 5.0);
      float d = densite(p, lod, t * 0.012, prof);
      if (d > 0.01) {
        // Ombre vers le soleil (deux prises), et lumière ambiante qui fonce en profondeur.
        float o = densite(p + SOLEIL * 0.08, 3.0, 0.1, pr2) + densite(p + SOLEIL * 0.25, 2.0, 0.2, pr2) * 0.7;
        float soleil = exp(-o * 3.2) * exp(-max(prof, 0.0) * 2.4);
        // Dessous, la lumière revient du sol : le gris s'éclaircit vers la sortie.
        float noir = min(max(prof, 0.0), max(p.y + 0.6, 0.0) * 1.3);
        vec3 amb = mix(vec3(0.40, 0.44, 0.52), vec3(0.70, 0.73, 0.82), exp(-noir * 1.8));
        vec3 c = amb * 0.55 + OR * 1.9 * soleil * phase * (1.0 - exp(-d * 4.0));
        // Brume dorée au loin (perspective aérienne).
        c = mix(c, vec3(1.0, 0.80, 0.56), 1.0 - exp(-t * 0.07));
        float a = 1.0 - exp(-d * 9.0 * pas);
        lum += tr * a * c; tr *= 1.0 - a;
      }
      t += pas;
    }
  }
  // Au-dessus des nuages, ce qui passe à travers garde le fond ; dessous (dessous = 1), c'est la carte.
  float alpha = 1.0 - tr * (rd.y < 0.0 ? dessous : 0.0);
  vec3 col = lum + tr * fond * (1.0 - (rd.y < 0.0 ? dessous : 0.0));
  col = vec3(1.0) - exp(-col * 1.9);
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.45);
  alpha *= ouvert;
  gl_FragColor = vec4(col * ouvert, alpha);
}`;

interface Rendu { toile: HTMLCanvasElement; gl: WebGLRenderingContext; progs: Map<string, { prog: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }> }
let rendu: Rendu | null | undefined;

function preparer(): Rendu | null {
  if (rendu !== undefined) return rendu;
  rendu = null;
  try {
    const toile = document.createElement('canvas');
    const gl = toile.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
    if (!gl) return null;
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    rendu = { toile, gl, progs: new Map() };
  } catch (e) {
    console.warn('Nuages WebGL indisponibles', e);
  }
  return rendu;
}

/** Le programme (compilé à la première demande) du dessin choisi ; null s'il ne compile pas sur ce téléphone. */
function programme(r: Rendu, fs: string) {
  const deja = r.progs.get(fs);
  if (deja) return deja;
  const { gl } = r;
  try {
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    const u: Record<string, WebGLUniformLocation | null> = {};
    for (const n of ['cam', 'cx', 'cy', 'cz', 'aspect', 'temps', 'dessous', 'ouvert', 'dechire', 'graine', 'froid']) u[n] = gl.getUniformLocation(prog, n);
    const p = { prog, u };
    r.progs.set(fs, p);
    return p;
  } catch (e) {
    console.warn('Nuages WebGL : dessin indisponible', e);
    return null;
  }
}

const doux = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Position et orientation de la caméra dans les nuages à l'avancée u (mêmes étapes que CIEL). */
export function cameraCiel(u: number) {
  const { bascule, dedans, dechirure, fin } = CIEL;
  const a = doux(u / bascule), b = doux((u - bascule) / (dedans - bascule));
  const c = Math.max(0, Math.min(1, (u - dedans) / (dechirure - dedans))), d = doux((u - dechirure) / (fin - dechirure));
  const y = u < bascule ? lerp(1.75, 1.6, a) : u < dedans ? lerp(1.6, 1.3, b) : u < dechirure ? lerp(1.3, 0.25, c) : lerp(0.25, 0.05, d);
  const pitch = (u < bascule ? lerp(-7, -11, a) : lerp(-11, -89.5, b)) * Math.PI / 180;
  const roulis = (u < dedans ? 6 * (1 - b) * Math.cos(u * 6) : 0) * Math.PI / 180;
  // On avance vers le soleil (−z), de moins en moins vite en basculant.
  const z = -(Math.min(u, dedans) * 9 + Math.max(0, u - dedans) * 2);
  return { y, z, pitch, roulis };
}

let moyenne: HTMLCanvasElement | null = null;

/**
 * Ambiance des nuages (Seb, 25/11 : « propose-les-moi tous ») : la mer lisse dorée d'origine, les cumulus dorés,
 * ou les cumulus bleu-gris, plus mélancoliques.
 */
export type Ambiance = 'lisse' | 'dore' | 'bleu';
let ambiance: Ambiance = 'dore', passesFilm = 2;
/** Choix pour le film : l'ambiance, et le soin (✨ soigné = 3 passes moyennées, ⚡ rapide = 2). */
export function ambianceCiel(a: Ambiance, soigne = false) { ambiance = a; passesFilm = soigne ? 3 : 2; }

/**
 * Rend l'image des nuages (u de 0 à 1 sur l'intro) à la taille w × h ; null sans WebGL.
 * passes : nombre de rendus moyennés, chacun avec des rayons décalés autrement ; plus il y en a, moins il y a de grain.
 */
export function rendreCiel(w: number, h: number, u: number, passes = passesFilm): HTMLCanvasElement | null {
  const rr = preparer();
  if (!rr) return null;
  // Si le dessin choisi ne compile pas sur ce téléphone, on retombe sur la mer lisse.
  const r = programme(rr, ambiance === 'lisse' ? FS_LISSE : FS) ?? programme(rr, FS_LISSE);
  if (!r) return null;
  const { gl, toile } = rr;
  gl.useProgram(r.prog);
  const pos = gl.getAttribLocation(r.prog, 'p');
  gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  if (ambiance === 'lisse') passes = 1;
  const k = Math.min(1, 720 / Math.max(w, h));
  const W = Math.round(w * k), H = Math.round(h * k);
  if (toile.width !== W || toile.height !== H) { toile.width = W; toile.height = H; }
  gl.viewport(0, 0, W, H);
  const { y, z, pitch, roulis } = cameraCiel(u);
  // Repère caméra : avant (cz), droite (cx), haut (cy), avec le roulis.
  const fz: [number, number, number] = [0, Math.sin(pitch), -Math.cos(pitch)];
  const dx: [number, number, number] = [1, 0, 0];
  const up: [number, number, number] = [0, Math.cos(pitch), Math.sin(pitch)];
  const cr = Math.cos(roulis), sr = Math.sin(roulis);
  const rx = dx.map((v, i) => v * cr + up[i] * sr), ry = up.map((v, i) => v * cr - dx[i] * sr);
  gl.uniform3f(r.u.cam, 0.4, y, z);
  gl.uniform3fv(r.u.cx, rx); gl.uniform3fv(r.u.cy, ry); gl.uniform3fv(r.u.cz, fz);
  gl.uniform1f(r.u.aspect, W / H);
  gl.uniform1f(r.u.froid, ambiance === 'bleu' ? 1 : 0);
  gl.uniform1f(r.u.temps, u * 6);
  gl.uniform1f(r.u.dessous, doux((u - (CIEL.dechirure - 0.06)) / 0.06));
  gl.uniform1f(r.u.dechire, Math.max(0, Math.min(1, (u - CIEL.dechirure + 0.02) / (CIEL.fin - CIEL.dechirure))));
  gl.uniform1f(r.u.ouvert, 1 - doux((u - CIEL.fin + 0.03) / 0.03));
  if (passes <= 1) {
    gl.uniform1f(r.u.graine, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return toile;
  }
  // Moyenne des passes : la i-ième est posée avec un poids 1/(i+1) sur les précédentes.
  moyenne ??= document.createElement('canvas');
  if (moyenne.width !== W || moyenne.height !== H) { moyenne.width = W; moyenne.height = H; }
  const ctx = moyenne.getContext('2d');
  if (!ctx) return toile;
  for (let i = 0; i < passes; i++) {
    gl.uniform1f(r.u.graine, i);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (i === 0) { ctx.globalCompositeOperation = 'copy'; ctx.globalAlpha = 1; } else { ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1 / (i + 1); }
    ctx.drawImage(toile, 0, 0);
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  return moyenne;
}
