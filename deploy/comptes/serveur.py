"""
Serveur des comptes Mountain Buddies (tourne sur le VPS, voir deploy/comptes/README.md).

Qui fait quoi :
- Logto (https://auth.silvaplana.cloud) gère la connexion : code par e-mail, Google, Apple. Il délivre
  aux applis un jeton d'accès (JWT signé) pour l'API https://silvaplana.cloud/mountaintest-api.
- Ce serveur vérifie ce jeton (signature, émetteur, destinataire, expiration) puis gère les données :
  profils, et ensuite groupes d'amis et invitations (tables déjà créées pour structurer la suite).

Hors ligne : l'appli ne dépend jamais de ce serveur pour s'ouvrir ; elle garde son profil sur le
téléphone et rejoue ici ce qu'elle a fait sans réseau (identifiants UUID choisis par le téléphone).

Routes (préfixe /api, ou l ancien /mountaintest-api, retiré par le gateway Caddy) :
  GET  /         état du serveur
  GET  /config   adresse de Logto et identifiants des applis (lu au moment de se connecter)
  GET  /moi      mon profil (créé à la première visite, e-mail repris de Logto)
  PUT  /moi      changer mon pseudo / ma photo
  POST /buddies/sync          Buddies : envoyer ce que le téléphone a fait, recevoir les nouveautés (buddies.py)
  POST /buddies/ecrit         « écrit… » dans une conversation (gardé 12 s en mémoire)
  POST /ouverture            l'appli vient d'être ouverte (jours et ouvertures, plateforme, version)
  GET  /telecharger           compte un téléchargement puis renvoie vers l'APK (page publique)
  GET  /super/utilisateurs    Super User : téléchargements, comptes et leur usage
  GET  /invitations/{code}    aperçu d'une invitation pour la page du lien (sans connexion)
  PUT  /buddies/photos/{id}/{petite|grande}   envoyer le JPEG d'une photo de l'album (annoncée par la synchro)
  GET  /buddies/photos/{id}/{petite|grande}   la lire (participants de la sortie)
  PUT  /buddies/photos/{id}/video             le film d'un survol 3D (MP4 ou WebM) ; GET : le lire
  PUT  /buddies/fichiers/{id} envoyer le fichier joint à un message (annoncé par la synchro) ; GET : le lire
  POST /appareils             📞 le jeton Firebase de ce téléphone (pour sonner)
  POST /appels                📞 appeler un groupe ou une sortie (ou rejoindre l'appel en cours) (appels.py)
  POST /appels/{id}/rejoindre décrocher ; POST /appels/{id}/presence  entrer / raccrocher
"""
from __future__ import annotations

import base64
import json
import os
import re
import threading
import time
import uuid
import urllib.parse
import urllib.request
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, func, inspect, select, text
from sqlalchemy.orm import Session, sessionmaker

