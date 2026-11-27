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
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session

import logging

import droits
import mails
from modeles import (Blocage, BuddyCount, Carnet, Coeur, DemandeEntree, Depense, Dispo, FicheJour, FichierBuddy, Groupe, Hebergement, Invitation, Journal, LectureBuddy, MaTrace, Membre, MessageBuddy, Participant, Photo, Planning,
                     Position, PositionGroupe, ReactionBuddy, Recit, Signalement, Sortie, TracePartagee, VoteBuddy, Utilisateur, Voiture, maintenant)

log = logging.getLogger(__name__)
DUREE_INVITATION = timedelta(days=30)
# Lien « un admin accepte » (Seb, 27/11, §7.29) : il ne périme pas (on peut l'épingler dans un groupe WhatsApp).
SANS_FIN = timedelta(days=36500)
CANAUX = {"sms", "mail", "contacts", "qr", "lien"}
# Groupe perso (ex-Me Time) : un par personne, même identifiant sur tous ses téléphones.
ESPACE_ME_TIME = uuid.UUID("6f0c2f7e-5b8f-4a43-9a2e-0c1f6d2b7d11")
# Discussion à deux : toujours la même pour deux buddies (comme AppBase), même identifiant chez l'un et l'autre.
ESPACE_DUO = uuid.UUID("0b6d8f4e-2c1a-4e57-9f3d-6a1e5c7b9d20")
# Marge sur « depuis » : une écriture en cours au moment de la lecture n'est pas manquée (renvoyer deux fois
# un groupe ne coûte rien, le téléphone le remplace). L'heure d'un changement est posée quand l'opération passe,
# mais il n'est visible qu'à la fin de l'envoi : la marge doit couvrir le plus long envoi (des centaines de photos
# d'un coup, ou une attente derrière un autre envoi), sinon ce changement était manqué pour toujours.
MARGE = timedelta(seconds=30)
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


def support(s: Session, u: Utilisateur, op: dict) -> None:
    """Écrire au support (Seb, 26 novembre) : une discussion à deux avec le ou les Super Users, toujours la même ;
    `infos` (version de l'appli, téléphone) devient son nom, que le Super User voit sous le pseudo."""
    gid = uuid.uuid5(ESPACE_DUO, f"support:{u.id}")
    sus = set(s.scalars(select(Utilisateur.id).where(Utilisateur.super_user.is_(True))))
    if not sus - {u.id}:
        raise Refus("Le support n'est pas encore ouvert")
    g = s.get(Groupe, gid)
    if g is None:
        g = Groupe(id=gid, nom="", nature="support", cree_par=u.id)
        s.add(g)
        s.flush()
    if op.get("infos"):
        g.nom = propre(op["infos"], 120)
    for x in {u.id, *sus}:
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
    if g is None or g.supprime_le is not None:
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


def supprimer_groupe(s: Session, u: Utilisateur, op: dict) -> None:
    """Supprimer un groupe (un admin, Seb 26 novembre) : caché de tous avec ses sorties, rien n'est effacé."""
    g = s.get(Groupe, uuid.UUID(str(op["groupe"])))
    if g is None or g.supprime_le is not None:
        return  # déjà fait
    g = groupe_de(s, u, op["groupe"], admin=True)
    if g.nature != "bande":
        raise Refus("Seul un groupe de buddies se supprime")
    g.supprime_le = maintenant()
    toucher(g)


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
    # Deux liens de groupe au choix (Seb, 27/11) : « un admin accepte » (sans fin) ou « entrée directe » (30 jours).
    approbation = bool(op.get("approbation")) and canal == "qr" and sortie is None
    s.add(Invitation(id=iid, code=code, groupe_id=g.id, sortie_id=sortie.id if sortie else None, invite_par=u.id,
                     canal=canal, nom=propre(op.get("nom"), 80), contact=contact, approbation=approbation,
                     email=contact.lower() if canal == "mail" else None,
                     expire_le=maintenant() + (SANS_FIN if approbation else DUREE_INVITATION)))
    toucher(sortie or g)
    if canal == "mail" and contact:
        s.info.setdefault("mails", []).append(iid)


def renvoyer_mail(s: Session, u: Utilisateur, op: dict) -> None:
    """« Renvoyer » sous une invitation par mail qui n'est pas partie."""
    inv = s.get(Invitation, uuid.UUID(str(op["invitation"])))
    if inv is None or inv.canal != "mail":
        return
    g = groupe_de(s, u, inv.groupe_id)
    inv.mail = None
    toucher(s.get(Sortie, inv.sortie_id) if inv.sortie_id else g)
    s.info.setdefault("mails", []).append(inv.id)


def envoyer_mails(Sessions, ids: list[uuid.UUID]) -> None:
    """Envoie les mails d'invitation et note le résultat, que le téléphone affiche (« mail envoyé » / « non parti »)."""
    for iid in ids:
        with Sessions() as s:
            inv = s.get(Invitation, iid)
            if inv is None or inv.mail == "envoye":
                continue
            par = s.get(Utilisateur, inv.invite_par)
            sortie = s.get(Sortie, inv.sortie_id) if inv.sortie_id else None
            g = s.get(Groupe, inv.groupe_id)
            try:
                mails.invitation(inv.contact, inv.nom if inv.nom != inv.contact else "", personne(par)["pseudo"], (sortie or g).nom,
                                 inv.code, sortie=sortie is not None, repondre_a=par.email)
                inv.mail = "envoye"
            except Exception:  # noqa: BLE001  (pas de SMTP, Brevo refuse, adresse invalide…)
                log.exception("Invitation par mail non partie (%s)", iid)
                inv.mail = "erreur"
            toucher(sortie or g)
            s.commit()


def noter(s: Session, u: Utilisateur, quoi: str, detail: str = "") -> None:
    """Une ligne du journal du Super User (jamais pour le Super User lui-même, Seb 27/11)."""
    if not u.super_user:
        s.add(Journal(utilisateur_id=u.id, quoi=quoi, detail=detail[:120]))


