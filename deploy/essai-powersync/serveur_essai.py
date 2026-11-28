"""Le vrai serveur des comptes, lancé en local pour l'essai PowerSync, avec un faux Logto (comme les tests) :
`GET /essai/jeton?sub=seb` donne un jeton d'accès pour un compte d'essai. À ne jamais lancer en production.

    DB_URL=postgresql+psycopg://mb:mb@localhost:5433/mountain python serveur_essai.py
"""
import os
import sys
import time
from pathlib import Path

import jwt
from cryptography.hazmat.primitives.asymmetric import ec

os.environ.setdefault("DB_URL", "postgresql+psycopg://mb:mb@localhost:5433/mountain")
os.environ.setdefault("LOGTO_ENDPOINT", "https://auth.exemple.test")
os.environ.setdefault("COMPTES_DOSSIER", str(Path(__file__).parent / "donnees"))
os.makedirs(os.environ["COMPTES_DOSSIER"], exist_ok=True)
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "comptes"))

import serveur  # noqa: E402

CLE = ec.generate_private_key(ec.SECP384R1())
serveur._jwks = type("FauxJwks", (), {"get_signing_key_from_jwt": lambda self, _j: type("K", (), {"key": CLE.public_key()})()})()
serveur.logto_utilisateur = lambda sub: {"primaryEmail": f"{sub}@exemple.test", "name": sub.capitalize()}


@serveur.app.get("/essai/jeton")
def jeton_essai(sub: str = "seb"):
    t = int(time.time())
    return {"jeton": jwt.encode({"sub": sub, "aud": serveur.API, "iss": f"{serveur.LOGTO}/oidc", "iat": t, "exp": t + 3600},
                                CLE, algorithm="ES384")}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(serveur.app, host="0.0.0.0", port=8000)
