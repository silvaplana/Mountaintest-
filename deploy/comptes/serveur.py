"""
Serveur des comptes Mountain Buddies (tourne sur le VPS, voir deploy/comptes/README.md).

Qui fait quoi :
- Logto (https://auth.silvaplana.cloud) gère la connexion : code par e-mail, Google, Apple. Il délivre
  aux applis un jeton d'accès (JWT signé) pour l'API https://silvaplana.cloud/mountaintest-api.
- Ce serveur vérifie ce jeton (signature, émetteur, destinataire, expiration) puis gère les données :
  profils, et ensuite groupes d'amis et invitations (tables déjà créées pour structurer la suite).

Hors ligne : l'appli ne dépend jamais de ce serveur pour s'ouvrir ; elle garde son profil sur le
téléphone et rejoue ici ce qu'elle a fait sans réseau (identifiants UUID choisis par le téléphone).

Routes (préfixe /mountaintest-api retiré par le gateway Caddy) :
  GET  /         état du serveur
  GET  /config   adresse de Logto et identifiants des applis (lu au moment de se connecter)
  GET  /moi      mon profil (créé à la première visite, e-mail repris de Logto)
  PUT  /moi      changer mon pseudo / ma photo
  POST /buddies/sync          Buddies : envoyer ce que le téléphone a fait, recevoir les nouveautés (buddies.py)
  GET  /invitations/{code}    aperçu d'une invitation pour la page du lien (sans connexion)
  PUT  /buddies/photos/{id}/{petite|grande}   envoyer le JPEG d'une photo de l'album (annoncée par la synchro)
  GET  /buddies/photos/{id}/{petite|grande}   la lire (participants du Buddy Time)
  POST /appareils             📞 le jeton Firebase de ce téléphone (pour sonner)
  POST /appels                📞 appeler un Buddy Group ou un Buddy Time (ou rejoindre l'appel en cours) (appels.py)
  POST /appels/{id}/rejoindre décrocher ; POST /appels/{id}/presence  entrer / raccrocher
"""
from __future__ import annotations

import base64
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

import jwt
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, func, inspect, select, text
from sqlalchemy.orm import Session, sessionmaker

import appels
import buddies
from modeles import Base, Utilisateur, maintenant
# Adresse publique de Logto (émetteur des jetons) et adresse interne (réseau Docker « web »).
LOGTO = os.environ.get("LOGTO_ENDPOINT", "https://auth.silvaplana.cloud").rstrip("/")
LOGTO_INTERNE = os.environ.get("LOGTO_INTERNE", LOGTO).rstrip("/")
API = os.environ.get("API_RESSOURCE", "https://silvaplana.cloud/mountaintest-api")
DB_URL = os.environ.get("DB_URL", "postgresql+psycopg://mb:mb@localhost:5432/mountain")
DOSSIER = os.environ.get("COMPTES_DOSSIER", "/data")
# Application « machine » de Logto (créée par l'installeur) : lit l'e-mail des utilisateurs.
M2M_ID = os.environ.get("LOGTO_M2M_ID", "")
M2M_SECRET = os.environ.get("LOGTO_M2M_SECRET", "")

moteur = create_engine(DB_URL, pool_pre_ping=True, pool_size=5)
Sessions = sessionmaker(moteur, expire_on_commit=False)


def db():
    with Sessions() as s:
        yield s


@asynccontextmanager
async def cycle(_app: FastAPI):
    Base.metadata.create_all(moteur)  # crée les tables manquantes (pas encore de migrations)
    ajouter_colonnes()
    yield


# Colonnes ajoutées après la création des tables sur le VPS (create_all n'ajoute pas de colonne).
COLONNES_AJOUTEES = [
    ("groupes", "nature", "VARCHAR(10) NOT NULL DEFAULT 'bande'"),
    ("groupes", "photo", "TEXT"),
    ("invitations", "canal", "VARCHAR(10) NOT NULL DEFAULT 'lien'"),
    ("invitations", "nom", "VARCHAR(80) NOT NULL DEFAULT ''"),
    ("invitations", "contact", "VARCHAR(320) NOT NULL DEFAULT ''"),
    ("invitations", "acceptee_par", "UUID REFERENCES utilisateurs(id)"),
    ("invitations", "sortie_id", "UUID REFERENCES sorties(id) ON DELETE CASCADE"),
]


def ajouter_colonnes():
    with moteur.begin() as c:
        for table, colonne, sql in COLONNES_AJOUTEES:
            if colonne not in {x["name"] for x in inspect(c).get_columns(table)}:
                c.execute(text(f"ALTER TABLE {table} ADD COLUMN {colonne} {sql}"))


app = FastAPI(title="Mountain Buddies, comptes", lifespan=cycle, docs_url=None, redoc_url=None)
# Version web du proto (silvaplana.cloud/mountaintest/) et WebView Capacitor (https://localhost).
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["Authorization", "Content-Type"])

# ---------------------------------------------------------------- jetons Logto

