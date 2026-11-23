#!/usr/bin/env bash
# Installation des comptes Mountain Buddies sur le VPS (voir deploy/comptes/README.md). Relançable sans risque.
#   https://auth.silvaplana.cloud            Logto : page de connexion (code par mail, plus tard Google / Apple)
#   https://silvaplana.cloud/mountaintest-api   serveur Python : profils, groupes, invitations
#   http://localhost:3002 (tunnel SSH)       console d'admin de Logto, jamais ouverte sur Internet
# Prérequis : le site installé (deploy/installer-vps.sh) et l'entrée DNS « auth » vers l'IP du VPS.
set -euo pipefail
M="$HOME/mountaintest"
DOMAINE_AUTH="${DOMAINE_AUTH:-auth.silvaplana.cloud}"
LOGTO_IMAGE="svhd/logto:1.46.0"
PG_IMAGE="postgres:17-alpine"
PY_IMAGE="python:3.12-slim"

[ -d "$M/www" ] || { echo "Installe d'abord le site (deploy/installer-vps.sh)."; exit 1; }
[ -f "$M/www/comptes/serveur.py" ] || "$M/maj.sh" || true
[ -f "$M/www/comptes/serveur.py" ] || { echo "Le dossier comptes/ n'est pas encore sur le VPS : réessaie dans 5 minutes."; exit 1; }

