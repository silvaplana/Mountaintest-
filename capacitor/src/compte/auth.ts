/**
 * Compte Mountain Buddies : connexion par Logto (https://auth.silvaplana.cloud), pensée pour le hors ligne.
 * Même fonctionnement côté Kotlin (Compte.kt) : les garder identiques.
 *
 * - Se connecter demande du réseau une fois : la page Logto s'ouvre dans le navigateur du téléphone
 *   (code reçu par mail), puis revient dans l'appli par fr.assomoutain.rando://callback (OAuth + PKCE).
 * - Ensuite la session reste sur le téléphone : jeton de renouvellement (180 jours) + profil en cache.
 *   L'appli ne demande jamais le réseau pour s'ouvrir ni pour savoir qui est connecté.
 * - Ce qu'on change hors ligne (pseudo) est mis en attente et envoyé au retour du réseau (synchroniser()).
 * - Une coupure réseau ne déconnecte jamais : seul un refus explicite de Logto (jeton révoqué ou expiré)
 *   demande de se reconnecter, et le profil local reste affiché.
 */

import { PLAY } from '../config';

export const API_URL = 'https://silvaplana.cloud/mountaintest-api';
/** Identifiant Android : l'APK des copains, ou la version du Play Store (deux applis distinctes). */
export const SCHEMA = PLAY ? 'cloud.silvaplana.mountainbuddies' : 'fr.assomoutain.rando';
export const REDIRECT = `${SCHEMA}://callback`;
const CLE = 'compte';

export type Profil = {
  id: string; email: string | null; pseudo: string; photo: string | null;
  /** Fiche du membre, comme AppBase (spec §7.18) : vue seulement par moi. Téléphone et IBAN facultatifs. */
  prenom?: string; nom?: string; telephone?: string | null; iban?: string | null; super_user?: boolean;
  /** Wero (Seb 26/11) : la case, et le numéro (ou mail) s'il diffère du portable. */
  wero?: boolean; wero_numero?: string | null;
};
/** Ce qui se change dans la fiche ; une chaîne vide efface le téléphone ou l'IBAN. */
export type Infos = { prenom?: string; nom?: string; telephone?: string; iban?: string; wero_numero?: string };
export type Config = { logto: string; ressource: string; appId: string; fournisseurs?: string[] };
/** Google ou Apple : la page Logto renvoie directement vers eux (direct_sign_in). */
export type Fournisseur = 'google' | 'apple';
export type Appli = 'capacitor' | 'kotlin' | 'web';

/** Version web (iPhone en PWA) : retour sur la page de l'appli elle-même, sans index.html. */
export function retourWeb(loc: { origin: string; pathname: string } = location) {
  return loc.origin + loc.pathname.replace(/index\.html$/, '');
}

export type Etat = {
  config?: Config;
  /** Jeton de renouvellement : c'est lui qui garde le téléphone connecté. */
  refresh?: string;
  access?: string;
  /** Expiration du jeton d'accès (ms). */
  accessExp?: number;
  /** Infos du jeton d'identité, lisibles hors ligne. */
  email?: string | null;
  profil?: Profil;
  /** Changements faits hors ligne, envoyés au retour du réseau. */
  attente?: { pseudo?: string; wero?: boolean } & Infos;
  /** Dernier échange réussi avec le serveur (ms). */
  synchro?: number;
  /** Logto a refusé le jeton : se reconnecter (quand il y aura du réseau). */
  aReconnecter?: boolean;
  /** Connexion en cours : vérificateur PKCE et état, gardés si l'appli est tuée pendant la page Logto. */
  pkce?: { verifier: string; state: string; redirect?: string };
};

export class HorsLigne extends Error { constructor() { super('Pas de réseau'); } }
export class Refuse extends Error {}

// ------------------------------------------------------------------ stockage

let memoire: Etat | null = null;
export function lire(): Etat {
  if (memoire) return memoire;
  try { memoire = JSON.parse(localStorage.getItem(CLE) ?? '{}') as Etat; } catch { memoire = {}; }
  return memoire;
}
export function ecrire(e: Etat) {
  memoire = e;
  try { localStorage.setItem(CLE, JSON.stringify(e)); } catch { /* stockage plein ou bloqué */ }
  for (const f of abonnes) f(e);
}
const abonnes = new Set<(e: Etat) => void>();
export function suivre(f: (e: Etat) => void) { abonnes.add(f); return () => { abonnes.delete(f); }; }

