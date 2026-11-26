// « Hors ligne » : les carrés déjà gardés sur le téléphone, colorés en vert sur la carte (Seb, 26/11).
// Un carré = une tuile du zoom 14 (environ 1,7 km dans les Alpes) ; il compte comme gardé quand au moins
// 12 de ses 16 tuiles du zoom 16 (le plus détaillé téléchargé) sont là, que ce soit SCAN 25 ou Plan IGN.
export const COVER_ZOOM = 14;
export const DETAIL_ZOOM = 16;
const MIN_TILES = 12;

const tileLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const tileLat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

/** Carrés du zoom 14 gardés (« x/y »), d'après les clés « z/x/y » des tuiles gardées, toutes couches confondues. */
export function ownedSquares(keys: Iterable<string>): Set<string> {
  const shift = DETAIL_ZOOM - COVER_ZOOM;
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (const k of keys) {
    const [z, x, y] = k.split('/').map(Number);
    if (z !== DETAIL_ZOOM || seen.has(k)) continue;
    seen.add(k);
    const p = `${x >> shift}/${y >> shift}`;
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n >= MIN_TILES).map(([p]) => p));
}

/** keys : « z/x/y » des tuiles gardées, toutes couches confondues. */
export function coverageGeoJson(keys: Iterable<string>): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const p of ownedSquares(keys)) {
    const [x, y] = p.split('/').map(Number);
    const w = tileLon(x, COVER_ZOOM), e = tileLon(x + 1, COVER_ZOOM), nl = tileLat(y, COVER_ZOOM), s = tileLat(y + 1, COVER_ZOOM);
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[w, nl], [e, nl], [e, s], [w, s], [w, nl]]] } });
  }
  return { type: 'FeatureCollection', features };
}

type Pt = [number, number];

/**
 * Bords des zones gardées, en anneaux fermés (coordonnées de tuiles du zoom 14, y vers le bas).
 * Chaque carré donne ses 4 bords dans le sens des aiguilles d'une montre ; un bord partagé par deux carrés
 * gardés apparaît dans les deux sens et s'annule. Ce qui reste se raccorde en anneaux : sens horaire = bord
 * extérieur d'une zone, sens inverse = trou (carré non gardé entouré de carrés gardés).
 */
function rings(squares: Set<string>): Pt[][] {
  const edges = new Map<string, Pt[]>();
  const add = (a: Pt, b: Pt) => {
    const back = `${b}>${a}`;
    if (edges.has(back)) { edges.delete(back); return; }
    edges.set(`${a}>${b}`, [a, b]);
  };
  for (const p of squares) {
    const [x, y] = p.split('/').map(Number);
    add([x, y], [x + 1, y]); add([x + 1, y], [x + 1, y + 1]); add([x + 1, y + 1], [x, y + 1]); add([x, y + 1], [x, y]);
  }
  const from = new Map<string, Pt[][]>();
  for (const e of edges.values()) {
    const k = String(e[0]);
    from.set(k, [...(from.get(k) ?? []), e]);
  }
  const out: Pt[][] = [];
  const used = new Set<Pt[]>();
  for (const start of edges.values()) {
    if (used.has(start)) continue;
    const ring: Pt[] = [start[0]];
    let e = start;
    while (!used.has(e)) {
      used.add(e);
      ring.push(e[1]);
      const dx = e[1][0] - e[0][0], dy = e[1][1] - e[0][1];
      const next = (from.get(String(e[1])) ?? []).filter((n) => !used.has(n) || n === start);
      // Coin partagé en diagonale : on tourne à droite d'abord, pour rester collé au même carré.
      const turn = (n: Pt[]) => { const nx = n[1][0] - n[0][0], ny = n[1][1] - n[0][1]; return dx * ny - dy * nx; };
      next.sort((a, b) => turn(b) - turn(a));
      if (!next.length) break;
      e = next[0];
    }
    // Points alignés retirés : un bord droit de dix carrés n'a que deux sommets.
    const pts = ring.slice(0, -1).filter((p, i, a) => {
      const q = a[(i - 1 + a.length) % a.length], r = a[(i + 1) % a.length];
      return (p[0] - q[0]) * (r[1] - p[1]) - (p[1] - q[1]) * (r[0] - p[0]) !== 0;
    });
    if (pts.length >= 4) out.push([...pts, pts[0]]);
  }
  return out;
}

