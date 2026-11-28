"""Essai PowerSync (branche d'essai, rien en production) : voitures garées et positions partagées.

PowerSync lit Postgres (réplication logique) et pousse aux téléphones les lignes qui les concernent ; chaque
téléphone les garde dans SQLite. Ce module fournit les trois choses que PowerSync demande au serveur :
- `GET  /powersync/cles`  : la clé publique (JWKS) avec laquelle le service PowerSync vérifie les jetons ;
- `GET  /powersync/jeton` : un jeton court pour l'appelant (connu par son jeton Logto), `sub` = son id chez nous ;
- `POST /powersync/ecrire`: les opérations de la file du téléphone, les mêmes que `/buddies/sync` et avec les
  mêmes règles (buddies.OPERATIONS). Quand la réponse part, tout est validé en base : PowerSync peut alors
  donner au téléphone son « point d'écriture » (il sait que ses envois sont revenus par la réplication).
"""
from __future__ import annotations

import base64
import os
import time

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import text

# Adresse publique du service PowerSync (ce que l'appli appelle) et public visé par les jetons.
ADRESSE = os.environ.get("POWERSYNC_URL", "http://localhost:8080")
PUBLIC = "powersync"
DUREE = 10 * 60  # secondes ; l'appli en redemande un toute seule
# Ce que chaque téléphone reçoit : une requête par table, filtrée par les groupes et les sorties de la personne
# (`auth.user_id()` = utilisateurs.id). Le fichier sync-config.yaml du service est écrit à partir de cette liste
# (`python powersync.py > …/sync-config.yaml`), et la publication Postgres aussi : une seule source.
MES_GROUPES = "SELECT groupe_id FROM membres WHERE utilisateur_id = auth.user_id()"
SORTIES_DE_MES_GROUPES = f"SELECT id FROM sorties WHERE groupe_id IN ({MES_GROUPES})"
OU_JE_PARTICIPE = "SELECT sortie_id FROM participants WHERE utilisateur_id = auth.user_id()"
# Une sortie se voit par son groupe, ou parce qu'on y participe (copain invité à une seule sortie).
PAR_GROUPE = {"groupe": f"groupe_id IN ({MES_GROUPES})"}
# Position et voiture : seulement de ceux qui ne m'ont pas bloqué. Les règles ne savent pas dire « sauf » : le serveur
# tient la table `visibles` (qui peut voir qui, modeles.Visible) et la règle exige d'y figurer.
VISIBLE = "utilisateur_id IN (SELECT auteur_id FROM visibles WHERE lecteur_id = auth.user_id())"
# Tables que PowerSync doit suivre pour évaluer les règles, sans les envoyer aux téléphones.
TABLES_DES_REGLES = ("visibles", "connus")
PAR_SORTIE = {"sortie": f"sortie_id IN ({SORTIES_DE_MES_GROUPES})", "invite": f"sortie_id IN ({OU_JE_PARTICIPE})"}
# De la fiche d'un buddy : ce qu'il montre aux autres. Jamais l'e-mail, le téléphone, l'IBAN ni le nom complet.
FICHE = ("id, pseudo, photo, upper(substring(prenom, 1, 1)) AS initiale_prenom, upper(substring(nom, 1, 1)) AS initiale_nom, "
         "voiture_modele, voiture_forme, voiture_couleur")


def cle(*colonnes: str) -> str:
    """Clé composée → la colonne `id` que PowerSync demande à chaque ligne."""
    return " || '/' || ".join(colonnes) + " AS id, *"