def rejoindre(s: Session, u: Utilisateur, op: dict) -> None:
    inv = s.scalar(select(Invitation).where(Invitation.code == str(op.get("code") or "")))
    if inv is None or inv.groupe_id is None or s.get(Groupe, inv.groupe_id).supprime_le is not None:
        raise Refus("Invitation inconnue")
    if inv.sortie_id:  # une sortie de Me Time : participant seulement
        if s.get(Participant, (inv.sortie_id, u.id)) is not None:
            return
    elif membre(s, inv.groupe_id, u.id) is not None:
        return  # déjà dans le groupe (opération renvoyée)
    if date(iso(inv.expire_le)) < maintenant():
        raise Refus("Invitation expirée : demande un nouveau lien")
    if inv.approbation and not inv.sortie_id:
        demander(s, u, s.get(Groupe, inv.groupe_id))
        return
    if inv.sortie_id:
        cible = s.get(Sortie, inv.sortie_id)
        deja = list(participants(s, cible))
        s.add(Participant(sortie_id=inv.sortie_id, utilisateur_id=u.id))
    else:
        cible = s.get(Groupe, inv.groupe_id)
        deja = list(s.scalars(select(Membre.utilisateur_id).where(Membre.groupe_id == cible.id)))
        s.add(Membre(groupe_id=inv.groupe_id, utilisateur_id=u.id, role="membre"))
    noter(s, u, "rejoint", cible.nom)
    if inv.acceptee_par is None and inv.canal != "qr":
        inv.acceptee_par = u.id
    toucher(cible)
    # 🔔 Seb, 27/11 : ceux qui y sont déjà sont prévenus de l'arrivée.
    prevenir(s, u, deja, cible, cible.nom, "a rejoint la sortie" if inv.sortie_id else "a rejoint le groupe")


def demander(s: Session, u: Utilisateur, g: Groupe) -> None:
    """Lien « un admin accepte » (§7.29) : une demande, que les admins voient dans le groupe ; ils sont prévenus."""
    if s.get(DemandeEntree, (g.id, u.id)) is not None:
        return
    s.add(DemandeEntree(groupe_id=g.id, utilisateur_id=u.id))
    toucher(g)
    admins = s.scalars(select(Membre.utilisateur_id).where(Membre.groupe_id == g.id, Membre.role != droits.MEMBRE)).all()
    prevenir(s, u, list(admins), g, g.nom, "demande à entrer dans le groupe")


def accepter_demande(s: Session, u: Utilisateur, op: dict) -> None:
    """Un admin accepte (ou refuse, `oui` faux) une demande pour entrer dans le groupe."""
    g = groupe_de(s, u, op["groupe"], admin=True)
    d = s.get(DemandeEntree, (g.id, uuid.UUID(str(op["buddy"]))))
    if d is None:
        return  # déjà traitée (par un autre admin, ou opération renvoyée)
    if op.get("oui") and membre(s, g.id, d.utilisateur_id) is None:
        s.add(Membre(groupe_id=g.id, utilisateur_id=d.utilisateur_id, role="membre"))
        prevenir(s, u, [d.utilisateur_id], g, g.nom, "t'a fait entrer dans le groupe")
        noter(s, s.get(Utilisateur, d.utilisateur_id), "rejoint", g.nom)
    s.delete(d)
    toucher(g)


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
    for t in (Participant, Invitation, BuddyCount):
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
    qui = participants(s, so) if so else set(s.scalars(select(Membre.utilisateur_id).where(Membre.groupe_id == g.id)))
    prevenir(s, u, list(qui), so or g, (so or g).nom, f"a partagé la trace « {propre(op.get('nom'), 80) or 'Trace'} »")


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
    ajoutees = s.info.setdefault("photos_ajoutees", {})
    ajoutees[so.id] = ajoutees.get(so.id, 0) + 1


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


def caisse(s: Session, u: Utilisateur, sortie: Any = None, count: Any = None) -> tuple[Any, set[uuid.UUID], Groupe | None, BuddyCount | None]:
    """Le Buddy count visé (§7.20) : une sortie, ou un Buddy count de groupe. Rend de quoi toucher, qui partage les
    frais (participants ou membres), le groupe (pour les admins) et la ligne d'état (ouvert, fermé, supprimé)."""
    if count is not None:
        c = s.get(BuddyCount, uuid.UUID(str(count)))
        if c is None or c.groupe_id is None or c.supprime_le is not None:
            raise Refus("Buddy count inconnu")
        g = groupe_de(s, u, c.groupe_id)
        qui = set(s.scalars(select(Membre.utilisateur_id).where(Membre.groupe_id == g.id)))
        return g, qui, g, c
    so = sortie_de(s, u, sortie)
    c = s.scalar(select(BuddyCount).where(BuddyCount.sortie_id == so.id))
    return so, participants(s, so), s.get(Groupe, so.groupe_id), c


def depense(s: Session, u: Utilisateur, op: dict) -> None:
    """Buddy count (§5.10) : ajoute ou corrige une dépense. Qui paie et pour qui : des buddies de la sortie (ou du
    groupe, pour un Buddy count de groupe). Fermé : plus rien ne s'ajoute ni ne change."""
    did = uuid.UUID(str(op["depense"]))
    d = s.get(Depense, did)
    if d is not None:
        lieu, qui, _, c = caisse(s, u, d.sortie_id, d.count_id)
    else:
        lieu, qui, _, c = caisse(s, u, op.get("sortie"), op.get("count"))
    # Plus d'ouvert/fermé (Seb, 26 novembre : « ils existent tout le temps ») ; seul un Buddy count supprimé refuse.
    if c is not None and c.supprime_le is not None:
        raise Refus("Ce Buddy count est supprimé")
    titre = propre(op.get("titre"), 80) or "Dépense"
    montant = int(op.get("montant"))
    if not 1 <= montant <= 10_000_000:
        raise Refus("Montant hors limites")
    paye_par = uuid.UUID(str(op["paye_par"]))
    pour = sorted({str(uuid.UUID(str(x))) for x in op.get("pour") or []})
    if paye_par not in qui or not pour or any(uuid.UUID(x) not in qui for x in pour):
        raise Refus("Seuls les buddies de la sortie partagent ses frais")
    if d is not None and d.remb:
        raise Refus("Un remboursement ne se modifie pas : retire-le")
    champs = {"titre": titre, "montant": montant, "paye_par": paye_par, "pour": json.dumps(pour), "jour": jour(op.get("jour"))}
    if d is None:
        if isinstance(lieu, Sortie):
            s.add(Depense(id=did, sortie_id=lieu.id, par=u.id, **champs))
        else:
            s.add(Depense(id=did, count_id=c.id, par=u.id, **champs))
    else:
        for k, v in champs.items():
            setattr(d, k, v)
        d.modifie_le = maintenant()
    toucher(lieu)


MOYENS = {"virement": "par virement", "wero": "par Wero", "especes": "en espèces", "autre": ""}


