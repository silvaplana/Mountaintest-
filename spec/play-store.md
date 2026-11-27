# Version du Play Store (Seb, 27 novembre 2026)

Deux applis Android sortent du même code (`capacitor/android/app/build.gradle`, saveurs « apk » et « play ») :

| | APK des copains | Play Store |
|---|---|---|
| Identifiant | `fr.assomoutain.rando` | `cloud.silvaplana.mountainbuddies` (définitif une fois publié) |
| Fichier | `mountain-buddies-capacitor.apk` (release latest, page …/apk/) | `mountain-buddies-play.aab`, à déposer dans la Play Console |
| Fonds de carte | Carte auto, SCAN 25, Plan IGN | Plan IGN seul (SCAN 25 : licence IGN payante pour le grand public) |
| Mise à jour | maison (Updater, REQUEST_INSTALL_PACKAGES) | par le Play Store (ni Updater ni cette permission) |

- Les deux s'installent côte à côte. Web : `VITE_PLAY=1` (`PLAY` dans `config.ts`) au moment de `vite build`.
- Retour de connexion Logto : `<identifiant>://callback` ; `configurer-logto.py` déclare les deux (relancer
  l'installeur des comptes). Lien d'invitation (`rejoindre.html`) : ouvre la version Play si elle est là, sinon l'APK.
- Firebase : la version Play demande sa propre appli Android dans le projet mountain-buddies-941fa
  (`src/play/google-services.json`). Sans elle, elle se construit, sans notifications ni sonnerie.
- Signature : la clé des APK sert de clé d'envoi ; Google signe ensuite l'appli lui-même (Play App Signing).
- Exigences déjà faites : supprimer mon compte (appli + `compte.html`), signaler, bloquer, conditions et
  confidentialité (spec/buddies.md §7.24).
- Reste : sélecteur de photos Android, fiche (textes, captures, icône 512, bannière 1024×500), formulaire
  « Sécurité des données », déclaration de la position en premier plan (vidéo), 12 testeurs pendant 14 jours.
