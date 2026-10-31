# Assomoutain Rando : prototype React + Capacitor

But : vérifier si React + Capacitor suffit pour une appli de rando/vélo d'association
(carte IGN SCAN 25 hors ligne, GPS économe en batterie, traces GPX), en comparaison
avec un prototype Kotlin natif qui suit **le même scénario**
(`/mnt/project-files/prototypes/scenario-commun/SCENARIO.md`).

## Ce que fait l'appli

- **Carte** : MapLibre GL JS (WebGL dans le WebView), SCAN 25 ou Plan IGN, surcouche « pentes > 30° ».
  Les tuiles passent par un protocole `ign://` : d'abord le disque, sinon le réseau.
  Les tuiles vues en ligne sont gardées (réglable).
- **Hors ligne** : onglet *Hors ligne* → « Télécharger la zone » (La Ciotat, z10 à z16, 467 tuiles).
  Sur téléphone, le téléchargement est natif (`@capacitor/file-transfer`), un fichier par tuile.
  « Tester la clé » lit le GetCapabilities et affiche le zoom max réellement servi.
- **GPS** : plugin natif maison `EcoLocation` (Java, `android/app/src/main/java/fr/assomoutain/rando/`),
  service de premier plan avec FusedLocationProvider. Les plugins Capacitor existants
  imposent un GPS haute précision toutes les secondes (vérifié dans le code de
  `@capacitor-community/background-geolocation` : `setInterval(1000)`, `PRIORITY_HIGH_ACCURACY`),
  ce qui est l'inverse de ce qu'on cherche.
- **Règles d'économie** (`src/gps/adaptive.ts`, identiques au prototype Kotlin) :
  - 3 modes : rando (10 m, 5 s), vélo (20 m, 2 s), éco (50 m, 30 s, précision équilibrée) ;
  - aucune position retenue depuis 2 min (on ne bouge plus) → précision équilibrée, une position par minute, jusqu'à ce qu'on
    s'éloigne de plus de max(50 m, précision) du point d'arrêt ;
  - écran éteint / arrière-plan → positions regroupées par lots (max(60 s, 4 × intervalle), 120 s à l'arrêt) :
    le processeur et le JS ne sont réveillés qu'une fois par lot ;
  - batterie < 20 % → mode éco ;
  - carte non redessinée en arrière-plan, rendu limité à 2× la densité d'écran.
- **Traces** : filtre (précision > 30 m, sauts > 30 m/s, distance/intervalle du mode), distance,
  D+/D- avec hystérésis de 10 m, sauvegarde toutes les 30 s, reprise si l'appli est tuée
  (le service natif tient un fichier de secours), export et import GPX.
- **Simulation** : rejoue `public/la-ciotat-rando.gpx` (×10 ou ×60) dans la même chaîne que le vrai GPS.
- **Mesures** : onglet *Mesures* + logs JSON sous le tag logcat `ASSO_BENCH`
  (démarrage, téléchargement, réglages GPS appliqués, bench caméra 30 s).

## Lancer

```bash
npm install
npm run dev            # dans un navigateur (GPS du navigateur, pas d'arrière-plan)
npm test               # tests unitaires (tuiles, règles GPS, filtre, GPX, dénivelé)
npm run android        # build + sync + ouvre Android Studio, puis ▶ sur le téléphone
```

Prérequis Android : Android Studio récent (SDK 36), JDK 21, téléphone Android 8+ en mode développeur.

## Clé IGN pour le SCAN 25

- **Plan IGN v2** : données ouvertes (Etalab 2.0), flux `data.geopf.fr/wmts` **sans clé**.
- **SCAN 25** : pas en données ouvertes. Flux privé `data.geopf.fr/private/wmts` avec clé.
  Gratuit pour un **usage professionnel ou associatif** ; une diffusion au grand public
  (appli sur le Play Store pour tout le monde) demande une **redevance** selon les CGU IGN.
  L'IGN a publié en 2024 une clé transitoire `ign_scan_ws` (valeur par défaut de l'appli) ;
  la voie normale est de créer sa propre clé « données SCAN » sur cartes.gouv.fr.
  Je n'ai pas pu joindre data.geopf.fr ni cartes.gouv.fr depuis mon environnement :
  **le bouton « Tester la clé » est la première chose à faire sur le téléphone.**
- Le stockage hors ligne de tuiles SCAN 25 dans une appli associative : à confirmer
  auprès de l'IGN si l'appli est distribuée au-delà des membres.

## Mesurer (même protocole que le prototype Kotlin)

Conditions : même téléphone, luminosité 50 %, batterie entre 90 et 40 %, aucune autre appli,
build **release** (`./gradlew assembleRelease` ou Android Studio → Build → Generate APK).

| Mesure | Comment |
|---|---|
| Taille | taille de l'APK release ; Paramètres → Applis → stockage après téléchargement de la zone |
| Démarrage à froid | `adb shell am force-stop fr.assomoutain.rando` puis `adb shell am start -W -n fr.assomoutain.rando/.MainActivity` (TotalTime) + ligne `{"bench":"startup","startup":"map_idle",...}` ; 5 fois, médiane |
| Téléchargement | lignes `download-start` / `download-end` (durée, octets) |
| Fluidité | bouton « Bench caméra 30 s » (tuiles en cache, mode avion) → ligne `camera` ; en parallèle `adb shell perfetto -o /data/misc/perfetto-traces/bench.pftrace -t 40s gfx view sched freq` puis ui.perfetto.dev → FrameTimeline |
| Mémoire | `adb shell dumpsys meminfo fr.assomoutain.rando` carte affichée |
| Batterie | voir ci-dessous |

