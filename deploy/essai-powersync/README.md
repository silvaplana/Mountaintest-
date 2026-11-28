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

## La batterie de tests à trois téléphones

Trois téléphones simulés (Seb, Julie, Marc) ouvrent la vraie appli dans Chromium. Chacun a son propre réseau, que le
banc coupe, ralentit, rend instable ou met en panne. Après chaque cas, un juge compare l'état de chaque téléphone à
celui du serveur. La même batterie se joue sur les deux synchros, pour les comparer.

```
docker compose up -d
python serveur_essai.py
(cd ../../capacitor && VITE_POWERSYNC=1 VITE_API_URL=http://localhost:8000 npx vite --port 5174 --strictPort)   # la bêta
(cd ../../capacitor && VITE_API_URL=http://localhost:8000 npx vite --port 5176 --strictPort)                    # la synchro de main

MODE=powersync node suite.cjs              # toute la batterie sur la bêta
MODE=actuelle  node suite.cjs              # la même sur la synchro de main
MODE=powersync node suite.cjs "reseau"     # seulement les cas dont la famille ou le nom contient « reseau »
LOURD=1 MODE=powersync node suite.cjs      # avec les cas qui redémarrent PowerSync et Postgres
GRAINE=1234 MODE=powersync node suite.cjs hasard   # rejouer un tirage au hasard
```

- `suite.cjs` : le lanceur. Écrit `resultats-<mode>.json` quand toute la batterie est jouée.
- `suite/banc.cjs` : les téléphones, les pannes (`avion`, `couper`, `lent`, `instable`, `perdreReponse`, `panne`,
  `rouvrir`) et le juge (`converge`).
- `suite/cas-fonctions.cjs`, `cas-reseau.cjs`, `cas-droits.cjs`, `cas-hasard.cjs`, `cas-lourd.cjs` : les cas.

Après une modification du code de l'appli, relancer les deux `vite` avant de rejouer.