_jwks = jwt.PyJWKClient(f"{LOGTO_INTERNE}/oidc/jwks", cache_keys=True, lifespan=3600)


def verifier(jeton: str) -> dict[str, Any]:
    """Jeton d'accès Logto → ses informations (sub = identifiant Logto). Lève HTTPException 401 sinon."""
    try:
        cle = _jwks.get_signing_key_from_jwt(jeton)
        return jwt.decode(jeton, cle.key, algorithms=["ES384", "ES256", "RS256"], audience=API,
                          issuer=f"{LOGTO}/oidc", options={"require": ["exp", "sub", "iss", "aud"]}, leeway=30)
    except jwt.PyJWTError as e:
        raise HTTPException(401, f"Jeton refusé : {e}") from e


def jeton_requis(authorization: str = Header("")) -> dict[str, Any]:
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Connexion requise")
    return verifier(authorization[7:].strip())


_m2m = {"jeton": "", "expire": 0.0}
_m2m_verrou = threading.Lock()


def logto_utilisateur(sub: str) -> dict[str, Any]:
    """Fiche Logto d'un utilisateur (e-mail, nom, photo) via l'API de gestion ; {} si indisponible."""
    if not (M2M_ID and M2M_SECRET):
        return {}
    try:
        with _m2m_verrou:
            if time.time() > _m2m["expire"] - 60:
                corps = urllib.parse.urlencode({"grant_type": "client_credentials", "scope": "all",
                                                "resource": "https://default.logto.app/api"}).encode()
                req = urllib.request.Request(f"{LOGTO_INTERNE}/oidc/token", corps)
                req.add_header("Authorization", "Basic " + base64.b64encode(f"{M2M_ID}:{M2M_SECRET}".encode()).decode())
                with urllib.request.urlopen(req, timeout=10) as r:
                    d = json.load(r)
                _m2m.update(jeton=d["access_token"], expire=time.time() + int(d.get("expires_in", 3600)))
            jeton = _m2m["jeton"]
        req = urllib.request.Request(f"{LOGTO_INTERNE}/api/users/{urllib.parse.quote(sub)}")
        req.add_header("Authorization", f"Bearer {jeton}")
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.load(r)
    except Exception as e:  # le profil reste utilisable sans e-mail, on réessaiera à la visite suivante
        print("Logto indisponible :", e, flush=True)
        return {}


# ---------------------------------------------------------------- routes

def iso(d: datetime | None) -> str | None:
    return d.astimezone(timezone.utc).isoformat() if d else None


def profil(u: Utilisateur) -> dict[str, Any]:
    return {"id": str(u.id), "email": u.email, "pseudo": u.pseudo, "photo": u.photo, "cree_le": iso(u.cree_le)}


@app.get("/")
def etat(s: Session = Depends(db)):
    n = s.scalar(select(func.count()).select_from(Utilisateur))
    return {"ok": True, "logto": LOGTO, "utilisateurs": n, "m2m": bool(M2M_ID)}


@app.get("/config")
def config():
    """Ce qu'il faut à l'appli pour ouvrir la page de connexion Logto (écrit par configurer-logto.py)."""
    try:
        with open(os.path.join(DOSSIER, "logto.json"), encoding="utf-8") as f:
            apps = json.load(f)
    except OSError:
        apps = {}
    return {"logto": LOGTO, "ressource": API, "applis": apps.get("applis", {}), "fournisseurs": apps.get("fournisseurs", [])}


def utilisateur(s: Session, j: dict[str, Any]) -> Utilisateur:
    """Le compte de l'appelant, créé à sa première visite (e-mail et nom repris de Logto)."""
    u = s.scalar(select(Utilisateur).where(Utilisateur.logto_id == j["sub"]))
    if u is None:
        u = Utilisateur(logto_id=j["sub"])
        s.add(u)
    if not u.email:
        fiche = logto_utilisateur(j["sub"])
        u.email = (fiche.get("primaryEmail") or "").lower() or None
        if not u.pseudo:
            u.pseudo = (fiche.get("name") or fiche.get("username") or (u.email or "").split("@")[0] or "")[:40]
        u.photo = u.photo or fiche.get("avatar")
    u.vu_le = maintenant()
    s.commit()
    return u


def moi_requis(j: dict = Depends(jeton_requis), s: Session = Depends(db)) -> Utilisateur:
    return utilisateur(s, j)


@app.get("/moi")
def moi(u: Utilisateur = Depends(moi_requis)):
    return profil(u)


class Changement(BaseModel):
    pseudo: str | None = Field(None, max_length=40)
    photo: str | None = Field(None, max_length=300_000)  # petite image en data: URL (JPEG ~ 256 px)


