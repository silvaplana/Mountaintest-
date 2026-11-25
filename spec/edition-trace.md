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
  Sur un morceau de chemin, le calcul d'itinéraire IGN suit le vrai tracé (lacets). Aperçu vert / orange avant ✓ Recoller. Les « houppettes » et culs-de-sac (aller-retour jusqu’à 3 km, sur tout le morceau) sont enlevés, sauf si le dessin fait lui-même l’aller-retour.
  Demande du réseau.
- **Prolonger** : seulement à la fin (Seb) ; toucher la carte allonge la trace, 📏 tout droit ou 🥾 par les chemins (IGN).
- **Souple** : ronds sur la trace, espacés à l'écran (choix « Ronds : ○ · ○○ · ○○○ » = 110, 70 ou 45 px) et replacés après chaque zoom ; pendant le glissé, l'ancien tracé est caché ; on en fait glisser un, la trace change en courbe douce
  entre ses deux voisins seulement.
- **⇄ Inverser** (4ᵉ outil, Seb 25/11, maquette « Sens de la trace » B + 2) : retourne la trace d'un coup (le départ passe à l'autre bout) ; « ↶ Annuler » revient.
- Chaque changement est gardé tout de suite ; une trace enregistrée dans 📂 Mes traces est mise à jour (et son fichier GPX).

## Sens de la trace (Seb, 25/11)
Sur la carte, chaque trace à moi montre son départ (rond vert ▶) et son arrivée (rond à damier), et de petites
flèches blanches le long du trait (tous les 70 px) donnent le sens. Prolonger n'a plus son 🏁 à part : c'est le rond d'arrivée.

## Gaucher / droitier (Seb, 25/11)
Dans 👤 Mon compte (avec ou sans connexion) : « Point décalé du doigt : Non / Gaucher / Droitier », NON par défaut (Seb : « perturbant » ; sans décalage ni viseur),
gardé sur le téléphone. Le point tracé ou glissé se pose 1 cm au-dessus du doigt et un peu de côté, à l'opposé
de la main (en haut à gauche pour un droitier, en haut à droite pour un gaucher).
Réglage à part (Seb : la colonne à gauche d'office « fait bizarre ») : « Icônes de la carte : À gauche / À droite »,
à droite par défaut. À gauche : bulles d'aide et variantes à sa droite, l'échelle et les bandeaux du haut à droite.

## Recoller : réseau d'abord (Seb, 25/11)
Recoller demande le réseau (chemins OSM via Overpass, puis calcul d'itinéraire IGN). Un serveur qui ne répond pas en 25 s
laisse la place au suivant ; les morceaux sur chemin sont coupés en bouts de 1,5 km, trois calculs à la fois, 15 s chacun
au plus (sinon le tracé reste posé sur le chemin). Avancement affiché, « ↻ Réessayer » si le réseau ne répond pas.
Sans réseau : à faire (garder la forme des chemins avec les cartes hors ligne), règle de Seb : en ligne d'abord, le local
seulement sans réseau ou si le réseau échoue.

## Rectangle de sélection (Seb, 25/11)
L'appui long sur la carte ne pose plus de « Point choisi » (gros repère rouge supprimé) : il ouvre un rectangle qu'on
étire du doigt. Mes traces (dès qu'un point est dedans) et les épingles dedans sont prises, la trace prise grossit.
Barre en bas : « 2 traces · 3 📍 », poubelle dessinée (même trait que le micro), ✕. La poubelle efface : les traces
quittent la carte (celles enregistrées restent dans 📂 Mes traces), les épingles sont enlevées ; « ↶ Annuler » 6 s.
Pendant un appel, l'appui long montre toujours l'endroit aux autres. Trace choisie : halo jaune sous un liseré blanc.

## Tracé au doigt ✏ (Seb, 25/11)
« recaler sur sentiers » est toujours décoché quand on ouvre ✏ ; le dernier choix n'est pas retenu.
Avec ✏ ouvert, la carte se déplace et se zoome normalement ; un APPUI LONG d'un doigt (0,45 s, une vibration) démarre
le trait, on glisse sans lever ; un appui TRÈS LONG sans bouger (1,4 s, deux vibrations) ouvre le rectangle de sélection.
