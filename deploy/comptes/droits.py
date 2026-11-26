"""Le seul endroit qui lit les rôles (spec/buddies.md §7.17), comme `comptes/roles.py` d'AppBase : aucune
autre partie du serveur ne teste un rôle elle-même.

Trois étages : l'appli (tout le monde, plus le Super User), le club facultatif (`Organisation`, rôles
membre / admin / admin_principal cumulables, comme une école d'AppBase), puis le Groupe (`Membre.role`).
Le Super User passe partout ; un admin du club passe dans les Groupes-sections de son club.
"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from modeles import Groupe, Membre, RoleOrganisation, Utilisateur

MEMBRE = "membre"
ADMIN = "admin"
ADMIN_PRINCIPAL = "admin_principal"


def est_super_user(u: Utilisateur) -> bool:
    return bool(u.super_user)


def roles_club(s: Session, u: Utilisateur, organisation_id: uuid.UUID | None) -> set[str]:
    if organisation_id is None:
        return set()
    return set(s.scalars(select(RoleOrganisation.role).where(
        RoleOrganisation.organisation_id == organisation_id, RoleOrganisation.utilisateur_id == u.id)))


def admin_du_club(s: Session, u: Utilisateur, organisation_id: uuid.UUID | None) -> bool:
    """Admin ou Admin principal du club (un Admin principal est toujours aussi admin), ou Super User."""
    return est_super_user(u) or bool(roles_club(s, u, organisation_id) & {ADMIN, ADMIN_PRINCIPAL})


def admin_principal_du_club(s: Session, u: Utilisateur, organisation_id: uuid.UUID | None) -> bool:
    return est_super_user(u) or ADMIN_PRINCIPAL in roles_club(s, u, organisation_id)


def role_dans_le_groupe(s: Session, u: Utilisateur, g: Groupe) -> str | None:
    m = s.get(Membre, (g.id, u.id))
    return m.role if m else None


def admin_du_groupe(s: Session, u: Utilisateur, g: Groupe) -> bool:
    """Admin ou Admin principal du Groupe, admin de son club, ou Super User : retire un membre, supprime la
    sortie, le message ou la photo d'un autre."""
    return role_dans_le_groupe(s, u, g) in (ADMIN, ADMIN_PRINCIPAL) or admin_du_club(s, u, g.organisation_id)


def admin_principal_du_groupe(s: Session, u: Utilisateur, g: Groupe) -> bool:
    """Admin principal du Groupe (ou de son club), ou Super User : nomme et retire les admins, transmet son rôle."""
    return role_dans_le_groupe(s, u, g) == ADMIN_PRINCIPAL or admin_principal_du_club(s, u, g.organisation_id)


def peut_retirer(s: Session, u: Utilisateur, g: Groupe, cible: Membre) -> bool:
    """Un admin retire un membre ; un admin, seul l'Admin principal le retire ; l'Admin principal, seul le Super User."""
    if cible.role == ADMIN_PRINCIPAL:
        return est_super_user(u)
    if cible.role == ADMIN:
        return admin_principal_du_groupe(s, u, g)
    return admin_du_groupe(s, u, g)


def vue_roles(u: Utilisateur) -> dict[str, bool]:
    """Ce que l'appli sait de mes rôles au niveau de l'appli (les rôles de Groupe sont dans chaque Groupe)."""
    return {"super_user": est_super_user(u)}