# table → (colonnes, {nom du filtre: condition})
FLUX: dict[str, tuple[str, dict[str, str]]] = {
    "utilisateurs": (FICHE, {
        "moi": "id = auth.user_id()",
        "connu": "id IN (SELECT auteur_id FROM connus WHERE lecteur_id = auth.user_id())",
    }),
    "groupes": ("*", {"groupe": f"id IN ({MES_GROUPES})"}),
    "membres": (cle("groupe_id", "utilisateur_id"), PAR_GROUPE),
    "invitations": ("*", {**PAR_GROUPE, "invite": f"sortie_id IN ({OU_JE_PARTICIPE})"}),
    "demandes_entree": (cle("groupe_id", "utilisateur_id"), {**PAR_GROUPE, "moi": "utilisateur_id = auth.user_id()"}),
    "sorties": ("*", {**PAR_GROUPE, "invite": f"id IN ({OU_JE_PARTICIPE})"}),
    "participants": (cle("sortie_id", "utilisateur_id"), PAR_SORTIE),
    "traces": ("*", {**PAR_GROUPE, **PAR_SORTIE}),
    "plannings": ("*", PAR_GROUPE),
    "dispos": (cle("planning_id", "utilisateur_id", "debut"), PAR_GROUPE),
    "photos": ("*", PAR_SORTIE),
    "recits": (cle("sortie_id", "utilisateur_id"), PAR_SORTIE),
    "fiches_jour": (cle("sortie_id", "jour"), PAR_SORTIE),
    "carnets": ("sortie_id AS id, *", PAR_SORTIE),
    "buddy_counts": ("*", {**PAR_GROUPE, **PAR_SORTIE}),
    "depenses": ("*", {**PAR_SORTIE, **PAR_GROUPE}),
    "positions": (cle("sortie_id", "utilisateur_id"), {k: f"{v} AND {VISIBLE}" for k, v in PAR_SORTIE.items()}),
    "positions_groupes": (cle("groupe_id", "utilisateur_id"), {k: f"{v} AND {VISIBLE}" for k, v in PAR_GROUPE.items()}),
    "voitures": ("utilisateur_id AS id, *", {
        "moi": "utilisateur_id = auth.user_id()",
        "groupe": f"utilisateur_id IN (SELECT utilisateur_id FROM membres WHERE groupe_id IN ({MES_GROUPES})) AND {VISIBLE}",
    }),
    "hebergements": ("*", PAR_SORTIE),
    "coeurs": (cle("hebergement_id", "utilisateur_id"), PAR_SORTIE),
    "messages_buddies": ("*", {**PAR_GROUPE, **PAR_SORTIE}),
    "reactions_buddies": (cle("message_id", "utilisateur_id"), {**PAR_GROUPE, **PAR_SORTIE}),
    "votes_buddies": (cle("message_id", "utilisateur_id", "option"), {**PAR_GROUPE, **PAR_SORTIE}),
    "lectures_buddies": (cle("utilisateur_id", "cle"), {
        "groupe": f"cle IN ({MES_GROUPES})", "sortie": f"cle IN ({SORTIES_DE_MES_GROUPES})", "invite": f"cle IN ({OU_JE_PARTICIPE})"}),
    "appels": ("*", {**PAR_GROUPE, **PAR_SORTIE}),
    "blocages": (cle("utilisateur_id", "bloque_id"), {"moi": "utilisateur_id = auth.user_id()"}),
}
TABLES = tuple(FLUX)


# Les filtres communs : toutes les tables filtrées par « mes groupes » vont dans UN flux (de même « les sorties de mes
# groupes » et « les sorties où je participe »). PowerSync fait alors un paquet par groupe ou par sortie, partagé par
# toutes ces tables, et ne compte la liste de mes groupes qu'une fois. Un flux par table et par filtre atteignait le
# plafond de 1000 par personne vers 250 messages ou 70 sorties, et le compte ne se synchronisait plus du tout.
COMMUNS = {"groupe": ("mes_groupes", MES_GROUPES), "sortie": ("mes_sorties", SORTIES_DE_MES_GROUPES),
           "invite": ("mes_participations", OU_JE_PARTICIPE)}


def sync_config() -> str:
    lignes = ["# Écrit par deploy/comptes/powersync.py (python powersync.py) : ne pas modifier à la main.",
              "config:", "  edition: 3", "streams:"]
    groupes: dict[str, list[str]] = {nom: [] for nom in COMMUNS}
    seuls: list[str] = []
    for table, (colonnes, filtres) in FLUX.items():
        for nom, condition in filtres.items():
            cte, sous = COMMUNS.get(nom, ("", ""))
            visible = condition.endswith(f" AND {VISIBLE}")
            colonne = condition.removesuffix(f" AND {VISIBLE}").removesuffix(f" IN ({sous})")
            if cte and colonne.isidentifier():
                groupes[nom].append(f"      - SELECT {colonnes} FROM {table} WHERE {colonne} IN {cte}"
                                    + (" AND utilisateur_id IN qui_se_montre" if visible else ""))
            else:
                seuls += [f"  {table}_{nom}:", "    auto_subscribe: true", f"    query: SELECT {colonnes} FROM {table} WHERE {condition}"]
    for nom, requetes in groupes.items():
        cte, sous = COMMUNS[nom]
        lignes += [f"  {nom}:", "    auto_subscribe: true", "    with:", f"      {cte}: {sous}"]
        if any("qui_se_montre" in r for r in requetes):
            lignes.append("      qui_se_montre: SELECT auteur_id FROM visibles WHERE lecteur_id = auth.user_id()")
        lignes += ["    queries:", *requetes]
    return "\n".join(lignes + seuls) + "\n"


