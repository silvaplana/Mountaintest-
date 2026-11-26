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

## Buddies (bloc 1)

`buddies.py` : Groupes, Me Time, invitations, et la synchro des téléphones (`POST /buddies/sync`, voir
`spec/buddies.md` §7.1). `GET /invitations/{code}` sert la page du lien d'invitation (`capacitor/public/rejoindre.html`).
Les colonnes ajoutées aux tables déjà créées sur le VPS s'ajoutent seules au démarrage (`ajouter_colonnes`).

## Appels de groupe (bloc 10)

`appels.py` : jetons d'entrée LiveKit, sonnerie Firebase, qui est en ligne (`spec/buddies.md` §7.10). Le son passe
par le conteneur `mb-livekit` (https://appels.silvaplana.cloud, ports TCP 7881 et UDP 50000-50200 ouverts sur le VPS).

1. **DNS** : enregistrement **A**, nom **appels**, valeur 187.124.17.136 (comme « auth »).
2. **Firebase** (pour que ça sonne appli fermée) : console.firebase.google.com › projet « Mountain Buddies » ›
   Paramètres › Comptes de service › « Générer une nouvelle clé privée ». Copier le fichier sur le VPS sous
   `~/mountaintest/firebase-cle.json` (depuis PowerShell : `scp chemin\du\fichier.json root@187.124.17.136:mountaintest/firebase-cle.json`).
   Cette clé est secrète : jamais dans le dépôt ni dans un message.
3. **VPS** : `bash <(curl -fsSL https://silvaplana.cloud/mountaintest/comptes/installer-appels.sh)`. Relançable :
   à relancer après avoir ajouté la clé Firebase.

Les fichiers `google-services.json` des deux applis (`capacitor/android/app/`, `kotlin-natif/app/`) ne sont pas
secrets : ils vont dans le dépôt. Sans eux, l'appli marche, sans sonnerie appli fermée.

## Console d'admin de Logto (voir les comptes)

Dans PowerShell : `ssh -L 3002:localhost:3002 root@187.124.17.136`, puis ouvrir http://localhost:3002 dans le
navigateur du PC. La première fois, Logto demande de créer le compte administrateur.

## « Continuer avec Google » (et Apple plus tard)

Les applis affichent le bouton Google dès l'ouverture ; il marche quand Google est activé ici.

1. https://console.cloud.google.com : créer un projet « Mountain Buddies », puis API et services ›
   Écran de consentement OAuth (externe, nom « Mountain Buddies », ton e-mail), puis Identifiants ›
   Créer des identifiants › ID client OAuth › Application Web.
2. URI de redirection autorisé : `https://auth.silvaplana.cloud/callback/google` (identifiant fixe du
   connecteur, posé par configurer-logto.py).
3. Sur le VPS (les secrets restent dans comptes.env, jamais dans le dépôt) :
   ```
   echo 'GOOGLE_CLIENT_ID=…' >> ~/mountaintest/comptes.env
   echo 'GOOGLE_CLIENT_SECRET=…' >> ~/mountaintest/comptes.env
   bash ~/mountaintest/www/comptes/installer-comptes.sh
   ```
   L'installeur crée le connecteur Google, l'ajoute à la page de connexion et l'annonce aux applis
   (`GET /config` → `"fournisseurs": ["google"]`). Le bouton envoie directement chez Google
   (`direct_sign_in=social:google`).

La version web (iPhone en PWA, https://silvaplana.cloud/mountaintest/) a sa propre appli Logto
« Mountain Buddies Web » (page web, retour sur la page elle-même), créée par le même script.

Apple : bouton affiché mais inactif. Il faut le compte Apple Developer (99 $/an) pour créer un Services ID ;
ensuite `APPLE_SERVICES_ID=…` dans comptes.env et relancer l'installeur (le connecteur « apple » suivra).

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