def prevenir(s: Session, u: Utilisateur, qui: list[uuid.UUID], lieu: Any, titre: str, texte: str) -> None:
    """🔔 Les seules notifications avec les messages (Seb, 26 novembre) : paiements et partages. Même forme qu'un
    message (la toucher ouvre la conversation de la sortie ou du groupe) ; envoyées après la réponse (serveur.py)."""
    qui = [x for x in qui if x != u.id]
    if not qui:
        return
    so = lieu if isinstance(lieu, Sortie) else None
    s.info.setdefault("a_prevenir", []).append((qui, {
        "type": "message", "cle": str(lieu.id), "groupe": "" if so else str(lieu.id), "sortie": str(so.id) if so else "",
        "titre": titre, "de": personne(u)["pseudo"], "texte": texte, "duo": "",
        "envoye_le": str(int(datetime.now(timezone.utc).timestamp() * 1000))}))


def prevenir_paiement(s: Session, u: Utilisateur, qui: uuid.UUID, lieu: Any, c: BuddyCount | None, texte: str) -> None:
    so = lieu if isinstance(lieu, Sortie) else None
    prevenir(s, u, [qui], lieu, so.nom if so else (c.nom if c else lieu.nom), texte)


def paye(s: Session, u: Utilisateur, op: dict) -> None:
    """« J'ai payé » (Seb, 26 novembre) : je dis avoir remboursé un buddy ; il est prévenu. Rien ne compte dans les
    équilibres avant son « OK, reçu »."""
    did = uuid.UUID(str(op["depense"]))
    if s.get(Depense, did) is not None:
        return  # déjà reçue
    lieu, qui, _, c = caisse(s, u, op.get("sortie"), op.get("count"))
    a = uuid.UUID(str(op["a"]))
    if a == u.id or a not in qui or u.id not in qui:
        raise Refus("On rembourse un buddy de ce Buddy count")
    montant = int(op.get("montant"))
    if not 1 <= montant <= 10_000_000:
        raise Refus("Montant hors limites")
    moyen = op.get("moyen") if op.get("moyen") in MOYENS else "autre"
    champs = {"titre": "Remboursement", "montant": montant, "paye_par": u.id, "pour": json.dumps([str(a)]), "jour": jour(op.get("jour") or maintenant().date().isoformat()),
              "remb": "annonce", "moyen": moyen, "par": u.id}
    if isinstance(lieu, Sortie):
        s.add(Depense(id=did, sortie_id=lieu.id, **champs))
    else:
        s.add(Depense(id=did, count_id=c.id, **champs))
    toucher(lieu)
    prevenir_paiement(s, u, a, lieu, c, f"dit t'avoir payé {montant // 100} € {MOYENS[moyen]}".strip())


def recu(s: Session, u: Utilisateur, op: dict) -> None:
    """« OK, reçu » (le remboursement compte) ou « Pas reçu » (il disparaît, celui qui a payé est prévenu)."""
    d = s.get(Depense, uuid.UUID(str(op["depense"])))
    if d is None or d.remb != "annonce":
        return  # déjà fait
    if json.loads(d.pour) != [str(u.id)]:
        raise Refus("Seul celui qui a reçu l'argent le confirme")
    lieu, _, _, c = caisse(s, u, d.sortie_id, d.count_id)
    if op.get("ok"):
        d.remb, d.modifie_le = "recu", maintenant()
        prevenir_paiement(s, u, d.paye_par, lieu, c, f"a bien reçu tes {d.montant // 100} €")
    else:
        s.delete(d)
        prevenir_paiement(s, u, d.paye_par, lieu, c, f"n'a pas reçu tes {d.montant // 100} €")
    toucher(lieu)


def a_moi_ou_admin(s: Session, u: Utilisateur, par: uuid.UUID, so: Sortie, quoi: str) -> None:
    """La règle de Seb (26 novembre) : un membre ne supprime que ce qu'il a apporté ; un admin du groupe, tout."""
    if par != u.id and not droits.admin_du_groupe(s, u, s.get(Groupe, so.groupe_id)):
        raise Refus(f"Seul celui qui a ajouté {quoi} (ou un admin du groupe) peut le retirer")


def retirer_depense(s: Session, u: Utilisateur, op: dict) -> None:
    d = s.get(Depense, uuid.UUID(str(op["depense"])))
    if d is None:
        return  # déjà retirée
    lieu, _, g, c = caisse(s, u, d.sortie_id, d.count_id)
    if d.par != u.id and not (g is not None and droits.admin_du_groupe(s, u, g)):
        raise Refus("Seul celui qui a ajouté cette dépense (ou un admin du groupe) peut le retirer")
    s.delete(d)
    toucher(lieu)


def buddy_count(s: Session, u: Utilisateur, op: dict) -> None:
    """Créer un Buddy count de groupe (`groupe`, `nom`), ou changer un Buddy count : `nom`, `ferme` (tout membre),
    `supprime` (un admin du groupe ; caché, rien n'est effacé). Celui d'une sortie se vise par `sortie`."""
    cid = uuid.UUID(str(op["count"]))
    c = s.get(BuddyCount, cid)
    if op.get("sortie") and c is None:
        so = sortie_de(s, u, op["sortie"])
        c = s.scalar(select(BuddyCount).where(BuddyCount.sortie_id == so.id))
        if c is None:  # sa ligne naît au premier changement ; renvoyée d'un autre téléphone : la même
            c = BuddyCount(id=cid, sortie_id=so.id, par=u.id)
            s.add(c)
    elif c is None:
        g = groupe_de(s, u, op["groupe"])
        if g.nature == "me_time":
            raise Refus("Choisis un groupe avec des buddies")
        c = BuddyCount(id=cid, groupe_id=g.id, nom=propre(op.get("nom"), 80) or "Buddy count", par=u.id)
        s.add(c)
        toucher(g)
        return
    if c.sortie_id is not None:
        lieu = sortie_de(s, u, c.sortie_id)
        g = s.get(Groupe, lieu.groupe_id)
    else:
        lieu = g = groupe_de(s, u, c.groupe_id)
    if "supprime" in op:
        if not droits.admin_du_groupe(s, u, g):
            raise Refus("Seul un admin du groupe supprime un Buddy count")
        c.supprime_le = maintenant() if op["supprime"] else None
    if "ferme" in op:
        c.ferme = bool(op["ferme"])
    if "nom" in op and c.groupe_id is not None:
        c.nom = propre(op.get("nom"), 80) or c.nom
    c.modifie_le = maintenant()
    toucher(lieu)


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


