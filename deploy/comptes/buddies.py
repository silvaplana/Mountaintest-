"""Buddies (spec/buddies.md §3.1, §5.2 à §5.5) : Groupes, Me Time, invitations, sorties, traces
partagées, plannings de saison, synchro.

Synchro « envoyer / nouveautés depuis » : le téléphone envoie d'un coup tout ce qu'il a fait (hors ligne ou
pas), puis reçoit les groupes qui ont changé depuis sa dernière synchro. Chaque opération est rejouable
sans risque (identifiants choisis par le téléphone) : si la réponse se perd, le téléphone renvoie tout et
rien n'est fait deux fois. Une opération refusée (droits, lien expiré) revient dans `refus` et le téléphone
l'oublie, pour que sa file d'attente ne reste jamais bloquée.
"""
from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

import droits
from modeles import (Carnet, Coeur, Depense, Dispo, FicheJour, FichierBuddy, Groupe, Hebergement, Invitation, LectureBuddy, Membre, MessageBuddy, Participant, Photo, Planning,
                     Position, PositionGroupe, ReactionBuddy, Recit, Sortie, TracePartagee, VoteBuddy, Utilisateur, maintenant)

DUREE_INVITATION = timedelta(days=30)
CANAUX = {"sms", "mail", "contacts", "qr", "lien"}
# Groupe perso (ex-Me Time) : un par personne, même identifiant sur tous ses téléphones.
ESPACE_ME_TIME = uuid.UUID("6f0c2f7e-5b8f-4a43-9a2e-0c1f6d2b7d11")
# Discussion à deux : toujours la même pour deux buddies (comme AppBase), même identifiant chez l'un et l'autre.
ESPACE_DUO = uuid.UUID("0b6d8f4e-2c1a-4e57-9f3d-6a1e5c7b9d20")
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


# Les Me Time d'avant cette date sont ceux que Seb a fait effacer le 25 novembre ; après, c'est le Groupe perso.
FIN_ME_TIME = datetime(2026, 11, 26, tzinfo=timezone.utc)


def ranger_me_time(s: Session, u: Utilisateur) -> None:
    """Le Me Time d'avant le 26 novembre n'existe plus (Seb, 25 novembre : « Tout effacer »). À la synchro,
    l'ancien Me Time de la personne est effacé avec tout ce qu'il contient, pour tout le monde : ses sorties et,
    par cascade de la base, leurs traces, photos (fichiers compris), dépenses, messages, hébergements,
    positions, carnets. Le Groupe perso d'après (`groupe_perso`) n'est pas touché."""
    g = s.get(Groupe, uuid.uuid5(ESPACE_ME_TIME, str(u.id)))
    if g is None or g.nature != "me_time" or date(iso(g.cree_le)) >= FIN_ME_TIME:
        return
    sids = list(s.scalars(select(Sortie.id).where(Sortie.groupe_id == g.id)))
    photos = list(s.scalars(select(Photo.id).where(Photo.sortie_id.in_(sids)))) if sids else []
    s.execute(delete(Sortie).where(Sortie.groupe_id == g.id))
    s.execute(delete(Groupe).where(Groupe.id == g.id))
    s.expire_all()
    for pid in photos:
        for taille in TAILLES:
            try:
                os.remove(fichier_photo(pid, taille))
            except OSError:
                pass


def duo(s: Session, u: Utilisateur, op: dict) -> None:
    """Discussion à deux (§7.13, comme AppBase) : un groupe « duo » de deux personnes qui partagent déjà une bande."""
    autre = s.get(Utilisateur, uuid.UUID(str(op["buddy"])))
    mes_bandes = select(Membre.groupe_id).join(Groupe, Groupe.id == Membre.groupe_id).where(Membre.utilisateur_id == u.id, Groupe.nature == "bande")
    if autre is None or autre.id == u.id or s.scalar(select(Membre).where(Membre.utilisateur_id == autre.id, Membre.groupe_id.in_(mes_bandes))) is None:
        raise Refus("Seulement avec un buddy de tes groupes")
    gid = uuid.uuid5(ESPACE_DUO, ":".join(sorted([str(u.id), str(autre.id)])))
    if s.get(Groupe, gid) is None:
        s.add(Groupe(id=gid, nom="", nature="duo", cree_par=u.id))
        s.flush()
    for x in (u.id, autre.id):
        if membre(s, gid, x) is None:
            s.add(Membre(groupe_id=gid, utilisateur_id=x, role="membre"))


def groupe_perso(s: Session, u: Utilisateur) -> Groupe:
    """Le Groupe perso, sans nom (Seb, 26 novembre) : il naît à la première sortie « Seul », puis resservira."""
    gid = uuid.uuid5(ESPACE_ME_TIME, str(u.id))
    g = s.get(Groupe, gid)
    if g is None:
        g = Groupe(id=gid, nom="", nature="me_time", cree_par=u.id)
        s.add(g)
        s.flush()
        s.add(Membre(groupe_id=gid, utilisateur_id=u.id, role=droits.ADMIN_PRINCIPAL))
    return g


def membre(s: Session, gid: uuid.UUID, uid: uuid.UUID) -> Membre | None:
    return s.get(Membre, (gid, uid))


def toucher(g: Groupe) -> None:
    g.modifie_le = maintenant()


def groupe_de(s: Session, u: Utilisateur, gid: Any, admin: bool = False) -> Groupe:
    if gid == "me-time":  # ancien téléphone
        raise Refus("Choisis un groupe")
    g = s.get(Groupe, uuid.UUID(str(gid)))
    if g is None:
        raise Refus("Groupe inconnu")
    # droits.py : un admin de son club ou le Super User y agit aussi sans en être membre.
    chef = droits.admin_du_groupe(s, u, g)
    if membre(s, g.id, u.id) is None and not chef:
        raise Refus("Groupe inconnu")
    if admin and not chef:
        raise Refus("Réservé aux admins du groupe")
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
    s.add(Membre(groupe_id=gid, utilisateur_id=u.id, role=droits.ADMIN_PRINCIPAL))


def renommer_groupe(s: Session, u: Utilisateur, op: dict) -> None:
    """Changer le nom d'un groupe (tout membre, comme un groupe WhatsApp ; Seb, 25 novembre)."""
    g = groupe_de(s, u, op["groupe"])
    if g.nature == "duo":
        raise Refus("Une discussion à deux n'a pas de nom")
    nom = propre(op.get("nom"), 80)
    if not nom:
        raise Refus("Il faut un nom")
    if g.nom != nom:
        g.nom = nom
        toucher(g)


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
    if m is None:
        return
    if not droits.peut_retirer(s, u, g, m):
        raise Refus("Seul l'admin principal retire un admin" if m.role == droits.ADMIN else "On ne retire pas l'admin principal")
    partir(s, g, m)


