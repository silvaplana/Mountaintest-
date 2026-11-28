#!/usr/bin/env bash
# Serveur BÊTA de Mountain Buddies (branche « beta », essai PowerSync). À côté de la production, sans y toucher :
#   https://mb-beta.silvaplana.cloud/apk/   page de téléchargement de l'appli « Mountain Buddies Bêta »
#   https://mb-beta.silvaplana.cloud/app/   l'appli bêta dans le navigateur
#   https://mb-beta.silvaplana.cloud/api/   serveur Python bêta (conteneur mb-beta-api)
#   https://mb-beta.silvaplana.cloud/ps/    service PowerSync (conteneur mb-beta-powersync)
# La bêta a SA base Postgres (conteneur mb-beta-db), copie de la production au moment de l'installation, et ses
# propres fichiers (~/mountainbuddies/beta/). Les comptes sont ceux de la production (même Logto).
# La bêta n'envoie ni notification ni mail : elle ne dérange pas les téléphones des copains.
#
# Avant : enregistrement DNS A « mb-beta » vers l'IP du VPS.
# Lancer :            bash <(curl -fsSL https://raw.githubusercontent.com/silvaplana/Mountaintest-/site-beta/installer-beta.sh)
# Recopier la base :  … installer-beta.sh) --recopier     (efface la base bêta et reprend celle de la production)
# Tout enlever :      … installer-beta.sh) --enlever
set -euo pipefail
M="$HOME/mountainbuddies"
B="$M/beta"
D=mb-beta.silvaplana.cloud
G="$HOME/gateway/Caddyfile"
PG_IMAGE="postgres:17-alpine"
PY_IMAGE="python:3.12-slim"
PS_IMAGE="journeyapps/powersync-service:1.29.1"
DEPOT="https://github.com/silvaplana/Mountaintest-.git"

if [ "${1:-}" = "--enlever" ]; then
  docker rm -f mb-beta-powersync mb-beta-api mb-beta-web mb-beta-db >/dev/null 2>&1 || true
  (crontab -l 2>/dev/null | grep -v 'beta/maj-beta.sh') | crontab - || true
  if grep -q "^$D" "$G"; then
    cp "$G" "$G.avant-enlever-beta"
    awk -v d="$D" '$0 ~ "^"d" {" {saute=1} !saute {print} saute && /^}/ {saute=0}' "$G.avant-enlever-beta" > "$B/Caddyfile.sans-beta"
    cat "$B/Caddyfile.sans-beta" > "$G"
    (cd "$HOME/gateway" && docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile) || cat "$G.avant-enlever-beta" > "$G"
  fi
  echo "Bêta enlevée. Ses fichiers restent dans $B (sudo rm -rf $B pour les effacer)."
  exit 0
fi

[ -f "$M/comptes.env" ] || { echo "Les comptes de la production ne sont pas installés ici ($M/comptes.env introuvable)."; exit 1; }

# 0. Le DNS doit déjà pointer ici, sinon Caddy n'obtient pas de certificat.
ici=$(getent ahostsv4 silvaplana.cloud | awk 'NR==1{print $1}')
la=$(getent ahostsv4 "$D" | awk 'NR==1{print $1}' || true)
if [ -z "$la" ] || [ "$la" != "$ici" ]; then
  echo "$D ne pointe pas encore vers ce serveur ($ici)."
  echo "Hostinger hPanel › Domaines › silvaplana.cloud › DNS : ajouter un enregistrement A, nom « mb-beta », valeur $ici."
  echo "Attends quelques minutes et relance."
  exit 1
fi

# Assez de mémoire ? Postgres + PowerSync + Python demandent environ 700 Mo.
libre=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
[ "$libre" -ge 900 ] || echo "ATTENTION : seulement $libre Mo de mémoire libre sur le VPS (il en faut environ 700 pour la bêta)."

mkdir -p "$B/data" "$B/db" "$B/www"

