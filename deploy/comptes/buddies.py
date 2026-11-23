"""Buddies, bloc 1 (spec/buddies.md §3.1, §5.2, §5.3) : Buddy Groups, Me Time, invitations, synchro.

Synchro « envoyer / nouveautés depuis » : le téléphone envoie d'un coup tout ce qu'il a fait (hors ligne ou
pas), puis reçoit les Buddy Groups qui ont changé depuis sa dernière synchro. Chaque opération est rejouable
sans risque (identifiants choisis par le téléphone) : si la réponse se perd, le téléphone renvoie tout et
rien n'est fait deux fois. Une opération refusée (droits, lien expiré) revient dans `refus` et le téléphone
l'oublie, pour que sa file d'attente ne reste jamais bloquée.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from modeles import Groupe, Invitation, Membre, Utilisateur, maintenant

DUREE_INVITATION = timedelta(days=30)
CANAUX = {"sms", "mail", "contacts", "qr", "lien"}
# Me Time : un par personne, même identifiant sur tous ses téléphones.
ESPACE_ME_TIME = uuid.UUID("6f0c2f7e-5b8f-4a43-9a2e-0c1f6d2b7d11")
# Marge sur « depuis » : une écriture en cours au moment de la lecture n'est pas manquée (renvoyer deux fois
# un groupe ne coûte rien, le téléphone le remplace).
MARGE = timedelta(seconds=5)


class Refus(Exception):
    pass


def iso(d: datetime | None) -> str | None:
    if d is None:
        return None
    if d.tzinfo is None:  # SQLite rend des dates sans fuseau
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc).isoformat()


def date(t: str | None) -> datetime | None:
    if not t:
        return None
    d = datetime.fromisoformat(t)
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def propre(t: Any, n: int) -> str:
    return re.sub(r"\s+", " ", str(t or "")).strip()[:n]


def photo_valide(p: Any) -> str | None:
    if not p:
        return None
    p = str(p)
    if len(p) > 300_000 or not p.startswith("data:image/"):
        raise Refus("Photo : petite image data:image/… attendue")
    return p


def me_time(s: Session, u: Utilisateur) -> Groupe:
    """Le Me Time de la personne, créé à la première synchro."""
    gid = uuid.uuid5(ESPACE_ME_TIME, str(u.id))
    g = s.get(Groupe, gid)
    if g is None:
        g = Groupe(id=gid, nom="Me Time", nature="me_time", cree_par=u.id)
        s.add(g)
        s.flush()
        s.add(Membre(groupe_id=gid, utilisateur_id=u.id, role="admin"))
        s.flush()
    return g


def membre(s: Session, gid: uuid.UUID, uid: uuid.UUID) -> Membre | None:
    return s.get(Membre, (gid, uid))


def toucher(g: Groupe) -> None:
    g.modifie_le = maintenant()


def groupe_de(s: Session, u: Utilisateur, gid: Any, admin: bool = False) -> Groupe:
    g = s.get(Groupe, uuid.UUID(str(gid)))
    m = membre(s, g.id, u.id) if g else None
    if g is None or m is None:
        raise Refus("Buddy Group inconnu")
    if admin and m.role != "admin":
        raise Refus("Réservé aux admins du Buddy Group")
    return g


# ------------------------------------------------------------------ opérations

def creer_groupe(s: Session, u: Utilisateur, op: dict) -> None:
    gid = uuid.UUID(str(op["groupe"]))
    if s.get(Groupe, gid) is not None:
        return  # déjà reçue
    nom = propre(op.get("nom"), 80)
    if not nom:
        raise Refus("Il faut un nom")
    s.add(Groupe(id=gid, nom=nom, nature="bande", photo=photo_valide(op.get("photo")), cree_par=u.id))
    s.flush()
    s.add(Membre(groupe_id=gid, utilisateur_id=u.id, role="admin"))


def inviter(s: Session, u: Utilisateur, op: dict) -> None:
    iid = uuid.UUID(str(op["invitation"]))
    if s.get(Invitation, iid) is not None:
        return
    g = groupe_de(s, u, op["groupe"])
    if g.nature != "bande":
        raise Refus("On invite dans un Buddy Group")
    code = str(op.get("code") or "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{16,32}", code):
        raise Refus("Code d'invitation invalide")
    canal = op.get("canal") if op.get("canal") in CANAUX else "lien"
    contact = propre(op.get("contact"), 320)
    s.add(Invitation(id=iid, code=code, groupe_id=g.id, invite_par=u.id, canal=canal, nom=propre(op.get("nom"), 80),
                     contact=contact, email=contact.lower() if canal == "mail" else None,
                     expire_le=maintenant() + DUREE_INVITATION))
    toucher(g)


def rejoindre(s: Session, u: Utilisateur, op: dict) -> None:
    inv = s.scalar(select(Invitation).where(Invitation.code == str(op.get("code") or "")))
    if inv is None or inv.groupe_id is None:
        raise Refus("Invitation inconnue")
    if membre(s, inv.groupe_id, u.id) is not None:
        return  # déjà dans le groupe (opération renvoyée)
    if date(iso(inv.expire_le)) < maintenant():
        raise Refus("Invitation expirée : demande un nouveau lien")
    s.add(Membre(groupe_id=inv.groupe_id, utilisateur_id=u.id, role="membre"))
    if inv.acceptee_par is None and inv.canal != "qr":
        inv.acceptee_par = u.id
    toucher(s.get(Groupe, inv.groupe_id))


def quitter(s: Session, u: Utilisateur, op: dict) -> None:
    g = s.get(Groupe, uuid.UUID(str(op["groupe"])))
    m = membre(s, g.id, u.id) if g else None
    if m is None:
        return  # déjà parti
    if g.nature == "me_time":
        raise Refus("On ne quitte pas son Me Time")
    partir(s, g, m)


def retirer(s: Session, u: Utilisateur, op: dict) -> None:
    g = groupe_de(s, u, op["groupe"], admin=True)
    m = membre(s, g.id, uuid.UUID(str(op["buddy"])))
    if m is not None:
        partir(s, g, m)


def nommer_admin(s: Session, u: Utilisateur, op: dict) -> None:
    g = groupe_de(s, u, op["groupe"], admin=True)
    m = membre(s, g.id, uuid.UUID(str(op["buddy"])))
    if m is not None and m.role != "admin":
        m.role = "admin"
        toucher(g)


def annuler_invitation(s: Session, u: Utilisateur, op: dict) -> None:
    inv = s.get(Invitation, uuid.UUID(str(op["invitation"])))
    if inv is None:
        return
    g = groupe_de(s, u, inv.groupe_id)
    s.delete(inv)
    toucher(g)


def partir(s: Session, g: Groupe, m: Membre) -> None:
    """Un membre s'en va ; le groupe garde toujours un admin, et disparaît s'il est vide."""
    s.delete(m)
    s.flush()
    restants = s.scalars(select(Membre).where(Membre.groupe_id == g.id).order_by(Membre.rejoint_le)).all()
    if not restants:
        s.delete(g)
        return
    if not any(r.role == "admin" for r in restants):
        restants[0].role = "admin"
    toucher(g)


OPERATIONS = {
    "creer_groupe": creer_groupe, "inviter": inviter, "rejoindre": rejoindre, "quitter": quitter,
    "retirer": retirer, "nommer_admin": nommer_admin, "annuler_invitation": annuler_invitation,
}


# ------------------------------------------------------------------ synchro

def personne(u: Utilisateur) -> dict[str, Any]:
    return {"id": str(u.id), "pseudo": u.pseudo or (u.email or "").split("@")[0], "photo": u.photo}


def vue_groupe(s: Session, g: Groupe) -> dict[str, Any]:
    membres = s.execute(select(Membre, Utilisateur).join(Utilisateur, Utilisateur.id == Membre.utilisateur_id)
                        .where(Membre.groupe_id == g.id).order_by(Membre.rejoint_le)).all()
    invitations = s.scalars(select(Invitation).where(Invitation.groupe_id == g.id, Invitation.acceptee_par.is_(None),
                                                     Invitation.expire_le > maintenant())
                            .order_by(Invitation.cree_le)).all()
    return {
        "id": str(g.id), "nom": g.nom, "nature": g.nature, "photo": g.photo, "modifie_le": iso(g.modifie_le),
        "membres": [{**personne(u), "role": m.role} for m, u in membres],
        "invitations": [{"id": str(i.id), "code": i.code, "canal": i.canal, "nom": i.nom, "contact": i.contact,
                         "par": str(i.invite_par)} for i in invitations],
    }


def synchroniser(s: Session, u: Utilisateur, ops: list[dict], depuis: str | None) -> dict[str, Any]:
    debut = maintenant()
    me_time(s, u)
    refus = []
    for op in ops:
        f = OPERATIONS.get(str(op.get("type")))
        try:
            if f is None:
                raise Refus("Opération inconnue")
            with s.begin_nested():
                f(s, u, op)
        except (Refus, KeyError, ValueError) as e:
            refus.append({"id": op.get("id"), "raison": str(e) if isinstance(e, Refus) else "Opération mal formée"})
    s.commit()
    mes = s.scalars(select(Groupe).join(Membre, Membre.groupe_id == Groupe.id).where(Membre.utilisateur_id == u.id)).all()
    d = date(depuis) if depuis else None
    changes = [g for g in mes if d is None or date(iso(g.modifie_le)) >= d - MARGE]
    return {"curseur": iso(debut), "moi": str(u.id), "ids": [str(g.id) for g in mes],
            "groupes": [vue_groupe(s, g) for g in changes], "refus": refus}


def apercu_invitation(s: Session, code: str) -> dict[str, Any] | None:
    """Pour la page du lien (sans connexion) : seulement le nom du groupe et qui invite."""
    inv = s.scalar(select(Invitation).where(Invitation.code == code))
    if inv is None or inv.groupe_id is None or date(iso(inv.expire_le)) < maintenant():
        return None
    g, par = s.get(Groupe, inv.groupe_id), s.get(Utilisateur, inv.invite_par)
    return {"groupe": g.nom, "par": personne(par)["pseudo"], "photo": g.photo}


def profil_change(s: Session, u: Utilisateur) -> None:
    """Pseudo ou photo changés : les buddies le reçoivent à leur prochaine synchro."""
    for g in s.scalars(select(Groupe).join(Membre, Membre.groupe_id == Groupe.id).where(Membre.utilisateur_id == u.id)):
        toucher(g)
