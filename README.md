# Assomountain : prototypes d'appli rando

Deux prototypes qui suivent le même scénario (`scenario-commun/SCENARIO.md`) :

- `capacitor/` : React + Capacitor (aussi publié en site web via GitHub Pages)
- `kotlin-natif/` : Kotlin natif

À chaque push sur `main`, GitHub Actions construit les deux APK et la version web :

- en ligne sur le VPS : https://silvaplana.cloud/mountaintest/ (web) et
  https://silvaplana.cloud/mountaintest/apk/ (APK), voir `deploy/README.md` ;
- aussi dans la release **latest** du dépôt (onglet *Releases*).
