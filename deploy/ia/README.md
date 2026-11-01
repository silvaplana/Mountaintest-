# Relais IA (randos trouvées sur le web par Claude)

L'onglet **Randos** des deux applis a un bouton « Chercher avec Claude ». L'appli envoie la zone
encadrée à **https://silvaplana.cloud/mountaintest-ia/randos** ; ce relais (`relais.py`, sur le VPS)
appelle l'API Claude avec la recherche web et renvoie, pour chaque rando trouvée, un point de départ
et le lien de la page. L'appli affiche un point par rando ; le toucher ouvre la page.

```
appli ─▶ gateway Caddy /mountaintest-ia/* ─▶ conteneur mountaintest-ia (python:3.12-slim + SDK anthropic)
                                                └─▶ API Claude (recherche web) ─▶ liste de randos
```

- La clé API Anthropic reste sur le VPS (`~/mountaintest/ia.env`, lisible par toi seul), jamais dans l'APK.
- Mot de passe IA : demandé par le relais, saisi une fois dans l'appli (onglet Randos).
- Limite : 40 recherches par jour (`RELAIS_MAX_PAR_JOUR` dans `ia.env`), et une même zone est
  réutilisée pendant 7 jours sans nouvel appel payant (`~/mountaintest/ia-data/cache.json`).
- Garde-fou : seuls les liens réellement renvoyés par la recherche web sont gardés, et les points hors de la zone sont écartés.
- `relais.py` arrive sur le VPS avec le site (branche « site », dossier `ia/`) ; le relais redémarre tout seul quand il change.

## Installation (une fois)

1. Créer une clé API sur https://console.anthropic.com (Settings › API keys), et y fixer une limite de dépense mensuelle (Settings › Limits).
2. Terminal du VPS : taper (ou coller) cette ligne, Entrée :
   `bash <(curl -fsSL https://silvaplana.cloud/mountaintest/ia/installer-ia.sh)`
   Il propose de réutiliser une clé Anthropic déjà présente sur le VPS (fichiers `.env` des autres applis),
   sinon la demande (invisible à la frappe), puis demande un mot de passe pour l'appli, lance le conteneur
   et ajoute la route au gateway.
3. Dans l'appli : onglet Randos › « Mot de passe IA ».

Coûts : chaque recherche payante est notée dans `~/mountaintest/ia-data/couts.jsonl` ; l'appli affiche le coût
de la recherche et les cumuls (mois, total), visibles aussi sur https://silvaplana.cloud/mountaintest-ia/.

Changer la clé ou le mot de passe : `rm ~/mountaintest/ia.env` puis relancer le script.

## Tout retirer

```bash
crontab -l | grep -v mountaintest/maj-ia.sh | crontab -
docker rm -f mountaintest-ia
cat ~/gateway/Caddyfile.avant-ia > ~/gateway/Caddyfile && (cd ~/gateway && docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile)
rm -rf ~/mountaintest/ia.env ~/mountaintest/ia-data
```