Logs : `adb logcat -s ASSO_BENCH EcoLocation`

### Batterie

1. Téléphone chargé, débranché ; adb en Wi-Fi (`adb tcpip 5555` puis `adb connect <ip>`) ou relevé à la fin.
2. `adb shell dumpsys batterystats --reset`
3. Démarrer une sortie en mode rando (GPS réel), écran éteint, 1 h de marche (ou téléphone posé dehors
   pour un test « immobile »). Recommencer 1 h écran allumé carte affichée.
4. `adb shell dumpsys batterystats fr.assomoutain.rando > stats.txt` : regarder « Estimated power use »
   (mAh) de l'appli, le temps GPS et les réveils (wakeups).
5. Pour le détail : `adb bugreport bugreport.zip`, à ouvrir dans Battery Historian.
6. Repère simple sans outil : % de batterie perdu par heure, noté au début et à la fin.

À comparer : mêmes chiffres pour l'appli Kotlin, et si possible une appli du commerce (Iphigénie, Visorando)
avec un réglage proche.

## Ce qui est vérifié, ce qui ne l'est pas

Vérifié ici (navigateur Chromium, serveur IGN simulé car data.geopf.fr est bloqué dans mon environnement) :
- 10 tests unitaires OK ; build web OK ;
- téléchargement des 467 tuiles, rechargement hors ligne avec la carte servie depuis le stockage ;
- rejeu de la trace : filtre, distance, D+, affichage ;
- bench caméra : ~53 img/s en rendu logiciel (sans GPU), donc sans valeur pour le téléphone.

**Pas vérifié : le code natif Android n'a pas été compilé** (pas de SDK Android ici).
Il faut l'ouvrir dans Android Studio ; les erreurs éventuelles seront de détail (imports, versions).

À tester sur un vrai téléphone :
1. la clé SCAN 25 et le zoom max servi (16 attendu) ;
2. le téléchargement natif des tuiles et leur lecture hors ligne en mode avion ;
3. le service GPS écran éteint pendant 1 h, sur un Android qui tue les applis agressivement
   (Xiaomi, Huawei, Samsung : désactiver l'optimisation de batterie pour l'appli) ;
4. que les lots de positions arrivent bien en arrière-plan (logs `EcoLocation`) ;
5. la reprise après avoir tué l'appli pendant une sortie ;
6. la fluidité de la carte en sur-zoom z17-z18 et la mémoire après 30 min ;
7. iOS : rien n'est fait côté iOS (il faudrait un plugin Swift équivalent avec CLLocationManager,
   `allowsBackgroundLocationUpdates`, `activityType = .fitness`, `distanceFilter`).

## Limites connues du prototype

- Une tuile = un fichier. Pour un département entier, passer à un fichier MBTiles (SQLite)
  ou PMTiles : moins de fichiers, copie et suppression instantanées.
- Les règles d'économie tournent en JS : le WebView est réveillé à chaque lot et toutes les 30 s pendant une sortie.
  Si la batterie écran éteint est moins bonne qu'en Kotlin, la piste est de déplacer ces règles dans le service natif.
- L'altitude vient du GPS (bruitée). Pour un D+ fiable, recalculer avec un modèle de terrain (voir plus bas).

## Faisabilité des fonctions futures

| Fonction | En Capacitor | Remarque |
|---|---|---|
| **Tracer un itinéraire** (points sur la carte → km et D+) | Facile en JS | Distance : déjà là. D+ : altitude par point via l'API altimétrique IGN (en ligne) ou un MNT local (RGE ALTI / BD ALTI en tuiles d'altitude) pour le hors-ligne. Suivre les sentiers demande un moteur de routage (BRouter, GraphHopper) : faisable hors ligne mais c'est un gros morceau, natif de préférence. |
| **Pentes et ombrage** | Faisable en JS | MapLibre sait faire l'ombrage (`hillshade`) et le relief 3D à partir de tuiles d'altitude ; les pentes se calculent sur la même grille (shader ou worker). L'IGN fournit aussi des couches prêtes (pentes > 30°, estompage) à télécharger comme le SCAN 25. |
| **Drone avec suivi de position** | Plugin natif obligatoire | Le SDK DJI (MSDK v5) est Android/iOS natif uniquement : il faudrait un plugin Capacitor qui l'enveloppe, et le flux vidéo s'affiche mieux dans une vue native que dans le WebView. Pour un drone MAVLink (ArduPilot/PX4), le protocole peut se parler en JS mais la liaison (USB, UDP) passe aussi par du natif. C'est l'argument le plus fort pour du natif sur cette partie. |

## Arborescence

```
src/config.ts            zone, couches IGN, URL WMTS
src/tiles/               calcul des tuiles, stockage hors ligne, protocole ign://, GetCapabilities
src/gps/                 plugin natif (pont JS), règles d'économie, filtre, sources (GPS, navigateur, rejeu)
src/track/               GPX, statistiques, enregistreur
src/cameraBench.ts       parcours caméra du scénario commun
android/app/src/main/java/fr/assomoutain/rando/
  LocationService.java   service GPS de premier plan
  EcoLocationPlugin.java pont Capacitor
  BenchLogPlugin.java    logs ASSO_BENCH
tests/core.test.ts       tests unitaires
```