def cible_admin_principal(s: Session, u: Utilisateur, op: dict) -> tuple[Groupe, Membre | None]:
    """Nommer, retirer un admin, transmettre : réservé à l'admin principal du Groupe (droits.py)."""
    g = groupe_de(s, u, op["groupe"])
    if not droits.admin_principal_du_groupe(s, u, g):
        raise Refus("Réservé à l'admin principal du groupe")
    return g, membre(s, g.id, uuid.UUID(str(op["buddy"])))


def nommer_admin(s: Session, u: Utilisateur, op: dict) -> None:
    g, m = cible_admin_principal(s, u, op)
    if m is not None and m.role == droits.MEMBRE:
        m.role = droits.ADMIN
        toucher(g)


def retirer_admin(s: Session, u: Utilisateur, op: dict) -> None:
    """Un admin redevient simple membre."""
    g, m = cible_admin_principal(s, u, op)
    if m is not None and m.role == droits.ADMIN:
        m.role = droits.MEMBRE
        toucher(g)


def transmettre(s: Session, u: Utilisateur, op: dict) -> None:
    """L'admin principal passe son rôle à un autre membre et reste admin (il n'y en a toujours qu'un)."""
    g, m = cible_admin_principal(s, u, op)
    if m is None or m.role == droits.ADMIN_PRINCIPAL:
        return
    for x in s.scalars(select(Membre).where(Membre.groupe_id == g.id, Membre.role == droits.ADMIN_PRINCIPAL)):
        x.role = droits.ADMIN
    m.role = droits.ADMIN_PRINCIPAL
    toucher(g)


def annuler_invitation(s: Session, u: Utilisateur, op: dict) -> None:
    inv = s.get(Invitation, uuid.UUID(str(op["invitation"])))
    if inv is None:
        return
    g = groupe_de(s, u, inv.groupe_id)
    s.delete(inv)
    toucher(g)


def partir(s: Session, g: Groupe, m: Membre) -> None:
    """Un membre s'en va ; le groupe garde toujours un admin principal (l'admin le plus ancien, sinon le membre
    le plus ancien), et disparaît s'il est vide."""
    s.delete(m)
    s.flush()
    restants = s.scalars(select(Membre).where(Membre.groupe_id == g.id).order_by(Membre.rejoint_le)).all()
    if not restants:
        s.delete(g)
        return
    if not any(r.role == droits.ADMIN_PRINCIPAL for r in restants):
        admins = [r for r in restants if r.role == droits.ADMIN]
        (admins or restants)[0].role = droits.ADMIN_PRINCIPAL
    toucher(g)


def sortie_visible(s: Session, u: Utilisateur, so: Sortie) -> bool:
    return membre(s, so.groupe_id, u.id) is not None or s.get(Participant, (so.id, u.id)) is not None


def sortie_de(s: Session, u: Utilisateur, sid: Any) -> Sortie:
    so = s.get(Sortie, uuid.UUID(str(sid)))
    if so is None or so.supprime_le is not None or not sortie_visible(s, u, so):
        raise Refus("Sortie inconnue")
    return so


def jour(t: Any) -> str:
    t = str(t or "")
    datetime.strptime(t, "%Y-%m-%d")  # ValueError si mal formée
    return t


def creer_sortie(s: Session, u: Utilisateur, op: dict) -> None:
    """Sortie : elle naît quand on est sûr de partir (§5.4). Dans un groupe, les membres cochés partent."""
    sid = uuid.UUID(str(op["sortie"]))
    if s.get(Sortie, sid) is not None:
        return
    g = groupe_perso(s, u) if op["groupe"] == "seul" else groupe_de(s, u, op["groupe"])
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


def retirer_sortie(s: Session, u: Utilisateur, op: dict) -> None:
    """Annuler une sortie qu'on vient de créer (« Annuler » sous la réponse de Bud, §7.12) : seulement celui qui l'a
    créé, et seulement tant que rien n'y est encore attaché (traces, photos, dépenses, messages, hébergements)."""
    so = s.get(Sortie, uuid.UUID(str(op["sortie"])))
    if so is None:
        return  # déjà retiré
    if so.cree_par != u.id:
        raise Refus("Seul celui qui a créé la sortie peut l'annuler")
    for t, c in ((TracePartagee, TracePartagee.sortie_id), (Photo, Photo.sortie_id), (Depense, Depense.sortie_id),
                 (MessageBuddy, MessageBuddy.sortie_id), (Hebergement, Hebergement.sortie_id)):
        if s.scalar(select(t).where(c == so.id).limit(1)) is not None:
            raise Refus("Cette sortie a déjà servi : elle reste")
    g = s.get(Groupe, so.groupe_id)
    for t in (Participant, Invitation):
        for x in s.scalars(select(t).where(t.sortie_id == so.id)).all():
            s.delete(x)
    s.flush()
    s.delete(so)
    if g is not None:
        toucher(g)


def sortie_a_supprimer(s: Session, u: Utilisateur, op: dict) -> Sortie | None:
    """Supprimer une sortie (ou la remettre) : celui qui l'a créée, ou un admin de son groupe."""
    so = s.get(Sortie, uuid.UUID(str(op["sortie"])))
    if so is None or not sortie_visible(s, u, so):
        raise Refus("Sortie inconnue")
    g = s.get(Groupe, so.groupe_id)
    if so.cree_par != u.id and not droits.admin_du_groupe(s, u, g):
        raise Refus("Seul celui qui a créé la sortie (ou un admin du groupe) peut la supprimer")
    return so


def supprimer_sortie(s: Session, u: Utilisateur, op: dict) -> None:
    """Bud supprime une sortie à la demande (§7.12) : caché de tous, rien n'est effacé, « Annuler » le remet."""
    so = sortie_a_supprimer(s, u, op)
    if so.supprime_le is None:
        so.supprime_le = so.modifie_le = maintenant()
        toucher(s.get(Groupe, so.groupe_id))


def remettre_sortie(s: Session, u: Utilisateur, op: dict) -> None:
    """« Annuler » sous la réponse de Bud : la sortie supprimée revient chez tous, avec tout ce qu'elle contenait."""
    so = sortie_a_supprimer(s, u, op)
    if so.supprime_le is not None:
        so.supprime_le, so.modifie_le = None, maintenant()
        toucher(s.get(Groupe, so.groupe_id))


def renommer_sortie(s: Session, u: Utilisateur, op: dict) -> None:
    """Changer le nom d'une sortie (Seb, 25 novembre) : tout buddy qui le voit, comme le nom d'un groupe WhatsApp."""
    so = sortie_de(s, u, op["sortie"])
    nom = propre(op.get("nom"), 80)
    if not nom:
        raise Refus("Donne un nom à la sortie")
    if so.nom != nom:
        so.nom, so.modifie_le = nom, maintenant()
        toucher(s.get(Groupe, so.groupe_id))


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