def ms_passe(v: Any) -> int:
    """Une heure du téléphone qui date un changement : jamais dans le futur. Un téléphone en avance de 10 minutes
    garait sa voiture « dans 10 minutes » : invisible chez les buddies, et impossible à enlever d'un autre appareil."""
    return min(ms(v), int(maintenant().timestamp() * 1000))


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


def secouer(s: Session) -> None:
    """Un état visible des buddies a changé (voiture garée ou enlevée, position allumée ou éteinte) : après la
    réponse, un push silencieux les fait se synchroniser tout de suite (Seb, 27/11 ; serveur.py)."""
    s.info["secouer"] = True


def copains(s: Session, u: Utilisateur) -> list[uuid.UUID]:
    """Les membres de mes groupes (moi exclu) : ceux qui voient ma voiture et ma position."""
    mes = select(Membre.groupe_id).join(Groupe, Groupe.id == Membre.groupe_id).where(Membre.utilisateur_id == u.id, Groupe.supprime_le.is_(None))
    return list(set(s.scalars(select(Membre.utilisateur_id).where(Membre.groupe_id.in_(mes), Membre.utilisateur_id != u.id))))


def concernes(s: Session, u: Utilisateur) -> set[uuid.UUID]:
    """Ceux qu'un changement de ma part peut toucher : les membres de mes groupes, les participants de mes sorties,
    et moi (mes autres appareils). Pour le flux d'événements (evenements.py)."""
    mes = select(Membre.groupe_id).join(Groupe, Groupe.id == Membre.groupe_id).where(Membre.utilisateur_id == u.id, Groupe.supprime_le.is_(None))
    qui = set(s.scalars(select(Membre.utilisateur_id).where(Membre.groupe_id.in_(mes))))
    sorties = select(Participant.sortie_id).where(Participant.utilisateur_id == u.id)
    return qui | set(s.scalars(select(Participant.utilisateur_id).where(Participant.sortie_id.in_(sorties)))) | {u.id}


def epingle(s: Session, u: Utilisateur, op: dict) -> None:
    """Position des buddies (§5.9) : enfoncer l'épingle (« mes buddies me voient » jusqu'à ce soir) ou la relever."""
    p, nouvelle = ma_position(s, u, op)
    t = ms_passe(op["quand"])
    if op.get("enfoncee"):
        jusqu = min(ms(op["jusqu"]), t + JOUR_MS)
        if jusqu <= t:
            raise Refus("Heure de fin avant le début")
        if p is None:
            s.add(nouvelle(depuis=t, jusqu=jusqu))
        elif p.depuis > t or (p.depuis, p.jusqu) == (t, jusqu):
            return  # renvoyée, ou plus ancienne que la dernière (comme la voiture) : un vieil envoi n'écrase rien
        else:
            p.depuis, p.jusqu, p.modifie_le = t, jusqu, maintenant()
        secouer(s)
    elif p is not None and p.depuis <= t < p.jusqu:
        # `depuis <= t` : relever une épingle d'avant (file d'un autre téléphone, envoyée en retard) ne relève pas
        # celle qu'on a enfoncée depuis.
        p.jusqu, p.modifie_le = t, maintenant()
        secouer(s)


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


# 🚗 Ma voiture (Seb, 27/11) : les silhouettes dessinées dans l'appli (buddies/voitureDessin.ts) et ses couleurs.
FORMES_VOITURE = ("citadine", "berline", "break", "suv", "van", "camping", "pickup", "cabriolet")
COULEURS_VOITURE = ("rouge", "bleu", "blanc", "gris", "noir", "vert", "jaune", "orange")


def vue_voiture(s: Session, v: Voiture) -> dict:
    """Une voiture garée, avec la marque, le modèle, la silhouette et la couleur de son propriétaire."""
    p = s.get(Utilisateur, v.utilisateur_id)
    return {"qui": str(v.utilisateur_id), "lat": v.lat, "lon": v.lon, "garee_le": v.garee_le, "jusqu": v.jusqu,
            "modele": p.voiture_modele if p else None, "forme": p.voiture_forme if p else None,
            "couleur": p.voiture_couleur if p else None}


def voiture(s: Session, u: Utilisateur, op: dict) -> None:
    """🚗 Garer ma voiture ici (appui long) ou l'enlever ; elle s'efface seule à minuit (`jusqu`, un jour au plus)."""
    v = s.get(Voiture, u.id)
    if not op.get("garee"):
        t = ms_passe(op["quand"])
        if v is not None and v.garee_le <= t < v.jusqu:
            v.jusqu, v.modifie_le = t, maintenant()
            secouer(s)
        return
    t = ms_passe(op["garee_le"])
    if v is not None and v.garee_le >= t:
        return  # renvoyée, ou plus ancienne que la dernière
    lat, lon = float(op["lat"]), float(op["lon"])
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("position")
    jusqu = min(ms(op["jusqu"]), t + JOUR_MS)
    if jusqu <= t:
        raise Refus("Heure de fin avant le début")
    if v is None:
        s.add(Voiture(utilisateur_id=u.id, lat=round(lat, 6), lon=round(lon, 6), garee_le=t, jusqu=jusqu))
    else:
        v.lat, v.lon, v.garee_le, v.jusqu, v.modifie_le = round(lat, 6), round(lon, 6), t, jusqu, maintenant()
    secouer(s)


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


NATURES_MESSAGE = {"texte", "point", "photo", "fichier", "sondage", "planning", "carte", "carte_fin"}
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
    planning = None
    if nature == "planning":  # un planning du groupe de la conversation (§7.28) ; son nom pour la notification
        pl = s.get(Planning, uuid.UUID(str(op["planning"])))
        if pl is None or pl.groupe_id != (so.groupe_id if so else g.id):
            raise Refus("Planning inconnu")
        planning, texte = pl.id, pl.nom
    # Réponse à un message de la même conversation (sinon le rappel est ignoré).
    cible = s.get(MessageBuddy, uuid.UUID(str(op["repond_a"]))) if op.get("repond_a") else None
    repond_a = cible.id if cible and (cible.groupe_id, cible.sortie_id) == (None if so else g.id, so.id if so else None) else None
    s.add(MessageBuddy(id=mid, groupe_id=g.id if g else None, sortie_id=so.id if so else None, par=u.id, nature=nature,
                       texte=texte, lon=lon, lat=lat, photo_id=photo, bud=bool(op.get("bud")), repond_a=repond_a,
                       fichier_id=fichier, sondage=sondage, transfere=bool(op.get("transfere")), planning_id=planning))


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
    if m.nature == "planning":
        return "📅 Planning : " + m.texte
    if m.nature == "carte":
        return "🗺 a partagé sa carte"
    if m.nature == "carte_fin":
        return "🗺 a arrêté de partager sa carte"
    return m.texte[:200]


