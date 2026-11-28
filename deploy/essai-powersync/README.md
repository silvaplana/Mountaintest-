# Essai PowerSync (branche d'essai, rien en production)

PowerSync lit Postgres (réplication logique) et tient à jour une base SQLite sur chaque téléphone. L'appli lit et
écrit dans SQLite ; PowerSync s'occupe du reste (reprise, file d'envoi, cohérence). Le serveur Python garde ses
opérations et ses règles (`buddies.OPERATIONS`).

```
appli (SQLite) ──lit──▶ service PowerSync ◀──réplication── Postgres
      └────────écrit──▶ serveur Python (POST /powersync/ecrire) ──▶ Postgres
```

## Lancer en local

```
docker compose up -d                       # Postgres (port 5433) + service PowerSync (port 8080)
python serveur_essai.py                    # le vrai serveur, avec un faux Logto (port 8000)
(cd ../../capacitor && npx vite)           # la page d'essai : http://localhost:5173/essai-powersync.html?sub=seb
node essai.cjs                             # les scénarios : deux appareils, hors ligne, conflit, refus, coupures, droits
```

## Fichiers

- `sync-config.yaml` : qui reçoit quoi (une requête SQL par table, filtrée par les groupes de la personne).
- `powersync.yaml` : le service ; ses « buckets » sont dans une base à part du même Postgres (pas de MongoDB).
- `../comptes/powersync.py` : jeton, clé publique, publication Postgres.
- `../../capacitor/src/buddies/powersync.ts` : schéma local, actions, connecteur.
