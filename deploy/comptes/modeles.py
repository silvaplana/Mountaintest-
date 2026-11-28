"""Tables du serveur des comptes (SQLAlchemy 2, même style qu'AppBase pour pouvoir y reprendre du code,
par exemple sa messagerie : une conversation par groupe).

Identifiants UUID choisis par le téléphone pour les groupes et invitations : l'appli peut les créer
hors ligne et les renvoyer au retour du réseau sans risque de doublon.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import BigInteger, Boolean, CheckConstraint, Date, DateTime, Float, ForeignKey, Integer, String, Text, Uuid
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
    # Fiche du membre, comme le cœur d'AppBase (spec/buddies.md §7.18) : vue seulement par la personne.
    prenom: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    nom: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    telephone: Mapped[str | None] = mapped_column(String(50))
    # Facultatif, pour les remboursements (Buddy count) ; sans espaces, clé vérifiée (comme AppBase).
    iban: Mapped[str | None] = mapped_column(String(34))
    # Wero (Seb 26/11) : case « J'ai Wero » ; numéro (ou mail) Wero s'il diffère du portable. Comme l'IBAN, montré
    # seulement aux buddies d'une même sortie qui me doivent de l'argent (spec §7.18).
    wero: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    wero_numero: Mapped[str | None] = mapped_column(String(100))
    # Super User (spec/buddies.md §7.17, comme AppBase) : au-dessus de tous les clubs et Groupes. Donné
    # seulement par la commande `python super_user.py <e-mail>` sur le VPS, jamais depuis l'appli.
    super_user: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # SCAN 25 débloqué dans la version du Play Store (spec/play-store.md) : coché par le Super User, pour les
    # membres d'une asso quand l'IGN l'aura accepté par écrit. Personne n'est coché pour l'instant (Seb, 27/11).
    scan25: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Place prise par l'appli sur son téléphone, envoyée par le téléphone (calque Hors ligne, Seb 26/11) :
    # le Super User la voit pour tout le monde.
    telephone_octets: Mapped[int | None] = mapped_column(BigInteger)
    telephone_le: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Compte supprimé par son propriétaire (Play Store) : la fiche reste pour que les messages et les dépenses
    # gardent un auteur, mais vidée de tout ce qui identifie la personne (pseudo « Ancien buddy »).
    supprime_le: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Onglet Utilisateurs du Super User (Seb, 27/11) : d'où vient la personne (apk, play, web) et sa version,
    # redits par l'appli à chaque ouverture.
    plateforme: Mapped[str | None] = mapped_column(String(10))
    # 🚗 Ma voiture (Seb, 27/11) : marque et modèle en texte libre, silhouette (citadine, suv…) et couleur, pour que
    # chacun ait sa voiture sur la carte. Vus par les buddies qui voient ma voiture garée.
    voiture_modele: Mapped[str | None] = mapped_column(String(60))
    voiture_forme: Mapped[str | None] = mapped_column(String(12))
    voiture_couleur: Mapped[str | None] = mapped_column(String(10))
    version: Mapped[str | None] = mapped_column(String(20))


class Organisation(Base):
    """Un club (spec/buddies.md §7.17) : l'organisation d'AppBase (une école), facultative. Il regroupe ses
    sections, qui sont des Groupes. Il ne cloisonne personne : on garde le même profil partout.
    Pas encore d'écran : aucun club n'existe pour l'instant."""

    __tablename__ = "organisations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    nom: Mapped[str] = mapped_column(String(80), nullable=False)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)


class RoleOrganisation(Base):
    """Les rôles d'une personne dans un club, cumulables comme dans AppBase (spec/core.md §7) :
    membre, admin, admin_principal. Lus seulement par droits.py."""

    __tablename__ = "roles_organisation"
    __table_args__ = (CheckConstraint("role in ('membre', 'admin', 'admin_principal')", name="roles_organisation_role"),)

    organisation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"), primary_key=True)
    utilisateur_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("utilisateurs.id", ondelete="CASCADE"), primary_key=True, index=True)
    role: Mapped[str] = mapped_column(String(16), primary_key=True)


