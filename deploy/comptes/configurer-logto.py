"""
Configure Logto pour Mountain Buddies, sans passer par la console (relançable sans risque).

Lancé par installer-comptes.sh, dans un conteneur Python sur le réseau Docker « web ».
Utilise l'application « machine » mb-installeur (droits sur l'API de gestion Logto) et fait :
  1. l'API https://silvaplana.cloud/mountaintest-api (jetons d'accès d'une heure) ;
  2. les deux applis natives (Capacitor et Kotlin), avec un jeton de renouvellement de 180 jours :
     c'est lui qui garde l'appli connectée. Pas de rotation : avec la rotation, une réponse perdue
     (réseau qui coupe en montagne) invalidait l'ancien jeton et déconnectait le téléphone (testé) ;
  3. la page de connexion : e-mail + code reçu par mail (pas de mot de passe), en français, aux couleurs de l'appli ;
  4. l'envoi des codes par Brevo (SMTP_* de l'environnement), si fourni ; Google (GOOGLE_CLIENT_ID/SECRET)
     et Apple (APPLE_SERVICES_ID) quand ils sont fournis ; la version web (iPhone en PWA) ;
  5. /data/logto.json : identifiants des applis, servis aux applis par GET /mountaintest-api/config.
"""
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

INTERNE = os.environ.get("LOGTO_INTERNE", "http://mb-logto:3001").rstrip("/")
API = os.environ.get("API_RESSOURCE", "https://silvaplana.cloud/mountaintest-api")
LOGO = os.environ.get("LOGO_URL", "https://silvaplana.cloud/mountaintest/logo.svg")
DOSSIER = os.environ.get("COMPTES_DOSSIER", "/data")
M2M_ID, M2M_SECRET = os.environ["LOGTO_M2M_ID"], os.environ["LOGTO_M2M_SECRET"]

# Schémas d'URL de retour après connexion = identifiant Android de chaque appli.
APPLIS = {
    "capacitor": ("Mountain Buddies", "fr.assomoutain.rando"),
    "kotlin": ("Mountain Buddies K", "fr.assomoutain.proto.kotlin"),
}
VERT = "#2f6f4f"


def jeton() -> str:
    corps = urllib.parse.urlencode({"grant_type": "client_credentials", "scope": "all",
                                    "resource": "https://default.logto.app/api"}).encode()
    req = urllib.request.Request(f"{INTERNE}/oidc/token", corps)
    req.add_header("Authorization", "Basic " + base64.b64encode(f"{M2M_ID}:{M2M_SECRET}".encode()).decode())
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)["access_token"]


