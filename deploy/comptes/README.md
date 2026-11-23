# Comptes Mountain Buddies (Logto + serveur Python)

```
appli ─▶ https://auth.silvaplana.cloud         ─▶ conteneur mb-logto (Logto 1.46 : connexion, code par mail)
      ─▶ https://silvaplana.cloud/mountaintest-api ─▶ conteneur mb-api (serveur.py : profils, puis groupes, invitations)
                                                     └─ conteneur mb-db (Postgres 17 : bases « logto » et « mountain »)
```

- **Connexion** : la page Logto s'ouvre dans le navigateur du téléphone, on tape son e-mail puis le code reçu
  (envoyé par Brevo, comme contretemps). Pas de mot de passe. Google et Apple pourront s'ajouter ensuite.
- **Hors ligne** : la 1re connexion demande du réseau. Ensuite l'appli garde un jeton de renouvellement valable
  180 jours et le profil : elle s'ouvre et reste connectée sans réseau. Ce qu'on change hors ligne part au retour
  du réseau. Après 180 jours, il faut retaper un code (seulement quand il y a du réseau ; rien n'est perdu).
  Pas de rotation du jeton : testé, une réponse perdue (réseau qui coupe) déconnectait le téléphone.
- **Sécurité** : la console d'admin de Logto n'est pas ouverte sur Internet (port 3002 de la machine seulement).
  Les secrets sont dans `~/mountaintest/comptes.env` (lisible par toi seul), jamais dans le dépôt ni dans l'APK.
- **Tout est configuré par script** (`configurer-logto.py`, via l'API de gestion de Logto) : rien à cliquer.

## Installation (une fois)

1. **DNS** : Hostinger hPanel › Domaines › silvaplana.cloud › DNS / Nameservers › ajouter un enregistrement
   **A**, nom **auth**, valeur **l'IP du VPS** (187.124.17.136), TTL par défaut. Attendre quelques minutes.
2. **VPS** (SSH depuis PowerShell : `ssh root@187.124.17.136`), coller :
   `bash <(curl -fsSL https://silvaplana.cloud/mountaintest/comptes/installer-comptes.sh)`
   Il vérifie le DNS, reprend la config mail Brevo, lance les 3 conteneurs, configure Logto, ajoute les routes
   au gateway (sauvegarde `~/gateway/Caddyfile.avant-comptes`, vérification, retour arrière si refus).
   Relançable sans risque.
3. Vérifier : https://silvaplana.cloud/mountaintest-api/config doit lister les applis `capacitor` et `kotlin`.

Le serveur redémarre tout seul quand une nouvelle version de `serveur.py` arrive avec le site (`~/mountaintest/maj-comptes.sh`, toutes les 5 min).

## Console d'admin de Logto (voir les comptes)

Dans PowerShell : `ssh -L 3002:localhost:3002 root@187.124.17.136`, puis ouvrir http://localhost:3002 dans le
navigateur du PC. La première fois, Logto demande de créer le compte administrateur.

## Plus tard : Google et Apple

- Google : créer un identifiant OAuth dans Google Cloud (gratuit), puis l'ajouter dans la console Logto (Connecteurs › Google).
- Apple : nécessite le compte Apple Developer (99 $/an, le même que pour publier sur iPhone).

## Tests

`cd deploy/comptes && pip install -r requirements.txt pytest httpx && python -m pytest tests` (base SQLite en
mémoire, faux Logto). Le tout a aussi été essayé avec un vrai Logto 1.46 + Postgres en Docker : connexion par code
mail de bout en bout, renouvellement du jeton, `/moi`.

## Tout retirer

```bash
crontab -l | grep -v mountaintest/maj-comptes.sh | crontab -
docker rm -f mb-api mb-logto mb-db
cat ~/gateway/Caddyfile.avant-comptes > ~/gateway/Caddyfile && (cd ~/gateway && docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile)
rm -rf ~/mountaintest/comptes.env ~/mountaintest/comptes-db ~/mountaintest/comptes-data
```