def heure_photo(t: Any) -> str:
    t = str(t or "")[:19]
    datetime.strptime(t, "%Y-%m-%dT%H:%M:%S")  # ValueError si mal formée
    return t


def ajouter_photo(s: Session, u: Utilisateur, op: dict) -> None:
    """Album (§5.8) : la photo est annoncée ici, son fichier arrive ensuite (PUT /buddies/photos/…)."""
    pid = uuid.UUID(str(op["photo"]))
    if s.get(Photo, pid) is not None:
        return
    so = sortie_de(s, u, op["sortie"])
    lon, lat = op.get("lon"), op.get("lat")
    if lon is not None and lat is not None:
        lon, lat = float(lon), float(lat)
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            lon = lat = None
    else:
        lon = lat = None
    s.add(Photo(id=pid, sortie_id=so.id, par=u.id, prise_le=heure_photo(op.get("prise_le")), lon=lon, lat=lat,
                video=bool(op.get("video"))))
    toucher(so)


def photo_de(s: Session, u: Utilisateur, pid: Any) -> Photo:
    p = s.get(Photo, uuid.UUID(str(pid)))
    if p is None or not sortie_visible(s, u, s.get(Sortie, p.sortie_id)):
        raise Refus("Photo inconnue")
    return p


def etoile(s: Session, u: Utilisateur, op: dict) -> None:
    p = photo_de(s, u, op["photo"])
    p.etoile = bool(op.get("etoile"))
    p.modifie_le = maintenant()


def placer_photo(s: Session, u: Utilisateur, op: dict) -> None:
    """📍 Place (ou replace) une photo sur la carte : les vieilles photos n'ont pas gardé leur position."""
    p = photo_de(s, u, op["photo"])
    lon, lat = float(op["lon"]), float(op["lat"])
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        raise Refus("Position impossible")
    p.lon, p.lat = lon, lat
    p.modifie_le = maintenant()


def retirer_photo(s: Session, u: Utilisateur, op: dict) -> None:
    """L'auteur retire sa photo, ou un admin du groupe (le fichier est effacé par le serveur)."""
    try:
        p = photo_de(s, u, op["photo"])
    except Refus:
        return  # déjà retirée : rejouer ne coûte rien
    if p.par != u.id and not droits.admin_du_groupe(s, u, s.get(Groupe, s.get(Sortie, p.sortie_id).groupe_id)):
        raise Refus("Seul l'auteur (ou un admin du groupe) peut retirer sa photo")
    s.delete(p)
    toucher(s.get(Sortie, p.sortie_id))
    for taille in TAILLES:
        try:
            os.remove(fichier_photo(p.id, taille))
        except OSError:
            pass


MAX_RECIT = 5000


def recit(s: Session, u: Utilisateur, op: dict) -> None:
    """Carnet (§5.8) : mon texte, transcrit mot pour mot puis corrigé au clavier. Un texte vide l'efface."""
    so = sortie_de(s, u, op["sortie"])
    texte = str(op.get("texte") or "").strip()[:MAX_RECIT]
    r = s.get(Recit, (so.id, u.id))
    if not texte:
        if r is not None:
            s.delete(r)
    elif r is None:
        s.add(Recit(sortie_id=so.id, utilisateur_id=u.id, texte=texte))
    else:
        r.texte, r.modifie_le = texte, maintenant()
    toucher(so)


def entier(v: Any, maxi: int) -> int | None:
    if v is None or v == "":
        return None
    n = int(v)
    if not 0 <= n <= maxi:
        raise Refus("Chiffre hors limites")
    return n


def fiche(s: Session, u: Utilisateur, op: dict) -> None:
    """Carnet : la fiche d'un jour (nom, départ, durée, distance, dénivelé). Tout vide : la fiche disparaît."""
    so = sortie_de(s, u, op["sortie"])
    j = jour(op.get("jour"))
    if not so.debut <= j <= so.fin:
        raise Refus("Jour hors de la sortie")
    depart = str(op.get("depart") or "")
    if depart and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", depart):
        raise Refus("Heure de départ mal formée")
    champs = {"nom": propre(op.get("nom"), 80), "depart": depart, "duree": entier(op.get("duree"), 48 * 60),
              "distance": entier(op.get("distance"), 1_000_000), "denivele": entier(op.get("denivele"), 20_000)}
    f = s.get(FicheJour, (so.id, j))
    if not any(v not in (None, "") for v in champs.values()):
        if f is not None:
            s.delete(f)
    elif f is None:
        s.add(FicheJour(sortie_id=so.id, jour=j, **champs))
    else:
        for k, v in champs.items():
            setattr(f, k, v)
        f.modifie_le = maintenant()
    toucher(so)


def carnet(s: Session, u: Utilisateur, op: dict) -> None:
    """Carnet : difficulté, météo, conditions (n'importe quel participant ; le dernier envoyé gagne)."""
    so = sortie_de(s, u, op["sortie"])
    c = s.get(Carnet, so.id)
    if c is None:
        c = Carnet(sortie_id=so.id)
        s.add(c)
    c.difficulte, c.meteo = propre(op.get("difficulte"), 20), propre(op.get("meteo"), 40)
    c.conditions, c.modifie_le = propre(op.get("conditions"), 300), maintenant()
    toucher(so)


def participants(s: Session, so: Sortie) -> set[uuid.UUID]:
    return set(s.scalars(select(Participant.utilisateur_id).where(Participant.sortie_id == so.id)))


def depense(s: Session, u: Utilisateur, op: dict) -> None:
    """Buddy count (§5.10) : ajoute ou corrige une dépense. Qui paie et pour qui : des participants de la sortie."""
    did = uuid.UUID(str(op["depense"]))
    d = s.get(Depense, did)
    so = sortie_de(s, u, d.sortie_id if d else op["sortie"])
    titre = propre(op.get("titre"), 80) or "Dépense"
    montant = int(op.get("montant"))
    if not 1 <= montant <= 10_000_000:
        raise Refus("Montant hors limites")
    qui = participants(s, so)
    paye_par = uuid.UUID(str(op["paye_par"]))
    pour = sorted({str(uuid.UUID(str(x))) for x in op.get("pour") or []})
    if paye_par not in qui or not pour or any(uuid.UUID(x) not in qui for x in pour):
        raise Refus("Seuls les buddies de la sortie partagent ses frais")
    champs = {"titre": titre, "montant": montant, "paye_par": paye_par, "pour": json.dumps(pour), "jour": jour(op.get("jour"))}
    if d is None:
        s.add(Depense(id=did, sortie_id=so.id, par=u.id, **champs))
    else:
        for k, v in champs.items():
            setattr(d, k, v)
        d.modifie_le = maintenant()
    toucher(so)