const area = (r: Pt[]) => r.reduce((s, p, i) => (i ? s + (r[i - 1][0] * p[1] - p[0] * r[i - 1][1]) : s), 0) / 2;
const lonLat = (r: Pt[]) => r.map(([x, y]) => [tileLon(x, COVER_ZOOM), tileLat(y, COVER_ZOOM)]);

const sqPolygon = (x0: number, y0: number, x1: number, y1: number) =>
  lonLat([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]);

/**
 * Calque « Hors ligne » (Seb, 26/11, maquette « Voile ») : un voile sur tout ce qui n'est pas gardé,
 * et le trait qui borde ce qui l'est. Un carré gardé = tout son territoire est là, sans demi-mesure.
 * planOnly : carrés qui n'ont que le Plan IGN (pas le SCAN 25), entourés de bleu.
 */
export function offlineVeil(owned: Set<string>, planOnly: Set<string> = new Set()) {
  const rs = rings(owned);
  const outer = rs.filter((r) => area(r) > 0), holes = rs.filter((r) => area(r) < 0);
  const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  const veil: GeoJSON.Feature[] = [
    { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [world, ...outer.map(lonLat)] } },
    // Un carré manquant au milieu d'une zone gardée est voilé lui aussi.
    ...holes.map((r): GeoJSON.Feature => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [lonLat(r)] } })),
  ];
  const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
  return {
    veil: fc(veil),
    edge: fc(rs.map((r) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: lonLat(r) } }))),
    plan: fc([...planOnly].map((p) => {
      const [x, y] = p.split('/').map(Number);
      return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [sqPolygon(x, y, x + 1, y + 1)] } };
    })),
  };
}

/** Carrés (« x/y » du zoom 14) touchés par un rectangle, et le cadre aligné sur eux (Seb : toujours un rectangle). */
export function squaresInBbox([w, s, e, n]: [number, number, number, number]) {
  const x0 = Math.floor(((w + 180) / 360) * 2 ** COVER_ZOOM), x1 = Math.floor(((e + 180) / 360) * 2 ** COVER_ZOOM);
  const tileY = (lat: number) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** COVER_ZOOM); };
  const y0 = tileY(n), y1 = tileY(s);
  const squares: string[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) squares.push(`${x}/${y}`);
  return { squares, frame: sqPolygon(x0, y0, x1 + 1, y1 + 1) };
}

/** Rectangle géographique d'un carré, rentré d'un cheveu pour ne pas déborder sur les voisins. */
export function squareBbox(p: string): [number, number, number, number] {
  const [x, y] = p.split('/').map(Number);
  const eps = 1e-7;
  return [tileLon(x, COVER_ZOOM) + eps, tileLat(y + 1, COVER_ZOOM) + eps, tileLon(x + 1, COVER_ZOOM) - eps, tileLat(y, COVER_ZOOM) - eps];
}

/** Clés « z/x/y » des tuiles d'un carré, du zoom 14 au zoom 16 (les zooms plus petits servent à plusieurs carrés). */
export function squareTileKeys(p: string): string[] {
  const [x, y] = p.split('/').map(Number);
  const out: string[] = [];
  for (let z = COVER_ZOOM; z <= DETAIL_ZOOM; z++) {
    const k = 2 ** (z - COVER_ZOOM);
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) out.push(`${z}/${x * k + i}/${y * k + j}`);
  }
  return out;
}
