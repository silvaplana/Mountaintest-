# Prototype Kotlin natif : SCAN 25 La Ciotat + GPS économe

Pendant du prototype React + Capacitor, pour comparer les performances sur **le même scénario** :
voir [`../scenario-commun/SCENARIO.md`](../scenario-commun/SCENARIO.md) (zone, couches, zooms, trace GPX, modes GPS, mesures).

> **État : non compilé.** L'environnement où il a été écrit n'avait accès ni au SDK Android
> (dl.google.com bloqué) ni aux serveurs IGN (data.geopf.fr bloqué). Les appels MapLibre ont été
> vérifiés contre les sources de MapLibre Native Android 13.7.1, mais la première compilation dans
> Android Studio peut demander de petites corrections.

## Ce que fait l'appli

| Bouton | Effet |
|---|---|
| Couche | SCAN 25 (clé requise) ↔ Plan IGN v2 (ouvert) |
| Télécharger z10-16 | Région hors-ligne MapLibre sur la bbox : 467 tuiles attendues, progression et taille affichées |
| Réseau | Coupe le réseau pour la carte seulement (`MapLibre.setConnected(false)`) : vérifie que tout vient du cache |
| Mode GPS | rando (10 m / 5 s), velo (20 m / 2 s), eco (50 m / 30 s) |
| Démarrer GPS | Service de premier plan, Fused Location, trace rouge + point bleu, GPX écrit à l'arrêt dans `Android/data/fr.assomoutain.proto.kotlin/files/traces/` |
| Rejouer GPX x10 | Rejoue `la-ciotat-rando.gpx` à travers les mêmes filtres que le vrai GPS |
| Bench caméra 30 s | Parcours caméra commun, fps / p50 / p95 / p99 / images en retard |

L'encart en haut à gauche affiche points gardés / reçus, distance, D+ (hystérésis 10 m), état « à l'arrêt ».

### Économies de batterie côté GPS (`TrackingService.kt`)
1. **Fused Location Provider** avec filtre de distance et intervalle minimal du mode : pas de réveil de l'appli pour un point inutile.
2. **Regroupement écran éteint** (`setMaxUpdateDelayMillis(max(60 s, 4 × intervalle))`) : la puce GPS continue, mais le processeur n'est réveillé qu'une fois par minute pour recevoir un paquet de positions.
3. **Détection d'arrêt** : aucune position pendant 2 min (on n'a pas franchi le filtre de distance) → priorité « équilibrée » toutes les 60 s, la puce GPS se coupe (Wi-Fi/antennes). Retour en haute précision dès qu'on s'éloigne de plus de 50 m.
4. **Batterie sous 20 %** : bascule automatique en mode eco.
5. Pas de permission « position en arrière-plan » : le service démarre pendant que l'appli est visible.

## Compiler et installer

1. Android Studio récent (JDK 17+), ouvrir ce dossier, laisser Gradle synchroniser (Gradle 8.14.3, AGP 8.10.1, Kotlin 2.1.21, MapLibre 13.7.1). Si Android Studio propose de monter les versions, accepter.
2. Clé SCAN 25 : dans `~/.gradle/gradle.properties`, ajouter `ignScanKey=<ta clé>` (créée sur cartes.gouv.fr). Sans clé, la valeur par défaut `ign_scan_ws` (clé transitoire publique de 2024) est utilisée et peut ne plus répondre ; la couche Plan IGN marche sans clé.
3. `./gradlew assembleRelease` puis `adb install -r app/build/outputs/apk/release/app-release.apk` (release minifiée, signée avec la clé debug, comme côté Capacitor).
4. Vérifier que la clé répond : `curl "https://data.geopf.fr/private/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&apikey=<clé>" | grep SCAN25TOUR`, et noter le TileMatrix max réel (16 attendu).

## Relever les mesures (package `fr.assomoutain.proto.kotlin`)

Toutes les mesures internes sortent en JSON dans logcat : `adb logcat -s ASSO_BENCH`.

