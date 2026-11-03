#!/usr/bin/env bash
# Installation unique du relais IA sur le VPS (voir deploy/ia/README.md). Relançable sans risque.
# Prérequis : deploy/installer-vps.sh déjà installé (le site arrive dans ~/mountaintest/www).
set -euo pipefail
M="$HOME/mountaintest"
[ -d "$M/www" ] || { echo "Installe d'abord le site (deploy/installer-vps.sh)."; exit 1; }
[ -f "$M/www/ia/relais.py" ] || "$M/maj.sh" || true
[ -f "$M/www/ia/relais.py" ] || { echo "Le fichier ia/relais.py n'est pas encore sur le VPS : réessaie dans 5 minutes."; exit 1; }
mkdir -p "$M/ia-data"

# 1. Clé API Anthropic et mot de passe de l'appli, rangés dans un fichier lisible par toi seul.
if [ ! -f "$M/ia.env" ]; then
  # Une clé déjà présente sur le VPS (ex. celle de contretemps / AppBase) peut être réutilisée.
  CLE=""
  for f in "$HOME"/*/.env "$HOME"/*/*.env "$HOME"/*/*/.env; do
    [ -f "$f" ] || continue
    k=$(grep -hs '^ANTHROPIC_API_KEY=' "$f" | head -1 | cut -d= -f2- | tr -d '"'"'"' ') || true
    if [ -n "$k" ]; then
      read -r -p "Clé Anthropic trouvée dans $f (…${k: -4}). La réutiliser ? [O/n] " R
      case "$R" in n|N) ;; *) CLE="$k"; break ;; esac
    fi
  done
  [ -n "$CLE" ] || { read -r -s -p "Colle ta clé API Anthropic (sk-ant-…) puis Entrée : " CLE; echo; }
  read -r -p "Choisis un mot de passe pour l'appli (à taper une fois dans l'onglet Randos) : " MDP
  umask 077
  printf 'ANTHROPIC_API_KEY=%s\nRELAIS_MOT_DE_PASSE=%s\nRELAIS_MAX_PAR_JOUR=40\n' "$CLE" "$MDP" > "$M/ia.env"
fi
chmod 600 "$M/ia.env"

# 2. Conteneur du relais (Python + SDK Anthropic), sur le réseau « web » comme le site.
docker rm -f mountaintest-ia >/dev/null 2>&1 || true
docker run -d --name mountaintest-ia --network web --restart unless-stopped \
  --env-file "$M/ia.env" -v "$M/www/ia:/app:ro" -v "$M/ia-data:/data" \
  python:3.12-slim sh -c "pip install -q --no-cache-dir anthropic==2.3.0 && exec python -I /app/relais.py" >/dev/null

# 3. Redémarrer le relais quand une nouvelle version arrive avec le site (vérifié toutes les 5 min).
cat > "$M/maj-ia.sh" <<'MAJ'
#!/bin/sh
M="$HOME/mountaintest"
h=$(sha1sum "$M/www/ia/relais.py" 2>/dev/null | cut -c1-40)
[ -n "$h" ] && [ "$h" != "$(cat "$M/ia-data/version" 2>/dev/null)" ] && docker restart mountaintest-ia >/dev/null && echo "$h" > "$M/ia-data/version"
MAJ
chmod +x "$M/maj-ia.sh"
sha1sum "$M/www/ia/relais.py" | cut -c1-40 > "$M/ia-data/version"
(crontab -l 2>/dev/null | grep -v 'mountaintest/maj-ia.sh'; echo "*/5 * * * * $M/maj-ia.sh >/dev/null 2>&1") | crontab -

# 4. Route https://silvaplana.cloud/mountaintest-ia/ dans le gateway (sauvegarde, vérification, retour arrière).
G="$HOME/gateway/Caddyfile"
if ! grep -q 'mountaintest-ia' "$G"; then
  cp "$G" "$G.avant-ia"
  awk '!fait && /redir \/mountaintest \/mountaintest\// {
         print "\thandle_path /mountaintest-ia/* {"
         print "\t\treverse_proxy mountaintest-ia:8080"
         print "\t}"
         print ""
         fait=1 }
       { print }
       END { if (!fait) exit 3 }' "$G.avant-ia" > "$M/Caddyfile.ia" \
    || { echo "Je n'ai pas trouvé la route mountaintest dans $G : rien n'a été changé."; exit 1; }
  cat "$M/Caddyfile.ia" > "$G"
  cd "$HOME/gateway"
  if docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  else
    cat "$G.avant-ia" > "$G"
    echo "Le gateway a refusé la nouvelle route : remis comme avant."; exit 1
  fi
fi

echo "Démarrage du relais (installation du SDK, environ 30 s)…"
sleep 30
echo
if curl -fsS https://silvaplana.cloud/mountaintest-ia/ >/dev/null; then
  echo "=== Relais IA en ligne. Dans l'appli : onglet Randos, tape ton mot de passe IA. ==="
else
  echo "Le relais ne répond pas encore. Regarde : docker logs mountaintest-ia"
fi
