"""
📞 Appels de groupe (spec/buddies.md §5.7, écrans 10 et 24).

- Le son passe par LiveKit, installé sur le VPS (installer-appels.sh) : ce serveur ne fait que donner à chaque buddy
  un jeton d'entrée dans la « salle » de l'appel (une salle par appel).
- Faire sonner : un message Firebase (FCM) prioritaire vers chaque téléphone des autres buddies ; le téléphone sonne
  même appli fermée. Sans clé Firebase sur le VPS, l'appel marche quand même, il ne sonne simplement pas.
- Un appel se termine quand plus personne n'est en ligne ; l'appelant qui raccroche avant toute réponse arrête les
  sonneries (message « fin »).
"""
from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from buddies import Refus, groupe_de, iso, participants, personne, sortie_de
from modeles import Appareil, Appel, Groupe, Membre, Utilisateur, maintenant

LIVEKIT_URL = os.environ.get("LIVEKIT_URL", "")
LIVEKIT_CLE = os.environ.get("LIVEKIT_CLE", "")
LIVEKIT_SECRET = os.environ.get("LIVEKIT_SECRET", "")
FIREBASE_CLE = os.environ.get("FIREBASE_CLE", "/data/firebase-cle.json")
# Un appel oublié (téléphones coupés sans raccrocher) se ferme seul.
DUREE_MAX = timedelta(hours=4)


def jeton_salle(salle: str, u: Utilisateur, duree: int = 6 * 3600) -> str:
    """Jeton d'entrée LiveKit (JWT HS256) : parler, écouter et montrer du doigt (données) dans cette salle seulement."""
    t = int(time.time())
    return jwt.encode({"iss": LIVEKIT_CLE, "sub": str(u.id), "name": personne(u)["pseudo"], "nbf": t - 10, "exp": t + duree,
                       "video": {"room": salle, "roomJoin": True, "canPublish": True, "canSubscribe": True, "canPublishData": True}},
                      LIVEKIT_SECRET, algorithm="HS256")


# ---------------------------------------------------------------- Firebase (sonnerie)

_google = {"jeton": "", "expire": 0.0}
_verrou = threading.Lock()