def a_prevenir(s: Session, u: Utilisateur, mids: list[uuid.UUID]) -> list[tuple[list[uuid.UUID], dict[str, str]]]:
    """🔔 Nouveaux messages (§7.13, étape 4) : à qui envoyer une notification, et quoi. Pas à l'auteur."""
    l = []
    for mid in mids:
        m = s.get(MessageBuddy, mid)
        if m is None or m.bud:  # pas de notification pour Bud (Seb, 26 novembre) : seulement les buddies
            continue
        a_deux = False
        if m.sortie_id:
            so = s.get(Sortie, m.sortie_id)
            qui, titre = participants(s, so), so.nom
        else:
            g = s.get(Groupe, m.groupe_id)
            qui = set(s.scalars(select(Membre.utilisateur_id).where(Membre.groupe_id == g.id)))
            a_deux = g.nature in ("duo", "support")
            titre = personne(u)["pseudo"] if a_deux else g.nom
        de = "🐻 Bud" if m.bud else personne(u)["pseudo"]
        texte = resume_message(m, s.get(FichierBuddy, m.fichier_id) if m.fichier_id else None)
        # 🗺 Carte partagée (Seb, 27/11) : une phrase entière, « Seb a partagé sa carte dans <groupe> ».
        ligne = ""
        if m.nature in ("carte", "carte_fin"):
            fait = "a partagé sa carte" if m.nature == "carte" else "a arrêté de partager sa carte"
            ligne = f"{de} {fait} {'avec toi' if a_deux else 'dans ' + titre}"
        bloque = set(s.scalars(select(Blocage.utilisateur_id).where(Blocage.bloque_id == u.id)))
        l.append(([x for x in qui if x != u.id and x not in bloque], {
            # 🗺 Carte partagée : une notification à part, avec Non merci / Suivre (Seb, 27/11, maquette notif-carte).
            "type": "carte" if m.nature == "carte" else "message", "message": str(m.id),
            "cle": str(m.sortie_id or m.groupe_id), "groupe": str(m.groupe_id or ""), "sortie": str(m.sortie_id or ""),
            "titre": titre, "de": de, "texte": texte, "duo": "1" if a_deux else "", "ligne": ligne,
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
    m.fichier_id = m.sondage = m.planning_id = None
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


# ------------------------------------------------------------------ 🚩 signaler, 🚫 bloquer (Play Store)

MOTIFS = {"insulte", "choquant", "pub", "autre"}
SUITES = {"ignore", "efface", "retire"}


def bloquer(s: Session, u: Utilisateur, op: dict) -> None:
    """Je bloque un buddy : ses messages se replient chez moi, il ne voit plus ma position. Il n'est pas prévenu."""
    autre = uuid.UUID(str(op["buddy"]))
    if autre == u.id or s.get(Utilisateur, autre) is None:
        raise Refus("Personne inconnue")
    if s.get(Blocage, (u.id, autre)) is None:
        s.add(Blocage(utilisateur_id=u.id, bloque_id=autre))


def donner_scan25(s: Session, u: Utilisateur, op: dict) -> None:
    """Le Super User donne (ou retire) le SCAN 25 à un buddy dans la version du Play Store (spec/play-store.md)."""
    if not u.super_user:
        raise Refus("Réservé au Super User")
    autre = s.get(Utilisateur, uuid.UUID(str(op["buddy"])))
    if autre is None or autre.supprime_le is not None:
        raise Refus("Personne inconnue")
    autre.scan25 = bool(op.get("oui"))


def debloquer(s: Session, u: Utilisateur, op: dict) -> None:
    b = s.get(Blocage, (u.id, uuid.UUID(str(op["buddy"]))))
    if b is not None:
        s.delete(b)


def signaler(s: Session, u: Utilisateur, op: dict) -> None:
    """Signaler un message (ou une personne) au Super User. Le message est gardé tel quel dans `extrait`."""
    sid = uuid.UUID(str(op["signalement"]))
    if s.get(Signalement, sid) is not None:
        return  # renvoyé : déjà là
    motif = str(op.get("motif") or "autre")
    if motif not in MOTIFS:
        raise ValueError("motif")
    m = cible = None
    lieu = ""
    if op.get("message"):
        m, g = message_de(s, u, op["message"])
        if m is None:
            raise Refus("Message inconnu")
        cible = None if m.bud else m.par
        lieu = s.get(Sortie, m.sortie_id).nom if m.sortie_id else (g.nom if g else "")
    else:
        cible = uuid.UUID(str(op["buddy"]))
        if s.get(Utilisateur, cible) is None:
            raise Refus("Personne inconnue")
    if cible == u.id:
        raise Refus("On ne se signale pas soi-même")
    s.add(Signalement(id=sid, par=u.id, cible_id=cible, message_id=m.id if m else None, motif=motif,
                      mot=propre(op.get("mot"), 300), extrait=(m.texte if m else "")[:500], lieu=propre(lieu, 80)))
    sus = list(s.scalars(select(Utilisateur.id).where(Utilisateur.super_user.is_(True), Utilisateur.id != u.id)))
    if sus:
        g = groupe_perso_support(s, u)
        if g is not None:
            prevenir(s, u, sus, g, "Signalement", "a signalé " + ("une réponse de Bud" if m and m.bud else "un message" if m else "une personne"))


def groupe_perso_support(s: Session, u: Utilisateur) -> Groupe | None:
    """La discussion « support » de cette personne, si elle existe : la notification d'un signalement l'ouvre."""
    return s.get(Groupe, uuid.uuid5(ESPACE_DUO, f"support:{u.id}"))


def traiter_signalement(s: Session, u: Utilisateur, op: dict) -> None:
    """Le Super User répond : ignorer, effacer le message (chez tous), ou retirer la personne du groupe."""
    if not u.super_user:
        raise Refus("Réservé au Super User")
    x = s.get(Signalement, uuid.UUID(str(op["signalement"])))
    suite = str(op.get("suite"))
    if x is None or suite not in SUITES:
        raise Refus("Signalement inconnu")
    m = s.get(MessageBuddy, x.message_id) if x.message_id else None
    if suite == "efface" and m is not None and not m.supprime:
        m.supprime, m.texte, m.lon, m.lat, m.photo_id, m.modifie_le = True, "", None, None, None, maintenant()
        m.fichier_id = m.sondage = m.planning_id = None
    if suite == "retire" and m is not None and x.cible_id is not None:
        g = s.get(Groupe, s.get(Sortie, m.sortie_id).groupe_id if m.sortie_id else m.groupe_id)
        mb = membre(s, g.id, x.cible_id) if g is not None and g.nature == "bande" else None
        if mb is not None:
            partir(s, g, mb)
    x.suite = suite


def vue_signalements(s: Session, u: Utilisateur) -> list[dict[str, Any]]:
    """Pour le Super User : ceux à traiter, puis ceux traités ces 30 derniers jours."""
    if not u.super_user:
        return []
    l = s.scalars(select(Signalement).where(or_(Signalement.suite.is_(None), Signalement.cree_le > maintenant() - timedelta(days=30)))
                  .order_by(Signalement.cree_le.desc())).all()
    nom = lambda i: personne(s.get(Utilisateur, i))["pseudo"] if i else "Bud"  # noqa: E731
    return [{"id": str(x.id), "par": nom(x.par), "cible": nom(x.cible_id), "cible_id": str(x.cible_id) if x.cible_id else None,
             "message": str(x.message_id) if x.message_id else None, "motif": x.motif, "mot": x.mot, "extrait": x.extrait,
             "lieu": x.lieu, "suite": x.suite, "le": iso(x.cree_le)} for x in l]


def bloques_par(s: Session, u: Utilisateur):
    """Les personnes qui m'ont bloqué (elles ne doivent plus voir ma position) : sous-requête."""
    return select(Blocage.utilisateur_id).where(Blocage.bloque_id == u.id)


def vue_bloques(s: Session, u: Utilisateur) -> list[dict[str, Any]]:
    return [personne(x) for x in s.scalars(select(Utilisateur).join(Blocage, Blocage.bloque_id == Utilisateur.id)
                                           .where(Blocage.utilisateur_id == u.id).order_by(Blocage.cree_le))]


# ------------------------------------------------------------------ supprimer mon compte (Play Store)

def supprimer_compte(s: Session, u: Utilisateur) -> None:
    """Efface la personne : sa place dans les groupes et sorties, ses photos, positions, voiture, dispos, réactions…
    Ses messages et ses dépenses restent pour les autres, signés « Ancien buddy » (la fiche est vidée, pas effacée)."""
    for p in s.scalars(select(Photo).where(Photo.par == u.id)).all():
        for taille in TAILLES:
            try:
                os.remove(fichier_photo(p.id, taille))
            except OSError:
                pass
        toucher(s.get(Sortie, p.sortie_id))
        s.delete(p)
    s.flush()
    for g, m in s.execute(select(Groupe, Membre).join(Membre, Membre.groupe_id == Groupe.id).where(Membre.utilisateur_id == u.id)).all():
        partir(s, g, m)
    for so in s.scalars(select(Sortie).join(Participant, Participant.sortie_id == Sortie.id).where(Participant.utilisateur_id == u.id)).all():
        toucher(so)
    for table in (Participant, DemandeEntree, Position, PositionGroupe, Voiture, Dispo, Recit, ReactionBuddy, VoteBuddy, LectureBuddy, Coeur, MaTrace):
        s.execute(delete(table).where(table.utilisateur_id == u.id))
    s.execute(delete(Blocage).where(or_(Blocage.utilisateur_id == u.id, Blocage.bloque_id == u.id)))
    s.execute(delete(Invitation).where(Invitation.invite_par == u.id, Invitation.acceptee_par.is_(None)))
    u.logto_id = f"supprime:{u.id}"  # une nouvelle connexion avec le même compte Google repart de zéro
    u.email = u.photo = u.telephone = u.iban = u.wero_numero = None
    u.voiture_modele = u.voiture_forme = u.voiture_couleur = None
    u.pseudo, u.prenom, u.nom, u.wero, u.super_user = "Ancien buddy", "", "", False, False
    u.supprime_le = maintenant()


OPERATIONS = {
    "creer_groupe": creer_groupe, "renommer_groupe": renommer_groupe, "inviter": inviter, "rejoindre": rejoindre, "quitter": quitter,
    "retirer": retirer, "nommer_admin": nommer_admin, "retirer_admin": retirer_admin, "transmettre": transmettre,
    "annuler_invitation": annuler_invitation, "renvoyer_mail": renvoyer_mail, "accepter_demande": accepter_demande,
    "creer_sortie": creer_sortie, "retirer_sortie": retirer_sortie,
    "supprimer_sortie": supprimer_sortie, "supprimer_groupe": supprimer_groupe, "remettre_sortie": remettre_sortie, "renommer_sortie": renommer_sortie, "partager_trace": partager_trace, "creer_planning": creer_planning, "dispo": dispo,
    "ajouter_photo": ajouter_photo, "etoile": etoile, "placer_photo": placer_photo, "retirer_photo": retirer_photo,
    "recit": recit, "fiche": fiche, "carnet": carnet, "depense": depense, "retirer_depense": retirer_depense, "paye": paye, "recu": recu, "buddy_count": buddy_count,
    "epingle": epingle, "position": position, "voiture": voiture, "proposer_hebergement": proposer_hebergement, "coeur": coeur,
    "retenir_hebergement": retenir_hebergement, "retirer_hebergement": retirer_hebergement,
    "message": message, "retirer_message": retirer_message, "duo": duo, "support": support, "modifier_message": modifier_message, "reagir": reagir, "lu": lu, "voter": voter,
    "bloquer": bloquer, "debloquer": debloquer, "signaler": signaler, "traiter_signalement": traiter_signalement,
    "scan25": donner_scan25,
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
        "invitations": [{"id": str(i.id), "code": i.code, "canal": i.canal, "nom": i.nom, "contact": i.contact, "mail": i.mail,
                         "par": str(i.invite_par), "approbation": i.approbation} for i in invitations],
        "demandes": [personne(x) for x in s.scalars(select(Utilisateur).join(DemandeEntree, DemandeEntree.utilisateur_id == Utilisateur.id)
                                                    .where(DemandeEntree.groupe_id == g.id).order_by(DemandeEntree.cree_le))],
    }


def mes_demandes(s: Session, u: Utilisateur) -> list[dict[str, Any]]:
    """Mes demandes pour entrer dans un groupe, en attente d'un admin (« Demande envoyée » sur le téléphone)."""
    return [{"groupe": str(g.id), "nom": g.nom} for g in s.scalars(
        select(Groupe).join(DemandeEntree, DemandeEntree.groupe_id == Groupe.id)
        .where(DemandeEntree.utilisateur_id == u.id, Groupe.supprime_le.is_(None)))]


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
            try:
                with s.begin_nested():
                    f(s, u, op)
            except IntegrityError:
                # Le même envoi arrivé deux fois en même temps (réponse trop lente, le téléphone a renvoyé) : l'autre
                # a créé la ligne le premier. Rejouée, l'opération la trouve et ne fait rien.
                with s.begin_nested():
                    f(s, u, op)
            if neuf_msg:
                nouveaux.append(uuid.UUID(str(op["message"])))
        except (Refus, KeyError, ValueError, TypeError, IndexError, OverflowError, DataError, IntegrityError) as e:
            # Une valeur que la base refuse (nombre démesuré, caractère nul) est refusée comme une opération mal
            # formée : une erreur 500 ici ferait renvoyer la même file sans fin, et plus rien ne partirait du téléphone.
            if not isinstance(e, (Refus, KeyError, ValueError, TypeError, IndexError)):
                log.warning("Opération refusée par la base (%s) : %s", op.get("type"), e)
            refus.append({"id": op.get("id"), "raison": str(e) if isinstance(e, Refus) else "Opération mal formée"})
    # 🔔 Photos ajoutées à un album : une seule notification par sortie et par synchro.
    for sid, n in s.info.pop("photos_ajoutees", {}).items():
        so = s.get(Sortie, sid)
        if so is not None:
            prevenir(s, u, list(participants(s, so)), so, so.nom, "a ajouté une photo à l'album" if n == 1 else f"a ajouté {n} photos à l'album")
    s.commit()
    s.info["nouveaux_messages"] = nouveaux  # pour les notifications (serveur.py, après la réponse)
    mes = s.scalars(select(Groupe).join(Membre, Membre.groupe_id == Groupe.id)
                    .where(Membre.utilisateur_id == u.id, Groupe.supprime_le.is_(None))).all()
    d = date(depuis) if depuis else None
    neuf = lambda t: d is None or date(iso(t)) >= d - MARGE  # noqa: E731
    gids = [g.id for g in mes]
    supprimes = select(Groupe.id).where(Groupe.supprime_le.is_not(None))
    sorties = s.scalars(select(Sortie).where(Sortie.supprime_le.is_(None), Sortie.groupe_id.not_in(supprimes), or_(
        Sortie.groupe_id.in_(gids),
        Sortie.id.in_(select(Participant.sortie_id).where(Participant.utilisateur_id == u.id))))).all()
    sids = [so.id for so in sorties]
    traces = s.scalars(select(TracePartagee).where(or_(TracePartagee.groupe_id.in_(gids), TracePartagee.sortie_id.in_(sids)))
                       .order_by(TracePartagee.cree_le)).all()
    plannings = s.scalars(select(Planning).where(Planning.groupe_id.in_(gids)).order_by(Planning.cree_le)).all()
    photos = s.scalars(select(Photo).where(Photo.sortie_id.in_(sids)).order_by(Photo.prise_le)).all()
    # Buddy counts (§7.20) : ceux de mes groupes et de mes sorties, supprimés compris (le téléphone les cache).
    counts = s.scalars(select(BuddyCount).where(or_(BuddyCount.groupe_id.in_(gids), BuddyCount.sortie_id.in_(sids)))).all()
    depenses = s.scalars(select(Depense).where(or_(Depense.sortie_id.in_(sids), Depense.count_id.in_([c.id for c in counts if c.groupe_id])))
                         .order_by(Depense.jour, Depense.cree_le)).all()
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
                          .where(Position.sortie_id.in_(sids), Position.modifie_le > debut - GARDE_POSITIONS,
                                 Position.utilisateur_id.not_in(bloques_par(s, u)))).all()
    # Hors sortie (§7.14) : celles partagées avec mes groupes, par qui en est encore membre.
    positions_g = s.scalars(select(PositionGroupe).join(Membre, (Membre.groupe_id == PositionGroupe.groupe_id)
                                                        & (Membre.utilisateur_id == PositionGroupe.utilisateur_id))
                            .where(PositionGroupe.groupe_id.in_(gids), PositionGroupe.modifie_le > debut - GARDE_POSITIONS,
                                   PositionGroupe.utilisateur_id.not_in(bloques_par(s, u)))).all()
    # 🚗 Voitures garées : la mienne et celles des membres de mes groupes, tant qu'elles sont là.
    copains = select(Membre.utilisateur_id).where(Membre.groupe_id.in_(gids))
    voitures = s.scalars(select(Voiture).where(or_(Voiture.utilisateur_id == u.id, Voiture.utilisateur_id.in_(copains)),
                                               Voiture.modifie_le > debut - GARDE_POSITIONS, Voiture.utilisateur_id.not_in(bloques_par(s, u)))).all()
    return {"curseur": iso(debut), "moi": str(u.id), "roles": droits.vue_roles(u), "ids": [str(g) for g in gids],
            "groupes": [vue_groupe(s, g) for g in mes if neuf(g.modifie_le)],
            "ids_sorties": [str(x) for x in sids], "sorties": [vue_sortie(s, so) for so in sorties if neuf(so.modifie_le)],
            "ids_traces": [str(t.id) for t in traces], "traces": [vue_trace(s, t) for t in traces if neuf(t.cree_le)],
            "ids_plannings": [str(p.id) for p in plannings],
            "plannings": [vue_planning(s, p) for p in plannings if neuf(p.modifie_le)],
            "ids_photos": [str(p.id) for p in photos], "photos": [vue_photo(s, p) for p in photos if neuf(p.modifie_le)],
            "counts": [vue_count(c) for c in counts], "ids_depenses": [str(x.id) for x in depenses], "depenses": [vue_depense(x) for x in depenses if neuf(x.modifie_le)],
            "ids_hebergements": [str(h.id) for h in hebergements],
            "hebergements": [vue_hebergement(s, h) for h in hebergements if neuf(h.modifie_le)],
            "ids_messages": [str(m.id) for m in messages], "messages": [vue_message(m, reactions.get(m.id, []), votes.get(m.id, []), fichiers.get(m.fichier_id)) for m in neufs],
            "lectures": lectures, "ecrivent": ecrivent(u, gids + sids),
            "positions": [vue_position(x) for x in [*positions, *positions_g]],
            "voitures": [vue_voiture(s, v) for v in voitures], "appels": appels_en_cours(s, gids, sids),
            "paiements": paiements(s, u, depenses), "bloques": vue_bloques(s, u), "signalements": vue_signalements(s, u),
            # SCAN 25 de la version Play : le mien ; et pour le Super User, la liste de ceux qui l'ont.
            "scan25": u.scan25 or u.super_user,
            "scan25_ids": [str(x) for x in s.scalars(select(Utilisateur.id).where(Utilisateur.scan25))] if u.super_user else [],
            "demandes": mes_demandes(s, u), "refus": refus}


def soldes(depenses: list[Depense]) -> dict[uuid.UUID, float]:
    """Solde de chacun dans une sortie, en centimes : + ce qu'il a payé, − sa part (comme count.ts)."""
    sol: dict[uuid.UUID, float] = {}
    for d in depenses:
        pour = [uuid.UUID(x) for x in json.loads(d.pour or "[]")]
        if not pour or d.remb == "annonce":  # « J'ai payé » pas encore confirmé : ne compte pas
            continue
        sol[d.paye_par] = sol.get(d.paye_par, 0) + d.montant
        for q in pour:
            sol[q] = sol.get(q, 0) - d.montant / len(pour)
    return sol


def paiements(s: Session, u: Utilisateur, depenses: list[Depense]) -> dict[str, dict[str, dict[str, str]]]:
    """Comment rembourser (Seb 26/11, spec §7.18) : par sortie où je dois de l'argent, l'IBAN et le Wero de ceux à
    qui l'on doit. Personne d'autre ne les voit (ni les buddies quittes, ni ceux qui ne sont pas de la sortie)."""
    par_sortie: dict[uuid.UUID, list[Depense]] = {}
    for d in depenses:  # par sortie, ou par Buddy count de groupe (§7.20)
        par_sortie.setdefault(d.sortie_id or d.count_id, []).append(d)
    res: dict[str, dict[str, dict[str, str]]] = {}
    for sid, ds in par_sortie.items():
        sol = soldes(ds)
        if sol.get(u.id, 0) > -1:  # moins d'un centime : quitte
            continue
        bc = s.get(BuddyCount, sid) if ds[0].count_id else None
        for qui, v in sol.items():
            dedans = membre(s, bc.groupe_id, qui) if bc is not None else s.get(Participant, (sid, qui))
            if v < 1 or qui == u.id or dedans is None:
                continue
            c = s.get(Utilisateur, qui)
            moyens = {}
            if c and c.iban:
                moyens["iban"] = c.iban
            if c and c.wero and (c.wero_numero or c.telephone):
                moyens["wero"] = c.wero_numero or c.telephone or ""
            if moyens:
                res.setdefault(str(sid), {})[str(qui)] = moyens
    return res


def vue_sortie(s: Session, so: Sortie) -> dict[str, Any]:
    qui = s.scalars(select(Utilisateur).join(Participant, Participant.utilisateur_id == Utilisateur.id)
                    .where(Participant.sortie_id == so.id)).all()
    invitations = s.scalars(select(Invitation).where(Invitation.sortie_id == so.id, Invitation.acceptee_par.is_(None),
                                                     Invitation.expire_le > maintenant()).order_by(Invitation.cree_le)).all()
    return {
        "id": str(so.id), "groupe": str(so.groupe_id), "nom": so.nom, "photo": so.photo, "debut": so.debut, "fin": so.fin,
        "lieu": so.lieu, "modifie_le": iso(so.modifie_le), "par": str(so.cree_par), "participants": [personne(x) for x in qui],
        "invitations": [{"id": str(i.id), "code": i.code, "canal": i.canal, "nom": i.nom, "contact": i.contact, "mail": i.mail,
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


def vue_count(c: BuddyCount) -> dict[str, Any]:
    return {"id": str(c.id), "groupe": str(c.groupe_id) if c.groupe_id else None, "sortie": str(c.sortie_id) if c.sortie_id else None,
            "nom": c.nom, "ferme": c.ferme, "supprime": c.supprime_le is not None, "par": str(c.par), "cree_le": iso(c.cree_le),
            "modifie_le": iso(c.modifie_le)}


def vue_depense(x: Depense) -> dict[str, Any]:
    return {"id": str(x.id), "sortie": str(x.sortie_id) if x.sortie_id else None, "count": str(x.count_id) if x.count_id else None, "titre": x.titre, "montant": x.montant, "paye_par": str(x.paye_par),
            "pour": json.loads(x.pour), "jour": x.jour, "par": str(x.par), "modifie_le": iso(x.modifie_le),
            "remb": x.remb, "moyen": x.moyen}


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
            "reactions": reactions or [], "transfere": m.transfere, "planning": str(m.planning_id) if m.planning_id else None,
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


def apercu_invitation(s: Session, code: str, planning: str = "") -> dict[str, Any] | None:
    """Pour la page du lien (sans connexion) : seulement le nom du groupe et qui invite (et le planning partagé)."""
    inv = s.scalar(select(Invitation).where(Invitation.code == code))
    if inv is None or inv.groupe_id is None or date(iso(inv.expire_le)) < maintenant():
        return None
    g, par = s.get(Groupe, inv.groupe_id), s.get(Utilisateur, inv.invite_par)
    if g is None or g.supprime_le is not None:
        return None
    if inv.sortie_id:
        so = s.get(Sortie, inv.sortie_id)
        return {"groupe": so.nom, "sortie": True, "par": personne(par)["pseudo"], "photo": so.photo}
    n = len(s.scalars(select(Membre.utilisateur_id).where(Membre.groupe_id == g.id)).all())
    a = {"groupe": g.nom, "par": personne(par)["pseudo"], "photo": g.photo, "approbation": inv.approbation, "membres": n}
    try:
        pl = s.get(Planning, uuid.UUID(planning)) if planning else None
    except ValueError:
        pl = None
    if pl is not None and pl.groupe_id == g.id:
        a["planning"] = pl.nom
    return a


def appels_en_cours(s: Session, gids: list, sids: list) -> list[dict[str, Any]]:
    import appels  # appels.py s'appuie sur ce module
    return appels.appels_en_cours(s, gids, sids)


def profil_change(s: Session, u: Utilisateur) -> None:
    """Pseudo ou photo changés : les buddies le reçoivent à leur prochaine synchro."""
    for g in s.scalars(select(Groupe).join(Membre, Membre.groupe_id == Groupe.id).where(Membre.utilisateur_id == u.id)):
        toucher(g)
    for so in s.scalars(select(Sortie).join(Participant, Participant.sortie_id == Sortie.id).where(Participant.utilisateur_id == u.id)):
        toucher(so)