class Groupe(Base):
    """Groupe (spec/buddies.md §5.3). `nature` = « bande » (copains invités) ou « me_time » (le
    groupe par défaut de chacun, créé par le serveur, un seul membre) ou « duo » (discussion à deux, §7.13)."""

    __tablename__ = "groupes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    nom: Mapped[str] = mapped_column(String(80), nullable=False)
    nature: Mapped[str] = mapped_column(String(10), nullable=False, default="bande")
    # Petite image en data: URL (~256 px), comme la photo du profil.
    photo: Mapped[str | None] = mapped_column(Text)
    # Le club dont ce Groupe est une section ; vide pour une bande de copains (le cas de tous aujourd'hui).
    organisation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("organisations.id", ondelete="SET NULL"), index=True)
    activite: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    cree_par: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)
    modifie_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant, index=True)
    # Supprimé par un admin (Seb, 26 novembre) : caché de tous, rien n'est effacé.
    supprime_le: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Membre(Base):
    __tablename__ = "membres"
    # Rôles dans le Groupe (spec/buddies.md §7.17) : un seul admin_principal (le créateur, qui peut transmettre).
    __table_args__ = (CheckConstraint("role in ('admin_principal', 'admin', 'membre')", name="membres_role"),)

    groupe_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("groupes.id", ondelete="CASCADE"), primary_key=True)
    utilisateur_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("utilisateurs.id", ondelete="CASCADE"), primary_key=True, index=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="membre")
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
    # Invitation à une sortie seulement (une sortie de Me Time) : on devient participant, pas membre du groupe.
    sortie_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("sorties.id", ondelete="CASCADE"))
    canal: Mapped[str] = mapped_column(String(10), nullable=False, default="lien")
    nom: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    contact: Mapped[str] = mapped_column(String(320), nullable=False, default="")
    acceptee_par: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("utilisateurs.id"))
    # Invitation par mail (canal « mail ») : « envoye », « erreur », ou vide tant que le serveur ne l'a pas envoyé.
    mail: Mapped[str | None] = mapped_column(String(10))
    expire_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)
    # Lien du groupe « un admin accepte » (Seb, 27/11, §7.29) : sans fin ; celui qui le touche fait une demande.
    approbation: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class DemandeEntree(Base):
    """Demande pour entrer dans un groupe, faite par son lien « un admin accepte » (§7.29)."""

    __tablename__ = "demandes_entree"

    groupe_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("groupes.id", ondelete="CASCADE"), primary_key=True)
    utilisateur_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), primary_key=True, index=True)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)


class Sortie(Base):
    """Sortie (spec/buddies.md §5.4) : une sortie ou un week-end, rangé dans un groupe (ou Me Time).
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
    # Supprimé (par Bud, §7.12) : caché de tous, gardé pour que « Annuler » le remette avec tout ce qu'il contient.
    supprime_le: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Participant(Base):
    """Qui part dans cette sortie."""

    __tablename__ = "participants"

    sortie_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sorties.id", ondelete="CASCADE"), primary_key=True)
    utilisateur_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("utilisateurs.id", ondelete="CASCADE"), primary_key=True, index=True)


class TracePartagee(Base):
    """Trace partagée dans une sortie ou un groupe (panneau de partage, spec §3.4)."""

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
    """Planning de saison (spec/buddies.md §5.5) : des dates proposées à un groupe, chacun dit s'il est dispo."""

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
    groupe_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True)  # recopie du planning (règles PowerSync)


class Photo(Base):
    """Album d'une sortie (spec/buddies.md §5.8) : chacun dépose ses photos. Le fichier JPEG (petite
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
    # La grande image est arrivée (avant : 🕓 chez tout le monde) ; pour un film, la vidéo est arrivée.
    envoyee: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # 🎥 Film du survol 3D d'une trace : petite et grande sont l'image de couverture, le film est la taille « video ».
    video: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)
    modifie_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant, index=True)


class Recit(Base):
    """Carnet d'une sortie (spec/buddies.md §5.8) : le texte de chaque buddy, signé de son visage.
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


class BuddyCount(Base):
    """Un Buddy count (Seb, 26/11, spec/buddies.md §7.20) : de groupe (plusieurs par groupe, avec un nom) ou de sortie
    (un seul, sans nom : celui de la sortie ; la ligne n'existe qu'une fois fermé, renommé ou supprimé).
    Ouvert ou fermé (fermé : on n'ajoute plus rien) ; supprimé par un admin du groupe (caché, rien n'est effacé)."""

    __tablename__ = "buddy_counts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    groupe_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("groupes.id", ondelete="CASCADE"), index=True)
    sortie_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("sorties.id", ondelete="CASCADE"), unique=True)
    nom: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    ferme: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    supprime_le: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    par: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)
    modifie_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant, index=True)