def a_moi_ou_admin(s: Session, u: Utilisateur, par: uuid.UUID, so: Sortie, quoi: str) -> None:
    """La règle de Seb (26 novembre) : un membre ne supprime que ce qu'il a apporté ; un admin du groupe, tout."""
    if par != u.id and not droits.admin_du_groupe(s, u, s.get(Groupe, so.groupe_id)):
        raise Refus(f"Seul celui qui a ajouté {quoi} (ou un admin du groupe) peut le retirer")


def retirer_depense(s: Session, u: Utilisateur, op: dict) -> None:
    d = s.get(Depense, uuid.UUID(str(op["depense"])))
    if d is None:
        return  # déjà retirée
    so = sortie_de(s, u, d.sortie_id)
    a_moi_ou_admin(s, u, d.par, so, "cette dépense")
    s.delete(d)
    toucher(so)


# Fichiers des photos : COMPTES_DOSSIER/photos/<id>-petite.jpg et -grande.jpg (et -video.jpg : le film, MP4 ou WebM).
DOSSIER_PHOTOS = os.path.join(os.environ.get("COMPTES_DOSSIER", "/data"), "photos")
TAILLES = {"petite": 300_000, "grande": 4_000_000, "video": 100_000_000}  # octets au plus


def format_video(corps: bytes) -> str | None:
    """Film d'un survol 3D : MP4 (boîte « ftyp ») ou WebM (en-tête EBML), sinon None."""
    if corps[4:8] == b"ftyp":
        return "video/mp4"
    if corps.startswith(b"\x1a\x45\xdf\xa3"):
        return "video/webm"
    return None


JOUR_MS = 24 * 3600 * 1000
MARGE_MS = 60_000
GARDE_POSITIONS = timedelta(hours=48)
GARDE_MESSAGES = timedelta(days=90)


def ms(v: Any) -> int:
    n = int(v)
    if not 1_500_000_000_000 <= n <= 4_000_000_000_000:
        raise ValueError("heure")
    return n


def ma_position(s: Session, u: Utilisateur, op: dict) -> tuple[Any, Any]:
    """L'épingle visée : dans une sortie (`sortie`) ou, hors sortie, dans un groupe (`groupe`, §7.14).
    Rend la ligne existante (ou None) et de quoi la créer."""
    if op.get("groupe"):
        g = groupe_de(s, u, op["groupe"])
        if g.nature == "me_time":
            raise Refus("Choisis un groupe avec des buddies")
        return s.get(PositionGroupe, (g.id, u.id)), lambda **k: PositionGroupe(groupe_id=g.id, utilisateur_id=u.id, **k)
    so = sortie_de(s, u, op["sortie"])
    if u.id not in participants(s, so):
        raise Refus("Seuls les buddies de la sortie partagent leur position")
    return s.get(Position, (so.id, u.id)), lambda **k: Position(sortie_id=so.id, utilisateur_id=u.id, **k)


def epingle(s: Session, u: Utilisateur, op: dict) -> None:
    """Position des buddies (§5.9) : enfoncer l'épingle (« mes buddies me voient » jusqu'à ce soir) ou la relever."""
    p, nouvelle = ma_position(s, u, op)
    t = ms(op["quand"])
    if op.get("enfoncee"):
        jusqu = min(ms(op["jusqu"]), t + JOUR_MS)
        if jusqu <= t:
            raise Refus("Heure de fin avant le début")
        if p is None:
            s.add(nouvelle(depuis=t, jusqu=jusqu))
        else:
            p.depuis, p.jusqu, p.modifie_le = t, jusqu, maintenant()
    elif p is not None and p.jusqu > t:
        p.jusqu, p.modifie_le = t, maintenant()


def position(s: Session, u: Utilisateur, op: dict) -> None:
    """Une position envoyée pendant que l'épingle est enfoncée ; hors de ce temps-là elle est ignorée sans bruit
    (personne n'est localisé sans l'avoir voulu). Seule la plus récente est gardée."""
    p, _ = ma_position(s, u, op)
    t = ms(op["prise_le"])
    if p is None or not p.depuis - MARGE_MS <= t <= p.jusqu + MARGE_MS or (p.prise_le or 0) >= t:
        return
    lat, lon = float(op["lat"]), float(op["lon"])
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("position")
    alt = op.get("alt")
    p.lat, p.lon, p.alt = round(lat, 6), round(lon, 6), round(float(alt)) if alt is not None else None
    p.prise_le, p.modifie_le = t, maintenant()


def proposer_hebergement(s: Session, u: Utilisateur, op: dict) -> None:
    """Hébergement (§5.11) : proposé dans une sortie depuis la recherche (panneau de partage, écran 23)."""
    hid = uuid.UUID(str(op["hebergement"]))
    if s.get(Hebergement, hid) is not None:
        return  # renvoyé : déjà là
    so = sortie_de(s, u, op["sortie"])
    if u.id not in participants(s, so):
        raise Refus("Seuls les buddies de la sortie proposent un hébergement")
    url = propre(op.get("url"), 500)
    if url and not url.startswith(("https://", "http://")):
        raise Refus("Lien d'hébergement invalide")
    prix = op.get("prix_nuit")
    lon, lat = op.get("lon"), op.get("lat")
    if (lon is None) != (lat is None) or (lon is not None and not (-180 <= float(lon) <= 180 and -90 <= float(lat) <= 90)):
        raise ValueError("position")
    s.add(Hebergement(id=hid, sortie_id=so.id, nom=propre(op.get("nom"), 80) or "Hébergement", nature=propre(op.get("nature"), 40),
                      prix_nuit=entier(round(float(prix)), 100_000) if prix is not None else None, adresse=propre(op.get("adresse"), 160), url=url,
                      resume=propre(op.get("resume"), 300), lon=float(lon) if lon is not None else None,
                      lat=float(lat) if lat is not None else None, par=u.id))
    toucher(so)


def hebergement_de(s: Session, u: Utilisateur, hid: Any) -> tuple[Hebergement, Sortie]:
    h = s.get(Hebergement, uuid.UUID(str(hid)))
    if h is None:
        raise Refus("Hébergement inconnu")
    so = sortie_de(s, u, h.sortie_id)
    if u.id not in participants(s, so):
        raise Refus("Seuls les buddies de la sortie choisissent l'hébergement")
    return h, so


def coeur(s: Session, u: Utilisateur, op: dict) -> None:
    h, so = hebergement_de(s, u, op["hebergement"])
    c = s.get(Coeur, (h.id, u.id))
    if op.get("coeur") and c is None:
        s.add(Coeur(hebergement_id=h.id, utilisateur_id=u.id))
    elif not op.get("coeur") and c is not None:
        s.delete(c)
    h.modifie_le = maintenant()