KID = "mb-1"


def cle(dossier: str) -> rsa.RSAPrivateKey:
    """La clé qui signe les jetons PowerSync, créée une fois et gardée à côté des autres secrets du serveur."""
    f = os.path.join(dossier, "powersync-cle.pem")
    try:
        with open(f, "rb") as h:
            return serialization.load_pem_private_key(h.read(), None)
    except OSError:
        k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        try:
            with open(os.open(f, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "wb") as h:
                h.write(pem)
        except OSError:
            pass  # dossier absent (tests) : une clé le temps du processus
        return k


def _b64(n: int) -> str:
    return base64.urlsafe_b64encode(n.to_bytes((n.bit_length() + 7) // 8, "big")).rstrip(b"=").decode()


def jwks(k: rsa.RSAPrivateKey) -> dict:
    n = k.public_key().public_numbers()
    return {"keys": [{"kty": "RSA", "alg": "RS256", "use": "sig", "kid": KID, "n": _b64(n.n), "e": _b64(n.e)}]}


def jeton(k: rsa.RSAPrivateKey, utilisateur_id) -> str:
    t = int(time.time())
    return jwt.encode({"sub": str(utilisateur_id), "aud": PUBLIC, "iat": t, "exp": t + DUREE}, k, algorithm="RS256",
                      headers={"kid": KID})


def preparer(moteur) -> None:
    """Postgres : la publication « powersync » (nom imposé) avec les tables envoyées aux téléphones. Les clés primaires
    suffisent à PowerSync (identité de réplique par défaut). Ailleurs (SQLite des tests) : rien."""
    if moteur.dialect.name != "postgresql":
        return
    with moteur.begin() as c:
        if c.execute(text("select 1 from pg_publication where pubname = 'powersync'")).first() is None:
            c.execute(text(f"CREATE PUBLICATION powersync FOR TABLE {', '.join(TABLES + TABLES_DES_REGLES)}"))
        else:  # la liste a pu grandir depuis
            c.execute(text(f"ALTER PUBLICATION powersync SET TABLE {', '.join(TABLES + TABLES_DES_REGLES)}"))


# Colonnes de `utilisateurs` telles qu'elles arrivent sur le téléphone (voir FICHE).
COLONNES_FICHE = {"pseudo": "text", "photo": "text", "initiale_prenom": "text", "initiale_nom": "text",
                  "voiture_modele": "text", "voiture_forme": "text", "voiture_couleur": "text"}


def schema_ts() -> str:
    """Le schéma SQLite du téléphone (capacitor/src/buddies/powersyncSchema.ts), déduit des tables du serveur."""
    from sqlalchemy import BigInteger, Boolean, Float, Integer

    from modeles import Base

    def nature(c) -> str:
        if isinstance(c.type, (Integer, BigInteger, Boolean)):
            return "integer"
        return "real" if isinstance(c.type, Float) else "text"

    lignes = ["// Écrit par deploy/comptes/powersync.py (python powersync.py schema) : ne pas modifier à la main.",
              "import { column, Schema, Table } from '@powersync/web';", "",
              "/** Ce qui part au serveur : jamais gardé ici une fois envoyé. */",
              "const ops = new Table({ type: column.text, corps: column.text }, { insertOnly: true });"]
    for table in TABLES:
        cols = COLONNES_FICHE if table == "utilisateurs" else {c.name: nature(c) for c in Base.metadata.tables[table].columns if c.name != "id"}
        lignes.append(f"const {table} = new Table({{ " + ", ".join(f"{n}: column.{v}" for n, v in cols.items()) + " });")
    lignes += ["", "export const SCHEMA = new Schema({ ops, " + ", ".join(TABLES) + " });", ""]
    return "\n".join(lignes)


if __name__ == "__main__":
    import sys
    print(schema_ts() if sys.argv[1:] == ["schema"] else sync_config(), end="")