# 0. L'adresse auth.silvaplana.cloud doit pointer sur ce VPS (sinon Caddy ne peut pas obtenir le certificat HTTPS).
IP_VPS=$(curl -fsS4 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
IP_DNS=$(getent ahostsv4 "$DOMAINE_AUTH" | awk 'NR==1{print $1}')
if [ "$IP_DNS" != "$IP_VPS" ]; then
  echo "L'adresse $DOMAINE_AUTH ne pointe pas encore sur ce VPS ($IP_VPS) : ${IP_DNS:-introuvable}."
  echo "Hostinger hPanel › Domaines › silvaplana.cloud › DNS : ajouter un enregistrement A, nom « auth », valeur $IP_VPS."
  echo "Puis relancer ce script (la prise en compte peut prendre quelques minutes)."
  exit 1
fi
mkdir -p "$M/comptes-db" "$M/comptes-data"

# 1. Secrets (fichier lisible par toi seul) : mot de passe de la base, clé de l'installeur Logto, envoi des mails Brevo.
if [ ! -f "$M/comptes.env" ]; then
  umask 077
  PG=$(openssl rand -hex 24); M2M=$(openssl rand -hex 24)
  {
    echo "POSTGRES_USER=mb"; echo "POSTGRES_PASSWORD=$PG"; echo "POSTGRES_DB=logto"
    echo "DB_URL=postgresql+psycopg://mb:$PG@mb-db:5432/mountain"
    echo "LOGTO_ENDPOINT=https://$DOMAINE_AUTH"; echo "LOGTO_INTERNE=http://mb-logto:3001"
    echo "LOGTO_M2M_ID=mb-installeur"; echo "LOGTO_M2M_SECRET=$M2M"
  } > "$M/comptes.env"
  # Même envoi que contretemps et le partage des frais : SMTP de Brevo.
  SRC=""
  for f in "$M/ia.env" "$HOME/contretemps/backend/.env" "$HOME"/*/.env "$HOME"/*/*/.env; do
    [ -f "$f" ] && grep -qs '^SMTP_HOST=' "$f" && { SRC="$f"; break; }
  done
  if [ -n "$SRC" ]; then
    echo "Envoi des codes par mail : configuration reprise de $SRC"
    grep -E '^SMTP_(HOST|PORT|USER|PASSWORD|REPLY_TO)=' "$SRC" | tr -d "\"'" >> "$M/comptes.env"
    DOM=$(grep -hs '^SMTP_FROM_EMAIL=' "$SRC" | head -1 | cut -d@ -f2 | tr -d "\"' ")
    echo "SMTP_FROM_EMAIL=mountainbuddies@${DOM:-silvaplana.cloud}" >> "$M/comptes.env"
  else
    echo "ATTENTION : aucune configuration SMTP (Brevo) trouvée : les codes de connexion ne pourront pas partir."
  fi
fi
chmod 600 "$M/comptes.env"
set -a; . "$M/comptes.env"; set +a

# 2. Base Postgres (une base « logto », une base « mountain »).
if ! docker ps -a --format '{{.Names}}' | grep -qx mb-db; then
  docker run -d --name mb-db --network web --restart unless-stopped --env-file "$M/comptes.env" \
    -v "$M/comptes-db:/var/lib/postgresql/data" "$PG_IMAGE" >/dev/null
fi
docker start mb-db >/dev/null
for i in $(seq 1 30); do docker exec mb-db pg_isready -U mb -d logto >/dev/null 2>&1 && break; sleep 2; done
docker exec mb-db psql -U mb -d logto -tAc "select 1 from pg_database where datname='mountain'" | grep -q 1 \
  || docker exec mb-db psql -U mb -d logto -qc "create database mountain"

# 3. Logto (port 3002 = console d'admin, seulement sur la machine).
docker rm -f mb-logto >/dev/null 2>&1 || true
docker run -d --name mb-logto --network web --restart unless-stopped -p 127.0.0.1:3002:3002 \
  -e TRUST_PROXY_HEADER=1 -e "DB_URL=postgres://mb:$POSTGRES_PASSWORD@mb-db:5432/logto" \
  -e "ENDPOINT=https://$DOMAINE_AUTH" -e ADMIN_ENDPOINT=http://localhost:3002 \
  --entrypoint sh "$LOGTO_IMAGE" -c "npm run cli db seed -- --swe && npm run cli db alteration deploy latest && npm start" >/dev/null
echo "Démarrage de Logto (jusqu'à 2 minutes la première fois)…"
for i in $(seq 1 60); do
  docker exec mb-db psql -U mb -d logto -tAc "select 1 from roles where tenant_id='default' and name='Logto Management API access'" 2>/dev/null | grep -q 1 && break
  sleep 3
done

# 4. Application « machine » mb-installeur : droits sur l'API de gestion de Logto, pour tout configurer par script
#    (et pour que le serveur lise l'e-mail des comptes). Clé dans comptes.env.
docker exec -i mb-db psql -U mb -d logto -q <<SQL
insert into applications (tenant_id, id, name, secret, type, oidc_client_metadata)
values ('default', 'mb-installeur', 'Installeur Mountain Buddies', '$LOGTO_M2M_SECRET', 'MachineToMachine',
        '{"redirectUris": [], "postLogoutRedirectUris": []}')
on conflict (id) do update set secret = excluded.secret;
insert into applications_roles (tenant_id, id, application_id, role_id)
select 'default', 'mb-installeur-role', 'mb-installeur', id from roles
where tenant_id = 'default' and name = 'Logto Management API access'
on conflict do nothing;
SQL

# 5. Configuration de Logto : applis, API, page de connexion en français, envoi des codes par Brevo.
docker run --rm --network web --env-file "$M/comptes.env" -v "$M/www/comptes:/app:ro" -v "$M/comptes-data:/data" \
  "$PY_IMAGE" python /app/configurer-logto.py

# 6. Serveur Python.
docker rm -f mb-api >/dev/null 2>&1 || true
docker run -d --name mb-api --network web --restart unless-stopped --env-file "$M/comptes.env" \
  -v "$M/www/comptes:/app:ro" -v "$M/comptes-data:/data" -w /app "$PY_IMAGE" \
  sh -c "pip install -q --no-cache-dir -r /app/requirements.txt && exec python /app/serveur.py" >/dev/null

# 7. Redémarrer le serveur quand une nouvelle version arrive avec le site (vérifié toutes les 5 min).
cat > "$M/maj-comptes.sh" <<'MAJ'
#!/bin/sh
M="$HOME/mountaintest"
h=$(cat "$M"/www/comptes/*.py "$M/www/comptes/requirements.txt" 2>/dev/null | sha1sum | cut -c1-40)
[ -n "$h" ] && [ "$h" != "$(cat "$M/comptes-data/version" 2>/dev/null)" ] && docker restart mb-api >/dev/null && echo "$h" > "$M/comptes-data/version"
MAJ
chmod +x "$M/maj-comptes.sh"
cat "$M"/www/comptes/*.py "$M/www/comptes/requirements.txt" | sha1sum | cut -c1-40 > "$M/comptes-data/version"
(crontab -l 2>/dev/null | grep -v 'mountaintest/maj-comptes.sh'; echo "*/5 * * * * $M/maj-comptes.sh >/dev/null 2>&1") | crontab -

# 8. Gateway Caddy : /mountaintest-api/ et le site auth.silvaplana.cloud (sauvegarde, vérification, retour arrière).
G="$HOME/gateway/Caddyfile"
if ! grep -q 'mb-api' "$G"; then
  cp "$G" "$G.avant-comptes"
  awk -v dom="$DOMAINE_AUTH" '!fait && /redir \/mountaintest \/mountaintest\// {
         print "\thandle_path /mountaintest-api/* {"
         print "\t\treverse_proxy mb-api:8000"
         print "\t}"
         print ""
         fait=1 }
       { print }
       END {
         if (!fait) exit 3
         print ""
         print dom " {"
         print "\treverse_proxy mb-logto:3001"
         print "}"
       }' "$G.avant-comptes" > "$M/Caddyfile.comptes" \
    || { echo "Je n'ai pas trouvé la route mountaintest dans $G : rien n'a été changé."; exit 1; }
  cat "$M/Caddyfile.comptes" > "$G"
  cd "$HOME/gateway"
  if docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  else
    cat "$G.avant-comptes" > "$G"
    echo "Le gateway a refusé les nouvelles routes : remis comme avant."; exit 1
  fi
fi

echo "Démarrage du serveur (installation des paquets Python, environ 40 s)…"
sleep 40
echo
OK=1
curl -fsS "https://$DOMAINE_AUTH/oidc/.well-known/openid-configuration" >/dev/null || { OK=0; echo "Logto ne répond pas sur https://$DOMAINE_AUTH (docker logs mb-logto)"; }
curl -fsS https://silvaplana.cloud/mountaintest-api/config | grep -q capacitor || { OK=0; echo "Le serveur ne répond pas (docker logs mb-api)"; }
[ "$OK" = 1 ] && echo "=== Comptes en ligne : https://$DOMAINE_AUTH et https://silvaplana.cloud/mountaintest-api/ ==="
