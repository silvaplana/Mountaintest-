"""Tests du serveur des comptes : base SQLite en mémoire, faux Logto (clé ES384 générée ici)."""
import os
import sys
import time
from pathlib import Path

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

os.environ["DB_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["LOGTO_ENDPOINT"] = "https://auth.exemple.test"
os.environ["COMPTES_DOSSIER"] = str(Path(__file__).parent)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402

import serveur  # noqa: E402

CLE = ec.generate_private_key(ec.SECP384R1())
AUTRE = ec.generate_private_key(ec.SECP384R1())


class FauxJwks:
    def get_signing_key_from_jwt(self, _jeton):
        return type("K", (), {"key": CLE.public_key()})()


@pytest.fixture()
def client(monkeypatch):
    moteur = create_engine("sqlite+pysqlite:///:memory:", poolclass=StaticPool, connect_args={"check_same_thread": False})
    monkeypatch.setattr(serveur, "moteur", moteur)
    monkeypatch.setattr(serveur, "Sessions", serveur.sessionmaker(moteur, expire_on_commit=False))
    monkeypatch.setattr(serveur, "_jwks", FauxJwks())
    monkeypatch.setattr(serveur, "logto_utilisateur", lambda sub: {"primaryEmail": "Seb@Exemple.fr", "name": None})
    with TestClient(serveur.app) as c:
        yield c


def jeton(sub="u1", cle=CLE, aud=serveur.API, iss="https://auth.exemple.test/oidc", exp=3600):
    return jwt.encode({"sub": sub, "aud": aud, "iss": iss, "exp": int(time.time()) + exp, "iat": int(time.time())},
                      cle, algorithm="ES384")


def entete(**k):
    return {"Authorization": f"Bearer {jeton(**k)}"}


def test_etat_et_config(client):
    assert client.get("/").json()["ok"] is True
    c = client.get("/config").json()
    assert c["logto"] == "https://auth.exemple.test" and c["ressource"] == serveur.API


def test_moi_cree_le_profil_avec_l_email_de_logto(client):
    r = client.get("/moi", headers=entete())
    assert r.status_code == 200
    assert r.json()["email"] == "seb@exemple.fr" and r.json()["pseudo"] == "seb"
    # Deuxième visite : même compte
    assert client.get("/moi", headers=entete()).json()["id"] == r.json()["id"]
    assert client.get("/").json()["utilisateurs"] == 1


def test_changer_pseudo(client):
    r = client.put("/moi", headers=entete(), json={"pseudo": "  Seb   le skieur "})
    assert r.json()["pseudo"] == "Seb le skieur"
    assert client.put("/moi", headers=entete(), json={"pseudo": "   "}).status_code == 422
    assert client.put("/moi", headers=entete(), json={"photo": "javascript:x"}).status_code == 422
    assert client.put("/moi", headers=entete(), json={"photo": "data:image/jpeg;base64,AAAA"}).json()["photo"].startswith("data:")


@pytest.mark.parametrize("mauvais", [
    {"cle": AUTRE},                      # signé par quelqu'un d'autre
    {"aud": "https://autre.api"},        # jeton pour une autre API
    {"iss": "https://pirate.test/oidc"},  # autre émetteur
    {"exp": -120},                       # expiré
])
def test_jetons_refuses(client, mauvais):
    assert client.get("/moi", headers=entete(**mauvais)).status_code == 401


def test_sans_jeton(client):
    assert client.get("/moi").status_code == 401