class Depense(Base):
    """Buddy count (spec/buddies.md §5.10, §7.20) : une dépense d'une sortie (`sortie_id`) ou d'un Buddy count de
    groupe (`count_id`), partagée entre téléphones. La dernière version envoyée gagne."""

    __tablename__ = "depenses"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    sortie_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("sorties.id", ondelete="CASCADE"), index=True)
    count_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("buddy_counts.id", ondelete="CASCADE"), index=True)
    groupe_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True)  # recopie du Buddy count de groupe (règles PowerSync)
    titre: Mapped[str] = mapped_column(String(80), nullable=False)
    montant: Mapped[int] = mapped_column(Integer, nullable=False)  # centimes
    paye_par: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    # Pour qui : identifiants des buddies en JSON.
    pour: Mapped[str] = mapped_column(Text, nullable=False)
    jour: Mapped[str] = mapped_column(String(10), nullable=False)
    par: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)
    modifie_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant, index=True)
    # Remboursement (Seb, 26 novembre) : vide = une dépense ; « annonce » = « J'ai payé » (pas encore dans les
    # équilibres) ; « recu » = confirmé par celui qui a reçu. `moyen` : virement, wero, especes, autre.
    remb: Mapped[str | None] = mapped_column(String(10))
    moyen: Mapped[str | None] = mapped_column(String(10))
    # Retirée : la ligne reste, cachée de tous (comme un groupe ou une sortie supprimés). Effacée pour de bon, elle
    # ressuscitait quand un téléphone resté hors ligne la modifiait, ou renvoyait son « J'ai payé » après un « Pas reçu ».
    supprime_le: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Position(Base):
    """Position des buddies (spec/buddies.md §5.9) : la dernière position d'un buddy dans une sortie, et son
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


class Voiture(Base):
    """🚗 Ma voiture garée (Seb, 26/11) : une par buddy, vue par les membres de ses groupes ; oubliée à minuit
    (`jusqu`, l'heure du téléphone). Heures en ms (epoch)."""

    __tablename__ = "voitures"

    utilisateur_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), primary_key=True)
    lon: Mapped[float] = mapped_column(Float, nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    garee_le: Mapped[int] = mapped_column(BigInteger, nullable=False)
    jusqu: Mapped[int] = mapped_column(BigInteger, nullable=False)  # minuit, ou l'heure où on l'a enlevée
    modifie_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant, index=True)


class PositionGroupe(Base):
    """Position partagée avec un groupe, hors sortie (📍 de la colonne de Buddies, spec/buddies.md §7.14) :
    même épingle et mêmes règles que `positions`, mais vue par les membres du groupe. Heures en ms (epoch)."""

    __tablename__ = "positions_groupes"

    groupe_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("groupes.id", ondelete="CASCADE"), primary_key=True)
    utilisateur_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), primary_key=True)
    depuis: Mapped[int] = mapped_column(BigInteger, nullable=False)
    jusqu: Mapped[int] = mapped_column(BigInteger, nullable=False)
    lon: Mapped[float | None] = mapped_column(Float)
    lat: Mapped[float | None] = mapped_column(Float)
    alt: Mapped[float | None] = mapped_column(Float)
    prise_le: Mapped[int | None] = mapped_column(BigInteger)
    modifie_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant, index=True)


class Hebergement(Base):
    """Hébergement proposé dans une sortie (spec/buddies.md §5.11, écrans 9 et 23) : chacun met un ♥, on en
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
    sortie_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True)  # recopie de l'hébergement (règles PowerSync)


class MessageBuddy(Base):
    """Messagerie (spec/buddies.md §5.6, écran 6) : un message dans la conversation d'un groupe ou d'une
    sortie (l'un ou l'autre). Identifiant choisi par le téléphone (envoi hors ligne sans doublon, comme le client_id
    d'AppBase). nature : texte, point (lon/lat), photo (une photo de l'album de la sortie)."""

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
    # Un planning du groupe de la conversation, en carte dans le fil (Seb, 27/11, §7.28).
    planning_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant, index=True)
    # Recopie du fichier joint (FichierBuddy) : le téléphone le lit avec le message, sans table à part.
    fichier_nom: Mapped[str | None] = mapped_column(String(200))
    fichier_mime: Mapped[str | None] = mapped_column(String(100))
    fichier_taille: Mapped[int | None] = mapped_column(BigInteger)
    fichier_envoye: Mapped[bool | None] = mapped_column(Boolean)
    modifie_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant, index=True)


class ReactionBuddy(Base):
    """Réaction à un message, comme WhatsApp et AppBase : une par personne, une autre la remplace."""

    __tablename__ = "reactions_buddies"

    message_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("messages_buddies.id", ondelete="CASCADE"), primary_key=True)
    utilisateur_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), primary_key=True)
    emoji: Mapped[str] = mapped_column(String(16), nullable=False)
    # Recopie du groupe ou de la sortie du message : les règles PowerSync filtrent sur une colonne de la table envoyée.
    groupe_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True)
    sortie_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True)
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
    # Recopie du groupe ou de la sortie du message : les règles PowerSync filtrent sur une colonne de la table envoyée.
    groupe_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True)
    sortie_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)


class LectureBuddy(Base):
    """Jusqu'où un buddy a lu une conversation (cle = id du groupe ou de la sortie) : les coches bleues."""

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
    """📞 Un appel de groupe (§5.7) : la conversation vocale d'un groupe ou d'une sortie. Le son passe par
    LiveKit (sur le VPS) ; ici on garde seulement qui a appelé, qui est en ligne, et la fin."""

    __tablename__ = "appels"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    groupe_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("groupes.id", ondelete="CASCADE"), index=True)
    sortie_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("sorties.id", ondelete="CASCADE"), index=True)
    par: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    en_ligne: Mapped[str] = mapped_column(Text, default="[]", nullable=False)  # identifiants JSON
    debut: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)
    fin: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Visible(Base):
    """Bêta PowerSync : qui (`lecteur_id`) peut voir la position et la voiture de qui (`auteur_id`). Les règles de
    PowerSync ne savent pas dire « sauf si l'auteur m'a bloqué » : le serveur tient donc à jour la liste de ceux qui
    PEUVENT voir (même groupe ou même sortie, moins les blocages), et les règles filtrent dessus. Table dérivée,
    recalculée par `buddies.recalculer_visibles` ; rien d'autre ne la lit."""

    __tablename__ = "visibles"

    auteur_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), primary_key=True)
    lecteur_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), primary_key=True)