| # | Mesure | Commande |
|---|---|---|
| 1 | Taille APK / installée | `ls -l app-release.apk` ; `adb shell dumpsys package fr.assomoutain.proto.kotlin \| grep -i size` ou Paramètres > Applis |
| 2 | Démarrage à froid | `adb shell am force-stop fr.assomoutain.proto.kotlin && adb shell am start -W -n fr.assomoutain.proto.kotlin/fr.assomoutain.proto.MainActivity` + ligne `{"startup":"map_idle",...}`, mode avion, médiane de 5 |
| 3 | Hors-ligne | bouton Télécharger : ligne `{"offline":...,"tiles":467,"tileBytes":...,"ms":...}` ; place totale : `adb shell run-as fr.assomoutain.proto.kotlin du -sh files` (base `mbgl-offline.db`) |
| 4 | Fluidité | bouton Bench (après téléchargement, réseau coupé) : ligne `{"bench":"camera",...}` ; mesure neutre Perfetto FrameTimeline, voir SCENARIO.md |
| 5 | Mémoire | juste après le bench : `adb shell dumpsys meminfo fr.assomoutain.proto.kotlin` → TOTAL PSS et Graphics |
| 6 | Batterie | `adb shell dumpsys batterystats --reset`, débrancher, 1 h écran éteint en mode rando (marche réelle), puis `adb shell dumpsys batterystats fr.assomoutain.proto.kotlin > bs.txt` : mAh estimés de l'UID, temps « GPS » et nombre de réveils (wakeups). Idéalement `adb bugreport` + Battery Historian. Recommencer 1 h écran allumé, carte visible. |
| 7 | Points GPS | encart : points gardés / reçus, et le GPX produit (comparer au tracé réel) |

## Licence IGN, ce qu'il faut savoir
- Le **SCAN 25 n'est pas une donnée libre** (la libération Etalab de 2021 ne couvre pas les SCAN). Il est diffusé par le flux privé de la Géoplateforme avec une clé personnelle (cartes.gouv.fr).
- Usage professionnel ou **associatif : gratuit** ; diffusion commerciale au grand public : redevance, à calculer avec l'IGN.
- Hors-ligne : l'appli officielle Cartes IGN ne permet **pas** de télécharger le SCAN 25 (droits de partenaires). Mettre en cache 467 tuiles pour un test est raisonnable, mais avant de distribuer une appli qui télécharge du SCAN 25 aux membres de l'asso, il faut faire valider l'usage par l'IGN.
- **Plan IGN v2** (et l'altimétrie, les pentes, l'orthophoto) est en licence ouverte : hors-ligne sans restriction.

## Fonctions futures : faisabilité en Kotlin natif

**1. Drone avec suivi de position — faisable, et c'est là que le natif compte le plus.**
Le DJI Mobile SDK v5 est une bibliothèque Android (Java/Kotlin) : flux vidéo, télémétrie, waypoints s'intègrent directement dans l'appli, position du drone affichée sur la même carte MapLibre. En Capacitor il faudrait écrire un plugin natif Android (et un iOS) qui enveloppe ce SDK, et superposer la vidéo native à la WebView. Pour les drones MAVLink (ArduPilot/PX4), MAVSDK-Java existe aussi. Penser à la réglementation : le Parc national des Calanques et une partie du littoral sont en zones de vol restreintes (carte des restrictions UAS sur cartes.gouv.fr).

**2. Tracer un chemin et obtenir km et dénivelé — faisable dans les deux technos.**
- Polyligne tracée à la main + altitude : le calcul est trivial, il faut un **modèle numérique de terrain** hors-ligne. L'IGN fournit le RGE ALTI / BD ALTI en licence ouverte ; on le découpe en tuiles « raster-dem » pour la zone (quelques dizaines de Mo par massif) et l'appli échantillonne l'altitude tous les 10-20 m.
- Itinéraire automatique entre deux points en suivant les sentiers : **BRouter** (Java, open source, hors-ligne, profils rando/VTT) s'embarque tel quel dans une appli Kotlin ; en Capacitor il faudrait un plugin ou un serveur.

**3. Pentes et ombrages — faisable, rendu GPU natif.**
MapLibre Native sait afficher une couche `hillshade` (ombrage) à partir des mêmes tuiles raster-dem, calculée sur le GPU. Pour les pentes : soit la couche IGN « pentes en montagne » (WMTS, téléchargeable comme le SCAN 25), soit un calcul maison par tuile (algorithme de Horn, quelques ms par tuile en Kotlin) colorié par classes 30°/35°/40°/45°.

## Fichiers
- `app/src/main/java/fr/assomoutain/proto/`
  - `Scenario.kt` : bbox, zooms, URLs WMTS, style MapLibre écrit en fichier (même URI pour affichage et hors-ligne)
  - `MainActivity.kt` : carte, boutons, trace, temps de démarrage
  - `OfflineDownloader.kt` : région hors-ligne z10-16
  - `TrackingService.kt` : GPS économe
  - `TrackRecorder.kt` : filtres, distance, D+, export GPX
  - `GpxReplay.kt` : rejeu de la trace de référence
  - `CameraBench.kt` : parcours caméra et statistiques d'images
- `app/src/main/assets/la-ciotat-rando.gpx` : copie de la trace commune
