# Scénario de test commun (Capacitor vs Kotlin)

Les deux prototypes doivent utiliser exactement ces paramètres pour que les mesures soient comparables.

## Zone et carte
- Zone : La Ciotat, bbox `[5.55, 43.15, 5.66, 43.21]` (lon min, lat min, lon max, lat max).
- Carte : IGN SCAN 25, flux WMTS privé Géoplateforme, projection Web Mercator (`TILEMATRIXSET=PM`).
  - URL : `https://data.geopf.fr/private/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN25TOUR&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg&apikey=<CLE>`
  - Clé : clé SCAN personnelle créée sur cartes.gouv.fr (ou clé transitoire `ign_scan_ws` si elle répond encore). À vérifier au premier lancement avec GetCapabilities.
  - Repli sans clé : Plan IGN v2 (`LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2`, `FORMAT=image/png`, URL `https://data.geopf.fr/wmts?...` sans `apikey`).
- Niveaux téléchargés pour le hors-ligne : z10 à z16 (z16 = meilleure résolution native du SCAN 25 en PM, à confirmer par GetCapabilities). Au-delà, sur-zoom jusqu'à z18.
- Volume attendu : 467 tuiles (z10:2, z11:4, z12:4, z13:9, z14:24, z15:88, z16:336).

## Trace GPS de référence
- Fichier : `la-ciotat-rando.gpx` (synthétique, port de La Ciotat → Bec de l'Aigle → Figuerolles → port, 4,9 km, 3952 points à 1 Hz, ~4,5 km/h).
- Usage : rejouée par le mode « simulation » de chaque appli pour tester le filtrage, l'enregistrement et le rendu à l'identique. La consommation GPS réelle se mesure, elle, sur le terrain avec le vrai capteur.

## Mesures à relever (identiques des deux côtés)
1. Taille de l'APK release et taille installée.
2. Temps de démarrage à froid jusqu'à la carte affichée (hors ligne, mode avion).
3. Temps de téléchargement des 467 tuiles et place occupée.
4. Fluidité : pan/zoom de z12 à z18 pendant 30 s (Perfetto ou `adb shell dumpsys gfxinfo <package>`).
5. Mémoire : `adb shell dumpsys meminfo <package>` carte affichée.
6. Batterie : 1 h d'enregistrement écran éteint, puis 1 h écran allumé, mêmes réglages GPS (mode « rando » : filtre 10 m, précision haute). Voir la méthode `adb shell dumpsys batterystats` dans chaque prototype.

## Modes GPS communs
| Mode | Filtre distance | Intervalle min | Usage |
|---|---|---|---|
| rando | 10 m | 5 s | marche |
| velo | 20 m | 2 s | VTT/route |
| eco | 50 m | 30 s | longue sortie, batterie faible |

## Bench caméra (ajout du prototype Kotlin, à reprendre tel quel côté Capacitor)
Le pan/zoom « à la main » n'est pas reproductible ; les deux applis jouent ce parcours scripté via un bouton « Bench caméra 30 s ».
- Départ (sans animation) : `43.180, 5.605` z12.
- 5 transitions de 3 s (animation linéaire/ease par défaut), jouées 2 fois = 30 s :
  1. `43.163, 5.597` z15 (Bec de l'Aigle)
  2. `43.170, 5.588` z16 (Figuerolles)
  3. `43.170, 5.588` z18 (sur-zoom)
  4. `43.1745, 5.6075` z17 (port)
  5. `43.180, 5.605` z12
- À relever dans l'appli : nombre d'images rendues par la carte, fps moyen, intervalle entre images p50/p95/p99, « images en retard » = intervalle > 33,3 ms. Kotlin : `OnDidFinishRenderingFrameListener` ; Capacitor/MapLibre GL JS : événement `render`. Sortie logcat au format JSON, tag `ASSO_BENCH`.
- Mesure neutre en plus, la même des deux côtés : trace Perfetto (`adb shell perfetto -o /data/misc/perfetto-traces/bench.pftrace -t 40s gfx view sched freq`) puis « Expected/Actual Timeline » (FrameTimeline, Android 12+). Attention : `dumpsys gfxinfo` ne voit pas les images OpenGL/Vulkan dessinées par MapLibre natif dans sa SurfaceView, donc il ne sert pas à comparer les deux.
- Toujours lancer le bench une fois les tuiles déjà en cache (après le téléchargement hors-ligne), réseau coupé, pour ne mesurer que le rendu.

## Démarrage à froid
`adb shell am force-stop <package>` puis `adb shell am start -W -n <package>/<activité>` (TotalTime = première image de l'appli) + temps jusqu'à la carte complète loggé par l'appli (`{"startup":"map_idle","ms":…}` côté Kotlin, `idle` de MapLibre GL JS côté Capacitor). 5 lancements, médiane.

## Conditions communes des mesures
Même téléphone, luminosité fixe (50 %), batterie entre 90 et 40 %, aucune autre appli ouverte, `adb shell dumpsys batterystats --reset` avant chaque session batterie, téléphone débranché (adb en Wi-Fi ou relevé après coup).

## Règles GPS communes (alignées Kotlin / Capacitor)
- Points de précision > 30 m rejetés (sauf le premier).
- Filtre distance + intervalle min du mode appliqués aussi au rejeu GPX (sur ses horodatages).
- Écran éteint / arrière-plan : regroupement `maxUpdateDelay = max(60 s, 4 × intervalle du mode)`.
- Immobile : aucune position retenue pendant 2 min → `PRIORITY_BALANCED`, intervalle 60 s (regroupé 120 s écran éteint) ; retour en haute précision quand on s'éloigne de plus de max(50 m, précision annoncée) du point d'arrêt.
- Batterie < 20 % → mode eco automatique.
- Dénivelé positif : hystérésis 10 m.
