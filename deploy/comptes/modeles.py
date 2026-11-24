"""Tables du serveur des comptes (SQLAlchemy 2, même style qu'AppBase pour pouvoir y reprendre du code,
par exemple sa messagerie : une conversation par groupe).

Identifiants UUID choisis par le téléphone pour les groupes et invitations : l'appli peut les créer
hors ligne et les renvoyer au retour du réseau sans risque de doublon.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, Float, ForeignKey, Integer, String, Text, Uuid
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
    Buddy Group par défaut de chacun, créé par le serveur, un seul membre) ou « duo » (discussion à deux, §7.13)."""

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
    # Invitation à un Buddy Time seulement (une sortie de Me Time) : on devient participant, pas membre du groupe.
    sortie_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("sorties.id", ondelete="CASCADE"))
    canal: Mapped[str] = mapped_column(String(10), nullable=False, default="lien")
    nom: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    contact: Mapped[str] = mapped_column(String(320), nullable=False, default="")
    acceptee_par: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("utilisateurs.id"))
    expire_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)


class Sortie(Base):
    """Buddy Time (spec/buddies.md §5.4) : une sortie ou un week-end, rangé dans un Buddy Group (ou Me Time).
    Le voient les membres du groupe et les participants (copains invités à une sortie de Me Time)."""

    __tablename__ = "sorties"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    groupe_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("groupes.id", ondelete="CASCADE"), nullable=False, index=True)
    nom: Mapped[str] = mapped_column(String(80), nullable=False)
    photo: Mapped[str | None] = mapped_column(Text)
    # Dates du calendrier (AAAA-MM-JJ), sans heure ni fuseau.
    debut: Mapped[str] = mapped_column(String(10), nullable=False)
    fin: Mapped[str] = mapped_column(String(10), nullable=False)
    lieu: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    cree_par: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)
    modifie_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant, index=True)


class Participant(Base):
    """Qui part dans ce Buddy Time."""

    __tablename__ = "participants"

    sortie_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sorties.id", ondelete="CASCADE"), primary_key=True)
    utilisateur_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("utilisateurs.id", ondelete="CASCADE"), primary_key=True, index=True)


class TracePartagee(Base):
    """Trace partagée dans un Buddy Time ou un Buddy Group (panneau de partage, spec §3.4)."""

    __tablename__ = "traces"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    sortie_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("sorties.id", ondelete="CASCADE"), index=True)
    groupe_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("groupes.id", ondelete="CASCADE"), index=True)
    nom: Mapped[str] = mapped_column(String(80), nullable=False)
    # [[lon, lat], …] en JSON.
    ligne: Mapped[str] = mapped_column(Text, nullable=False)
    mot: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    par: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant, index=True)


class Planning(Base):
    """Planning de saison (spec/buddies.md §5.5) : des dates proposées à un Buddy Group, chacun dit s'il est dispo."""

    __tablename__ = "plannings"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    groupe_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("groupes.id", ondelete="CASCADE"), nullable=False, index=True)
    nom: Mapped[str] = mapped_column(String(80), nullable=False)
    # [[début, fin], …] en JSON, dates AAAA-MM-JJ : un week-end ou un jour par ligne.
    dates: Mapped[str] = mapped_column(Text, nullable=False)
    limite: Mapped[str] = mapped_column(String(10), nullable=False)
    cree_par: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)
    modifie_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant, index=True)


class Dispo(Base):
    """La réponse d'un buddy pour une date du planning : oui, peut (peut-être) ou non, avec un petit mot."""

    __tablename__ = "dispos"

    planning_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("plannings.id", ondelete="CASCADE"), primary_key=True)
    utilisateur_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), primary_key=True)
    debut: Mapped[str] = mapped_column(String(10), primary_key=True)
    etat: Mapped[str] = mapped_column(String(4), nullable=False)
    mot: Mapped[str] = mapped_column(String(200), nullable=False, default="")


class Photo(Base):
    """Album d'un Buddy Time (spec/buddies.md §5.8) : chacun dépose ses photos. Le fichier JPEG (petite
    400 px et grande 1600 px) est envoyé à part (PUT /buddies/photos/…) et rangé dans COMPTES_DOSSIER/photos."""

    __tablename__ = "photos"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    sortie_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sorties.id", ondelete="CASCADE"), nullable=False, index=True)
    par: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    # Heure de prise de vue lue dans la photo (heure locale du téléphone, AAAA-MM-JJTHH:MM:SS), sinon heure du dépôt.
    prise_le: Mapped[str] = mapped_column(String(19), nullable=False)
    lon: Mapped[float | None] = mapped_column(Float)
    lat: Mapped[float | None] = mapped_column(Float)
    # ⭐ : retenue pour le carnet (n'importe quel participant peut la choisir).
    etoile: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # La grande image est arrivée (avant : 🕓 chez tout le monde).
    envoyee: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)
    modifie_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant, index=True)


