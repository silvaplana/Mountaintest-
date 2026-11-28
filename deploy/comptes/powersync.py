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
PAR_SORTIE = {"sortie": f"sortie_id IN ({SORTIES_DE_MES_GROUPES})", "invite": f"sortie_id IN ({OU_JE_PARTICIPE})"}
MES_MESSAGES = {
    "groupe": f"SELECT id FROM messages_buddies WHERE groupe_id IN ({MES_GROUPES})",
    "sortie": f"SELECT id FROM messages_buddies WHERE sortie_id IN ({SORTIES_DE_MES_GROUPES})",
    "invite": f"SELECT id FROM messages_buddies WHERE sortie_id IN ({OU_JE_PARTICIPE})",
}
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
        "groupe": f"id IN (SELECT utilisateur_id FROM membres WHERE groupe_id IN ({MES_GROUPES}))",
        "sortie": f"id IN (SELECT utilisateur_id FROM participants WHERE sortie_id IN ({SORTIES_DE_MES_GROUPES}))",
        "invite": f"id IN (SELECT utilisateur_id FROM participants WHERE sortie_id IN ({OU_JE_PARTICIPE}))",
        "demande": f"id IN (SELECT utilisateur_id FROM demandes_entree WHERE groupe_id IN ({MES_GROUPES}))",
    }),
    "groupes": ("*", {"groupe": f"id IN ({MES_GROUPES})"}),
    "membres": (cle("groupe_id", "utilisateur_id"), PAR_GROUPE),
    "invitations": ("*", {**PAR_GROUPE, "invite": f"sortie_id IN ({OU_JE_PARTICIPE})"}),
    "demandes_entree": (cle("groupe_id", "utilisateur_id"), {**PAR_GROUPE, "moi": "utilisateur_id = auth.user_id()"}),
    "sorties": ("*", {**PAR_GROUPE, "invite": f"id IN ({OU_JE_PARTICIPE})"}),
    "participants": (cle("sortie_id", "utilisateur_id"), PAR_SORTIE),
    "traces": ("*", {**PAR_GROUPE, **PAR_SORTIE}),
    "plannings": ("*", PAR_GROUPE),
    "dispos": (cle("planning_id", "utilisateur_id", "debut"), {"groupe": f"planning_id IN (SELECT id FROM plannings WHERE groupe_id IN ({MES_GROUPES}))"}),
    "photos": ("*", PAR_SORTIE),
    "recits": (cle("sortie_id", "utilisateur_id"), PAR_SORTIE),
    "fiches_jour": (cle("sortie_id", "jour"), PAR_SORTIE),
    "carnets": ("sortie_id AS id, *", PAR_SORTIE),
    "buddy_counts": ("*", {**PAR_GROUPE, **PAR_SORTIE}),
    "depenses": ("*", {**PAR_SORTIE, "groupe": f"count_id IN (SELECT id FROM buddy_counts WHERE groupe_id IN ({MES_GROUPES}))"}),
    "positions": (cle("sortie_id", "utilisateur_id"), PAR_SORTIE),
    "positions_groupes": (cle("groupe_id", "utilisateur_id"), PAR_GROUPE),
    "voitures": ("utilisateur_id AS id, *", {
        "moi": "utilisateur_id = auth.user_id()",
        "groupe": f"utilisateur_id IN (SELECT utilisateur_id FROM membres WHERE groupe_id IN ({MES_GROUPES}))",
    }),
    "hebergements": ("*", PAR_SORTIE),
    "coeurs": (cle("hebergement_id", "utilisateur_id"), {
        "sortie": f"hebergement_id IN (SELECT id FROM hebergements WHERE sortie_id IN ({SORTIES_DE_MES_GROUPES}))",
        "invite": f"hebergement_id IN (SELECT id FROM hebergements WHERE sortie_id IN ({OU_JE_PARTICIPE}))",
    }),
    "messages_buddies": ("*", {**PAR_GROUPE, **PAR_SORTIE}),
    "reactions_buddies": (cle("message_id", "utilisateur_id"), {k: f"message_id IN ({v})" for k, v in MES_MESSAGES.items()}),
    "votes_buddies": (cle("message_id", "utilisateur_id", "option"), {k: f"message_id IN ({v})" for k, v in MES_MESSAGES.items()}),
    "fichiers_buddies": ("*", {k: f"id IN ({v.replace('SELECT id', 'SELECT fichier_id')})" for k, v in MES_MESSAGES.items()}),
    "lectures_buddies": (cle("utilisateur_id", "cle"), {
        "groupe": f"cle IN ({MES_GROUPES})", "sortie": f"cle IN ({SORTIES_DE_MES_GROUPES})", "invite": f"cle IN ({OU_JE_PARTICIPE})"}),
    "appels": ("*", {**PAR_GROUPE, **PAR_SORTIE}),
    "blocages": (cle("utilisateur_id", "bloque_id"), {"moi": "utilisateur_id = auth.user_id()"}),
}
TABLES = tuple(FLUX)


def sync_config() -> str:
    lignes = ["# Écrit par deploy/comptes/powersync.py (python powersync.py) : ne pas modifier à la main.",
              "config:", "  edition: 3", "streams:"]
    for table, (colonnes, filtres) in FLUX.items():
        for nom, condition in filtres.items():
            lignes += [f"  {table}_{nom}:", "    auto_subscribe: true", f"    query: SELECT {colonnes} FROM {table} WHERE {condition}"]
    return "\n".join(lignes) + "\n"


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
            c.execute(text(f"CREATE PUBLICATION powersync FOR TABLE {', '.join(TABLES)}"))
        else:  # la liste a pu grandir depuis
            c.execute(text(f"ALTER PUBLICATION powersync SET TABLE {', '.join(TABLES)}"))


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
