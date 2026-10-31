# Assomountain : prototypes d'appli rando

Deux prototypes qui suivent le même scénario (`scenario-commun/SCENARIO.md`) :

- `capacitor/` : React + Capacitor (aussi publié en site web via GitHub Pages)
- `kotlin-natif/` : Kotlin natif

À chaque push sur `main`, GitHub Actions construit les deux APK et les met dans la release
**latest** (onglet *Releases*), et publie la version web sur GitHub Pages.