class Recit(Base):
    """Carnet d'un Buddy Time (spec/buddies.md §5.8) : le texte de chaque buddy, signé de son visage.
    Un texte par personne ; le dernier envoyé gagne."""

    __tablename__ = "recits"

    sortie_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sorties.id", ondelete="CASCADE"), primary_key=True)
    utilisateur_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), primary_key=True)
    texte: Mapped[str] = mapped_column(Text, nullable=False)
    modifie_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)


class FicheJour(Base):
    """Carnet : la fiche d'un jour, facultative. Ce qui est tapé à la main ; distance et dénivelé
    viennent de la trace du jour quand ils ne sont pas tapés."""

    __tablename__ = "fiches_jour"

    sortie_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sorties.id", ondelete="CASCADE"), primary_key=True)
    jour: Mapped[str] = mapped_column(String(10), primary_key=True)  # AAAA-MM-JJ
    nom: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    depart: Mapped[str] = mapped_column(String(5), nullable=False, default="")  # HH:MM
    duree: Mapped[int | None] = mapped_column(Integer)  # minutes
    distance: Mapped[int | None] = mapped_column(Integer)  # mètres
    denivele: Mapped[int | None] = mapped_column(Integer)  # mètres de montée
    modifie_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)


class Carnet(Base):
    """Carnet : ce qui ne se lit pas dans la trace (difficulté, météo, conditions)."""

    __tablename__ = "carnets"

    sortie_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sorties.id", ondelete="CASCADE"), primary_key=True)
    difficulte: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    meteo: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    conditions: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    modifie_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)


class Depense(Base):
    """Buddy count d'un Buddy Time (spec/buddies.md §5.10) : une dépense, partagée entre téléphones.
    N'importe quel participant l'ajoute, la corrige ou la retire ; la dernière version envoyée gagne."""

    __tablename__ = "depenses"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    sortie_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sorties.id", ondelete="CASCADE"), nullable=False, index=True)
    titre: Mapped[str] = mapped_column(String(80), nullable=False)
    montant: Mapped[int] = mapped_column(Integer, nullable=False)  # centimes
    paye_par: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    # Pour qui : identifiants des buddies en JSON.
    pour: Mapped[str] = mapped_column(Text, nullable=False)
    jour: Mapped[str] = mapped_column(String(10), nullable=False)
    par: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)
    modifie_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant, index=True)


class Position(Base):
    """Position des buddies (spec/buddies.md §5.9) : la dernière position d'un buddy dans un Buddy Time, et son
    épingle. Personne n'apparaît sans avoir enfoncé l'épingle ; elle se relève seule le soir. Heures en ms (epoch)."""

    __tablename__ = "positions"

    sortie_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sorties.id", ondelete="CASCADE"), primary_key=True)
    utilisateur_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), primary_key=True)
    depuis: Mapped[int] = mapped_column(BigInteger, nullable=False)  # épingle enfoncée à
    jusqu: Mapped[int] = mapped_column(BigInteger, nullable=False)  # épingle relevée (ou prévue) à
    lon: Mapped[float | None] = mapped_column(Float)
    lat: Mapped[float | None] = mapped_column(Float)
    alt: Mapped[float | None] = mapped_column(Float)
    prise_le: Mapped[int | None] = mapped_column(BigInteger)
    modifie_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant, index=True)


class Hebergement(Base):
    """Hébergement proposé dans un Buddy Time (spec/buddies.md §5.11, écrans 9 et 23) : chacun met un ♥, on en
    retient un (✅). N'importe quel participant propose, retient ou retire."""

    __tablename__ = "hebergements"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    sortie_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sorties.id", ondelete="CASCADE"), nullable=False, index=True)
    nom: Mapped[str] = mapped_column(String(80), nullable=False)
    nature: Mapped[str] = mapped_column(String(40), default="", nullable=False)  # gîte, refuge, hôtel…
    prix_nuit: Mapped[int | None] = mapped_column(Integer)  # euros
    adresse: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    url: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    resume: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    lon: Mapped[float | None] = mapped_column(Float)
    lat: Mapped[float | None] = mapped_column(Float)
    retenu: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    par: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)
    modifie_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant, index=True)