def retenir_hebergement(s: Session, u: Utilisateur, op: dict) -> None:
    """✅ On en retient un : les autres de la même sortie ne le sont plus."""
    h, so = hebergement_de(s, u, op["hebergement"])
    if op.get("retenu"):
        for x in s.scalars(select(Hebergement).where(Hebergement.sortie_id == so.id, Hebergement.retenu.is_(True))):
            x.retenu, x.modifie_le = False, maintenant()
    h.retenu, h.modifie_le = bool(op.get("retenu")), maintenant()
    toucher(so)


def retirer_hebergement(s: Session, u: Utilisateur, op: dict) -> None:
    h, so = hebergement_de(s, u, op["hebergement"])
    a_moi_ou_admin(s, u, h.par, so, "cet hébergement")
    s.delete(h)
    toucher(so)


NATURES_MESSAGE = {"texte", "point", "photo", "fichier", "sondage"}
# Comme AppBase (§7.13) : 25 Mo par fichier ou photo, 100 Mo par vidéo ; un sondage a 2 à 10 réponses.
MAX_FICHIER, MAX_VIDEO = 25 * 1024 * 1024, 100 * 1024 * 1024
MAX_REPONSES = 10
DOSSIER_FICHIERS = os.path.join(os.environ.get("COMPTES_DOSSIER", "/data"), "fichiers")


def max_fichier(mime: str) -> int:
    return MAX_VIDEO if mime.startswith("video/") else MAX_FICHIER


def sondage_propre(x: Any) -> str:
    """La question et les réponses, sans vide ni doublon (comme AppBase)."""
    question = str((x or {}).get("question") or "").strip()[:200]
    if not question:
        raise Refus("Écris la question du sondage")
    reponses: list[str] = []
    for o in (x or {}).get("options") or []:
        r = str(o).strip()[:100]
        if r and r.lower() not in (y.lower() for y in reponses):
            reponses.append(r)
    if len(reponses) < 2:
        raise Refus("Donne au moins 2 réponses")
    if len(reponses) > MAX_REPONSES:
        raise Refus(f"{MAX_REPONSES} réponses au plus")
    return json.dumps({"question": question, "multiple": bool(x.get("multiple", True)), "options": reponses}, ensure_ascii=False)


def fichier_lisible(s: Session, u: Utilisateur, fid: uuid.UUID) -> bool:
    """Un fichier se lit depuis toute conversation où un message le montre (envoyé ou transféré)."""
    for m in s.scalars(select(MessageBuddy).where(MessageBuddy.fichier_id == fid, MessageBuddy.supprime.is_(False))):
        try:
            message_de(s, u, m.id)
            return True
        except Refus:
            continue
    return False


def message(s: Session, u: Utilisateur, op: dict) -> None:
    """Messagerie (§5.6, écran 6) : un message dans la conversation d'un groupe ou d'une sortie.
    Texte, « je suis ici » (point) ou une photo de l'album de la sortie."""
    mid = uuid.UUID(str(op["message"]))
    if s.get(MessageBuddy, mid) is not None:
        return  # renvoyé : déjà là
    so = sortie_de(s, u, op["sortie"]) if op.get("sortie") else None
    g = None if so else groupe_de(s, u, op["groupe"])
    nature = str(op.get("nature") or "texte")
    if nature not in NATURES_MESSAGE:
        raise ValueError("nature")
    texte = str(op.get("texte") or "").strip()[:2000]
    lon = lat = photo = None
    if nature == "texte" and not texte:
        raise Refus("Message vide")
    if nature == "point":
        lat, lon = float(op["lat"]), float(op["lon"])
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError("position")
        lat, lon = round(lat, 6), round(lon, 6)
    if nature == "photo":
        p = s.get(Photo, uuid.UUID(str(op["photo"])))
        if p is None or so is None or p.sortie_id != so.id:
            raise Refus("Photo inconnue")
        photo = p.id
    fichier = sondage = None
    if nature == "fichier":
        f = op["fichier"]
        fid = uuid.UUID(str(f["id"]))
        ff = s.get(FichierBuddy, fid)
        if ff is None:
            nom, mime, taille = propre(f.get("nom"), 200) or "fichier", propre(f.get("mime"), 100) or "application/octet-stream", int(f["taille"])
            if not 0 < taille <= max_fichier(mime):
                raise Refus("Trop gros : 25 Mo au plus, 100 Mo pour une vidéo")
            s.add(FichierBuddy(id=fid, par=u.id, nom=nom, mime=mime, taille=taille))
            s.flush()
        elif ff.par != u.id and not fichier_lisible(s, u, fid):
            raise Refus("Fichier inconnu")
        fichier = fid
    if nature == "sondage":
        sondage = sondage_propre(op.get("sondage"))
    # Réponse à un message de la même conversation (sinon le rappel est ignoré).
    cible = s.get(MessageBuddy, uuid.UUID(str(op["repond_a"]))) if op.get("repond_a") else None
    repond_a = cible.id if cible and (cible.groupe_id, cible.sortie_id) == (None if so else g.id, so.id if so else None) else None
    s.add(MessageBuddy(id=mid, groupe_id=g.id if g else None, sortie_id=so.id if so else None, par=u.id, nature=nature,
                       texte=texte, lon=lon, lat=lat, photo_id=photo, bud=bool(op.get("bud")), repond_a=repond_a,
                       fichier_id=fichier, sondage=sondage, transfere=bool(op.get("transfere"))))


def resume_message(m: MessageBuddy, f: FichierBuddy | None) -> str:
    """Le texte d'une notification (§7.13, étape 4)."""
    if m.nature == "point":
        return "📍 est ici"
    if m.nature == "photo":
        return "📷 Photo"
    if m.nature == "fichier":
        return f"{'🎬' if f and f.mime.startswith('video/') else '📷' if f and f.mime.startswith('image/') else '📄'} {f.nom if f else 'Fichier'}"
    if m.nature == "sondage":
        return "📊 " + json.loads(m.sondage or "{}").get("question", "Sondage")
    return m.texte[:200]


def a_prevenir(s: Session, u: Utilisateur, mids: list[uuid.UUID]) -> list[tuple[list[uuid.UUID], dict[str, str]]]:
    """🔔 Nouveaux messages (§7.13, étape 4) : à qui envoyer une notification, et quoi. Pas à l'auteur."""
    l = []
    for mid in mids:
        m = s.get(MessageBuddy, mid)
        if m is None:
            continue
        a_deux = False
        if m.sortie_id:
            so = s.get(Sortie, m.sortie_id)
            qui, titre = participants(s, so), so.nom
        else:
            g = s.get(Groupe, m.groupe_id)
            qui = set(s.scalars(select(Membre.utilisateur_id).where(Membre.groupe_id == g.id)))
            a_deux = g.nature == "duo"
            titre = personne(u)["pseudo"] if a_deux else g.nom
        de = "🐻 Bud" if m.bud else personne(u)["pseudo"]
        texte = resume_message(m, s.get(FichierBuddy, m.fichier_id) if m.fichier_id else None)
        l.append(([x for x in qui if x != u.id], {
            "type": "message", "cle": str(m.sortie_id or m.groupe_id), "groupe": str(m.groupe_id or ""), "sortie": str(m.sortie_id or ""),
            "titre": titre, "de": de, "texte": texte, "duo": "1" if a_deux else "",
            "envoye_le": str(int(datetime.now(timezone.utc).timestamp() * 1000))}))
    return l


