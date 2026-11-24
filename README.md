# Assomountain : prototypes d'appli rando

L'appli : `capacitor/` (React + Capacitor, aussi publiée en site web). Le prototype Kotlin natif a été arrêté
le 24/11/2026 (choix de Seb : Capacitor marche bien, et aussi sur iPhone) ; son code reste dans l'historique git.

À chaque push sur `main`, GitHub Actions construit l'APK et la version web :

- en ligne sur le VPS : https://silvaplana.cloud/mountaintest/ (web) et
  https://silvaplana.cloud/mountaintest/apk/ (APK), voir `deploy/README.md` ;
- aussi dans la release **latest** du dépôt (onglet *Releases*).