class Coeur(Base):
    """Un ♥ d'un buddy sur un hébergement proposé."""

    __tablename__ = "coeurs"

    hebergement_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("hebergements.id", ondelete="CASCADE"), primary_key=True)
    utilisateur_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), primary_key=True)


class MessageBuddy(Base):
    """Messagerie (spec/buddies.md §5.6, écran 6) : un message dans la conversation d'un Buddy Group ou d'un Buddy
    Time (l'un ou l'autre). Identifiant choisi par le téléphone (envoi hors ligne sans doublon, comme le client_id
    d'AppBase). nature : texte, point (lon/lat), photo (une photo de l'album du Buddy Time)."""

    __tablename__ = "messages_buddies"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    groupe_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("groupes.id", ondelete="CASCADE"), index=True)
    sortie_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("sorties.id", ondelete="CASCADE"), index=True)
    par: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    nature: Mapped[str] = mapped_column(String(10), default="texte", nullable=False)
    texte: Mapped[str] = mapped_column(Text, default="", nullable=False)
    lon: Mapped[float | None] = mapped_column(Float)
    lat: Mapped[float | None] = mapped_column(Float)
    photo_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    # 🐻 Réponse de Bud (§5.12), demandée par `par` : affichée dans la bulle de Bud, jamais comme un message du buddy.
    bud: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Comme la messagerie d'AppBase (§5.6) : réponse à un message, texte corrigé (15 min), supprimé chez tous
    # (la bulle devient « Ce message a été supprimé »).
    repond_a: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    edite_le: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    supprime: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Étape 3 (§7.13) : un fichier (photo, vidéo, document), un sondage (JSON : question, multiple, options), transféré.
    fichier_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    sondage: Mapped[str | None] = mapped_column(Text)
    transfere: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant, index=True)
    modifie_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant, index=True)


class ReactionBuddy(Base):
    """Réaction à un message, comme WhatsApp et AppBase : une par personne, une autre la remplace."""

    __tablename__ = "reactions_buddies"

    message_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("messages_buddies.id", ondelete="CASCADE"), primary_key=True)
    utilisateur_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), primary_key=True)
    emoji: Mapped[str] = mapped_column(String(16), nullable=False)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)


class FichierBuddy(Base):
    """Fichier joint à un message (photo, vidéo, document) : annoncé par la synchro, envoyé ensuite (comme l'album).
    Un message transféré garde le même fichier : on peut le lire depuis toute conversation qui le montre."""

    __tablename__ = "fichiers_buddies"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    par: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    nom: Mapped[str] = mapped_column(String(200), nullable=False)
    mime: Mapped[str] = mapped_column(String(100), nullable=False)
    taille: Mapped[int] = mapped_column(BigInteger, nullable=False)
    envoye: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)


class VoteBuddy(Base):
    """Vote à un sondage : une ligne par réponse cochée (plusieurs si le sondage le permet)."""

    __tablename__ = "votes_buddies"

    message_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("messages_buddies.id", ondelete="CASCADE"), primary_key=True)
    utilisateur_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), primary_key=True)
    option: Mapped[int] = mapped_column(Integer, primary_key=True)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)


class LectureBuddy(Base):
    """Jusqu'où un buddy a lu une conversation (cle = id du Buddy Group ou du Buddy Time) : les coches bleues."""

    __tablename__ = "lectures_buddies"

    utilisateur_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), primary_key=True)
    cle: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    lu_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Appareil(Base):
    """Un téléphone qui peut sonner (spec/buddies.md §5.7) : son jeton Firebase (FCM), donné par l'appli."""

    __tablename__ = "appareils"

    jeton: Mapped[str] = mapped_column(String(400), primary_key=True)
    utilisateur_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), index=True, nullable=False)
    plateforme: Mapped[str] = mapped_column(String(20), default="android", nullable=False)
    modifie_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)


class Appel(Base):
    """📞 Un appel de groupe (§5.7) : la conversation vocale d'un Buddy Group ou d'un Buddy Time. Le son passe par
    LiveKit (sur le VPS) ; ici on garde seulement qui a appelé, qui est en ligne, et la fin."""

    __tablename__ = "appels"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    groupe_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("groupes.id", ondelete="CASCADE"), index=True)
    sortie_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("sorties.id", ondelete="CASCADE"), index=True)
    par: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    en_ligne: Mapped[str] = mapped_column(Text, default="[]", nullable=False)  # identifiants JSON
    debut: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)
    fin: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