def _cle_firebase() -> dict[str, Any] | None:
    try:
        with open(FIREBASE_CLE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _jeton_google(cle: dict[str, Any]) -> str:
    with _verrou:
        if time.time() < _google["expire"] - 60:
            return _google["jeton"]
        t = int(time.time())
        assertion = jwt.encode({"iss": cle["client_email"], "scope": "https://www.googleapis.com/auth/firebase.messaging",
                                "aud": cle["token_uri"], "iat": t, "exp": t + 3600}, cle["private_key"], algorithm="RS256")
        corps = f"grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion={assertion}".encode()
        req = urllib.request.Request(cle["token_uri"], corps, {"Content-Type": "application/x-www-form-urlencoded"})
        with urllib.request.urlopen(req, timeout=10) as r:
            d = json.load(r)
        _google.update(jeton=d["access_token"], expire=time.time() + int(d.get("expires_in", 3600)))
        return _google["jeton"]


def envoyer_push(jetons: list[str], data: dict[str, str], ttl: str = "45s") -> list[str]:
    """Message Firebase prioritaire (« data » seulement : l'appli fait sonner elle-même). Rend les jetons périmés."""
    cle = _cle_firebase()
    if not cle or not jetons:
        return []
    perimes = []
    try:
        acces = _jeton_google(cle)
    except Exception as e:  # pas de sonnerie, l'appel marche quand même
        print("Firebase indisponible :", e, flush=True)
        return []
    for j in jetons:
        msg = {"message": {"token": j, "data": data, "android": {"priority": "HIGH", "ttl": ttl}}}
        req = urllib.request.Request(f"https://fcm.googleapis.com/v1/projects/{cle['project_id']}/messages:send",
                                     json.dumps(msg).encode(), {"Content-Type": "application/json", "Authorization": f"Bearer {acces}"})
        try:
            urllib.request.urlopen(req, timeout=10).close()
        except urllib.error.HTTPError as e:
            if e.code in (404, 400):
                perimes.append(j)
        except Exception as e:
            print("Envoi Firebase :", e, flush=True)
    return perimes


def sonner(Sessions, qui: list[uuid.UUID], data: dict[str, str], ttl: str = "45s") -> None:
    """En arrière-plan : la réponse à l'appelant n'attend pas Google."""
    def tache():
        with Sessions() as s:
            jetons = list(s.scalars(select(Appareil.jeton).where(Appareil.utilisateur_id.in_(qui))))
            for j in envoyer_push(jetons, data, ttl):
                a = s.get(Appareil, j)
                if a is not None:
                    s.delete(a)
            s.commit()
    threading.Thread(target=tache, daemon=True).start()


# ---------------------------------------------------------------- appels

def enregistrer_appareil(s: Session, u: Utilisateur, jeton: str, plateforme: str) -> None:
    a = s.get(Appareil, jeton)
    if a is None:
        s.add(Appareil(jeton=jeton, utilisateur_id=u.id, plateforme=plateforme[:20]))
    else:
        a.utilisateur_id, a.plateforme, a.modifie_le = u.id, plateforme[:20], maintenant()
    s.commit()


def destinataires(s: Session, u: Utilisateur, groupe: str | None, sortie: str | None) -> tuple[Groupe | None, Any, set[uuid.UUID], str]:
    """Qui sonne : les participants de la sortie, ou les membres du groupe (moi compris), et le nom à afficher."""
    if sortie:
        so = sortie_de(s, u, sortie)
        return None, so, participants(s, so), so.nom
    g = groupe_de(s, u, groupe)
    if g.nature == "me_time":
        raise Refus("Pas d'appel dans Me Time : appelle depuis une sortie")
    return g, None, set(s.scalars(select(Membre.utilisateur_id).where(Membre.groupe_id == g.id))), g.nom


def heure(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)  # SQLite rend des heures sans fuseau


def en_cours(s: Session, groupe_id, sortie_id) -> Appel | None:
    a = s.scalar(select(Appel).where(Appel.fin.is_(None), Appel.groupe_id == groupe_id if groupe_id else Appel.sortie_id == sortie_id)
                 .order_by(Appel.debut.desc()))
    if a is not None and heure(a.debut) < maintenant() - DUREE_MAX:
        a.fin = maintenant()
        return None
    return a


def appeler(s: Session, Sessions, u: Utilisateur, groupe: str | None, sortie: str | None) -> dict[str, Any]:
    """📞 Appeler (ou rejoindre l'appel déjà en cours, sans refaire sonner)."""
    if not (LIVEKIT_URL and LIVEKIT_CLE and LIVEKIT_SECRET):
        raise Refus("Les appels ne sont pas encore installés sur le serveur")
    g, so, qui, nom = destinataires(s, u, groupe, sortie)
    if u.id not in qui:
        raise Refus("Seuls les buddies de la sortie appellent")
    a = en_cours(s, g.id if g else None, so.id if so else None)
    nouveau = a is None
    if nouveau:
        a = Appel(groupe_id=g.id if g else None, sortie_id=so.id if so else None, par=u.id)
        s.add(a)
    s.commit()
    if nouveau:
        sonner(Sessions, [x for x in qui if x != u.id], {
            "type": "appel", "appel": str(a.id), "de": personne(u)["pseudo"], "nom": nom,
            "groupe": str(g.id) if g else "", "sortie": str(so.id) if so else "", "envoye_le": str(int(time.time() * 1000))})
    return vue_appel(s, a) | {"url": LIVEKIT_URL, "jeton": jeton_salle(str(a.id), u), "nouveau": nouveau}


def appel_de(s: Session, u: Utilisateur, aid: str) -> tuple[Appel, set[uuid.UUID]]:
    a = s.get(Appel, uuid.UUID(aid))
    if a is None:
        raise Refus("Appel inconnu")
    _, _, qui, _ = destinataires(s, u, str(a.groupe_id) if a.groupe_id else None, str(a.sortie_id) if a.sortie_id else None)
    if u.id not in qui:
        raise Refus("Appel inconnu")
    return a, qui


def rejoindre(s: Session, u: Utilisateur, aid: str) -> dict[str, Any]:
    """Décrocher : le jeton d'entrée dans la salle (l'appel est peut-être déjà fini)."""
    a, _ = appel_de(s, u, aid)
    if a.fin is not None:
        raise Refus("L'appel est terminé")
    return vue_appel(s, a) | {"url": LIVEKIT_URL, "jeton": jeton_salle(str(a.id), u)}


def presence(s: Session, Sessions, u: Utilisateur, aid: str, en_ligne: bool) -> dict[str, Any]:
    """Le téléphone dit quand il entre et quand il raccroche. Plus personne : l'appel est fini (et ne sonne plus)."""
    a, qui = appel_de(s, u, aid)
    ids = [x for x in json.loads(a.en_ligne) if x != str(u.id)]
    if en_ligne and a.fin is None:
        ids.append(str(u.id))
    a.en_ligne = json.dumps(ids)
    if not ids and a.fin is None and not en_ligne:
        a.fin = maintenant()
        sonner(Sessions, [x for x in qui if x != u.id], {"type": "fin", "appel": str(a.id)})
    s.commit()
    return vue_appel(s, a)


def appels_en_cours(s: Session, gids: list[uuid.UUID], sids: list[uuid.UUID]) -> list[dict[str, Any]]:
    """Pour la synchro : les appels en cours dans mes groupes et sorties (« rejoindre l'appel »)."""
    l = s.scalars(select(Appel).where(Appel.fin.is_(None), Appel.debut > maintenant() - DUREE_MAX,
                                      or_(Appel.groupe_id.in_(gids), Appel.sortie_id.in_(sids)))).all()
    return [vue_appel(s, a) for a in l]


def vue_appel(s: Session, a: Appel) -> dict[str, Any]:
    return {"id": str(a.id), "groupe": str(a.groupe_id) if a.groupe_id else None, "sortie": str(a.sortie_id) if a.sortie_id else None,
            "par": str(a.par), "en_ligne": json.loads(a.en_ligne), "debut": iso(a.debut), "fini": a.fin is not None}

