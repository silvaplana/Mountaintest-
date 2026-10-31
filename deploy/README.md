# Mise en ligne sur le VPS

Adresse : **https://silvaplana.cloud/mountaintest/** (version web du proto React)
et **https://silvaplana.cloud/mountaintest/apk/** (les deux APK à installer).

```
push sur main ─▶ GitHub Actions : tests, build web, APK Capacitor, APK Kotlin
                     └─▶ branche « site » (web + apk/), écrasée à chaque fois
VPS, toutes les 5 min : ~/mountaintest/maj.sh récupère la branche « site » dans ~/mountaintest/www
gateway (~/gateway/Caddyfile) : /mountaintest/* ─▶ conteneur mountaintest-web (caddy:2-alpine, fichiers de www)
```

Différence avec contretemps : ici c'est le VPS qui va chercher (dépôt privé, clé
GitHub en lecture seule « deploy key »), GitHub n'a aucune clé du VPS et il n'y a
aucun secret à mettre dans le dépôt.

## Installation (une seule fois, sur le VPS)

1. Ouvrir un terminal sur le VPS (Hostinger hPanel › VPS › Terminal du navigateur, ou une appli SSH).
2. Coller le contenu de `deploy/installer-vps.sh` puis Entrée. Il :
   crée la clé, la tâche cron, le conteneur `mountaintest-web`, ajoute la route au gateway
   (sauvegarde `~/gateway/Caddyfile.avant-mountaintest`, vérification, retour arrière si refus),
   puis affiche une ligne `ssh-ed25519 ...`.
3. Sur GitHub : dépôt › Settings › Deploy keys › Add deploy key, titre `VPS`,
   coller la ligne, **sans** cocher « Allow write access », Add key.
4. Moins de 5 minutes après, le site répond. Pour forcer : `~/mountaintest/maj.sh`.

## Tout retirer

```bash
crontab -l | grep -v mountaintest/maj.sh | crontab -
docker rm -f mountaintest-web
cat ~/gateway/Caddyfile.avant-mountaintest > ~/gateway/Caddyfile && (cd ~/gateway && docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile)
rm -rf ~/mountaintest
```
puis supprimer la deploy key sur GitHub.