# 1. Les fichiers de la bêta (branche « site-beta », écrite par GitHub à chaque changement de la branche « beta »).
cat > "$B/maj-beta.sh" <<MAJ
#!/bin/sh
# Toutes les 5 minutes : nouveaux fichiers de la bêta ; serveur et PowerSync relancés seulement si leurs fichiers changent.
B="$B"
cd "\$B" || exit 1
[ -d site.git ] || git init -q --bare site.git
git --git-dir=site.git fetch -q --depth 1 $DEPOT +site-beta:refs/heads/site-beta || exit 1
git --git-dir=site.git --work-tree=www checkout -q -f site-beta
h=\$(cat www/comptes/*.py www/comptes/requirements.txt 2>/dev/null | sha1sum | cut -c1-40)
[ -n "\$h" ] && [ "\$h" != "\$(cat data/version 2>/dev/null)" ] && docker restart mb-beta-api >/dev/null 2>&1 && echo "\$h" > data/version
p=\$(cat www/powersync/*.yaml 2>/dev/null | sha1sum | cut -c1-40)
[ -n "\$p" ] && [ "\$p" != "\$(cat data/version-powersync 2>/dev/null)" ] && docker restart mb-beta-powersync >/dev/null 2>&1 && echo "\$p" > data/version-powersync
exit 0
MAJ
chmod +x "$B/maj-beta.sh"
"$B/maj-beta.sh" || true
[ -f "$B/www/comptes/serveur.py" ] || { echo "Les fichiers de la bêta ne sont pas encore publiés (branche site-beta) : réessaie dans quelques minutes."; exit 1; }
(crontab -l 2>/dev/null | grep -v 'beta/maj-beta.sh'; echo "*/5 * * * * $B/maj-beta.sh >/dev/null 2>&1") | crontab -

# 2. Secrets de la bêta : ceux de la production (Logto, appels), sans les mails, avec SA base.
set -a; . "$M/comptes.env"; set +a
if [ ! -f "$B/beta.env" ]; then
  umask 077
  PG=$(openssl rand -hex 24)
  {
    grep -Ev '^(SMTP_|POSTGRES_|DB_URL=|FIREBASE_CLE=|SITE_PUBLIC=|LIEN_APK=|POWERSYNC_URL=)' "$M/comptes.env"
    echo "POSTGRES_USER=mb"; echo "POSTGRES_PASSWORD=$PG"; echo "POSTGRES_DB=mountain"
    echo "DB_URL=postgresql+psycopg://mb:$PG@mb-beta-db:5432/mountain"
    echo "POWERSYNC_URL=https://$D/ps"
    echo "SITE_PUBLIC=https://$D"; echo "LIEN_APK=https://$D/apk/mountain-buddies-beta.apk"
    echo "PS_SOURCE_URI=postgresql://mb:$PG@mb-beta-db:5432/mountain"
    echo "PS_STORAGE_URI=postgresql://mb:$PG@mb-beta-db:5432/powersync_storage"
    echo "PS_JWKS_URI=http://mb-beta-api:8000/powersync/cles"
    echo "POWERSYNC_CONFIG_PATH=/config/powersync.yaml"
    echo "NODE_OPTIONS=--max-old-space-size=400"
  } > "$B/beta.env"
fi
chmod 600 "$B/beta.env"

# 3. Base Postgres de la bêta, avec la réplication logique (PowerSync lit le journal de la base).
if [ "${1:-}" = "--recopier" ]; then
  docker rm -f mb-beta-powersync mb-beta-api mb-beta-db >/dev/null 2>&1 || true
  docker run --rm -v "$B:/b" alpine sh -c 'rm -rf /b/db && mkdir -p /b/db'
fi
if ! docker ps -a --format '{{.Names}}' | grep -qx mb-beta-db; then
  docker run -d --name mb-beta-db --network web --restart unless-stopped --env-file "$B/beta.env" \
    -v "$B/db:/var/lib/postgresql/data" "$PG_IMAGE" postgres -c wal_level=logical >/dev/null
fi
docker start mb-beta-db >/dev/null
for i in $(seq 1 30); do docker exec mb-beta-db pg_isready -U mb -d mountain >/dev/null 2>&1 && break; sleep 2; done
docker exec mb-beta-db psql -U mb -d mountain -tAc "select 1 from pg_database where datname='powersync_storage'" | grep -q 1 \
  || docker exec mb-beta-db psql -U mb -d mountain -qc "create database powersync_storage"

# 4. Copie des données de la production (une seule fois ; --recopier pour recommencer). La production est seulement lue.
if ! docker exec mb-beta-db psql -U mb -d mountain -tAc "select 1 from information_schema.tables where table_name='utilisateurs'" | grep -q 1; then
  echo "Copie de la base de production vers la bêta…"
  docker exec mb-db pg_dump -U mb --no-owner --no-publications --no-subscriptions mountain | docker exec -i mb-beta-db psql -U mb -d mountain -q -v ON_ERROR_STOP=1 >/dev/null
  # Aucun téléphone à faire sonner depuis la bêta.
  docker exec mb-beta-db psql -U mb -d mountain -qc "truncate appareils"
  echo "Copie des photos et des fichiers…"
  for d in photos fichiers; do [ -d "$M/comptes-data/$d" ] && cp -an "$M/comptes-data/$d" "$B/data/" || true; done
fi
[ -f "$M/comptes-data/logto.json" ] && cp "$M/comptes-data/logto.json" "$B/data/logto.json"

# 5. Logto : accepter le retour de connexion vers l'appli bêta (une adresse de plus, rien d'autre ne change).
docker run --rm --network web --env-file "$M/comptes.env" -v "$B/www/comptes:/app:ro" -v "$M/comptes-data:/data" \
  "$PY_IMAGE" python /app/configurer-logto.py >/dev/null \
  && echo "Connexion à l'appli bêta : OK." || echo "ATTENTION : Logto n'a pas pu être mis à jour ; la connexion à l'appli bêta ne marchera pas."
cp "$M/comptes-data/logto.json" "$B/data/logto.json" 2>/dev/null || true

# 6. Serveur Python de la bêta (il crée la publication « powersync » dans la base), puis le service PowerSync.
docker rm -f mb-beta-api >/dev/null 2>&1 || true
docker run -d --name mb-beta-api --network web --restart unless-stopped --env-file "$B/beta.env" \
  -v "$B/www/comptes:/app:ro" -v "$B/data:/data" -w /app "$PY_IMAGE" \
  sh -c "pip install -q --no-cache-dir -r /app/requirements.txt && exec python /app/serveur.py" >/dev/null
cat "$B"/www/comptes/*.py "$B/www/comptes/requirements.txt" | sha1sum | cut -c1-40 > "$B/data/version"
echo "Démarrage du serveur bêta (installation des paquets Python, environ 40 s)…"
for i in $(seq 1 60); do docker exec mb-beta-api python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/powersync/cles')" >/dev/null 2>&1 && break; sleep 2; done

docker rm -f mb-beta-powersync >/dev/null 2>&1 || true
docker run -d --name mb-beta-powersync --network web --restart unless-stopped --memory 700m --env-file "$B/beta.env" \
  -v "$B/www/powersync:/config:ro" "$PS_IMAGE" start -r unified >/dev/null
cat "$B"/www/powersync/*.yaml | sha1sum | cut -c1-40 > "$B/data/version-powersync"

# 7. Les fichiers (page de téléchargement, APK, appli web).
docker ps -a --format '{{.Names}}' | grep -qx mb-beta-web \
  || docker run -d --name mb-beta-web --network web --restart unless-stopped -v "$B/www:/usr/share/caddy:ro" caddy:2-alpine >/dev/null

# 8. L'adresse dans le gateway (sauvegarde, vérification, retour arrière si erreur).
if ! grep -q "^$D" "$G"; then
  cp "$G" "$G.avant-beta"
  cat >> "$G" <<CADDY

$D {
	redir / /apk/ 302
	redir /app /app/ 308
	handle_path /api/* {
		reverse_proxy mb-beta-api:8000
	}
	handle_path /ps/* {
		reverse_proxy mb-beta-powersync:8080 {
			flush_interval -1
		}
	}
	handle {
		reverse_proxy mb-beta-web:80
	}
}
CADDY
  cd "$HOME/gateway"
  if docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  else
    cat "$G.avant-beta" > "$G"
    echo "Le gateway a refusé la nouvelle adresse : remis comme avant. Les conteneurs de la bêta tournent, mais sans adresse."; exit 1
  fi
fi

# 9. Vérification.
sleep 20
OK=1
curl -fsS "https://$D/api/powersync/cles" | grep -q '"keys"' || { OK=0; echo "Le serveur bêta ne répond pas (docker logs mb-beta-api)."; }
curl -fsS "https://$D/ps/probes/liveness" >/dev/null || { OK=0; echo "PowerSync ne répond pas (docker logs mb-beta-powersync)."; }
docker logs mb-beta-powersync 2>&1 | grep -q '"level":"error"' && echo "PowerSync a écrit des erreurs : docker logs mb-beta-powersync | grep error"
if [ "$OK" = 1 ]; then
  echo "=== Bêta en ligne. Sur le téléphone : https://$D/apk/ ==="
else
  echo "(le certificat HTTPS peut prendre une minute : relance le script dans un moment, il ne refait que ce qui manque)"
fi
