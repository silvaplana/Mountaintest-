#!/usr/bin/env bash
# Renomme Mountain Buddies sur le VPS : plus de « mountaintest » (Seb, 27/11). À lancer une fois, relançable sans risque.
#   ~/mountaintest            → ~/mountainbuddies (un lien ~/mountaintest est gardé : rien d'ancien ne casse)
#   conteneurs mountaintest-web, mountaintest-ia → mb-web, mb-ia (mb-api, mb-db, mb-logto, mb-livekit gardent leur nom)
#   https://mountainbuddies.silvaplana.cloud/api/ et /ia/ : le serveur des comptes et le relais
#   https://silvaplana.cloud/mountaintest/ : la page et les invitations renvoient vers mountainbuddies.silvaplana.cloud ;
#   /mountaintest/apk/, /mountaintest-api/ et /mountaintest-ia/ restent servis pour les applis déjà installées.
# La connexion ne change pas : personne n'a à se reconnecter.
set -euo pipefail
A="$HOME/mountaintest"
M="$HOME/mountainbuddies"
G="$HOME/gateway/Caddyfile"
D=mountainbuddies.silvaplana.cloud

grep -q "^$D" "$G" || { echo "Lance d'abord installer-mountainbuddies.sh (l'adresse $D n'est pas dans le gateway)."; exit 1; }

# 1. Le dossier (même disque : les conteneurs en marche ne voient pas la différence).
if [ -d "$A" ] && [ ! -L "$A" ]; then
  [ -e "$M" ] && { echo "$M existe déjà à côté de $A : je ne touche à rien, regarde ce qu'il contient."; exit 1; }
  mv "$A" "$M"
  ln -s "$M" "$A"
  echo "Dossier : $M (et le lien $A)."
fi
[ -d "$M" ] || { echo "Je ne trouve ni $A ni $M."; exit 1; }

# 2. Scripts de mise à jour et tâches toutes les 5 min : nouveaux chemins, nouveaux noms.
for f in "$M"/maj*.sh; do
  [ -f "$f" ] || continue
  sed -i -E -e "s#(\\\$HOME|$HOME)/mountaintest([/\" ]|\$)#\\1/mountainbuddies\\2#g" \
            -e 's#mountaintest-ia#mb-ia#g; s#mountaintest-web#mb-web#g' "$f"
done
crontab -l 2>/dev/null | sed -E "s#$HOME/mountaintest/#$HOME/mountainbuddies/#g" | crontab -

# 3. Nouveaux conteneurs, démarrés avant de toucher au gateway (pas de coupure).
if ! docker ps -a --format '{{.Names}}' | grep -qx mb-web; then
  docker run -d --name mb-web --network web --restart unless-stopped \
    -v "$M/www:/usr/share/caddy:ro" caddy:2-alpine >/dev/null
fi
if [ -f "$M/ia.env" ] && ! docker ps -a --format '{{.Names}}' | grep -qx mb-ia; then
  docker run -d --name mb-ia --network web --restart unless-stopped \
    --env-file "$M/ia.env" -v "$M/www/ia:/app:ro" -v "$M/ia-data:/data" \
    python:3.12-slim sh -c "pip install -q --no-cache-dir anthropic==2.3.0 && exec python -I /app/relais.py" >/dev/null
  echo "Démarrage du relais (environ 30 s)…"; sleep 30
fi

# 4. Gateway (sauvegarde, vérification, retour arrière si erreur).
if grep -q 'mountaintest-web\|mountaintest-ia' "$G" || ! grep -q 'handle_path /api/' "$G"; then
  cp "$G" "$G.avant-renommage"
  awk -v dom="$D" '
    # les anciennes routes vont aux nouveaux conteneurs
    { gsub(/mountaintest-web:80/, "mb-web:80"); gsub(/mountaintest-ia:8080/, "mb-ia:8080") }
    # l ancienne page et les anciennes invitations renvoient vers la nouvelle adresse
    !vieux && /handle_path \/mountaintest\/\* \{/ {
      print "\t@vieuxsite path_regexp vieuxsite ^/mountaintest/(index\\.html|rejoindre\\.html)?$"
      print "\tredir @vieuxsite https://" dom "/app/{re.vieuxsite.1}?{query} 302"
      vieux = 1 }
    { print }
    # /api et /ia sous la nouvelle adresse
    $0 ~ "^" dom " \\{" { dans = 1 }
    dans && !api && /redir \/app \/app\/ 308/ {
      print "\thandle_path /api/* {"; print "\t\treverse_proxy mb-api:8000"; print "\t}"
      print "\thandle_path /ia/* {"; print "\t\treverse_proxy mb-ia:8080"; print "\t}"
      api = 1 }
    END { if (!api && !deja) exit 3 }' deja="$(grep -c 'handle_path /api/' "$G" || true)" \
    "$G.avant-renommage" > "$M/Caddyfile.renommage" \
    || { echo "Je n'ai pas trouvé où ajouter /api dans $G : rien n'a été changé."; exit 1; }
  cat "$M/Caddyfile.renommage" > "$G"
  cd "$HOME/gateway"
  if docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  else
    cat "$G.avant-renommage" > "$G"
    echo "Le gateway a refusé les changements : remis comme avant (les nouveaux conteneurs tournent à côté, sans gêne)."; exit 1
  fi
fi

# 5. Les anciens conteneurs ne servent plus.
docker rm -f mountaintest-web mountaintest-ia >/dev/null 2>&1 || true

# 6. Vérification.
sleep 3
OK=1
curl -fsS "https://$D/api/config" | grep -q capacitor || { OK=0; echo "Le serveur ne répond pas sur https://$D/api/ (docker logs mb-api)"; }
curl -fsS "https://$D/ia/" >/dev/null || { OK=0; echo "Le relais ne répond pas sur https://$D/ia/ (docker logs mb-ia)"; }
curl -fsS "https://$D/" | grep -q "Mountain Buddies" || { OK=0; echo "La page publique ne répond pas (docker logs mb-web)"; }
curl -fsS https://silvaplana.cloud/mountaintest-api/config | grep -q capacitor || { OK=0; echo "L'ancienne adresse du serveur ne répond plus"; }
[ "$OK" = 1 ] && echo "=== C'est renommé : tout est sous $M et https://$D ==="
