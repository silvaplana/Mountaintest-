"""Buddies (spec/buddies.md §3.1, §5.2 à §5.5) : Buddy Groups, Me Time, invitations, Buddy Times, traces
partagées, plannings de saison, synchro.

Synchro « envoyer / nouveautés depuis » : le téléphone envoie d'un coup tout ce qu'il a fait (hors ligne ou
pas), puis reçoit les Buddy Groups qui ont changé depuis sa dernière synchro. Chaque opération est rejouable
sans risque (identifiants choisis par le téléphone) : si la réponse se perd, le téléphone renvoie tout et
rien n'est fait deux fois. Une opération refusée (droits, lien expiré) revient dans `refus` et le téléphone
l'oublie, pour que sa file d'attente ne reste jamais bloquée.
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from modeles import Dispo, Groupe, Invitation, Membre, Participant, Planning, Sortie, TracePartagee, Utilisateur, maintenant

DUREE_INVITATION = timedelta(days=30)
CANAUX = {"sms", "mail", "contacts", "qr", "lien"}
# Me Time : un par personne, même identifiant sur tous ses téléphones.
ESPACE_ME_TIME = uuid.UUID("6f0c2f7e-5b8f-4a43-9a2e-0c1f6d2b7d11")
# Marge sur « depuis » : une écriture en cours au moment de la lecture n'est pas manquée (renvoyer deux fois
# un groupe ne coûte rien, le téléphone le remplace).
MARGE = timedelta(seconds=5)
MAX_POINTS = 20_000
MAX_DATES = 200
ETATS = {"oui", "peut", "non"}


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
    # « me-time » : le téléphone n'avait pas encore reçu l'identifiant de son Me Time.
    g = me_time(s, u) if gid == "me-time" else s.get(Groupe, uuid.UUID(str(gid)))
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
    sortie = sortie_de(s, u, op["sortie"]) if op.get("sortie") else None
    g = s.get(Groupe, sortie.groupe_id) if sortie else groupe_de(s, u, op["groupe"])
    if sortie is None and g.nature != "bande":
        raise Refus("Dans Me Time, on invite à une sortie")
    code = str(op.get("code") or "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{16,32}", code):
        raise Refus("Code d'invitation invalide")
    canal = op.get("canal") if op.get("canal") in CANAUX else "lien"
    contact = propre(op.get("contact"), 320)
    s.add(Invitation(id=iid, code=code, groupe_id=g.id, sortie_id=sortie.id if sortie else None, invite_par=u.id,
                     canal=canal, nom=propre(op.get("nom"), 80), contact=contact,
                     email=contact.lower() if canal == "mail" else None, expire_le=maintenant() + DUREE_INVITATION))
    toucher(sortie or g)


def rejoindre(s: Session, u: Utilisateur, op: dict) -> None:
    inv = s.scalar(select(Invitation).where(Invitation.code == str(op.get("code") or "")))
    if inv is None or inv.groupe_id is None:
        raise Refus("Invitation inconnue")
    if inv.sortie_id:  # une sortie de Me Time : participant seulement
        if s.get(Participant, (inv.sortie_id, u.id)) is not None:
            return
    elif membre(s, inv.groupe_id, u.id) is not None:
        return  # déjà dans le groupe (opération renvoyée)
    if date(iso(inv.expire_le)) < maintenant():
        raise Refus("Invitation expirée : demande un nouveau lien")
    if inv.sortie_id:
        s.add(Participant(sortie_id=inv.sortie_id, utilisateur_id=u.id))
        cible = s.get(Sortie, inv.sortie_id)
    else:
        s.add(Membre(groupe_id=inv.groupe_id, utilisateur_id=u.id, role="membre"))
        cible = s.get(Groupe, inv.groupe_id)
    if inv.acceptee_par is None and inv.canal != "qr":
        inv.acceptee_par = u.id
    toucher(cible)


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


def sortie_visible(s: Session, u: Utilisateur, so: Sortie) -> bool:
    return membre(s, so.groupe_id, u.id) is not None or s.get(Participant, (so.id, u.id)) is not None


def sortie_de(s: Session, u: Utilisateur, sid: Any) -> Sortie:
    so = s.get(Sortie, uuid.UUID(str(sid)))
    if so is None or not sortie_visible(s, u, so):
        raise Refus("Buddy Time inconnu")
    return so


def jour(t: Any) -> str:
    t = str(t or "")
    datetime.strptime(t, "%Y-%m-%d")  # ValueError si mal formée
    return t


def creer_sortie(s: Session, u: Utilisateur, op: dict) -> None:
    """Buddy Time : il naît quand on est sûr de partir (§5.4). Dans un Buddy Group, les membres cochés partent."""
    sid = uuid.UUID(str(op["sortie"]))
    if s.get(Sortie, sid) is not None:
        return
    g = groupe_de(s, u, op["groupe"])
    nom = propre(op.get("nom"), 80)
    if not nom:
        raise Refus("Il faut un nom")
    debut, fin = jour(op.get("debut")), jour(op.get("fin") or op.get("debut"))
    if fin < debut:
        raise Refus("La fin est avant le début")
    so = Sortie(id=sid, groupe_id=g.id, nom=nom, photo=photo_valide(op.get("photo")), debut=debut, fin=fin,
                lieu=propre(op.get("lieu"), 120), cree_par=u.id)
    s.add(so)
    s.flush()
    qui = {u.id}
    for b in op.get("participants") or []:
        try:
            bid = uuid.UUID(str(b))
        except ValueError:
            continue
        if membre(s, g.id, bid) is not None:
            qui.add(bid)
    for bid in qui:
        s.add(Participant(sortie_id=sid, utilisateur_id=bid))
    toucher(g)


def partager_trace(s: Session, u: Utilisateur, op: dict) -> None:
    tid = uuid.UUID(str(op["trace"]))
    if s.get(TracePartagee, tid) is not None:
        return
    so = sortie_de(s, u, op["sortie"]) if op.get("sortie") else None
    g = None if so else groupe_de(s, u, op["groupe"])
    ligne = op.get("ligne")
    if not isinstance(ligne, list) or not 2 <= len(ligne) <= MAX_POINTS:
        raise Refus("Trace vide ou trop longue")
    points = [[round(float(p[0]), 5), round(float(p[1]), 5)] for p in ligne]
    s.add(TracePartagee(id=tid, sortie_id=so.id if so else None, groupe_id=g.id if g else None,
                        nom=propre(op.get("nom"), 80) or "Trace", ligne=json.dumps(points, separators=(",", ":")),
                        mot=propre(op.get("mot"), 300), par=u.id))
    toucher(so or g)


def creer_planning(s: Session, u: Utilisateur, op: dict) -> None:
    """Planning de saison (§5.5) : des dates proposées à toute la bande, une date limite pour répondre."""
    pid = uuid.UUID(str(op["planning"]))
    if s.get(Planning, pid) is not None:
        return
    g = groupe_de(s, u, op["groupe"])
    if g.nature == "me_time":
        raise Refus("Un planning se fait avec une bande")
    nom = propre(op.get("nom"), 80)
    if not nom:
        raise Refus("Il faut un nom")
    dates = sorted({(jour(d[0]), jour(d[1] or d[0])) for d in op.get("dates") or []})
    if not 1 <= len(dates) <= MAX_DATES or any(f < d for d, f in dates):
        raise Refus("Choisis entre 1 et 200 dates")
    s.add(Planning(id=pid, groupe_id=g.id, nom=nom, dates=json.dumps(dates), limite=jour(op.get("limite")), cree_par=u.id))


def planning_de(s: Session, u: Utilisateur, pid: Any) -> Planning:
    p = s.get(Planning, uuid.UUID(str(pid)))
    if p is None or membre(s, p.groupe_id, u.id) is None:
        raise Refus("Planning inconnu")
    return p


def dispo(s: Session, u: Utilisateur, op: dict) -> None:
    """Ma réponse pour une date : oui, peut, non, ou rien (etat vide) ; rejouer la même opération ne change rien."""
    p = planning_de(s, u, op["planning"])
    debut = jour(op.get("debut"))
    if debut not in {d for d, _ in json.loads(p.dates)}:
        raise Refus("Date hors du planning")
    etat = str(op.get("etat") or "")
    if etat and etat not in ETATS:
        raise Refus("Réponse inconnue")
    d = s.get(Dispo, (p.id, u.id, debut))
    if not etat:
        if d is not None:
            s.delete(d)
    elif d is None:
        s.add(Dispo(planning_id=p.id, utilisateur_id=u.id, debut=debut, etat=etat, mot=propre(op.get("mot"), 200)))
    else:
        d.etat, d.mot = etat, propre(op.get("mot"), 200)
    p.modifie_le = maintenant()


OPERATIONS = {
    "creer_groupe": creer_groupe, "inviter": inviter, "rejoindre": rejoindre, "quitter": quitter,
    "retirer": retirer, "nommer_admin": nommer_admin, "annuler_invitation": annuler_invitation,
    "creer_sortie": creer_sortie, "partager_trace": partager_trace, "creer_planning": creer_planning, "dispo": dispo,
}


# ------------------------------------------------------------------ synchro

def personne(u: Utilisateur) -> dict[str, Any]:
    return {"id": str(u.id), "pseudo": u.pseudo or (u.email or "").split("@")[0], "photo": u.photo}


def vue_groupe(s: Session, g: Groupe) -> dict[str, Any]:
    membres = s.execute(select(Membre, Utilisateur).join(Utilisateur, Utilisateur.id == Membre.utilisateur_id)
                        .where(Membre.groupe_id == g.id).order_by(Membre.rejoint_le)).all()
    invitations = s.scalars(select(Invitation).where(Invitation.groupe_id == g.id, Invitation.sortie_id.is_(None),
                                                     Invitation.acceptee_par.is_(None), Invitation.expire_le > maintenant())
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
        except (Refus, KeyError, ValueError, TypeError, IndexError) as e:
            refus.append({"id": op.get("id"), "raison": str(e) if isinstance(e, Refus) else "Opération mal formée"})
    s.commit()
    mes = s.scalars(select(Groupe).join(Membre, Membre.groupe_id == Groupe.id).where(Membre.utilisateur_id == u.id)).all()
    d = date(depuis) if depuis else None
    neuf = lambda t: d is None or date(iso(t)) >= d - MARGE  # noqa: E731
    gids = [g.id for g in mes]
    sorties = s.scalars(select(Sortie).where(or_(
        Sortie.groupe_id.in_(gids),
        Sortie.id.in_(select(Participant.sortie_id).where(Participant.utilisateur_id == u.id))))).all()
    sids = [so.id for so in sorties]
    traces = s.scalars(select(TracePartagee).where(or_(TracePartagee.groupe_id.in_(gids), TracePartagee.sortie_id.in_(sids)))
                       .order_by(TracePartagee.cree_le)).all()
    plannings = s.scalars(select(Planning).where(Planning.groupe_id.in_(gids)).order_by(Planning.cree_le)).all()
    return {"curseur": iso(debut), "moi": str(u.id), "ids": [str(g) for g in gids],
            "groupes": [vue_groupe(s, g) for g in mes if neuf(g.modifie_le)],
            "ids_sorties": [str(x) for x in sids], "sorties": [vue_sortie(s, so) for so in sorties if neuf(so.modifie_le)],
            "ids_traces": [str(t.id) for t in traces], "traces": [vue_trace(s, t) for t in traces if neuf(t.cree_le)],
            "ids_plannings": [str(p.id) for p in plannings],
            "plannings": [vue_planning(s, p) for p in plannings if neuf(p.modifie_le)],
            "refus": refus}


def vue_sortie(s: Session, so: Sortie) -> dict[str, Any]:
    qui = s.scalars(select(Utilisateur).join(Participant, Participant.utilisateur_id == Utilisateur.id)
                    .where(Participant.sortie_id == so.id)).all()
    invitations = s.scalars(select(Invitation).where(Invitation.sortie_id == so.id, Invitation.acceptee_par.is_(None),
                                                     Invitation.expire_le > maintenant()).order_by(Invitation.cree_le)).all()
    return {
        "id": str(so.id), "groupe": str(so.groupe_id), "nom": so.nom, "photo": so.photo, "debut": so.debut, "fin": so.fin,
        "lieu": so.lieu, "modifie_le": iso(so.modifie_le), "participants": [personne(x) for x in qui],
        "invitations": [{"id": str(i.id), "code": i.code, "canal": i.canal, "nom": i.nom, "contact": i.contact,
                         "par": str(i.invite_par)} for i in invitations],
    }


def vue_trace(s: Session, t: TracePartagee) -> dict[str, Any]:
    par = s.get(Utilisateur, t.par)
    return {"id": str(t.id), "sortie": str(t.sortie_id) if t.sortie_id else None,
            "groupe": str(t.groupe_id) if t.groupe_id else None, "nom": t.nom, "ligne": json.loads(t.ligne),
            "mot": t.mot, "par": personne(par), "cree_le": iso(t.cree_le)}


def vue_planning(s: Session, p: Planning) -> dict[str, Any]:
    dispos = s.scalars(select(Dispo).where(Dispo.planning_id == p.id)).all()
    return {"id": str(p.id), "groupe": str(p.groupe_id), "nom": p.nom, "par": personne(s.get(Utilisateur, p.cree_par)),
            "dates": json.loads(p.dates), "limite": p.limite, "modifie_le": iso(p.modifie_le),
            "dispos": [{"qui": str(d.utilisateur_id), "debut": d.debut, "etat": d.etat, "mot": d.mot} for d in dispos]}


def apercu_invitation(s: Session, code: str) -> dict[str, Any] | None:
    """Pour la page du lien (sans connexion) : seulement le nom du groupe et qui invite."""
    inv = s.scalar(select(Invitation).where(Invitation.code == code))
    if inv is None or inv.groupe_id is None or date(iso(inv.expire_le)) < maintenant():
        return None
    g, par = s.get(Groupe, inv.groupe_id), s.get(Utilisateur, inv.invite_par)
    if inv.sortie_id:
        so = s.get(Sortie, inv.sortie_id)
        return {"groupe": so.nom, "sortie": True, "par": personne(par)["pseudo"], "photo": so.photo}
    return {"groupe": g.nom, "par": personne(par)["pseudo"], "photo": g.photo}


def profil_change(s: Session, u: Utilisateur) -> None:
    """Pseudo ou photo changés : les buddies le reçoivent à leur prochaine synchro."""
    for g in s.scalars(select(Groupe).join(Membre, Membre.groupe_id == Groupe.id).where(Membre.utilisateur_id == u.id)):
        toucher(g)
    for so in s.scalars(select(Sortie).join(Participant, Participant.sortie_id == Sortie.id).where(Participant.utilisateur_id == u.id)):
        toucher(so)