def appel(methode: str, chemin: str, corps=None):
    req = urllib.request.Request(f"{INTERNE}/api{chemin}", method=methode,
                                 data=None if corps is None else json.dumps(corps).encode())
    req.add_header("Authorization", f"Bearer {JETON}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            t = r.read()
            return json.loads(t) if t else None
    except urllib.error.HTTPError as e:
        sys.exit(f"Logto a refusé {methode} {chemin} : {e.code} {e.read().decode()[:400]}")


def attendre_logto():
    for _ in range(60):
        try:
            urllib.request.urlopen(f"{INTERNE}/oidc/.well-known/openid-configuration", timeout=5).read()
            return
        except Exception:
            time.sleep(3)
    sys.exit("Logto ne répond pas (docker logs mb-logto).")


attendre_logto()
JETON = jeton()

# 1. API protégée
ressource = next((r for r in appel("GET", "/resources") if r["indicator"] == API), None)
if ressource is None:
    ressource = appel("POST", "/resources", {"name": "Mountain Buddies API", "indicator": API, "accessTokenTtl": 3600})
print("API :", ressource["indicator"])

# 2. Applis natives
existantes = {a["name"]: a for a in appel("GET", "/applications?page_size=100")}
ids = {}
for cle, (nom, schema) in APPLIS.items():
    oidc = {"redirectUris": [f"{schema}://callback"], "postLogoutRedirectUris": [f"{schema}://logout"]}
    perso = {"alwaysIssueRefreshToken": True, "rotateRefreshToken": False, "refreshTokenTtlInDays": 180}
    if cle == "capacitor":
        # L'appli Capacitor est une page web dans le téléphone (origine https://localhost sur Android,
        # capacitor://localhost sur iPhone) : sans ça, Logto refuse l'échange du code (CORS) et l'appli
        # croit qu'il n'y a pas de réseau.
        perso["corsAllowedOrigins"] = ["https://localhost", "capacitor://localhost", "http://localhost"]
    a = existantes.get(nom)
    if a is None:
        a = appel("POST", "/applications", {"name": nom, "type": "Native", "oidcClientMetadata": oidc,
                                            "customClientMetadata": perso})
    else:
        appel("PATCH", f"/applications/{a['id']}", {"oidcClientMetadata": oidc, "customClientMetadata": perso})
    ids[cle] = a["id"]
    print(f"Appli {nom} : {a['id']} (retour {schema}://callback)")

# 2 bis. Version web (iPhone en PWA, https://silvaplana.cloud/mountaintest/) : appli « page web » (SPA),
# retour sur la page elle-même. Même jeton de renouvellement de 180 jours, gardé par le navigateur.
SITE = os.environ.get("SITE_URL", "https://silvaplana.cloud/mountaintest/")
oidc = {"redirectUris": [SITE, SITE + "index.html"], "postLogoutRedirectUris": [SITE]}
perso = {"alwaysIssueRefreshToken": True, "rotateRefreshToken": False, "refreshTokenTtlInDays": 180,
         "corsAllowedOrigins": [SITE.split("/", 3)[0] + "//" + SITE.split("/", 3)[2]]}
a = existantes.get("Mountain Buddies Web")
if a is None:
    a = appel("POST", "/applications", {"name": "Mountain Buddies Web", "type": "SPA", "oidcClientMetadata": oidc,
                                        "customClientMetadata": perso})
else:
    appel("PATCH", f"/applications/{a['id']}", {"oidcClientMetadata": oidc, "customClientMetadata": perso})
ids["web"] = a["id"]
print(f"Appli web : {a['id']} (retour {SITE})")

# 3. Envoi des codes par mail (Brevo), avant la page de connexion qui en a besoin
smtp = {k: os.environ.get(k, "") for k in ("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM_EMAIL", "SMTP_REPLY_TO")}
mail_ok = bool(smtp["SMTP_HOST"] and smtp["SMTP_USER"] and smtp["SMTP_PASSWORD"])
if mail_ok:
    def modele(usage, sujet, phrase):
        return {"usageType": usage, "contentType": "text/plain", "subject": sujet,
                "content": f"{phrase}\n\nTon code : {{{{code}}}}\n\nIl reste valable 10 minutes. Si tu n'as rien demandé, ignore ce mail.\n\nMountain Buddies"}
    config = {
        "host": smtp["SMTP_HOST"], "port": int(smtp["SMTP_PORT"] or 587),
        "auth": {"type": "login", "user": smtp["SMTP_USER"], "pass": smtp["SMTP_PASSWORD"]},
        "fromEmail": f"Mountain Buddies <{smtp['SMTP_FROM_EMAIL'] or smtp['SMTP_USER']}>",
        "templates": [
            modele("SignIn", "Ton code de connexion Mountain Buddies", "Voici ton code pour te connecter à Mountain Buddies."),
            modele("Register", "Bienvenue sur Mountain Buddies", "Voici ton code pour créer ton compte Mountain Buddies."),
            modele("ForgotPassword", "Mountain Buddies : code de vérification", "Voici ton code de vérification."),
            modele("Generic", "Mountain Buddies : code de vérification", "Voici ton code de vérification."),
            modele("UserPermissionValidation", "Mountain Buddies : code de vérification", "Voici ton code de vérification."),
            modele("BindNewIdentifier", "Mountain Buddies : nouvelle adresse", "Voici ton code pour confirmer ta nouvelle adresse."),
            modele("MfaVerification", "Mountain Buddies : code de vérification", "Voici ton code de vérification."),
            modele("BindMfa", "Mountain Buddies : code de vérification", "Voici ton code de vérification."),
        ],
    }
    if smtp["SMTP_REPLY_TO"]:
        config["replyTo"] = smtp["SMTP_REPLY_TO"]
    if smtp["SMTP_PORT"] == "465":
        config["secure"] = True
    mails = [c for c in appel("GET", "/connectors") if c["type"] == "Email"]
    if mails:
        appel("PATCH", f"/connectors/{mails[0]['id']}", {"config": config})
    else:
        appel("POST", "/connectors", {"connectorId": "simple-mail-transfer-protocol", "config": config})
    print("Envoi des codes : Brevo", smtp["SMTP_HOST"])
else:
    print("ATTENTION : pas de SMTP_* : la connexion par code mail ne marchera pas tant que l'envoi n'est pas configuré.")

# 3 bis. « Continuer avec Google / Apple » : connecteurs d'identifiant fixe, pour que l'adresse de retour à déclarer
# chez Google soit connue d'avance : https://auth.silvaplana.cloud/callback/google (et /callback/apple).
def connecteur(ident: str, usine: str, config: dict):
    deja = next((c for c in appel("GET", "/connectors") if c["id"] == ident), None)
    if deja:
        appel("PATCH", f"/connectors/{ident}", {"config": config})
    else:
        appel("POST", "/connectors", {"connectorId": usine, "id": ident, "config": config})


fournisseurs = []
if os.environ.get("GOOGLE_CLIENT_ID") and os.environ.get("GOOGLE_CLIENT_SECRET"):
    connecteur("google", "google-universal", {
        "clientId": os.environ["GOOGLE_CLIENT_ID"], "clientSecret": os.environ["GOOGLE_CLIENT_SECRET"],
        "scope": "openid profile email", "prompts": ["select_account"]})
    fournisseurs.append("google")
    print("Google : activé")
else:
    print("Google : pas encore (GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET dans comptes.env, voir README)")
if os.environ.get("APPLE_SERVICES_ID"):
    # Nécessite le compte Apple Developer (Services ID + domaine vérifié chez Apple).
    connecteur("apple", "apple-universal", {"clientId": os.environ["APPLE_SERVICES_ID"], "scope": "email name"})
    fournisseurs.append("apple")
    print("Apple : activé")

# 4. Page de connexion
appel("PATCH", "/sign-in-exp", {
    "socialSignInConnectorTargets": fournisseurs,
    "color": {"primaryColor": VERT, "isDarkModeEnabled": True, "darkPrimaryColor": "#6cc196"},
    "branding": {"logoUrl": LOGO, "darkLogoUrl": LOGO},
    "customCss": "[class*=signature] { display: none !important; }",
    "languageInfo": {"autoDetect": True, "fallbackLanguage": "fr"},
    "signInMode": "SignInAndRegister",
    "signUp": {"identifiers": ["email"], "password": False, "verify": True},
    "signIn": {"methods": [{"identifier": "email", "password": False, "verificationCode": True, "isPasswordPrimary": False}]},
})
print("Page de connexion : e-mail + code, en français")

# 5. Pour GET /config
os.makedirs(DOSSIER, exist_ok=True)
with open(os.path.join(DOSSIER, "logto.json"), "w", encoding="utf-8") as f:
    json.dump({"applis": ids, "mail": mail_ok, "fournisseurs": fournisseurs}, f, indent=2)
print("OK")
