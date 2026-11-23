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

export const API_URL = 'https://silvaplana.cloud/mountaintest-api';
export const SCHEMA = 'fr.assomoutain.rando';
export const REDIRECT = `${SCHEMA}://callback`;
const CLE = 'compte';

export type Profil = { id: string; email: string | null; pseudo: string; photo: string | null };
export type Config = { logto: string; ressource: string; appId: string };

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
  attente?: { pseudo?: string };
  /** Dernier échange réussi avec le serveur (ms). */
  synchro?: number;
  /** Logto a refusé le jeton : se reconnecter (quand il y aura du réseau). */
  aReconnecter?: boolean;
  /** Connexion en cours : vérificateur PKCE et état, gardés si l'appli est tuée pendant la page Logto. */
  pkce?: { verifier: string; state: string };
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
export async function chargerConfig(appli: 'capacitor' | 'kotlin' = 'capacitor'): Promise<Config> {
  const r = await requete(`${API_URL}/config`);
  if (!r.ok) throw new Error(`Serveur des comptes : erreur ${r.status}`);
  const c = await r.json() as { logto: string; ressource: string; applis: Record<string, string> };
  if (!c.applis?.[appli]) throw new Error('Serveur des comptes pas encore configuré');
  return { logto: c.logto, ressource: c.ressource, appId: c.applis[appli] };
}

/** 1re étape : adresse de la page de connexion Logto (à ouvrir dans le navigateur). */
export async function debutConnexion(config: Config, email?: string): Promise<string> {
  const verifier = aleatoire(48), state = aleatoire(16);
  ecrire({ ...lire(), config, pkce: { verifier, state } });
  const q = new URLSearchParams({
    client_id: config.appId, redirect_uri: REDIRECT, response_type: 'code', state,
    scope: 'openid offline_access profile email', resource: config.ressource, prompt: 'consent',
    code_challenge: await defi(verifier), code_challenge_method: 'S256', ui_locales: 'fr',
  });
  if (email) q.set('login_hint', email);
  return `${config.logto}/oidc/auth?${q}`;
}

type Jetons = { access_token: string; refresh_token?: string; id_token?: string; expires_in: number };

function garderJetons(e: Etat, j: Jetons): Etat {
  const n: Etat = { ...e, access: j.access_token, accessExp: Date.now() + (j.expires_in - 60) * 1000, aReconnecter: false };
  if (j.refresh_token) n.refresh = j.refresh_token;
  if (j.id_token) { const c = claims(j.id_token); n.email = (c.email as string) ?? n.email ?? null; }
  return n;
}

/** 2e étape : retour de la page Logto (fr.assomoutain.rando://callback?code=…&state=…). */
export async function finConnexion(url: string): Promise<Etat> {
  const e = lire();
  const q = new URL(url.replace(/^[a-z.]+:\/\//, 'https://x/')).searchParams;
  if (q.get('error')) throw new Error(q.get('error_description') || q.get('error') || 'Connexion annulée');
  if (!e.pkce || !e.config || q.get('state') !== e.pkce.state) throw new Error('Connexion expirée : recommence');
  const r = await requete(`${e.config.logto}/oidc/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code: q.get('code') ?? '', redirect_uri: REDIRECT,
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
  if (!r.ok) throw new Error(`Serveur : erreur ${r.status}`);
  return await r.json() as T;
}

/** Envoie ce qui attend, puis récupère le profil. Sans réseau : HorsLigne, rien n'est perdu. */
export async function synchroniser(): Promise<Etat> {
  if (!connecte()) return lire();
  const attente = lire().attente;
  let p: Profil;
  if (attente?.pseudo != null) {
    p = await api<Profil>('PUT', '/moi', { pseudo: attente.pseudo });
    const reste = { ...lire().attente }; if (reste.pseudo === attente.pseudo) delete reste.pseudo;
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
