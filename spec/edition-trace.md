# Modifier une trace et piquer des points

Maquette validée par Seb le 25/11/2026 : `maquettes/edition-trace/` (fichiers du projet).

## Accès
Dans le menu d'une de mes traces, à droite de 🎥 : **✏ crayon** (écran « Modifier ») puis **📍 épingle**.
Ce sont deux choses séparées (demande de Seb).

## 📍 Épingle : pas d'écran à part
- Toucher 📍 l'allume (anneau vert). Chaque appui sur la carte pique un point sur cette trace.
- Le mot du point s'écrit dans une ligne du menu de la trace (🗑 l'enlève, ✓ ferme la ligne).
- Sur un point : un appui montre son mot (et rouvre la ligne), un nouvel appui le cache ;
  appui long (0,45 s) : on le fait glisser ; très long (1,4 s) : une 🗑 rouge apparaît au-dessus, la toucher l'enlève.
- Les points suivent la trace : traces affichées (`tracesAffichees`) et 📂 Mes traces (`pins`).

## ✏ Écran « Modifier »
Même place que le menu, ← pour y revenir, bouton « ↶ Annuler » pour revenir en arrière (pas de Refaire, Seb 25/11). Ligne km avec l'écart à la trace d'avant.
- **Recoller** : on touche le début ▶ puis la fin ■ du morceau sur la trace (bornes à faire glisser),
  ou « Toute la trace » / « Jusqu'au bout ». Les chemins OSM à moins de 40 m sont cherchés (Overpass) :
  chaque point proche est posé sur le chemin, le reste garde le tracé (« par morceaux », pas de chemin partout).
  Sur un morceau de chemin, le calcul d'itinéraire IGN suit le vrai tracé (lacets). Aperçu vert / orange avant ✓ Recoller. Les « houppettes » (aller-retour en pointe à plus de 15 m du dessin) sont enlevées.
  Demande du réseau.
- **Prolonger** : seulement à la fin (Seb) ; toucher la carte allonge la trace, 📏 tout droit ou 🥾 par les chemins (IGN).
- **Souple** : ronds sur la trace, espacés à l'écran (Peu 110 px, Moyen 70 px, Beaucoup 45 px) et replacés après chaque zoom ; pendant le glissé, l'ancien tracé est caché ; on en fait glisser un, la trace change en courbe douce
  entre ses deux voisins seulement.
- Chaque changement est gardé tout de suite ; une trace enregistrée dans 📂 Mes traces est mise à jour (et son fichier GPX).

## Gaucher / droitier (Seb, 25/11)
Dans 👤 Mon compte (avec ou sans connexion) : « Pour tracer, je suis… Gaucher / Droitier », droitier par défaut,
gardé sur le téléphone. Le point tracé ou glissé se pose 1 cm au-dessus du doigt et un peu de côté, à l'opposé
de la main (en haut à gauche pour un droitier, en haut à droite pour un gaucher).
Réglage à part (Seb : la colonne à gauche d'office « fait bizarre ») : « Icônes de la carte : À gauche / À droite »,
à droite par défaut. À gauche : bulles d'aide et variantes à sa droite, l'échelle et les bandeaux du haut à droite.
