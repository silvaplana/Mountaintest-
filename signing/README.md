# Clé de signature des prototypes

Android n'installe une mise à jour que si elle est signée avec **la même clé** que l'appli déjà installée.
GitHub Actions (job « Clé de signature ») crée donc une clé une seule fois, au premier build qui trouve le
secret `SIGNING_PASSWORD`, et la range ici dans `prototypes.p12`, chiffrée par ce mot de passe.
Le mot de passe n'est que dans les secrets du dépôt (Settings › Secrets and variables › Actions).

- Sans le secret : APK signés avec une clé jetable (il faut désinstaller avant chaque mise à jour).
- Ne jamais supprimer `prototypes.p12` ni changer le mot de passe : les applis installées ne
  pourraient plus être mises à jour sans être désinstallées.
- Avant de distribuer une vraie appli (Play Store ou membres de l'asso), créer une clé dédiée.