def message_de(s: Session, u: Utilisateur, mid: Any) -> tuple[MessageBuddy | None, Groupe | None]:
    """Un message de mes conversations, et le groupe dont les admins peuvent le supprimer (modération)."""
    m = s.get(MessageBuddy, uuid.UUID(str(mid)))
    if m is None:
        return None, None
    if m.sortie_id:
        so = sortie_de(s, u, m.sortie_id)
        return m, s.get(Groupe, so.groupe_id)
    return m, groupe_de(s, u, m.groupe_id)


DELAI_MODIFIER = timedelta(minutes=15)


def modifier_message(s: Session, u: Utilisateur, op: dict) -> None:
    """Modifier : son propre message texte, pendant 15 minutes après l'envoi (comme AppBase)."""
    m, _ = message_de(s, u, op["message"])
    if m is None or m.supprime or m.par != u.id or m.bud or m.nature != "texte" or maintenant() - date(iso(m.cree_le)) > DELAI_MODIFIER:
        raise Refus("Ce message ne peut plus être modifié")
    texte = str(op.get("texte") or "").strip()[:2000]
    if not texte:
        raise Refus("Message vide")
    if texte != m.texte:
        m.texte, m.edite_le, m.modifie_le = texte, maintenant(), maintenant()


def retirer_message(s: Session, u: Utilisateur, op: dict) -> None:
    """Supprimer : chez tous, la bulle devient « Ce message a été supprimé ». Ses messages, ou tous pour un admin
    du groupe (aussi dans ses sorties)."""
    m, g = message_de(s, u, op["message"])
    if m is None or m.supprime:
        return
    if m.par != u.id:
        if g is None or not droits.admin_du_groupe(s, u, g):
            raise Refus("On ne supprime que ses messages")
    m.supprime, m.texte, m.lon, m.lat, m.photo_id, m.modifie_le = True, "", None, None, None, maintenant()
    m.fichier_id = m.sondage = None
    for r in [*s.scalars(select(ReactionBuddy).where(ReactionBuddy.message_id == m.id)), *s.scalars(select(VoteBuddy).where(VoteBuddy.message_id == m.id))]:
        s.delete(r)


def voter(s: Session, u: Utilisateur, op: dict) -> None:
    """Sondage : mes réponses remplacent les précédentes ; aucune retire mon vote."""
    m, _ = message_de(s, u, op["message"])
    if m is None or m.supprime or not m.sondage:
        raise Refus("Sondage inconnu")
    sd = json.loads(m.sondage)
    choix = {int(x) for x in op.get("options") or []}
    if not choix <= set(range(len(sd["options"]))):
        raise Refus("Réponse introuvable")
    if len(choix) > 1 and not sd["multiple"]:
        raise Refus("Une seule réponse")
    for v in s.scalars(select(VoteBuddy).where(VoteBuddy.message_id == m.id, VoteBuddy.utilisateur_id == u.id)):
        s.delete(v)
    s.flush()
    for o in sorted(choix):
        s.add(VoteBuddy(message_id=m.id, utilisateur_id=u.id, option=o))
    m.modifie_le = maintenant()


def reagir(s: Session, u: Utilisateur, op: dict) -> None:
    """Réaction : une par personne, une autre la remplace, vide la retire."""
    m, _ = message_de(s, u, op["message"])
    if m is None or m.supprime:
        return
    emoji = str(op.get("emoji") or "").strip()
    if len(emoji) > 16:
        raise Refus("Une seule émoji")
    r = s.get(ReactionBuddy, (m.id, u.id))
    if r is not None:
        s.delete(r)
        s.flush()
    if emoji:
        s.add(ReactionBuddy(message_id=m.id, utilisateur_id=u.id, emoji=emoji))
    m.modifie_le = maintenant()


def lu(s: Session, u: Utilisateur, op: dict) -> None:
    """Conversation lue jusqu'à ce message (heure du serveur) : coches bleues chez les autres."""
    cle = uuid.UUID(str(op["cle"]))
    so = s.get(Sortie, cle)
    if so is not None:
        sortie_de(s, u, cle)
    else:
        groupe_de(s, u, cle)
    jusqu = min(date(str(op["jusqu"])), maintenant())
    l = s.get(LectureBuddy, (u.id, cle))
    if l is None:
        s.add(LectureBuddy(utilisateur_id=u.id, cle=cle, lu_le=jusqu))
    elif jusqu > date(iso(l.lu_le)):
        l.lu_le = jusqu


def fichier_photo(pid: uuid.UUID, taille: str) -> str:
    return os.path.join(DOSSIER_PHOTOS, f"{pid}-{taille}.jpg")


OPERATIONS = {
    "creer_groupe": creer_groupe, "renommer_groupe": renommer_groupe, "inviter": inviter, "rejoindre": rejoindre, "quitter": quitter,
    "retirer": retirer, "nommer_admin": nommer_admin, "retirer_admin": retirer_admin, "transmettre": transmettre,
    "annuler_invitation": annuler_invitation,
    "creer_sortie": creer_sortie, "retirer_sortie": retirer_sortie,
    "supprimer_sortie": supprimer_sortie, "remettre_sortie": remettre_sortie, "renommer_sortie": renommer_sortie, "partager_trace": partager_trace, "creer_planning": creer_planning, "dispo": dispo,
    "ajouter_photo": ajouter_photo, "etoile": etoile, "placer_photo": placer_photo, "retirer_photo": retirer_photo,
    "recit": recit, "fiche": fiche, "carnet": carnet, "depense": depense, "retirer_depense": retirer_depense,
    "epingle": epingle, "position": position, "proposer_hebergement": proposer_hebergement, "coeur": coeur,
    "retenir_hebergement": retenir_hebergement, "retirer_hebergement": retirer_hebergement,
    "message": message, "retirer_message": retirer_message, "duo": duo, "modifier_message": modifier_message, "reagir": reagir, "lu": lu, "voter": voter,
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
        "organisation": str(g.organisation_id) if g.organisation_id else None,
        "membres": [{**personne(u), "role": m.role} for m, u in membres],
        "invitations": [{"id": str(i.id), "code": i.code, "canal": i.canal, "nom": i.nom, "contact": i.contact,
                         "par": str(i.invite_par)} for i in invitations],
    }


