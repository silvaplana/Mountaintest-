"""Tables du serveur des comptes (SQLAlchemy 2, même style qu'AppBase pour pouvoir y reprendre du code,
par exemple sa messagerie : une conversation par groupe).

Identifiants UUID choisis par le téléphone pour les groupes et invitations : l'appli peut les créer
hors ligne et les renvoyer au retour du réseau sans risque de doublon.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text, Uuid
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def maintenant() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Utilisateur(Base):
    """Un compte Mountain Buddies. L'identité (e-mail, connexion) est chez Logto (`logto_id`) ;
    ici, ce que voient les amis. Un futur branchement d'AppBase sur le même Logto retrouvera
    la même personne par ce `logto_id`."""

    __tablename__ = "utilisateurs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    logto_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    email: Mapped[str | None] = mapped_column(String(320), index=True)
    pseudo: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    # Petite image en data: URL (~256 px), ou adresse https (photo Google).
    photo: Mapped[str | None] = mapped_column(Text)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)
    vu_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)


class Groupe(Base):
    """Buddy Group (spec/buddies.md §5.3). `nature` = « bande » (copains invités) ou « me_time » (le
    Buddy Group par défaut de chacun, créé par le serveur, un seul membre)."""

    __tablename__ = "groupes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    nom: Mapped[str] = mapped_column(String(80), nullable=False)
    nature: Mapped[str] = mapped_column(String(10), nullable=False, default="bande")
    # Petite image en data: URL (~256 px), comme la photo du profil.
    photo: Mapped[str | None] = mapped_column(Text)
    activite: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    cree_par: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)
    modifie_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant, index=True)


class Membre(Base):
    __tablename__ = "membres"
    __table_args__ = (CheckConstraint("role in ('admin', 'membre')", name="membres_role"),)

    groupe_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("groupes.id", ondelete="CASCADE"), primary_key=True)
    utilisateur_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("utilisateurs.id", ondelete="CASCADE"), primary_key=True, index=True)
    role: Mapped[str] = mapped_column(String(10), nullable=False, default="membre")
    rejoint_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)


class Invitation(Base):
    """Lien envoyé par SMS, mail ou QR code (`code`, choisi par le téléphone pour pouvoir l'envoyer hors
    ligne). Le lien sert jusqu'à `expire_le`, à plusieurs personnes (un QR code montré à la bande)."""

    __tablename__ = "invitations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    groupe_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("groupes.id", ondelete="CASCADE"))
    invite_par: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    email: Mapped[str | None] = mapped_column(String(320))
    # Ce que montre l'appli dans « Dans la bande » : « Julie Martin · invitée par SMS ».
    canal: Mapped[str] = mapped_column(String(10), nullable=False, default="lien")
    nom: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    contact: Mapped[str] = mapped_column(String(320), nullable=False, default="")
    acceptee_par: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("utilisateurs.id"))
    expire_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)
