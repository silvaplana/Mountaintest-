#!/usr/bin/env bash
# Ajoute l'adresse https://mountainbuddies.silvaplana.cloud (voir deploy/README.md) :
#   /          page publique (dossier vitrine/ de la branche « site »)
#   /app/      l'appli web (les mêmes fichiers que https://silvaplana.cloud/mountaintest/, qui reste en place)
#   /conditions, /confidentialite   pages des conditions d'utilisation et de confidentialité
# Avant : enregistrement DNS A « mountainbuddies » vers l'IP du VPS. Relançable sans risque.
set -euo pipefail
M="$HOME/mountaintest"
D=mountainbuddies.silvaplana.cloud
G="$HOME/gateway/Caddyfile"

# 1. Le DNS doit déjà pointer ici, sinon Caddy n'obtient pas de certificat.
ici=$(getent ahostsv4 silvaplana.cloud | awk 'NR==1{print $1}')
la=$(getent ahostsv4 "$D" | awk 'NR==1{print $1}' || true)
if [ -z "$la" ] || [ "$la" != "$ici" ]; then
  echo "$D ne pointe pas encore vers ce serveur ($ici)."
  echo "Crée chez Hostinger un enregistrement DNS A « mountainbuddies » vers $ici, attends quelques minutes et relance."
  exit 1
fi

# 2. Le site dans le gateway (sauvegarde, vérification, retour arrière si erreur).
if ! grep -q "^$D" "$G"; then
  cp "$G" "$G.avant-mountainbuddies"
  cat >> "$G" <<CADDY

$D {
	redir /app /app/ 308
	handle_path /app/* {
		reverse_proxy mountaintest-web:80
	}
	redir /conditions /app/conditions.html
	redir /confidentialite /app/confidentialite.html
	handle {
		rewrite * /vitrine{path}
		reverse_proxy mountaintest-web:80
	}
}
CADDY
  cd "$HOME/gateway"
  if docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  else
    cat "$G.avant-mountainbuddies" > "$G"
    echo "Le gateway a refusé la nouvelle adresse : remis comme avant, rien n'a changé."; exit 1
  fi
fi

# 3. Connexion depuis l'appli web à la nouvelle adresse (Logto accepte l'ancienne et la nouvelle).
if [ -f "$M/comptes.env" ]; then
  PY_IMAGE=python:3.12-slim
  docker run --rm --network web --env-file "$M/comptes.env" -v "$M/www/comptes:/app:ro" -v "$M/comptes-data:/data" \
    "$PY_IMAGE" python /app/configurer-logto.py >/dev/null && echo "Connexion web : OK."
fi

# 4. Vérification.
sleep 5
if curl -fsS "https://$D/" | grep -q "Mountain Buddies"; then
  echo "C'est en ligne : https://$D/ (et l'appli sur https://$D/app/)."
else
  echo "Pas encore de réponse (le certificat peut prendre une minute) : ouvre https://$D/ dans un moment."
fi
