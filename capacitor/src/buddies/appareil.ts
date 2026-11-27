/** La ligne d'appareil que le Super User lit sous le pseudo d'une demande de support (Seb, 27/11 : « Windows machin,
 * j'ai pas compris ») : « Ordinateur Windows · version web », « Android 14 · Samsung SM-S911B · version 1.2.3 ». */
export interface Appareil {
  /** Version de l'appli installée ; absente sur la version web. */
  version?: string;
  plateforme: string; fabricant: string; modele: string; os: string; osVersion: string;
}

const SYSTEME: Record<string, string> = { windows: 'Windows', mac: 'Mac', linux: 'Linux', android: 'Android', ios: 'iOS' };
const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function appareilLisible(a: Appareil): string {
  const os = a.os.toLowerCase();
  if (a.plateforme === 'web' || !a.version) {
    const machine = os === 'android' ? 'Téléphone Android' : os === 'ios' ? 'iPhone' : SYSTEME[os] ? `Ordinateur ${SYSTEME[os]}` : 'Ordinateur';
    return `${machine} · version web`;
  }
  const telephone = os === 'ios' ? 'iPhone' : [majuscule(a.fabricant), a.modele].filter(Boolean).join(' ');
  return [`${SYSTEME[os] ?? majuscule(os)} ${a.osVersion}`.trim(), telephone, `version ${a.version}`].filter(Boolean).join(' · ');
}

/** Les demandes déjà reçues gardent l'ancienne ligne brute (« version web · Google Inc. Windows NT 10.0 · windows … ») :
 * on la relit pour l'afficher pareil. Une ligne déjà lisible passe telle quelle. */
export function relireAppareil(nom: string): string {
  const m = /^version (web|(\S+) \([^)]*\)) · (\S+)(?: (.*?))? · (\w+) ?(.*)$/.exec(nom);
  if (!m) return nom;
  const [, appli, version, fabricant, modele, os, osVersion] = m;
  return appareilLisible({ version: appli === 'web' ? undefined : version, plateforme: appli === 'web' ? 'web' : os,
    fabricant: appli === 'web' ? '' : fabricant, modele: modele ?? '', os, osVersion });
}
