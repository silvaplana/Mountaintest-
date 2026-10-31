export interface TrackPoint { lat: number; lon: number; ele: number | null; time: number | null }
export interface Track { name: string; points: TrackPoint[] }

/** Lit les points de trace (trkpt), ou à défaut de route (rtept), d'un fichier GPX. */
export function parseGpx(xml: string): Track {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('GPX illisible');
  let nodes = [...doc.getElementsByTagNameNS('*', 'trkpt')];
  if (!nodes.length) nodes = [...doc.getElementsByTagNameNS('*', 'rtept')];
  const points = nodes.map((n) => {
    const ele = n.getElementsByTagNameNS('*', 'ele')[0]?.textContent;
    const time = n.getElementsByTagNameNS('*', 'time')[0]?.textContent;
    return {
      lat: Number(n.getAttribute('lat')),
      lon: Number(n.getAttribute('lon')),
      ele: ele ? Number(ele) : null,
      time: time ? Date.parse(time) : null,
    };
  });
  const name = doc.getElementsByTagNameNS('*', 'name')[0]?.textContent ?? 'Trace';
  return { name, points };
}

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

export function toGpx(track: Track): string {
  const pts = track.points
    .map((p) => {
      const ele = p.ele !== null ? `<ele>${p.ele.toFixed(1)}</ele>` : '';
      const time = p.time !== null ? `<time>${new Date(p.time).toISOString()}</time>` : '';
      return `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${ele}${time}</trkpt>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Assomoutain Rando" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${esc(track.name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

export function toLineString(points: TrackPoint[]): GeoJSON.Feature<GeoJSON.LineString> {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points.map((p) => [p.lon, p.lat]) } };
}