def synchroniser(s: Session, u: Utilisateur, ops: list[dict], depuis: str | None) -> dict[str, Any]:
    debut = maintenant()
    ranger_me_time(s, u)
    refus = []
    nouveaux = []
    for op in ops:
        f = OPERATIONS.get(str(op.get("type")))
        try:
            if f is None:
                raise Refus("Opération inconnue")
            neuf_msg = op.get("type") == "message" and s.get(MessageBuddy, uuid.UUID(str(op["message"]))) is None
            with s.begin_nested():
                f(s, u, op)
            if neuf_msg:
                nouveaux.append(uuid.UUID(str(op["message"])))
        except (Refus, KeyError, ValueError, TypeError, IndexError) as e:
            refus.append({"id": op.get("id"), "raison": str(e) if isinstance(e, Refus) else "Opération mal formée"})
    s.commit()
    s.info["nouveaux_messages"] = nouveaux  # pour les notifications (serveur.py, après la réponse)
    mes = s.scalars(select(Groupe).join(Membre, Membre.groupe_id == Groupe.id).where(Membre.utilisateur_id == u.id)).all()
    d = date(depuis) if depuis else None
    neuf = lambda t: d is None or date(iso(t)) >= d - MARGE  # noqa: E731
    gids = [g.id for g in mes]
    sorties = s.scalars(select(Sortie).where(Sortie.supprime_le.is_(None), or_(
        Sortie.groupe_id.in_(gids),
        Sortie.id.in_(select(Participant.sortie_id).where(Participant.utilisateur_id == u.id))))).all()
    sids = [so.id for so in sorties]
    traces = s.scalars(select(TracePartagee).where(or_(TracePartagee.groupe_id.in_(gids), TracePartagee.sortie_id.in_(sids)))
                       .order_by(TracePartagee.cree_le)).all()
    plannings = s.scalars(select(Planning).where(Planning.groupe_id.in_(gids)).order_by(Planning.cree_le)).all()
    photos = s.scalars(select(Photo).where(Photo.sortie_id.in_(sids)).order_by(Photo.prise_le)).all()
    depenses = s.scalars(select(Depense).where(Depense.sortie_id.in_(sids)).order_by(Depense.jour, Depense.cree_le)).all()
    hebergements = s.scalars(select(Hebergement).where(Hebergement.sortie_id.in_(sids)).order_by(Hebergement.cree_le)).all()
    # Messages : ceux des 90 derniers jours seulement.
    messages = s.scalars(select(MessageBuddy).where(or_(MessageBuddy.groupe_id.in_(gids), MessageBuddy.sortie_id.in_(sids)),
                                                    MessageBuddy.cree_le > debut - GARDE_MESSAGES)
                         .order_by(MessageBuddy.cree_le)).all()
    reactions: dict[uuid.UUID, list[dict[str, str]]] = {}
    neufs = [m for m in messages if neuf(m.modifie_le)]
    for r in s.scalars(select(ReactionBuddy).where(ReactionBuddy.message_id.in_([m.id for m in neufs])).order_by(ReactionBuddy.cree_le)):
        reactions.setdefault(r.message_id, []).append({"qui": str(r.utilisateur_id), "emoji": r.emoji})
    votes: dict[uuid.UUID, list[dict[str, Any]]] = {}
    for v in s.scalars(select(VoteBuddy).where(VoteBuddy.message_id.in_([m.id for m in neufs if m.sondage])).order_by(VoteBuddy.cree_le)):
        votes.setdefault(v.message_id, []).append({"qui": str(v.utilisateur_id), "option": v.option})
    fichiers = {f.id: f for f in s.scalars(select(FichierBuddy).where(FichierBuddy.id.in_([m.fichier_id for m in neufs if m.fichier_id])))}
    lectures = vue_lectures(s, u, gids, sids)
    # Positions : toujours toutes (peu nombreuses), seulement des participants, et oubliées après 48 h.
    positions = s.scalars(select(Position).join(Participant, (Participant.sortie_id == Position.sortie_id)
                                                & (Participant.utilisateur_id == Position.utilisateur_id))
                          .where(Position.sortie_id.in_(sids), Position.modifie_le > debut - GARDE_POSITIONS)).all()
    # Hors sortie (§7.14) : celles partagées avec mes groupes, par qui en est encore membre.
    positions_g = s.scalars(select(PositionGroupe).join(Membre, (Membre.groupe_id == PositionGroupe.groupe_id)
                                                        & (Membre.utilisateur_id == PositionGroupe.utilisateur_id))
                            .where(PositionGroupe.groupe_id.in_(gids), PositionGroupe.modifie_le > debut - GARDE_POSITIONS)).all()
    return {"curseur": iso(debut), "moi": str(u.id), "roles": droits.vue_roles(u), "ids": [str(g) for g in gids],
            "groupes": [vue_groupe(s, g) for g in mes if neuf(g.modifie_le)],
            "ids_sorties": [str(x) for x in sids], "sorties": [vue_sortie(s, so) for so in sorties if neuf(so.modifie_le)],
            "ids_traces": [str(t.id) for t in traces], "traces": [vue_trace(s, t) for t in traces if neuf(t.cree_le)],
            "ids_plannings": [str(p.id) for p in plannings],
            "plannings": [vue_planning(s, p) for p in plannings if neuf(p.modifie_le)],
            "ids_photos": [str(p.id) for p in photos], "photos": [vue_photo(s, p) for p in photos if neuf(p.modifie_le)],
            "ids_depenses": [str(x.id) for x in depenses], "depenses": [vue_depense(x) for x in depenses if neuf(x.modifie_le)],
            "ids_hebergements": [str(h.id) for h in hebergements],
            "hebergements": [vue_hebergement(s, h) for h in hebergements if neuf(h.modifie_le)],
            "ids_messages": [str(m.id) for m in messages], "messages": [vue_message(m, reactions.get(m.id, []), votes.get(m.id, []), fichiers.get(m.fichier_id)) for m in neufs],
            "lectures": lectures, "ecrivent": ecrivent(u, gids + sids),
            "positions": [vue_position(x) for x in [*positions, *positions_g]], "appels": appels_en_cours(s, gids, sids), "refus": refus}


def vue_sortie(s: Session, so: Sortie) -> dict[str, Any]:
    qui = s.scalars(select(Utilisateur).join(Participant, Participant.utilisateur_id == Utilisateur.id)
                    .where(Participant.sortie_id == so.id)).all()
    invitations = s.scalars(select(Invitation).where(Invitation.sortie_id == so.id, Invitation.acceptee_par.is_(None),
                                                     Invitation.expire_le > maintenant()).order_by(Invitation.cree_le)).all()
    return {
        "id": str(so.id), "groupe": str(so.groupe_id), "nom": so.nom, "photo": so.photo, "debut": so.debut, "fin": so.fin,
        "lieu": so.lieu, "modifie_le": iso(so.modifie_le), "par": str(so.cree_par), "participants": [personne(x) for x in qui],
        "invitations": [{"id": str(i.id), "code": i.code, "canal": i.canal, "nom": i.nom, "contact": i.contact,
                         "par": str(i.invite_par)} for i in invitations],
        "carnet": vue_carnet(s, so),
    }


