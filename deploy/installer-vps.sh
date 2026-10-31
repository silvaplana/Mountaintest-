#!/usr/bin/env bash
# Installation unique de Mountaintest sur le VPS (voir deploy/README.md).
# Sert https://silvaplana.cloud/mountaintest/ (site web + page des APK).
# Relançable sans risque.
set -euo pipefail
M="$HOME/mountaintest"
mkdir -p "$M/www"

# 1. Clé en lecture seule pour récupérer la branche « site » du dépôt privé.
[ -f "$M/cle" ] || ssh-keygen -q -t ed25519 -N "" -C "mountaintest-vps" -f "$M/cle"
[ -d "$M/site.git" ] || git init -q --bare "$M/site.git"

# 2. Mise à jour toutes les 5 minutes.
cat > "$M/maj.sh" <<'MAJ'
#!/bin/sh
cd "$HOME/mountaintest" || exit 1
export GIT_SSH_COMMAND="ssh -i $HOME/mountaintest/cle -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
git --git-dir=site.git fetch -q --depth 1 git@github.com:silvaplana/Mountaintest-.git +site:refs/heads/site || exit 1
git --git-dir=site.git --work-tree=www checkout -q -f site
MAJ
chmod +x "$M/maj.sh"
(crontab -l 2>/dev/null | grep -v 'mountaintest/maj.sh'; echo "*/5 * * * * $M/maj.sh >/dev/null 2>&1") | crontab -

# 3. Petit serveur de fichiers sur le réseau « web » (comme les autres applis).
if ! docker ps -a --format '{{.Names}}' | grep -qx mountaintest-web; then
  docker run -d --name mountaintest-web --network web --restart unless-stopped \
    -v "$M/www:/usr/share/caddy:ro" caddy:2-alpine >/dev/null
fi

# 4. Route /mountaintest/ dans le gateway (sauvegarde, vérification, retour arrière si erreur).
G="$HOME/gateway/Caddyfile"
if ! grep -q 'mountaintest-web' "$G"; then
  cp "$G" "$G.avant-mountaintest"
  awk '!fait && /redir \/contretemps \/contretemps\// {
         print "\tredir /mountaintest /mountaintest/ 308"
         print "\thandle_path /mountaintest/* {"
         print "\t\treverse_proxy mountaintest-web:80"
         print "\t}"
         print ""
         fait=1 }
       { print }
       END { if (!fait) exit 3 }' "$G.avant-mountaintest" > "$M/Caddyfile.nouveau" \
    || { echo "Je n'ai pas trouvé où ajouter la route dans $G : rien n'a été changé."; exit 1; }
  cat "$M/Caddyfile.nouveau" > "$G"   # même fichier (le conteneur le voit toujours)
  cd "$HOME/gateway"
  if docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  else
    cat "$G.avant-mountaintest" > "$G"
    echo "Le gateway a refusé la nouvelle route : remis comme avant, rien n'a changé."; exit 1
  fi
fi

echo
echo "=== C'est installé. Copie la ligne ci-dessous (elle commence par ssh-ed25519) : ==="
echo
cat "$M/cle.pub"
echo
