#!/usr/bin/env bash
# 📞 Appels de groupe de Mountain Buddies sur le VPS (spec/buddies.md §5.7, voir deploy/comptes/README.md). Relançable.
#   https://appels.silvaplana.cloud   LiveKit : le son des appels (WebRTC)
#   le serveur des comptes donne les jetons d'entrée et fait sonner les téléphones (Firebase)
# Prérequis : les comptes installés (installer-comptes.sh), l'entrée DNS « appels » vers l'IP du VPS et, pour que
# ça sonne appli fermée, la clé Firebase copiée dans ~/mountaintest/firebase-cle.json.
set -euo pipefail
M="$HOME/mountaintest"
DOMAINE="${DOMAINE_APPELS:-appels.silvaplana.cloud}"
LIVEKIT_IMAGE="livekit/livekit-server:v1.8.4"
PY_IMAGE="python:3.12-slim"
UDP_DEBUT=50000
UDP_FIN=50200

[ -f "$M/comptes.env" ] || { echo "Installe d'abord les comptes (installer-comptes.sh)."; exit 1; }

# 0. L'adresse appels.silvaplana.cloud doit pointer sur ce VPS (certificat HTTPS de Caddy).
IP_VPS=$(curl -fsS4 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
IP_DNS=$(getent ahostsv4 "$DOMAINE" | awk 'NR==1{print $1}')
if [ "$IP_DNS" != "$IP_VPS" ]; then
  echo "L'adresse $DOMAINE ne pointe pas encore sur ce VPS ($IP_VPS) : ${IP_DNS:-introuvable}."
  echo "Hostinger hPanel › Domaines › silvaplana.cloud › DNS : ajouter un enregistrement A, nom « appels », valeur $IP_VPS."
  echo "Puis relancer ce script (la prise en compte peut prendre quelques minutes)."
  exit 1
fi

# 1. Clé LiveKit (dans comptes.env, lisible par toi seul).
if ! grep -q '^LIVEKIT_SECRET=' "$M/comptes.env"; then
  { echo "LIVEKIT_URL=wss://$DOMAINE"; echo "LIVEKIT_CLE=mb"; echo "LIVEKIT_SECRET=$(openssl rand -hex 32)"; } >> "$M/comptes.env"
fi
grep -q '^FIREBASE_CLE=' "$M/comptes.env" || echo "FIREBASE_CLE=/data/firebase-cle.json" >> "$M/comptes.env"
chmod 600 "$M/comptes.env"
set -a; . "$M/comptes.env"; set +a

# 2. LiveKit : signalisation derrière Caddy (HTTPS), le son en direct sur le port TCP 7881 et les ports UDP.
umask 077
cat > "$M/livekit.yaml" <<YAML
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: $UDP_DEBUT
  port_range_end: $UDP_FIN
  node_ip: $IP_VPS
  use_external_ip: false
keys:
  $LIVEKIT_CLE: $LIVEKIT_SECRET
logging:
  level: info
YAML
umask 022
docker rm -f mb-livekit >/dev/null 2>&1 || true
docker run -d --name mb-livekit --network web --restart unless-stopped \
  -p 7881:7881/tcp -p "$UDP_DEBUT-$UDP_FIN:$UDP_DEBUT-$UDP_FIN/udp" \
  -v "$M/livekit.yaml:/etc/livekit.yaml:ro" "$LIVEKIT_IMAGE" --config /etc/livekit.yaml >/dev/null

# 3. Pare-feu de la machine (s'il est actif).
if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
  ufw allow 7881/tcp >/dev/null; ufw allow "$UDP_DEBUT:$UDP_FIN/udp" >/dev/null
fi

# 4. Clé Firebase (sonnerie appli fermée) : copiée à côté des données du serveur, jamais dans le dépôt.
if [ -f "$M/firebase-cle.json" ]; then
  cp "$M/firebase-cle.json" "$M/comptes-data/firebase-cle.json"; chmod 600 "$M/comptes-data/firebase-cle.json"
  SONNERIE=1
else
  SONNERIE=0
fi

# 5. Serveur des comptes relancé avec la nouvelle configuration.
docker rm -f mb-api >/dev/null 2>&1 || true
docker run -d --name mb-api --network web --restart unless-stopped --env-file "$M/comptes.env" \
  -v "$M/www/comptes:/app:ro" -v "$M/comptes-data:/data" -w /app "$PY_IMAGE" \
  sh -c "pip install -q --no-cache-dir -r /app/requirements.txt && exec python /app/serveur.py" >/dev/null

# 6. Gateway Caddy : le site appels.silvaplana.cloud (sauvegarde, vérification, retour arrière).
G="$HOME/gateway/Caddyfile"
if ! grep -q 'mb-livekit' "$G"; then
  cp "$G" "$G.avant-appels"
  { cat "$G.avant-appels"; echo; echo "$DOMAINE {"; printf '\treverse_proxy mb-livekit:7880\n'; echo "}"; } > "$M/Caddyfile.appels"
  cat "$M/Caddyfile.appels" > "$G"
  cd "$HOME/gateway"
  if docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  else
    cat "$G.avant-appels" > "$G"
    echo "Le gateway a refusé la nouvelle adresse : remis comme avant."; exit 1
  fi
fi

echo "Démarrage (environ 40 s)…"
sleep 40
echo
OK=1
curl -fsS "https://$DOMAINE/" >/dev/null || { OK=0; echo "LiveKit ne répond pas sur https://$DOMAINE (docker logs mb-livekit)"; }
curl -fsS https://silvaplana.cloud/mountaintest-api/ >/dev/null || { OK=0; echo "Le serveur ne répond pas (docker logs mb-api)"; }
[ "$SONNERIE" = 1 ] || echo "Pas de clé Firebase dans $M/firebase-cle.json : les appels marchent, mais ne sonnent que l'appli ouverte."
if [ "$OK" = 1 ]; then
  echo "=== Appels en ligne : https://$DOMAINE ==="
  echo "Si le son ne passe pas : dans hPanel › VPS › Pare-feu, autoriser TCP 7881 et UDP $UDP_DEBUT-$UDP_FIN."
fi