/** Connecté = une session existe sur le téléphone, réseau ou pas. */
export const connecte = (e: Etat = lire()) => !!e.refresh;

// ------------------------------------------------------------------ PKCE

const b64url = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function aleatoire(n = 32) { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a); }
export async function defi(verifier: string) {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
}

/** Décode la partie centrale d'un JWT (sans vérifier : le serveur vérifie, ici c'est pour l'affichage). */
export function claims(jwt: string): Record<string, unknown> {
  const p = jwt.split('.')[1] ?? '';
  const s = atob(p.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(p.length / 4) * 4, '='));
  return JSON.parse(decodeURIComponent(Array.from(s, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')));
}

// ------------------------------------------------------------------ réseau

async function requete(url: string, init?: RequestInit): Promise<Response> {
  try { return await fetch(url, init); } catch { throw new HorsLigne(); }
}

/** Adresse Logto et identifiant de l'appli, donnés par le serveur (gardés pour la suite). */
export async function chargerConfig(appli: Appli = 'capacitor'): Promise<Config> {
  const r = await requete(`${API_URL}/config`);
  if (!r.ok) throw new Error(`Serveur des comptes : erreur ${r.status}`);
  const c = await r.json() as { logto: string; ressource: string; applis: Record<string, string>; fournisseurs?: string[] };
  if (!c.applis?.[appli]) throw new Error('Serveur des comptes pas encore configuré');
  return { logto: c.logto, ressource: c.ressource, appId: c.applis[appli], fournisseurs: c.fournisseurs ?? [] };
}

/**
 * 1re étape : adresse de la page de connexion Logto (à ouvrir dans le navigateur).
 * Avec un fournisseur (Google, Apple), Logto envoie tout de suite vers sa page, sans passer par la sienne.
 * `redirect` : adresse de retour, celle de l'appli (par défaut) ou de la page web (retourWeb()).
 */
export async function debutConnexion(config: Config, email?: string, fournisseur?: Fournisseur, redirect = REDIRECT): Promise<string> {
  if (fournisseur && config.fournisseurs && !config.fournisseurs.includes(fournisseur)) {
    throw new Error(`${fournisseur === 'google' ? 'Google' : 'Apple'} n'est pas encore activé : utilise ton e-mail`);
  }
  const verifier = aleatoire(48), state = aleatoire(16);
  ecrire({ ...lire(), config, pkce: { verifier, state, redirect } });
  const q = new URLSearchParams({
    client_id: config.appId, redirect_uri: redirect, response_type: 'code', state,
    scope: 'openid offline_access profile email', resource: config.ressource,
    // « login » : toujours redemander le compte, même si la page de connexion se souvient d'une session
    // (sinon, après « Se déconnecter », elle reconnectait l'ancien compte sans rien demander).
    prompt: 'login consent',
    code_challenge: await defi(verifier), code_challenge_method: 'S256', ui_locales: 'fr',
  });
  if (email) q.set('login_hint', email);
  if (fournisseur) q.set('direct_sign_in', `social:${fournisseur}`);
  return `${config.logto}/oidc/auth?${q}`;
}

type Jetons = { access_token: string; refresh_token?: string; id_token?: string; expires_in: number };

function garderJetons(e: Etat, j: Jetons): Etat {
  const n: Etat = { ...e, access: j.access_token, accessExp: Date.now() + (j.expires_in - 60) * 1000, aReconnecter: false };
  if (j.refresh_token) n.refresh = j.refresh_token;
  if (j.id_token) { const c = claims(j.id_token); n.email = (c.email as string) ?? n.email ?? null; }
  return n;
}

/** Version web : la page revient de Logto avec ?code=…&state=… (à finir au chargement). */
export function retourWebEnAttente(href: string = location.href): boolean {
  const q = new URL(href).searchParams;
  return !!lire().pkce && q.has('state') && (q.has('code') || q.has('error'));
}

/** 2e étape : retour de la page Logto (fr.assomoutain.rando://callback?code=…&state=…, ou la page web). */
export async function finConnexion(url: string): Promise<Etat> {
  const e = lire();
  const q = new URL(url.replace(/^[a-z.]+:\/\//, 'https://x/')).searchParams;
  if (q.get('error')) throw new Error(q.get('error_description') || q.get('error') || 'Connexion annulée');
  if (!e.pkce || !e.config || q.get('state') !== e.pkce.state) throw new Error('Connexion expirée : recommence');
  const r = await requete(`${e.config.logto}/oidc/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code: q.get('code') ?? '', redirect_uri: e.pkce.redirect ?? REDIRECT,
      client_id: e.config.appId, code_verifier: e.pkce.verifier, resource: e.config.ressource,
    }),
  });
  if (!r.ok) throw new Error(`Connexion refusée (${r.status})`);
  const n = garderJetons({ ...e, pkce: undefined }, await r.json() as Jetons);
  ecrire(n);
  await synchroniser().catch(() => undefined);
  return lire();
}

/** Jeton d'accès valide, renouvelé si besoin. HorsLigne sans réseau ; Refuse si Logto ne veut plus. */
export async function jetonAcces(): Promise<string> {
  const e = lire();
  if (!e.refresh || !e.config) throw new Refuse('Pas connecté');
  if (e.access && (e.accessExp ?? 0) > Date.now()) return e.access;
  const r = await requete(`${e.config.logto}/oidc/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: e.refresh, client_id: e.config.appId, resource: e.config.ressource }),
  });
  if (r.status === 400 || r.status === 401) {
    // invalid_grant : jeton expiré (180 jours) ou révoqué. On garde le profil, on demande de se reconnecter.
    ecrire({ ...lire(), access: undefined, aReconnecter: true });
    throw new Refuse('Session expirée : reconnecte-toi');
  }
  if (!r.ok) throw new HorsLigne();
  const n = garderJetons(lire(), await r.json() as Jetons);
  ecrire(n);
  return n.access!;
}

export async function api<T>(methode: string, chemin: string, corps?: unknown): Promise<T> {
  const t = await jetonAcces();
  const r = await requete(`${API_URL}${chemin}`, {
    method: methode,
    headers: { Authorization: `Bearer ${t}`, ...(corps ? { 'Content-Type': 'application/json' } : {}) },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  if (r.status === 401) { ecrire({ ...lire(), access: undefined }); throw new Refuse('Jeton refusé'); }
  // 409 : le serveur dit pourquoi (« L'appel est terminé »…), en français, à montrer tel quel.
  if (r.status === 409) throw new Error(String((await r.json().catch(() => ({})) as { detail?: string }).detail ?? 'Refusé'));
  if (!r.ok) throw new Error(`Serveur : erreur ${r.status}`);
  return await r.json() as T;
}

/** Fichier envoyé ou lu (photos de l'album) : même jeton que `api`. */
export async function apiFichier(methode: 'GET' | 'PUT', chemin: string, corps?: Blob): Promise<Blob> {
  const t = await jetonAcces();
  const r = await requete(`${API_URL}${chemin}`, {
    method: methode, body: corps,
    headers: { Authorization: `Bearer ${t}`, ...(corps ? { 'Content-Type': corps.type || 'image/jpeg' } : {}) },
  });
  if (r.status === 401) { ecrire({ ...lire(), access: undefined }); throw new Refuse('Jeton refusé'); }
  if (!r.ok) throw new Error(`Serveur : erreur ${r.status}`);
  return await r.blob();
}

/** Envoie ce qui attend, puis récupère le profil. Sans réseau : HorsLigne, rien n'est perdu. */
export async function synchroniser(): Promise<Etat> {
  if (!connecte()) return lire();
  const attente = lire().attente;
  let p: Profil;
  if (attente && Object.keys(attente).length) {
    p = await api<Profil>('PUT', '/moi', attente);
    // Ce qui a changé pendant l'envoi reste en attente pour la prochaine fois.
    const reste: Record<string, string | boolean | undefined> = { ...lire().attente };
    for (const [k, v] of Object.entries(attente)) if (reste[k] === v) delete reste[k];
    ecrire({ ...lire(), attente: reste });
  } else {
    p = await api<Profil>('GET', '/moi');
  }
  ecrire({ ...lire(), profil: p, synchro: Date.now() });
  return lire();
}

/** Changer son pseudo : tout de suite sur le téléphone, envoyé au serveur dès que possible. */
export async function changerPseudo(pseudo: string): Promise<Etat> {
  const p = pseudo.replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!p) throw new Error('Le pseudo ne peut pas être vide');
  const e = lire();
  ecrire({ ...e, profil: e.profil ? { ...e.profil, pseudo: p } : e.profil, attente: { ...e.attente, pseudo: p } });
  try { return await synchroniser(); } catch { return lire(); }
}

/** IBAN : sans espaces, en majuscules, clé vérifiée (ISO 13616, même règle qu'AppBase). Vide = rien. */
export function normaliserIban(iban: string): string {
  const t = iban.replace(/\s+/g, '').toUpperCase();
  if (!t) return '';
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(t)) throw new Error('Cet IBAN n’a pas la bonne forme (ex. FR76 3000 6000 0112 3456 7890 189).');
  const chiffres = (t.slice(4) + t.slice(0, 4)).split('').map((c) => parseInt(c, 36)).join('');
  let reste = 0;
  for (const c of chiffres) reste = (reste * 10 + Number(c)) % 97;
  if (reste !== 1) throw new Error('Cet IBAN est incorrect : un caractère est sans doute mal recopié.');
  return t;
}

/** Changer ma fiche (prénom, nom, téléphone, IBAN) : tout de suite sur le téléphone, envoyée dès que possible. */
export async function changerInfos(infos: Infos): Promise<Etat> {
  const propre: Infos = {};
  for (const [k, v] of Object.entries(infos) as [keyof Infos, string][]) {
    propre[k] = k === 'iban' ? normaliserIban(v) : v.replace(/\s+/g, ' ').trim();
  }
  const e = lire();
  const vide = (v?: string) => (v ? v : null);
  const profil = e.profil && { ...e.profil, ...propre, telephone: 'telephone' in propre ? vide(propre.telephone) : e.profil.telephone,
    iban: 'iban' in propre ? vide(propre.iban) : e.profil.iban, wero_numero: 'wero_numero' in propre ? vide(propre.wero_numero) : e.profil.wero_numero };
  ecrire({ ...e, profil, attente: { ...e.attente, ...propre } });
  try { return await synchroniser(); } catch { return lire(); }
}

/** « J'ai Wero » : tout de suite sur le téléphone, envoyé dès que possible (hors ligne aussi). */
export async function changerWero(oui: boolean): Promise<Etat> {
  const e = lire();
  ecrire({ ...e, profil: e.profil && { ...e.profil, wero: oui }, attente: { ...e.attente, wero: oui } });
  try { return await synchroniser(); } catch { return lire(); }
}

/** Nom complet de la fiche (« Sébastien Richard »), sinon le pseudo ; initiales pour la pastille (« SR »). */
export function nomComplet(e: Etat = lire()) {
  return [e.profil?.prenom, e.profil?.nom].filter(Boolean).join(' ') || nomAffiche(e);
}
export function initiales(e: Etat = lire()) {
  const p = e.profil;
  return p?.prenom && p?.nom ? (p.prenom[0] + p.nom[0]).toUpperCase() : initialesDe(nomAffiche(e));
}
/** « sebastien.richard54 » → « SR », « Marc Dupont » → « MD », « luc » → « L » : une lettre par mot, chiffres et
 * séparateurs (point, tiret, souligné, espace, @) ignorés (Seb, 26/11 : « SE » le choquait). */
export function initialesDe(texte: string) {
  const mots = texte.split('@')[0].split(/[\s._-]+/).map((m) => m.replace(/[^\p{L}]/gu, '')).filter(Boolean);
  return mots.slice(0, 2).map((m) => m[0]).join('').toUpperCase() || texte.trim().slice(0, 1).toUpperCase();
}

/** Se déconnecter : oublie la session (les traces et le reste de l'appli ne bougent pas). */
export async function deconnecter() {
  const e = lire();
  ecrire({ config: e.config });
  if (e.refresh && e.config) {
    // Révocation côté Logto si le réseau est là ; sinon le jeton expirera tout seul.
    requete(`${e.config.logto}/oidc/token/revocation`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: e.refresh, client_id: e.config.appId }),
    }).catch(() => undefined);
  }
}

/** Nom affiché : pseudo, sinon début de l'e-mail. */
export function nomAffiche(e: Etat = lire()) {
  return e.profil?.pseudo || (e.profil?.email ?? e.email ?? '').split('@')[0] || 'Moi';
}

/** Pour les tests. */
export function _reinitialiser() { memoire = null; abonnes.clear(); }
