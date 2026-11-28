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
# Les tables que PowerSync lit. `utilisateurs` et `membres` servent à savoir qui voit quoi.
TABLES = ("utilisateurs", "groupes", "membres", "voitures", "positions_groupes")
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
    """Postgres : la publication « powersync » (nom imposé) avec les seules tables de l'essai. Les clés primaires
    suffisent à PowerSync (identité de réplique par défaut). Ailleurs (SQLite des tests) : rien."""
    if moteur.dialect.name != "postgresql":
        return
    with moteur.begin() as c:
        if c.execute(text("select 1 from pg_publication where pubname = 'powersync'")).first() is None:
            c.execute(text(f"CREATE PUBLICATION powersync FOR TABLE {', '.join(TABLES)}"))