class Connu(Base):
    """Bêta PowerSync : de qui (`auteur_id`) chacun (`lecteur_id`) reçoit la fiche (pseudo, photo, initiales). Même
    principe que `visibles` : une règle « les participants des sorties de mes groupes » coûtait à PowerSync une ligne
    par participant et par sortie, et son plafond de 1000 par personne arrêtait la synchro. Ici : une par personne connue."""

    __tablename__ = "connus"

    auteur_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), primary_key=True)
    lecteur_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), primary_key=True)


class Blocage(Base):
    """🚫 Bloquer un buddy (Play Store) : je ne vois plus ses messages (repliés), il ne voit plus ma position ni ma
    voiture. Il n'est pas prévenu et reste dans les groupes."""

    __tablename__ = "blocages"

    utilisateur_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), primary_key=True)
    bloque_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), primary_key=True)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)


class Signalement(Base):
    """🚩 Un message (ou une personne) signalé au Super User (Play Store). `extrait` garde le texte du message tel
    qu'il était, même s'il est ensuite modifié ou supprimé. `cible_id` vide : une réponse de Bud.
    `suite` : ignore, efface (message supprimé) ou retire (la personne quitte le groupe)."""

    __tablename__ = "signalements"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    par: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), nullable=False)
    cible_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"))
    message_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("messages_buddies.id", ondelete="SET NULL"))
    motif: Mapped[str] = mapped_column(String(12), nullable=False)
    mot: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    extrait: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    lieu: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    suite: Mapped[str | None] = mapped_column(String(8))
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant, index=True)


class Usage(Base):
    """Ouvertures de l'appli par personne et par jour (onglet Utilisateurs du Super User, Seb 27/11) :
    une ligne par jour d'utilisation, donc jours = nombre de lignes, ouvertures = leur somme."""

    __tablename__ = "usages"

    utilisateur_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), primary_key=True)
    jour: Mapped[date] = mapped_column(Date, primary_key=True)
    ouvertures: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Telechargement(Base):
    """Téléchargements de l'APK par jour, comptés par le bouton de la page publique (anonymes : on ne sait pas qui)."""

    __tablename__ = "telechargements"

    jour: Mapped[date] = mapped_column(Date, primary_key=True)
    nombre: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class MaTrace(Base):
    """💾 Copie d'une de « Mes traces » du téléphone (Seb, 27/11 : retrouvée après une réinstallation).
    `id_tel` = l'identifiant choisi par le téléphone ; `donnees` = la trace telle que le téléphone la garde (JSON).
    Une trace effacée sur le téléphone est marquée `supprime_le` (pas rendue au téléphone)."""

    __tablename__ = "mes_traces"

    utilisateur_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), primary_key=True)
    id_tel: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    donnees: Mapped[str] = mapped_column(Text, nullable=False)
    modifie_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)
    supprime_le: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Journal(Base):
    """Journal du Super User (Seb, 27/11) : « Toto a créé son compte », « s'est connecté », « a ouvert l'appli »,
    « a rejoint X », « s'est déconnecté ». Seulement des personnes connectées (rien d'anonyme), jamais le
    Super User lui-même ; gardé 90 jours. `quoi` : inscription, connexion, ouverture, rejoint, deconnexion."""

    __tablename__ = "journal"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    quand: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant, index=True)
    utilisateur_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), index=True, nullable=False)
    quoi: Mapped[str] = mapped_column(String(12), nullable=False)
    detail: Mapped[str] = mapped_column(String(120), nullable=False, default="")
