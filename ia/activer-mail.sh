#!/usr/bin/env bash
# Active l'envoi des invitations par e-mail (partage des frais) : reprend la configuration SMTP Brevo
# de contretemps (~/contretemps/backend/.env) dans ~/mountaintest/ia.env, puis relance le relais IA.
# Usage sur le VPS : bash <(curl -fsSL https://silvaplana.cloud/mountaintest/ia/activer-mail.sh)
set -euo pipefail
M="$HOME/mountaintest"
[ -f "$M/ia.env" ] || { echo "Installe d'abord le relais IA (installer-ia.sh)."; exit 1; }
SRC=""
for f in "$HOME/contretemps/backend/.env" "$HOME"/*/.env "$HOME"/*/*/.env; do
  [ -f "$f" ] && grep -qs '^SMTP_HOST=' "$f" && { SRC="$f"; break; }
done
[ -n "$SRC" ] || { echo "Aucun fichier .env avec SMTP_HOST trouvé (contretemps) : rien n'a été changé."; exit 1; }
echo "Configuration mail reprise de $SRC"
umask 077
grep -v '^SMTP_' "$M/ia.env" > "$M/ia.env.tmp" || true
grep -E '^SMTP_(HOST|PORT|USER|PASSWORD|REPLY_TO)=' "$SRC" | tr -d '"'"'" >> "$M/ia.env.tmp"
# Adresse d'expédition sur le domaine authentifié chez Brevo (comme contretemps@silvaplana.cloud).
DOM=$(grep -hs '^SMTP_FROM_EMAIL=' "$SRC" | head -1 | cut -d@ -f2 | tr -d '"'"'" ')
echo "SMTP_FROM_EMAIL=assomoutain@${DOM:-silvaplana.cloud}" >> "$M/ia.env.tmp"
mv "$M/ia.env.tmp" "$M/ia.env"; chmod 600 "$M/ia.env"
# Relance du conteneur avec le nouveau fichier (même commande que installer-ia.sh).
docker rm -f mountaintest-ia >/dev/null 2>&1 || true
docker run -d --name mountaintest-ia --network web --restart unless-stopped \
  --env-file "$M/ia.env" -v "$M/www/ia:/app:ro" -v "$M/ia-data:/data" \
  python:3.12-slim sh -c "pip install -q --no-cache-dir anthropic==2.3.0 && exec python -I /app/relais.py" >/dev/null
echo "Démarrage du relais (environ 30 s)…"; sleep 30
curl -fsS https://silvaplana.cloud/mountaintest-ia/ | grep -q '"mail": true' \
  && echo "=== Envoi des invitations activé. ===" \
  || echo "Le relais ne confirme pas encore : regarde docker logs mountaintest-ia"
