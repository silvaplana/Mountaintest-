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

interface Rendu { toile: HTMLCanvasElement; gl: WebGLRenderingContext; u: Record<string, WebGLUniformLocation | null> }
let rendu: Rendu | null | undefined;

function preparer(): Rendu | null {
  if (rendu !== undefined) return rendu;
  rendu = null;
  try {
    const toile = document.createElement('canvas');
    const gl = toile.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
    if (!gl) return null;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const p = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(p); gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
    const u: Rendu['u'] = {};
    for (const n of ['cam', 'cx', 'cy', 'cz', 'aspect', 'temps', 'dessous', 'ouvert', 'dechire']) u[n] = gl.getUniformLocation(prog, n);
    rendu = { toile, gl, u };
  } catch (e) {
    console.warn('Nuages WebGL indisponibles', e);
  }
  return rendu;
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

/** Rend l'image des nuages (u de 0 à 1 sur l'intro) à la taille w × h ; null sans WebGL. */
export function rendreCiel(w: number, h: number, u: number): HTMLCanvasElement | null {
  const r = preparer();
  if (!r) return null;
  const { gl, toile } = r;
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
  gl.uniform1f(r.u.temps, u * 6);
  gl.uniform1f(r.u.dessous, doux((u - (CIEL.dechirure - 0.06)) / 0.06));
  gl.uniform1f(r.u.dechire, Math.max(0, Math.min(1, (u - CIEL.dechirure + 0.02) / (CIEL.fin - CIEL.dechirure))));
  gl.uniform1f(r.u.ouvert, 1 - doux((u - CIEL.fin + 0.03) / 0.03));
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return toile;
}