@app.put("/moi")
def changer_moi(ch: Changement, j: dict = Depends(jeton_requis), s: Session = Depends(db)):
    u = utilisateur(s, j)
    if ch.pseudo is not None:
        p = re.sub(r"\s+", " ", ch.pseudo).strip()
        if not p:
            raise HTTPException(422, "Le pseudo ne peut pas être vide")
        u.pseudo = p
    if ch.photo is not None:
        if ch.photo and not ch.photo.startswith(("data:image/", "https://")):
            raise HTTPException(422, "Photo : data:image/… ou https://… attendu")
        u.photo = ch.photo or None
    buddies.profil_change(s, u)
    s.commit()
    return profil(u)


# ---------------------------------------------------------------- Buddies (bloc 1)

class Synchro(BaseModel):
    ops: list[dict[str, Any]] = Field(default_factory=list, max_length=500)
    depuis: str | None = None


@app.post("/buddies/sync")
def buddies_sync(corps: Synchro, j: dict = Depends(jeton_requis), s: Session = Depends(db)):
    try:
        buddies.date(corps.depuis)
    except ValueError as e:
        raise HTTPException(422, "depuis : date ISO attendue") from e
    return buddies.synchroniser(s, utilisateur(s, j), corps.ops, corps.depuis)


def photo_visible(s: Session, j: dict, pid: str, taille: str):
    if taille not in buddies.TAILLES:
        raise HTTPException(404, "Taille inconnue")
    try:
        return buddies.photo_de(s, utilisateur(s, j), pid)
    except (buddies.Refus, ValueError) as e:
        raise HTTPException(404, "Photo inconnue") from e


@app.put("/buddies/photos/{pid}/{taille}")
async def envoyer_photo(pid: str, taille: str, req: Request, j: dict = Depends(jeton_requis), s: Session = Depends(db)):
    """Le fichier d'une photo annoncée par la synchro (seul l'auteur l'envoie ; renvoyer remplace)."""
    p = photo_visible(s, j, pid, taille)
    if p.par != utilisateur(s, j).id:
        raise HTTPException(403, "Seul l'auteur envoie sa photo")
    corps = await req.body()
    if len(corps) > buddies.TAILLES[taille] or not corps.startswith(b"\xff\xd8"):
        raise HTTPException(422, "JPEG attendu, trop gros ou illisible")
    os.makedirs(buddies.DOSSIER_PHOTOS, exist_ok=True)
    chemin = buddies.fichier_photo(p.id, taille)
    with open(chemin + ".tmp", "wb") as f:
        f.write(corps)
    os.replace(chemin + ".tmp", chemin)
    if taille == "grande" and not p.envoyee:
        p.envoyee = True
        p.modifie_le = maintenant()
        s.commit()
    return {"ok": True}


@app.get("/buddies/photos/{pid}/{taille}")
def lire_photo(pid: str, taille: str, j: dict = Depends(jeton_requis), s: Session = Depends(db)):
    p = photo_visible(s, j, pid, taille)
    try:
        with open(buddies.fichier_photo(p.id, taille), "rb") as f:
            # Une photo ne change jamais : le téléphone la garde.
            return Response(f.read(), media_type="image/jpeg", headers={"Cache-Control": "private, max-age=31536000, immutable"})
    except OSError as e:
        raise HTTPException(404, "Pas encore arrivée") from e


# ---------------------------------------------------------------- 📞 appels (bloc 10)

class UnAppareil(BaseModel):
    jeton: str = Field(min_length=20, max_length=400)
    plateforme: str = Field("android", max_length=20)


class Destination(BaseModel):
    groupe: str | None = None
    sortie: str | None = None


class Presence(BaseModel):
    en_ligne: bool


def refus(f):
    try:
        return f()
    except buddies.Refus as e:
        raise HTTPException(409, str(e)) from e
    except (ValueError, KeyError) as e:
        raise HTTPException(422, "Demande mal formée") from e


@app.post("/appareils")
def appareil(a: UnAppareil, j: dict = Depends(jeton_requis), s: Session = Depends(db)):
    appels.enregistrer_appareil(s, utilisateur(s, j), a.jeton, a.plateforme)
    return {"ok": True}


@app.post("/appels")
def appeler(d: Destination, j: dict = Depends(jeton_requis), s: Session = Depends(db)):
    u = utilisateur(s, j)
    return refus(lambda: appels.appeler(s, Sessions, u, d.groupe, d.sortie))


@app.post("/appels/{aid}/rejoindre")
def rejoindre_appel(aid: str, j: dict = Depends(jeton_requis), s: Session = Depends(db)):
    u = utilisateur(s, j)
    return refus(lambda: appels.rejoindre(s, u, aid))


@app.post("/appels/{aid}/presence")
def presence_appel(aid: str, p: Presence, j: dict = Depends(jeton_requis), s: Session = Depends(db)):
    u = utilisateur(s, j)
    return refus(lambda: appels.presence(s, Sessions, u, aid, p.en_ligne))


@app.get("/invitations/{code}")
def invitation(code: str, s: Session = Depends(db)):
    a = buddies.apercu_invitation(s, code)
    if a is None:
        raise HTTPException(404, "Invitation inconnue ou expirée")
    return a


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, proxy_headers=True, forwarded_allow_ips="*")