import appels
import buddies
import droits
import mails
from modeles import Base, Groupe, Membre, Telechargement, Usage, Utilisateur, maintenant
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
    roles_de_groupe()
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
    ("invitations", "mail", "VARCHAR(10)"),
    ("messages_buddies", "bud", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("messages_buddies", "repond_a", "UUID"),
    ("messages_buddies", "edite_le", "TIMESTAMP WITH TIME ZONE"),
    ("messages_buddies", "supprime", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("messages_buddies", "fichier_id", "UUID"),
    ("messages_buddies", "sondage", "TEXT"),
    ("messages_buddies", "transfere", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("photos", "video", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("sorties", "supprime_le", "TIMESTAMP WITH TIME ZONE"),
    ("groupes", "supprime_le", "TIMESTAMP WITH TIME ZONE"),
    ("depenses", "remb", "VARCHAR(10)"),
    ("depenses", "moyen", "VARCHAR(10)"),
    ("utilisateurs", "super_user", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("utilisateurs", "scan25", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("utilisateurs", "prenom", "VARCHAR(100) NOT NULL DEFAULT ''"),
    ("utilisateurs", "nom", "VARCHAR(100) NOT NULL DEFAULT ''"),
    ("utilisateurs", "telephone", "VARCHAR(50)"),
    ("utilisateurs", "iban", "VARCHAR(34)"),
    ("utilisateurs", "wero", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("utilisateurs", "wero_numero", "VARCHAR(100)"),
    ("groupes", "organisation_id", "UUID REFERENCES organisations(id) ON DELETE SET NULL"),
    ("depenses", "count_id", "UUID REFERENCES buddy_counts(id) ON DELETE CASCADE"),
    ("utilisateurs", "telephone_octets", "BIGINT"),
    ("utilisateurs", "telephone_le", "TIMESTAMP WITH TIME ZONE"),
    ("utilisateurs", "supprime_le", "TIMESTAMP WITH TIME ZONE"),
    ("utilisateurs", "plateforme", "VARCHAR(10)"),
    ("utilisateurs", "version", "VARCHAR(20)"),
]


def roles_de_groupe():
    """Rôle admin_principal dans les Groupes (spec/buddies.md §7.17, 26 novembre) : on élargit la colonne et sa
    contrainte (Postgres), puis chaque Groupe qui n'en a pas reçoit le sien : son créateur s'il en est encore
    admin, sinon l'admin le plus ancien, sinon le membre le plus ancien."""
    with moteur.begin() as c:
        if "membres" not in inspect(c).get_table_names():
            return
        if c.dialect.name == "postgresql":
            role = next(x for x in inspect(c).get_columns("membres") if x["name"] == "role")
            if getattr(role["type"], "length", 16) < 16:
                c.execute(text("ALTER TABLE membres DROP CONSTRAINT IF EXISTS membres_role"))
                c.execute(text("ALTER TABLE membres ALTER COLUMN role TYPE VARCHAR(16)"))
                c.execute(text("ALTER TABLE membres ADD CONSTRAINT membres_role "
                               "CHECK (role in ('admin_principal', 'admin', 'membre'))"))
    with Sessions() as s:
        avec = select(Membre.groupe_id).where(Membre.role == "admin_principal")
        for g in s.scalars(select(Groupe).where(Groupe.nature != "duo", Groupe.id.not_in(avec))).all():
            ms = s.scalars(select(Membre).where(Membre.groupe_id == g.id).order_by(Membre.rejoint_le)).all()
            createur = [m for m in ms if m.utilisateur_id == g.cree_par and m.role == "admin"]
            admins = [m for m in ms if m.role == "admin"]
            choix = (createur or admins or ms or [None])[0]
            if choix is not None:
                choix.role = "admin_principal"
        s.commit()


def ajouter_colonnes():
    with moteur.begin() as c:
        tables = set(inspect(c).get_table_names())
        for table, colonne, sql in COLONNES_AJOUTEES:
            if table in tables and colonne not in {x["name"] for x in inspect(c).get_columns(table)}:
                c.execute(text(f"ALTER TABLE {table} ADD COLUMN {colonne} {sql}"))
        # Buddy counts de groupe (§7.20) : une dépense n'a plus forcément de sortie (Postgres sur le VPS).
        if c.dialect.name == "postgresql" and "depenses" in tables and next(
                x for x in inspect(c).get_columns("depenses") if x["name"] == "sortie_id")["nullable"] is False:
            c.execute(text("ALTER TABLE depenses ALTER COLUMN sortie_id DROP NOT NULL"))


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
    """Mon profil (à moi seul : téléphone et IBAN ne partent jamais chez les autres)."""
    return {"id": str(u.id), "email": u.email, "pseudo": u.pseudo, "photo": u.photo, "cree_le": iso(u.cree_le),
            "prenom": u.prenom, "nom": u.nom, "telephone": u.telephone, "iban": u.iban,
            "wero": u.wero, "wero_numero": u.wero_numero, "super_user": u.super_user}


def normaliser_iban(iban: str | None) -> str | None:
    """Sans espaces, en majuscules, clé de contrôle vérifiée (ISO 13616) : la même règle qu'AppBase."""
    texte = "".join((iban or "").split()).upper()
    if not texte:
        return None
    if not (15 <= len(texte) <= 34 and texte[:2].isalpha() and texte[2:4].isdigit() and texte.isalnum()):
        raise HTTPException(422, "Cet IBAN n'a pas la bonne forme (ex. FR76 3000 6000 0112 3456 7890 189).")
    if int("".join(str(int(c, 36)) for c in texte[4:] + texte[:4])) % 97 != 1:
        raise HTTPException(422, "Cet IBAN est incorrect : un caractère est sans doute mal recopié.")
    return texte


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


# ---------------------------------------------------------------- 💾 place prise (calque Hors ligne, Seb 26/11)

def _taille(chemin: str) -> int:
    try:
        return os.path.getsize(chemin)
    except OSError:
        return 0


def place_serveur(s: Session) -> dict[uuid.UUID, dict[str, int]]:
    """Octets pris sur le serveur par chacun : photos et films de l'album, fichiers joints aux messages,
    et ses données dans la base (traces partagées, messages), comptées à la longueur du texte."""
    place: dict[uuid.UUID, dict[str, int]] = {}
    def de(qui):
        return place.setdefault(qui, {"photos": 0, "fichiers": 0, "donnees": 0})
    for pid, par, video in s.execute(select(buddies.Photo.id, buddies.Photo.par, buddies.Photo.video)):
        de(par)["photos"] += sum(_taille(buddies.fichier_photo(pid, t)) for t in (("petite", "grande", "video") if video else ("petite", "grande")))
    for fid, par in s.execute(select(buddies.FichierBuddy.id, buddies.FichierBuddy.par).where(buddies.FichierBuddy.envoye)):
        de(par)["fichiers"] += _taille(os.path.join(buddies.DOSSIER_FICHIERS, str(fid)))
    for par, n in s.execute(select(buddies.TracePartagee.par, func.sum(func.length(buddies.TracePartagee.ligne))).group_by(buddies.TracePartagee.par)):
        de(par)["donnees"] += int(n or 0)
    for par, n in s.execute(select(buddies.MessageBuddy.par, func.sum(func.length(buddies.MessageBuddy.texte))).group_by(buddies.MessageBuddy.par)):
        de(par)["donnees"] += int(n or 0)
    return place


class PlaceTelephone(BaseModel):
    octets: int = Field(ge=0, le=10**13)


@app.put("/stockage/telephone")
def noter_place_telephone(p: PlaceTelephone, u: Utilisateur = Depends(moi_requis), s: Session = Depends(db)):
    """Le téléphone dit la place que prend l'appli chez lui (le Super User la voit pour tout le monde)."""
    u = s.merge(u)
    u.telephone_octets = p.octets
    u.telephone_le = maintenant()
    s.commit()
    return {"ok": True}


@app.get("/stockage")
def stockage(u: Utilisateur = Depends(moi_requis), s: Session = Depends(db)):
    """Ma place sur le serveur par nature ; le Super User a en plus celle de chacun (serveur et téléphone)."""
    place = place_serveur(s)
    vide = {"photos": 0, "fichiers": 0, "donnees": 0}
    r: dict[str, Any] = {"moi": place.get(u.id, vide)}
    if droits.est_super_user(u):
        r["tous"] = sorted(({"pseudo": x.pseudo or (x.email or "").split("@")[0], **place.get(x.id, vide),
                             "telephone": x.telephone_octets, "telephone_le": x.telephone_le.isoformat() if x.telephone_le else None}
                            for x in s.scalars(select(Utilisateur))),
                           key=lambda d: -(d["photos"] + d["fichiers"] + d["donnees"] + (d["telephone"] or 0)))
    return r


class Changement(BaseModel):
    pseudo: str | None = Field(None, max_length=40)
    photo: str | None = Field(None, max_length=300_000)  # petite image en data: URL (JPEG ~ 256 px)
    prenom: str | None = Field(None, max_length=100)
    nom: str | None = Field(None, max_length=100)
    telephone: str | None = Field(None, max_length=50)  # texte libre, vide = effacé
    iban: str | None = Field(None, max_length=60)  # vide = effacé
    wero: bool | None = None
    wero_numero: str | None = Field(None, max_length=100)  # vide = le portable du profil


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
    if ch.prenom is not None:
        u.prenom = re.sub(r"\s+", " ", ch.prenom).strip()
    if ch.nom is not None:
        u.nom = re.sub(r"\s+", " ", ch.nom).strip()
    if ch.telephone is not None:
        u.telephone = ch.telephone.strip() or None
    if ch.iban is not None:
        u.iban = normaliser_iban(ch.iban)
    if ch.wero is not None:
        u.wero = ch.wero
    if ch.wero_numero is not None:
        u.wero_numero = re.sub(r"\s+", " ", ch.wero_numero).strip() or None
    buddies.profil_change(s, u)
    s.commit()
    return profil(u)


def logto_supprimer(sub: str) -> None:
    """Efface la personne chez Logto (son e-mail, ses connexions Google) ; sans accès de gestion, rien."""
    if not (M2M_ID and M2M_SECRET) or not logto_utilisateur(sub):  # logto_utilisateur renouvelle le jeton
        return
    try:
        req = urllib.request.Request(f"{LOGTO_INTERNE}/api/users/{urllib.parse.quote(sub)}", method="DELETE")
        req.add_header("Authorization", f"Bearer {_m2m['jeton']}")
        urllib.request.urlopen(req, timeout=10).close()
    except Exception as e:
        print("Logto : suppression impossible :", e, flush=True)


@app.delete("/moi")
def supprimer_moi(j: dict = Depends(jeton_requis), s: Session = Depends(db)):
    """Supprimer mon compte (exigé par le Play Store) : voir buddies.supprimer_compte pour ce qui part et ce qui reste."""
    u = utilisateur(s, j)
    buddies.supprimer_compte(s, u)
    s.commit()
    logto_supprimer(j["sub"])
    return {"ok": True}


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
    u = utilisateur(s, j)
    r = buddies.synchroniser(s, u, corps.ops, corps.depuis)
    # 🔔 Nouveaux messages : une notification aux autres (en arrière-plan, sans clé Firebase : rien).
    for qui, data in buddies.a_prevenir(s, u, s.info.pop("nouveaux_messages", [])):
        appels.sonner(Sessions, qui, data, ttl="86400s")
    # 💶 Paiements, traces et photos partagées (buddies.prevenir) : même forme qu'un message.
    for qui, data in s.info.pop("a_prevenir", []):
        appels.sonner(Sessions, qui, data, ttl="86400s")
    # ✉ Invitations par mail : envoyées par Brevo après l'enregistrement (en arrière-plan).
    if mails_ := s.info.pop("mails", []):
        mails.en_arriere_plan(lambda: buddies.envoyer_mails(Sessions, mails_))
    return r


class Ecrit(BaseModel):
    cle: str


@app.post("/buddies/ecrit")
def buddies_ecrit(corps: Ecrit, j: dict = Depends(jeton_requis), s: Session = Depends(db)):
    """« écrit… » : je tape dans cette conversation (les autres le voient à leur prochaine synchro, 12 s au plus)."""
    try:
        buddies.ecrit(s, utilisateur(s, j), corps.cle)
    except (buddies.Refus, ValueError) as e:
        raise HTTPException(404, "Conversation inconnue") from e
    return {"ok": True}


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
    if taille == "video":
        if not p.video or len(corps) > buddies.TAILLES[taille] or not buddies.format_video(corps):
            raise HTTPException(422, "Film MP4 ou WebM attendu, trop gros ou illisible")
    elif len(corps) > buddies.TAILLES[taille] or not corps.startswith(b"\xff\xd8"):
        raise HTTPException(422, "JPEG attendu, trop gros ou illisible")
    os.makedirs(buddies.DOSSIER_PHOTOS, exist_ok=True)
    chemin = buddies.fichier_photo(p.id, taille)
    with open(chemin + ".tmp", "wb") as f:
        f.write(corps)
    os.replace(chemin + ".tmp", chemin)
    # Arrivée : la grande image d'une photo, le film d'une vidéo.
    if taille == ("video" if p.video else "grande") and not p.envoyee:
        p.envoyee = True
        p.modifie_le = maintenant()
        s.commit()
    return {"ok": True}


@app.get("/buddies/photos/{pid}/{taille}")
def lire_photo(pid: str, taille: str, j: dict = Depends(jeton_requis), s: Session = Depends(db)):
    p = photo_visible(s, j, pid, taille)
    try:
        with open(buddies.fichier_photo(p.id, taille), "rb") as f:
            corps = f.read()
            # Une photo ne change jamais : le téléphone la garde.
            return Response(corps, media_type=(buddies.format_video(corps) or "video/mp4") if taille == "video" else "image/jpeg",
                            headers={"Cache-Control": "private, max-age=31536000, immutable"})
    except OSError as e:
        raise HTTPException(404, "Pas encore arrivée") from e


def fichier_du_message(s: Session, j: dict, fid: str):
    try:
        f = s.get(buddies.FichierBuddy, uuid.UUID(fid))
    except ValueError as e:
        raise HTTPException(404, "Fichier inconnu") from e
    u = utilisateur(s, j)
    if f is None or (f.par != u.id and not buddies.fichier_lisible(s, u, f.id)):
        raise HTTPException(404, "Fichier inconnu")
    return f, u


@app.put("/buddies/fichiers/{fid}")
async def envoyer_fichier(fid: str, req: Request, j: dict = Depends(jeton_requis), s: Session = Depends(db)):
    """Le fichier joint à un message (§7.13), annoncé par la synchro ; seul l'auteur l'envoie, renvoyer remplace."""
    f, u = fichier_du_message(s, j, fid)
    if f.par != u.id:
        raise HTTPException(403, "Seul l'auteur envoie son fichier")
    os.makedirs(buddies.DOSSIER_FICHIERS, exist_ok=True)
    chemin = os.path.join(buddies.DOSSIER_FICHIERS, str(f.id))
    n = 0
    with open(chemin + ".tmp", "wb") as sortie:
        async for bout in req.stream():
            n += len(bout)
            if n > min(f.taille, buddies.max_fichier(f.mime)):
                sortie.close()
                os.remove(chemin + ".tmp")
                raise HTTPException(413, "Plus gros qu'annoncé")
            sortie.write(bout)
    os.replace(chemin + ".tmp", chemin)
    if not f.envoye:
        f.envoye = True
        for m in s.scalars(select(buddies.MessageBuddy).where(buddies.MessageBuddy.fichier_id == f.id)):
            m.modifie_le = maintenant()
        s.commit()
    return {"ok": True}


@app.get("/buddies/fichiers/{fid}")
def lire_fichier(fid: str, j: dict = Depends(jeton_requis), s: Session = Depends(db)):
    f, _ = fichier_du_message(s, j, fid)
    chemin = os.path.join(buddies.DOSSIER_FICHIERS, str(f.id))
    if not os.path.exists(chemin):
        raise HTTPException(404, "Pas encore arrivé")
    return FileResponse(chemin, media_type=f.mime, filename=f.nom, headers={"Cache-Control": "private, max-age=31536000, immutable"})


# ---------------------------------------------------------------- 📞 appels (bloc 10)

class AmiAInviter(BaseModel):
    nom: str = Field("", max_length=80)
    email: str = Field(min_length=3, max_length=320)


@app.post("/inviter-appli")
def inviter_appli(a: AmiAInviter, j: dict = Depends(jeton_requis), s: Session = Depends(db)):
    """Profil › Inviter un ami : un mail pour installer Mountain Buddies, sans groupe (Seb, 26/11)."""
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", a.email.strip()):
        raise HTTPException(409, "Adresse e-mail invalide")
    u = utilisateur(s, j)
    try:
        mails.appli(a.email.strip(), a.nom.strip(), buddies.personne(u)["pseudo"], repondre_a=u.email)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(409, "Le mail n'est pas parti, réessaie plus tard") from e
    return {"ok": True}


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


class Ouverture(BaseModel):
    plateforme: str = Field("web", pattern="^(apk|play|web)$")
    version: str | None = Field(None, max_length=20)


@app.post("/ouverture")
def ouverture(o: Ouverture, u: Utilisateur = Depends(moi_requis), s: Session = Depends(db)):
    """L'appli vient d'être ouverte (ou rouverte après un long moment) : +1 ouverture aujourd'hui."""
    u = s.merge(u)
    u.plateforme, u.version = o.plateforme, o.version
    jour = maintenant().date()
    us = s.get(Usage, (u.id, jour)) or s.merge(Usage(utilisateur_id=u.id, jour=jour, ouvertures=0))
    us.ouvertures += 1
    s.commit()
    return {"ok": True}


LIEN_APK = os.environ.get("LIEN_APK", "https://mountainbuddies.silvaplana.cloud/app/apk/mountain-buddies-capacitor.apk")


@app.get("/telecharger")
def telecharger(s: Session = Depends(db)):
    """Bouton « Télécharger » de la page publique : +1 aujourd'hui, puis le fichier APK."""
    jour = maintenant().date()
    t = s.get(Telechargement, jour) or s.merge(Telechargement(jour=jour, nombre=0))
    t.nombre += 1
    s.commit()
    return RedirectResponse(LIEN_APK, status_code=302)


@app.get("/super/utilisateurs")
def super_utilisateurs(u: Utilisateur = Depends(moi_requis), s: Session = Depends(db)):
    """Onglet Utilisateurs du Super User (Seb, 27/11) : téléchargements, puis chaque compte avec son usage."""
    if not droits.est_super_user(u):
        raise HTTPException(403, "Réservé au Super User")
    semaine = maintenant().date() - timedelta(days=6)
    mois = maintenant().date() - timedelta(days=29)
    tel = {"total": int(s.scalar(select(func.coalesce(func.sum(Telechargement.nombre), 0)))),
           "semaine": int(s.scalar(select(func.coalesce(func.sum(Telechargement.nombre), 0)).where(Telechargement.jour >= semaine)))}
    usages: dict[uuid.UUID, list[Usage]] = {}
    for x in s.scalars(select(Usage).order_by(Usage.jour)):
        usages.setdefault(x.utilisateur_id, []).append(x)
    groupes: dict[uuid.UUID, list[str]] = {}
    for uid, nom in s.execute(select(Membre.utilisateur_id, Groupe.nom).join(Groupe, Groupe.id == Membre.groupe_id)
                              .where(Groupe.nature == "bande", Groupe.supprime_le.is_(None), Groupe.nom != "")):
        groupes.setdefault(uid, []).append(nom)
    comptes = []
    for x in s.scalars(select(Utilisateur).where(Utilisateur.supprime_le.is_(None)).order_by(Utilisateur.vu_le.desc())):
        l = usages.get(x.id, [])
        comptes.append({"id": str(x.id), "pseudo": x.pseudo or (x.email or "").split("@")[0], "email": x.email, "photo": x.photo,
                        "cree_le": iso(x.cree_le), "vu_le": iso(x.vu_le), "plateforme": x.plateforme, "version": x.version,
                        "jours": len(l), "ouvertures": sum(y.ouvertures for y in l), "groupes": sorted(groupes.get(x.id, [])),
                        "par_jour": {y.jour.isoformat(): y.ouvertures for y in l if y.jour >= mois}})
    return {"telechargements": tel, "comptes": comptes,
            "semaine": sum(1 for c in comptes if c["vu_le"] and c["vu_le"][:10] >= semaine.isoformat())}


@app.get("/invitations/{code}")
def invitation(code: str, s: Session = Depends(db)):
    a = buddies.apercu_invitation(s, code)
    if a is None:
        raise HTTPException(404, "Invitation inconnue ou expirée")
    return a


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, proxy_headers=True, forwarded_allow_ips="*")
