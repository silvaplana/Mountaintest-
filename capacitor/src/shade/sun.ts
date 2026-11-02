// Position du soleil (algorithme NOAA, précision ~0,1° entre 1900 et 2100), sans réseau ni librairie.
// Même calcul côté Kotlin (Shade.kt) : garder les deux identiques.

const rad = Math.PI / 180;

export interface SunPos {
  /** Direction du soleil en degrés depuis le nord, sens horaire (90 = est, 180 = sud). */
  azimuth: number;
  /** Hauteur au-dessus de l'horizon en degrés, réfraction comprise (négative la nuit). */
  altitude: number;
}

export function sunPosition(date: Date, lat: number, lon: number): SunPos {
  const jd = date.getTime() / 86_400_000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const l0 = (((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360) + 360) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c = Math.sin(m * rad) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * m * rad) * (0.019993 - 0.000101 * t) + Math.sin(3 * m * rad) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(omega * rad);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * rad);
  const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad));
  const y = Math.tan((eps / 2) * rad) ** 2;
  // Équation du temps, en minutes.
  const eot = 4 / rad * (y * Math.sin(2 * l0 * rad) - 2 * e * Math.sin(m * rad)
    + 4 * e * y * Math.sin(m * rad) * Math.cos(2 * l0 * rad)
    - 0.5 * y * y * Math.sin(4 * l0 * rad) - 1.25 * e * e * Math.sin(2 * m * rad));
  const utcMin = ((date.getTime() / 60_000) % 1440 + 1440) % 1440;
  const tst = (((utcMin + eot + 4 * lon) % 1440) + 1440) % 1440;
  const ha = (tst / 4 - 180) * rad;
  const phi = lat * rad;
  const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZ)));
  let altitude = 90 - zenith / rad;
  // Réfraction atmosphérique (Bennett), qui relève le soleil près de l'horizon.
  if (altitude > -1) altitude += 1.02 / Math.tan((altitude + 10.3 / (altitude + 5.11)) * rad) / 60;
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) / rad + 180;
  return { azimuth: ((az % 360) + 360) % 360, altitude };
}

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
export function compass(az: number): string { return DIRS[Math.round(az / 45) % 8]; }