def vue_carnet(s: Session, so: Sortie) -> dict[str, Any]:
    c = s.get(Carnet, so.id)
    recits = s.execute(select(Recit, Utilisateur).join(Utilisateur, Utilisateur.id == Recit.utilisateur_id)
                       .where(Recit.sortie_id == so.id).order_by(Recit.modifie_le)).all()
    fiches = s.scalars(select(FicheJour).where(FicheJour.sortie_id == so.id).order_by(FicheJour.jour)).all()
    return {
        "difficulte": c.difficulte if c else "", "meteo": c.meteo if c else "", "conditions": c.conditions if c else "",
        "recits": [{"par": personne(x), "texte": r.texte, "modifie_le": iso(r.modifie_le)} for r, x in recits],
        "fiches": [{"jour": f.jour, "nom": f.nom, "depart": f.depart, "duree": f.duree, "distance": f.distance,
                    "denivele": f.denivele} for f in fiches],
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


def vue_photo(s: Session, p: Photo) -> dict[str, Any]:
    return {"id": str(p.id), "sortie": str(p.sortie_id), "par": personne(s.get(Utilisateur, p.par)), "prise_le": p.prise_le,
            "lon": p.lon, "lat": p.lat, "etoile": p.etoile, "envoyee": p.envoyee, "video": p.video, "modifie_le": iso(p.modifie_le)}


def vue_depense(x: Depense) -> dict[str, Any]:
    return {"id": str(x.id), "sortie": str(x.sortie_id), "titre": x.titre, "montant": x.montant, "paye_par": str(x.paye_par),
            "pour": json.loads(x.pour), "jour": x.jour, "par": str(x.par), "modifie_le": iso(x.modifie_le)}


def vue_hebergement(s: Session, h: Hebergement) -> dict[str, Any]:
    coeurs = s.scalars(select(Coeur.utilisateur_id).where(Coeur.hebergement_id == h.id)).all()
    return {"id": str(h.id), "sortie": str(h.sortie_id), "nom": h.nom, "nature": h.nature, "prix_nuit": h.prix_nuit,
            "adresse": h.adresse, "url": h.url, "resume": h.resume, "lon": h.lon, "lat": h.lat, "retenu": h.retenu,
            "par": str(h.par), "coeurs": sorted(str(c) for c in coeurs), "cree_le": iso(h.cree_le), "modifie_le": iso(h.modifie_le)}


def vue_message(m: MessageBuddy, reactions: list[dict[str, str]] | None = None, votes: list[dict[str, Any]] | None = None,
                f: FichierBuddy | None = None) -> dict[str, Any]:
    return {"id": str(m.id), "groupe": str(m.groupe_id) if m.groupe_id else None, "sortie": str(m.sortie_id) if m.sortie_id else None,
            "par": str(m.par), "nature": m.nature, "texte": m.texte, "lon": m.lon, "lat": m.lat,
            "photo": str(m.photo_id) if m.photo_id else None, "bud": m.bud, "cree_le": iso(m.cree_le),
            "repond_a": str(m.repond_a) if m.repond_a else None, "edite": m.edite_le is not None, "supprime": m.supprime,
            "reactions": reactions or [], "transfere": m.transfere,
            "fichier": {"id": str(f.id), "nom": f.nom, "mime": f.mime, "taille": f.taille, "envoye": f.envoye} if f else None,
            "sondage": {**json.loads(m.sondage), "votes": votes or []} if m.sondage else None}


# « écrit… » (§7.13) : gardé en mémoire quelques secondes, jamais en base.
ECRIVENT: dict[uuid.UUID, dict[uuid.UUID, datetime]] = {}
DUREE_ECRIT = timedelta(seconds=12)


def ecrit(s: Session, u: Utilisateur, cle: Any) -> None:
    c = uuid.UUID(str(cle))
    if s.get(Sortie, c) is not None:
        sortie_de(s, u, c)
    else:
        groupe_de(s, u, c)
    ECRIVENT.setdefault(c, {})[u.id] = maintenant()


def ecrivent(u: Utilisateur, cles: list) -> list[dict[str, str]]:
    t = maintenant() - DUREE_ECRIT
    return [{"cle": str(c), "qui": str(q)} for c in cles for q, quand in ECRIVENT.get(c, {}).items() if q != u.id and quand > t]


def vue_lectures(s: Session, u: Utilisateur, gids: list, sids: list) -> list[dict[str, Any]]:
    """Coches des messages (§5.6) : pour chaque buddy de mes conversations, sa dernière synchro (« reçu ») et
    jusqu'où il a lu chacune (« lu »)."""
    qui = set(s.scalars(select(Membre.utilisateur_id).where(Membre.groupe_id.in_(gids))))
    qui |= set(s.scalars(select(Participant.utilisateur_id).where(Participant.sortie_id.in_(sids))))
    qui.discard(u.id)
    cles = set(gids) | set(sids)
    lus: dict[uuid.UUID, dict[str, str | None]] = {}
    for l in s.scalars(select(LectureBuddy).where(LectureBuddy.utilisateur_id.in_(qui))):
        if l.cle in cles:
            lus.setdefault(l.utilisateur_id, {})[str(l.cle)] = iso(l.lu_le)
    return [{"qui": str(x.id), "vu_le": iso(x.vu_le), "lus": lus.get(x.id, {})}
            for x in s.scalars(select(Utilisateur).where(Utilisateur.id.in_(qui)))]


def vue_position(x: Position | PositionGroupe) -> dict[str, Any]:
    dest = {"groupe": str(x.groupe_id)} if isinstance(x, PositionGroupe) else {"sortie": str(x.sortie_id)}
    return {**dest, "qui": str(x.utilisateur_id), "depuis": x.depuis, "jusqu": x.jusqu,
            "lon": x.lon, "lat": x.lat, "alt": x.alt, "prise_le": x.prise_le}


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


def appels_en_cours(s: Session, gids: list, sids: list) -> list[dict[str, Any]]:
    import appels  # appels.py s'appuie sur ce module
    return appels.appels_en_cours(s, gids, sids)


def profil_change(s: Session, u: Utilisateur) -> None:
    """Pseudo ou photo changés : les buddies le reçoivent à leur prochaine synchro."""
    for g in s.scalars(select(Groupe).join(Membre, Membre.groupe_id == Groupe.id).where(Membre.utilisateur_id == u.id)):
        toucher(g)
    for so in s.scalars(select(Sortie).join(Participant, Participant.sortie_id == Sortie.id).where(Participant.utilisateur_id == u.id)):
        toucher(so)
