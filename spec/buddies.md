# Buddies — spec

Version 1 du 23 novembre 2026, issue de la séance de maquettes avec Seb.
À valider par Seb avant tout code. Les écrans sont dans [`buddies/`](buddies/) (source :
[`buddies/buddies.html`](buddies/buddies.html)), la planche complète est
[`buddies/0-toutes-les-maquettes.png`](buddies/0-toutes-les-maquettes.png).

Légende : **(Seb)** = décidé ou validé par Seb. **(proposé)** = proposition faite pendant la
séance, pas encore confirmée. Les points ouverts sont regroupés au §9.

## 1. L'esprit

- L'appli est faite pour Seb et sa bande : la passion de la montagne et le partage entre
  copains. Elle n'a pas à être vendue. Le seul juge : est-ce que ça donne envie de partir. **(Seb)**
- Aller vite, instinctif, beaucoup d'image. Tout en icônes, pas d'onglets en haut ni en bas. **(Seb)**
- La carte garde la plus grande partie de l'écran ; on doit pouvoir n'avoir que le fond de
  carte derrière. **(Seb)**
- Un côté humain : voir §3.2. **(Seb)**

## 2. Vocabulaire

| Mot à l'écran | Ce que c'est |
|---|---|
| **Buddies** | L'espace entier, ouvert par 👥 dans la barre étendue de la carte. |
| **Groupe** | Une bande de copains (comme une conversation de groupe). |
| **Sortie** | Une sortie ou un week-end passé ensemble. |
| ~~Me Time~~ | **Retiré** (Seb, 25 novembre 2026). Remplacé le 26 novembre par **Seul** : un Groupe perso sans nom, né à la première sortie seul (§7.17). |
| **Club** | Une organisation (asso) facultative au-dessus de ses Groupes-sections, comme une école d'AppBase. Pas encore d'écran (§7.17). |
| **admin principal**, **admin** | Les rôles dans un Groupe ou un club (§7.17). |
| **Buddy count** | Le partage des frais (l'actuel « partage des frais » du menu Voyage). |
| **Carnet** | Le compte rendu final d'une sortie. |
| **buddy** | Une personne d'un de mes groupes ou sorties. |

Noms changés le 26 novembre 2026 (Seb : « On va remplacer buddy group et buddy time par groupe et sortie ») :
« Buddy Group » devient **Groupe** et « Buddy Time » devient **Sortie** partout à l'écran ; **Buddy count** reste.
Les tables, l'API et le code gardent leurs noms (`groupe`, `sortie`, actions `buddy_time` de Bud…). Bud comprend
encore les anciens noms (§7.12).

## 3. Règles valables partout

### 3.1 Hors ligne (le point le plus important) **(Seb : « très important »)**

- Le serveur porte la version commune ; il sert à passer les nouveautés d'un téléphone à l'autre.
- Chaque téléphone garde une copie locale complète de ses Buddies. L'appli n'affiche que
  cette copie : sans réseau tout s'ouvre, avec la dernière version reçue et la mention
  « à jour ce matin 8 h 12 ».
- Tout ce qu'on fait sans réseau (message, dispo, dépense, photo, récit, position) est
  enregistré tout de suite sur le téléphone, marqué 🕓, et part seul au retour du réseau.
- Conflits : les ajouts s'additionnent (messages, photos, dépenses, dispos). Pour un texte
  modifié des deux côtés, le dernier envoyé gagne et l'autre version reste récupérable.
- Une sortie à venir se télécharge en entier : trace, fonds de carte du couloir,
  hébergement, point de rendez-vous. Les photos des anciens albums sont gardées en vignette,
  la pleine taille se charge à la demande.
- Impossible sans réseau : appels, réception des positions des autres, recherche
  d'hébergement, choix automatique des photos du carnet. La dictée marche hors ligne quand
  le téléphone le permet ; sinon le vocal est gardé et transcrit au retour du réseau.

### 3.2 Côté humain **(Seb)**

- À l'écran : les visages, les voix et les mots des copains. Jamais un assistant qui parle
  en son nom. Pas de mot « IA ».
- L'automatique reste discret : il range, télécharge, remplit les chiffres depuis la trace.
- Il propose, un humain décide (seul cas visible : le choix des photos du carnet).
- Le récit du carnet est transcrit mot pour mot, jamais rédigé à la place de la personne.
- On s'arrange de vive voix : l'appli montre l'information, les gens décident.

### 3.3 La colonne d'icônes

- Verticale, à droite, toujours visible **(Seb)** : 📞 appel, ma position (interrupteur sous le téléphone, Seb 26/11 ;
  partager sa position même hors sortie, §7.14), 💬 messagerie, 📅 planning (ordre de Seb, 26/11), 📸 album,
  💶 Buddy count, 🏨 hébergement, 🚗 voyage, 👤 moi. Toutes au trait, sans émoji (Seb, 26/11) : Buddy count = B et C
  entrelacés, deux petites barres communes (B1) ; ma position = un point et des ondes de chaque côté (P1) ; moi = une
  silhouette dans un rond ; 🚗 garée = une épingle posée sur la voiture (§7.19).
- **Rétractable** (Seb, 26 novembre 2026) : le ✕ (fermer Buddies) reste toujours en haut de la colonne, dessous
  une flèche ⌄ ; la toucher fait descendre les icônes avec une animation, la flèche se retourne ⌃ et les
  remonte. Sortie à l'ouverture de Buddies ; si on la range, l'appli s'en souvient pour la prochaine fois (Seb, 26 novembre, avant : rangée). Plus de titre « Buddies » ni de second ✕ en haut des écrans ;
  en bas de la liste, simplement « ＋ Groupe » et « ＋ Sortie » (sans sous-titre).
  **Retouches (Seb, 26 novembre)** : icônes de la taille de celles de la carte (44 px) ; flèche horizontale ‹ / ›,
  les icônes sortent du bord de l'écran, à droite, ou à gauche si « Icônes de la carte : à gauche » (la colonne
  passe alors à gauche). **✕ = retour** (Seb, 26 novembre) : sur tous les écrans de Buddies, ✕ et la flèche restent en haut à droite, même place, même taille ; ✕ ramène à l'écran d'avant (la liste, elle, revient à la carte), comme le retour du téléphone, et il n'y a plus de ‹ à gauche. Sur une sortie ouverte sur la carte, le ✕ de la carte ramène au groupe ; il ne ferme l'appli que sur la carte seule. Rangée, ✕ et la flèche sont l’un au-dessus de l’autre tout en haut (✕ en pastille basse, flèche de 56 px, comme sur la carte) et l'écran prend toute la largeur ; sortie,
  la colonne glisse (sans panneau : seulement les ronds des icônes, ombrés) et l'écran **se resserre** à côté d'elle, le texte se ré-enroule et tout reste visible (Seb, 26 novembre, 3e essai après « pousser » puis « recouvrir »), en une seule animation ; le contenu de l'écran monte tout en haut, à côté de ✕ et de la flèche ; petite icône de « ＋ Groupe » / « ＋ Sortie » à la hauteur du mot ; plus de ligne
  « à jour à … » (seulement « 🕓 n changements partiront au retour du réseau » quand il y en a).
- Elle ne change pas ; sa portée suit ce qui est ouvert à gauche **(proposé)** : dans la
  liste elle regarde tous mes buddies, dans un groupe ce groupe, dans une sortie
  cette sortie.
- Dans une sortie, deux icônes s'ajoutent sous un trait **(proposé)** : 📍 position des
  buddies, 📖 carnet.
- Une icône ouvre un panneau par-dessus la carte ; le panneau se tire vers le haut ou se
  baisse. L'icône active est verte.

**Anciennes ou nouvelles icônes (Seb, 26 novembre)** : case « Nouvelles icônes dans Buddies » dans 👤 Mon compte
(Paramètres), gardée sur le téléphone. Décochée (par défaut) : les anciennes, émojis en couleur 📞 💬 📅 📸 🚗 👤
(voiture garée : 🚗 avec une petite 📍) ; cochée : des pastilles de couleur, dessin blanc (Seb, 26 novembre, version D : appel vert, position bleue, messages bleu, planning rouge, photos orange, Buddy count ocre, hébergement brun, voiture rouge, moi violet). Buddy count (B1), hébergement (lit dans la maison)
et Ma position (point et ondes) sont les mêmes dans les deux cas. Ma position allumée garde le fond clair, comme éteinte ;
seules les ondes passent en noir gras (avant : rond ardoise, jugé trop sombre).
**Pièce (Seb, 26 novembre, plus tard)** : le B1 est frappé sur une pièce dorée, pour qu'on comprenne que c'est de
l'argent ; c'est le symbole du Buddy count partout (colonne, listes), quel que soit le choix d'icônes.
**Hébergement (Seb, 26 novembre)** : une maison en couleur, fermée avec un sol (toit rouge, murs crème, lit à
couverture bleue), quel que soit le choix d'icônes.
**Initiales** : prénom + nom s'ils sont remplis, sinon une lettre par mot du pseudo, chiffres et séparateurs ignorés
(« sebastien.richard54 » → SR).

### 3.4 Le panneau de partage, le même partout **(Seb pour trace et hébergement)**

Depuis une trace (Mes traces), un hébergement, un itinéraire voiture, un point ou une photo,
le partage ouvre toujours les mêmes rangées, dans cet ordre (écrans 22, 23) :

1. « Dans une sortie » : les sorties où il y a de l'activité, en image avec leur date.
   L'objet s'y range et apparaît sur leur carte.
2. « Ou à mes buddies » : les copains et groupes avec qui j'échange le plus (cinq au
   plus), puis « Tous ». Pas besoin d'avoir un groupe.
3. « Ou ailleurs » : WhatsApp, mail, fichier, autres applis.

On peut cocher plusieurs destinataires. Un seul bouton « Partager ».

### 3.5 Vie privée

- On n'invite que des gens qu'on connaît (contacts, mail, téléphone, QR code). Pas
  d'annuaire ni de recherche parmi les utilisateurs de Mountain Buddies. **(Seb)**
- Personne n'est localisé sans l'avoir voulu (§5.9). **(Seb)**

## 4. Les écrans

| N° | Fichier | Rôle |
|---|---|---|
| 1 | `1-carte-buddies-moi.png` | 2e barre : 👥 Buddies et 👤 Moi (profil, compte, réglages). |
| 2 | `2-buddies.png` | Liste : prochaine sortie en grand, groupes, dernières sorties, deux « ＋ ». |
| 3 | `3-buddy-group.png` | Un groupe : ses sorties à venir puis ses souvenirs. |
| 4 | `4-buddy-time-carte.png` | Une sortie : la carte d'abord, bandeau rabattable. |
| 6 | `6-messagerie.png` | Messagerie de la sortie, carte au-dessus. |
| 7 | `7-album-sur-la-carte.png` | Album, vue « Sur la carte ». |
| 8 | `8-buddy-count.png` | Buddy count. |
| 9 | `9-hebergement.png` | Hébergements proposés au groupe. |
| 10 | `10-appel.png` | Appel entrant. |
| 11 | `11-album-depot.png` | Album : chacun dépose ses photos. |
| 12 | `12-carnet-souvenir.png` | Carnet : photos, récit, trace. |
| 13 | `13-carnet-chiffres-jours.png` | Carnet : chiffres, fiches par jour, « Le pratique » replié. |
| 14 | `14-carnet-dicter.png` | Écrire le carnet à la voix. |
| 15 | `15-position-buddies.png` | Position des buddies (épingle). |
| 16 | `16-planning-saison.png` | Planning de saison d'un groupe. |
| 17 | `17-planning-mes-dispos.png` | Remplir mes dispos. |
| 18 | `18-planning-nouveau.png` | Nouveau planning. |
| 19 | `19-planning-valider.png` | Une ligne du planning devient une sortie. |
| 20 | `20-nouveau-buddy-group.png` | Nouveau groupe, invitations. |
| 21 | `21-nouveau-buddy-time.png` | Nouvelle sortie. |
| 22 | `22-trace-partager.png` | Partager une trace. |
| 23 | `23-hebergement-partager.png` | Partager un hébergement. |
| 24 | `24-parler-ecrire-carte.png` | Parler ou écrire en regardant la carte. |
| 25 | `25-bud.png` | Bud, le buddy qui connaît l'appli. |

Il n'y a pas d'écran 5 : le vote de dates a été retiré (§5.4).

## 5. Les blocs

### 5.1 Accès (écran 1)

Dans la barre étendue de la carte, 👥 ouvre Buddies (pastille = du nouveau) ; 👤, dernière icône de sa colonne, ouvre Moi
(profil, compte, réglages, état hors ligne). 👤 reprend l'écran « Mon compte » existant. **(Seb)**

Depuis le 24/11 (Seb), la carte n'a plus qu'une colonne d'icônes : réduite = ✕, flèche, ◎, 🔍, 📷 ;
étendue = ✕, flèche, ◎, 🔍, 📷, ✈, ✏, Calques, activité, 🌦 (🏔 à sa gauche, comme 👖 pour ✈), 👥 (tout en bas, le bouton important, Seb 26/11).
🔍 (chercher un lieu) est de nouveau un bouton visible juste sous ◎, même en barre réduite (Seb, 25/11 ; avant : appui long sur ◎).
La loupe 🔍 (Seb, 25/11) cherche d'abord dans les noms de lieux gardés sur le téléphone (sommets, cols, crêtes,
lieux-dits, sources, refuges, calanques… de la BD TOPO IGN complétée par OpenStreetMap), téléchargés avec les cartes
d'un rectangle ou d'une trace mise hors ligne (📶) et effacés avec elles : elle marche sans réseau. Puis, avec du
réseau, la recherche de la Géoplateforme IGN, les lieux proches du centre de la carte en premier.
Depuis le 25/11 après-midi (Seb, « Le Dôme des Écrins » ne sortait pas) : en ligne, trois demandes à la fois, IGN lieux
seulement (avec les mots qui comptent, sans « le », « des »…), OpenStreetMap (Photon, lieux naturels seulement) puis IGN
tout (communes, adresses) : sommets et lieux naturels avant les adresses, jusqu'à 30 résultats dans une liste qui défile.
🎤 à côté du champ : on dit le nom (dictée dans l'appli, comme la messagerie).
Refuges dans la loupe (Seb, 26/11) : un texte qui commence par « refuge », « cabane » ou « gîte » (avec ou sans lieu :
« refuges vers Chamonix », « gîte à Ceillac ») ajoute en tête une ligne « Refuges et cabanes autour de … » ; la toucher pose
sur la carte les points refuges.info à environ 10 km du lieu (sinon du centre de la carte), avec la même fiche que les
hébergements trouvés (Voir le site, Proposer à mes buddies). Relais `/refuges` : API publique refuges.info, gratuite, sans Claude.
Loupe rangée par catégories (Seb, 26/11 : « c'est fourre-tout ») : les résultats sont groupés, dans cet ordre, en
Courses skitour (topos et sorties de l'année, skitour d'abord), Sommets et nature, Refuges et gîtes, Villes et lieux,
3 lignes par catégorie et « Voir plus ». Une rangée de pastilles à icônes au trait (Tout, courses, sommets, refuges,
lieux, avec le nombre trouvé) montre une seule catégorie ; la pastille Refuges propose aussi « Refuges et cabanes
autour de <texte> » (refuges.info). Toucher un topo ou une sortie ouvre sa fiche skitour. Relais `/skitour-chercher` :
topos gardés sur le disque (sans appel à l'API) et sorties des 365 derniers jours dont le nom contient les mots tapés.
Bud cherche aussi dans skitour d'abord (outil `chercher_skitour` du relais) pour un sommet, une course ou des conditions.
Auberges et gîtes privés dans la loupe (Seb, 26/11 : « Auberge La Jabiore » introuvable) : OpenStreetMap (Photon) garde
aussi hôtels, gîtes et chambres d'hôtes, auberges de jeunesse, chalets, campings, et les restaurants dont le nom dit
auberge, refuge, gîte, chalet ou hôtel ; ils vont dans « Refuges, gîtes, auberges ». Photon tolère les petites fautes de frappe.
« X près de Lieu » dans la loupe (Seb, 26/11) : un texte qui commence par refuge, cabane, gîte, auberge, hôtel,
hébergement, logement ou « où dormir », suivi ou non d'un lieu (« auberges près de Prapic »), ajoute la ligne
« Auberges autour de Prapic » ; la toucher pose sur la carte, à environ 10 km du lieu, les hébergements de cette nature :
refuges.info (refuges, cabanes, gîtes d'étape) et OpenStreetMap (Overpass : hôtels, gîtes, chambres d'hôtes, auberges,
campings), un même lieu vu deux fois gardé une fois. La pastille Refuges propose « Hébergements autour de <texte> ».
Web et Bud dans la loupe (Seb, 26/11) : en bas des résultats, « Chercher sur le web » (globe au trait) passe la
recherche à Bud (recherche web, payante, seulement si on touche) ; un texte qui commence par « Bud », « OK Bud » (ou
« bad », « budd »… comme dans les conversations) est une question à Bud : plus de catégories, une ligne « Demander à
Bud » (Entrée, ou tout de suite si c'est dicté), puis sa réponse, les endroits proposés (toucher = y aller) et « Tout
voir sur la carte » pour ses hébergements. Bud reçoit le centre de la carte. Pas Google : payant et sans coordonnées.
Calques (trois strates, Seb 26/11 ; avant ⛰) déplie la ligne des calques : pente, 3D, 🌗, 🌲, drone, 🗺. Chaque calque
s'allume à part et on peut les mélanger ; seul 🗺 change de fond. Icônes au trait, « 3D » et « pente » écrits dedans
(maquettes maquettes/icones-calques/ du dossier du projet).
Calque « Hors ligne » (quadrillage + trace, Seb 26/11, avant 🗺) : ce qui n'est pas gardé sur le téléphone est voilé de
blanc, les zones gardées restent nettes, bordées de vert (un carré du zoom 14 gardé = tout son territoire, 0 ou 1), et
toutes les traces de Mes traces sont dessinées dans le même vert. Rien n'y est touchable. En bas, une petite fenêtre
« place sur le téléphone » : le panneau remontable habituel (poignée), réduit à sa barre de titre ; remonté : cartes,
photos et vidéos, données, nombre de tuiles gardées et poids moyen d'une tuile, place libre. La croix à droite le ferme
jusqu'au prochain allumage. Une tuile (on ne dit pas « carré ») = un carré du zoom 14 ; verte = SCAN 25 gardé, bleue =
Plan IGN seulement. Calque allumé, l'appui long ouvre le rectangle de sélection, qui prend aussi les tuiles (cadre aligné
sur les tuiles entières, toujours un rectangle) et les traces de Mes traces. Ses lignes vont dans un petit encart en haut de l'écran, pour ne pas gêner le panneau du bas (Seb 26/11) : « N traces » + poubelle, « N tuiles téléchargées » (leur poids) +
poubelle, « M tuiles à ajouter » (poids estimé) + « Télécharger » (tout : Plan IGN de loin, SCAN 25 de près, relief). Le panneau du bas rappelle toujours le geste (appui long puis étirer le rectangle). Supprimer = « Annuler » pendant 6 s, puis effacé du téléphone (maquettes maquettes/calque-hors-ligne/).
Le même panneau montre aussi ma place sur le serveur des comptes (mes photos et films, mes fichiers joints, mes traces et
messages), pas celle des autres. Le Super User voit en plus, pour chacun, sa place sur le serveur et sur son téléphone
(chaque appli l'envoie une fois par jour : PUT /stockage/telephone ; GET /stockage).
🚗 🏨 💶 ne sont plus sur la carte : ils sont dans la colonne d'icônes de Buddies (🚗 ajouté sous 🏨, puis 👤 Moi en dernier).
Appui long sur un bouton à variantes (activité ⛷ 🚵 🚴 🚲 🥾, fond de carte) : elles s'ouvrent à
sa gauche, on en choisit une.

### 5.2 La liste Buddies (écran 2)

- Façon WhatsApp : les groupes au-dessus, puis les sorties ; dans chaque partie le
  plus récemment actif en haut. **(Seb)**
- Rond = Groupe, carré avec le jour = Sortie **(proposé)**.
- Tout en haut, en grande image : la sortie en cours ou le prochain **(proposé)**.
- Me Time figure parmi les groupes, avec ma photo.
- En bas, deux boutons en image **(Seb : deux « ＋ », en image si possible)** :
  « ＋ Groupe » (visages qui se chevauchent) et « ＋ Sortie » (photo datée).

### 5.3 groupe (écrans 3, 20)

- Création : une photo, un nom, des invitations par contacts, mail, téléphone (SMS) ou QR
  code. L'invité reçoit un lien qui installe l'appli et le fait entrer. Réutilise les
  comptes et invitations existants (`deploy/comptes/`, `capacitor/src/compte/`). **(Seb)**
- Ouvert, il montre ses sorties : à venir d'abord (sinon « Rien de prévu pour l'instant »), puis « Sorties passées », chacune sur toute la largeur (Seb, 26 novembre). Plus de « Traces partagées » sur cet écran : les traces se partagent dans le chat.
- Toucher les visages en haut ouvre les membres : inviter, nommer admin, retirer. Pas
  d'icône d'administration. **(proposé)**
- « ＋ Sortie » dans un groupe ne demande pas quel groupe. **(Seb)**

### 5.4 sortie (écrans 4, 21)

- **Il naît quand on est sûr de partir**, jamais automatiquement. **(Seb)** Deux chemins :
  depuis une ligne du planning (§5.5), ou par « ＋ Sortie ». La préparation peut donc se
  faire hors de la sortie (dans le planning du groupe) ou dedans. **(Seb)**
- Créé dans un groupe, il appartient à ce groupe ; on décoche ceux qui ne viennent pas.
  Créé depuis la liste (« ＋ Sortie »), on choisit d'abord son groupe ; sans groupe, on en crée un
  (même rien que pour soi). **(Seb, 25 novembre 2026 : plus de Me Time)**
- Dans Me Time, on peut inviter un ou plusieurs copains à une sortie sans créer de
  groupe. **(Seb)**
- Création : photo, nom, dates, lieu facultatif.
- **Changer son nom** (Seb, 25 novembre 2026) : le crayon (dessiné au trait) en haut de sa carte, ou toucher le nom ;
  l'écrire, ✓ (✕ pour renoncer). Tout buddy qui voit la sortie peut le faire, comme le nom d'un groupe WhatsApp (opération
  `renommer_sortie`). Aussi par Bud (§7.12).
- **Le supprimer** (Seb, 25 novembre 2026) : la poubelle (dessinée au trait, pas l'émoji) en haut de sa carte, montrée
  seulement à celui qui l'a créé et aux admins du groupe. Supprimé tout de suite, « Annuler » 10 secondes, puis
  retour aux Buddies. Rien n'est effacé sur le serveur (même opération que Bud, §7.12).
- **Renommer un groupe** (Seb, 25 novembre 2026) : crayon au trait en haut de l'écran du groupe (ou toucher
  son nom), feuille « Nom du groupe ». Tout membre peut le faire (opération `renommer_groupe`).
- **Plus de Me Time** (Seb, 25 novembre 2026) : le serveur n'en crée plus. À la synchro, l'ancien Me Time de chacun
  est **effacé avec tout ce qu'il contient**, pour tout le monde (choix de Seb : « Tout effacer ») : ses sorties
  et leurs traces, photos (fichiers compris), dépenses, messages, hébergements, carnets. Un téléphone pas encore à
  jour qui range une sortie dans « me-time » est refusé (« Choisis un groupe »). Le paragraphe suivant (inviter
  à une seule sortie sans groupe) ne vaut plus. **Remplacé le 26 novembre par « Seul » (§7.17).**
- Crayon et poubelle aussi **à côté de chaque sortie** des listes (Seb, 25 novembre 2026) : la liste des Buddies
  (l'heure de la ligne laisse sa place) et les affiches d'un groupe (en haut à droite de l'image). Le crayon
  ouvre une feuille « Nom de la sortie » (Enregistrer, Annuler) ; la poubelle : « « … » supprimé · Annuler » 10 s.
  **Remplacés le 26 novembre (Seb) par l'appui long, comme WhatsApp** : appuyer longtemps sur un groupe ou une sortie
  (liste des Buddies, affiches d'un groupe) la choisit (fond teinté) et une barre ardoise prend le haut de l'écran :
  ✕ (laisser), son nom, crayon (« Nom du groupe » / « Nom de la sortie »), Partager, et la poubelle pour une sortie
  (son créateur ou un admin ; « Annuler » 10 s). Un **groupe** a aussi sa poubelle, pour ses admins seulement (Seb, 26 novembre) : « Supprimer « X » ? Le groupe et ses sorties disparaissent pour tous ses buddies » (Supprimer le groupe, Annuler) ; caché de tous côté serveur (`groupes.supprime_le`), rien n'est effacé, ses liens d'invitation ne marchent plus. Un appui normal ouvre toujours.
  **Partager** passe par la feuille de partage du téléphone (WhatsApp, SMS, mail…) : une sortie envoie son nom, ses
  dates, le lieu, le groupe, le nombre de partants et « Rejoins la sortie sur Mountain Buddies : lien » (qui l'ouvre
  devient partant) ; un groupe envoie son invitation (« X t'invite dans « groupe »… : lien »). Le lien est celui,
  réutilisable, du QR code ; il est créé la première fois. « Seul » n'a pas d'appui long.
- Ouvrir une sortie ouvre sa carte : traces, rendez-vous, hébergement, puis photos. Un
  bandeau en bas (dans combien de jours, qui vient, chiffres du parcours) se baisse pour ne
  laisser que la carte. **(proposé)**
- Une fois terminé, il s'ouvre directement sur son carnet (§5.8). **(proposé, construit au bloc 5)**
- Pas de vote de dates. **(Seb)**

### 5.5 Planning de saison (écrans 16 à 19) **(Seb)**

- Sert à une bande où chacun a une famille et où il est dur de se coordonner sur une saison.
- Un planning est publié par quelqu'un, avec le « ＋ » en bas de l'écran planning : un nom,
  pour quel groupe, une période de quelques mois, « week-ends » ou « tous les jours »
  (ou à la carte), les dates proposées cochées d'avance, une date limite de réponse.
- Publié, il apparaît dans le planning de chaque membre, qui est prévenu et doit le remplir.
- Remplir : un toucher par date (✓ dispo, ? peut-être, ✗ non). Un appui long ajoute un petit
  mot : phrases toutes prêtes (« Samedi seulement », « Dimanche seulement », « À confirmer »,
  « Avec les enfants », « Je peux conduire ») ou texte libre, dictable.
- La grille montre une ligne par date, une colonne par buddy, le nombre de dispos au bout.
- Ensuite on s'arrange de vive voix. Toucher une ligne montre qui est dispo et propose
  « Créer la sortie » ou « Pas encore ». La ligne d'une sortie créé devient un lien
  vers lui.

### 5.6 Messagerie (écrans 6, 24)

- Pour l'instant la spec dit seulement qu'il y a une messagerie par groupe et par
  sortie ; le détail se fera au moment de la développer, en reprenant celle d'AppBase
  (`silvaplana/contretemps`, `backend/src/messagerie/`). **(Seb)**
- Ce qu'elle doit porter **(Seb)** : écrire ou parler tout en regardant la carte. Elle se
  réduit à un bandeau en bas. Une trace ou un hébergement partagé apparaît sur la carte de
  l'autre (« Julie te montre… ») et reste dans la conversation en carte cliquable, pour la
  retrouver plus tard.
- Envoi d'un geste : photo, point sur la carte, trace, dictée (§7.13).
- Hors ligne : file d'attente d'envoi (§3.1).

### 5.7 Appels (écrans 10, 24)

- 📞 fait sonner toute la sortie ou le groupe, comme un vrai appel. On voit qui a
  décroché et qui parle. Besoin de réseau. **(Seb)**
- Pendant l'appel, une barre en haut (qui est en ligne, micro, raccrocher) ; le reste de
  l'écran reste à la carte.
- Montrer du doigt : pendant un appel, toucher un endroit de la carte l'allume sur celle des
  autres. **(Seb : intéressé)**
- Technique étudiée avant la séance : WebRTC auto-hébergé (LiveKit ou Jitsi sur le VPS).
  Android : vraie sonnerie. iPhone publié : sonnerie CallKit (compte Apple Developer).
  iPhone en appli web installée : une notification, sans sonnerie.

### 5.8 Album et carnet (écrans 7, 11 à 14) **(Seb)**

- **Album** : un endroit où chacun dépose ses photos (et vidéos). Rangées par jour, avec le
  visage de l'auteur. Trois vues : Toutes, Sur la carte (chaque photo là où elle a été
  prise), ⭐ Carnet.
- **Carnet** : le rendu final, joli et bien rangé. Dans l'ordre :
  1. Une couverture, puis les photos choisies automatiquement dans l'album pour faire un
     ensemble cohérent ; on peut en changer.
  2. Le récit : chacun écrit ce qu'il veut. Chaque buddy peut ajouter son propre texte,
     signé de son visage, dicté à la voix, transcrit, puis modifiable au clavier. **(Seb)**
  3. La trace sur la carte, une couleur par jour ; un toucher l'ouvre en plein écran.
  4. Le profil et les chiffres, à la manière de Skitour ou VisuGPX : distance, montée,
     descente, durée, temps en marche, point haut, vitesse de montée, difficulté, météo,
     conditions.
  5. Une fiche par jour, facultative : nom de la rando, heure de départ, durée, distance,
     dénivelé, quelques photos. Remplie depuis la trace enregistrée quand il y en a une.
  6. Tout en bas, replié, « Le pratique » : hébergement, comptes, messages.
- Partager le carnet : un lien ou un PDF **(proposé)** ; d'abord en texte (§7.5).

### 5.9 Position des buddies (écran 15) **(Seb)**

- 📍 est une épingle qu'on enfonce : « j'accepte que mes buddies me voient ». La position
  part alors seule, régulièrement, jusqu'à ce qu'on relève l'épingle.
- Qui n'a pas enfoncé l'épingle n'apparaît ni sur la carte ni dans la liste.
- Chaque position est affichée avec l'heure de la dernière reçue ; elle grise en vieillissant.
- Arrêt automatique le soir ou à la fin de la sortie ; un envoi toutes les cinq minutes
  environ avec le GPS économe existant ; visible seulement par les buddies de cette sortie.
- Hors sortie **(Seb, 25 novembre)** : 📍 de la colonne de Buddies partage pareillement avec un ou
  plusieurs groupes choisis (§7.14).
- Sans réseau, les positions sont gardées avec leur heure et partent au retour.

### 5.10 Buddy count (écran 8)

Le partage des frais existant (`capacitor/src/expenses/`, `Expenses.kt`), rangé dans chaque
sortie et partagé entre téléphones : équilibres, « qui doit à qui », dépenses, « ＋ Dépense ».

### 5.11 Hébergement (écrans 9, 23)

La recherche existante (`Lodging.tsx`, `LodgingPanel.kt`), pour le groupe : les propositions
sont des épingles sur la carte, chacun met un ♥, on en retient une. Elle devient l'épingle 🏨
de la sortie et une ligne du Buddy count **(proposé)**. Un hébergement se partage avec le
panneau du §3.4 **(Seb)**.

### 5.12 Bud (écran 25) **(idée de Seb, 23 novembre)**

- Dans une conversation, on peut parler à **Bud** : un buddy à part, qui est une IA (Claude)
  et qui connaît toute l'appli (carte, traces, planning, comptes, hébergements).
- Règles proposées pour rester dans le côté humain (§3.2) **(proposé)** :
  - Bud ne parle que si on l'appelle (« Bud, … », écrit ou dicté). Il n'intervient jamais seul.
  - Il est clairement Bud : son nom, son visage, une bulle à part. Il ne se fait jamais
    passer pour un copain.
  - Il propose et pose le résultat sur la carte ; ce sont les buddies qui décident.
  - Dans un groupe, sa réponse est vue de tous, comme n'importe quel message.
- Exemples : trouver un gîte près du départ, donner la pente maximale d'une trace et la
  montrer, dire quel week-end réunit le plus de monde, résumer ce qui a été décidé, dire qui
  doit quoi.
- Besoin de réseau. Passe par le relais existant (`deploy/ia/`) ; son coût s'ajoute à
  l'écran 📊 Usage.
- Vient après la messagerie dans l'ordre de construction.

## 6. Données (première esquisse)

Serveur Python (FastAPI, SQLAlchemy) à côté des comptes existants ; base locale sur le
téléphone, identifiants créés par le téléphone, synchronisation « envoyer / nouveautés
depuis ». Objets : buddy group, membre, invitation, buddy time, participant, planning, date
de planning, dispo, conversation, message, pièce jointe, photo, carnet, fiche de jour, trace
liée, hébergement proposé, dépense, position. Chaque objet porte l'identifiant de son
groupe ou de sa sortie, qui décide qui peut le voir. À détailler bloc par bloc.

## 7. Ordre de construction

Seb laisse le choix de l'ordre. **(Seb)**

Un bloc = une PR, dans les deux applis (Capacitor et Kotlin), chacun utilisable seul.

1. Socle : serveur, copie locale et file d'attente ; liste Buddies, groupes, Me Time,
   invitations (écrans 1, 2, 3, 20).
2. Sortie : création, carte, traces associées, panneau de partage (4, 21, 22).
3. Planning de saison (16 à 19).
4. Album (7, 11).
5. Carnet (12, 13, 14).
6. Buddy count partagé (8).
7. Position des buddies (15).
8. Hébergement partagé (9, 23).
9. Messagerie, reprise d'AppBase (6, 24).
10. Appels, puis montrer du doigt (10, 24).
11. Bud (25).

### 7.1 Bloc 1 : ce qui est construit (23 novembre 2026)

- **Écran 1** : 👥 ouvre Buddies, 👤 ouvre Mon compte (pastille verte ou orange). La pastille de 👥
  compte les groupes qui ont bougé depuis la dernière ouverture.
- **Écran 2** : la liste des groupes (Me Time compris), le plus récemment actif en haut,
  « à jour à 8 h 12 » et 🕓 pour ce qui attend le réseau. Les sorties arrivent avec le
  bloc 2 (§7.2).
- **Écran 3** : un groupe, ses visages (toucher : inviter, nommer admin, retirer, quitter).
  Le dernier admin qui part passe la main au plus ancien membre ; un groupe vide disparaît.
- **Écran 20** : photo, nom, invitations par Contacts (sélecteur d'Android, sans permission
  « contacts »), Mail, Téléphone (SMS) ou QR code. 26/11 au soir : « Partager » (qui avait remplacé « Mail »)
  redevient « Mail », envoyé par le serveur avec Brevo (§7.23). L'invitation part au serveur avant le message, pour que le lien
  marche tout de suite ; valable 30 jours. La page du lien (rejoindre.html) prend les couleurs de l'appli,
  un seul bouton, et réessaie une minute avant de dire « pas reconnu » (plus de faux « expiré »).
- **Colonne d'icônes** : visible partout ; 💶 ouvre le partage des frais et 🏨 l'hébergement
  existants ; 📞 📅 💬 📸 disent « Bientôt » jusqu'à leur bloc.
- **Me Time** : créé par le serveur à la première synchro, le même sur tous les téléphones de la
  personne ; on ne le quitte pas et on n'y invite pas de groupe (inviter à une sortie : bloc 2).
- **Invitations** : le code est tiré au hasard par le téléphone, donc le SMS part même sans réseau.
  Le lien `silvaplana.cloud/mountaintest/rejoindre.html?c=…` montre le groupe et qui invite, ouvre
  l'appli (`…://rejoindre?c=…`) ou propose de l'installer ; il sert 30 jours. Un lien SMS ou mail
  sert à une personne ; un QR code sert à toute la bande.
- **Synchro** : une seule route, `POST /buddies/sync` (deploy/comptes/buddies.py) : le téléphone
  envoie ses opérations en attente et reçoit les groupes changés depuis la fois d'avant.
  Une opération refusée (droits, lien expiré) est montrée puis oubliée. Synchro à l'ouverture de
  l'appli, au retour du réseau, après chaque action et chaque minute quand Buddies est ouvert.
  Toute requête sans réponse est abandonnée au bout de 30 s (5 min pour un fichier) et les photos et fichiers
  partent à côté de la synchro : avant, une requête muette bloquait tout jusqu'à relancer l'appli (Seb, 27/11 :
  voiture garée jamais partie, impossible à enlever).
  Cas limites corrigés après audit (27/11) : le délai de 30 s couvre aussi le corps de la réponse (sans un octet
  pendant 30 s on abandonne ; tant que ça arrive on attend) ; la file part par envois de 200 opérations au plus (le
  serveur en refuse plus de 500 : une longue file hors ligne ne partait plus jamais) ; une synchro demandée pendant
  qu'une autre est en route en relance une juste derrière (sinon l'événement était perdu) ; un objet manquant est
  redemandé tout de suite ; la file est gardée à part de la copie locale (elle survit si le stockage est plein).
  Serveur : une opération que la base refuse revient dans `refus` au lieu d'une erreur 500 qui bloquait la file ;
  un même envoi reçu deux fois en même temps est rejoué ; la marge du curseur passe de 5 à 30 s ; une heure du
  téléphone dans le futur est ramenée à l'heure du serveur (épingle, voiture) ; une épingle plus ancienne, rejouée
  en retard par un autre appareil, n'écrase plus la plus récente (comme la voiture).
  « Suis ma carte » : chaque « j'allume » ouvre une époque (plus grande que toutes celles vues dans l'appel) et
  chaque message porte un numéro ; celui qui reçoit jette un message d'une époque finie ou d'un numéro dépassé (une
  vue arrivée après la fin faisait resuivre pour toujours). Deux buddies qui allument en même temps : la plus
  grande époque garde la main (avant, les deux s'éteignaient).
  **Un événement pour tout, plus le passage régulier (Seb, 27/11 : « événement plus polling, au moins on ne ratera
  rien »).** Flux SSE repris de la messagerie d'AppBase (`deploy/comptes/evenements.py`, `GET /buddies/evenements`,
  `capacitor/src/buddies/evenements.ts`) : un flux par appareil, ouvert tant que l'appli est à l'écran ; jeton dans
  l'adresse, premier octet tout de suite, ping toutes les 20 s, reconnexion forcée au retour du réseau et au retour
  à l'écran, synchro à chaque (re)connexion. À chaque changement (toute opération acceptée d'une synchro, « écrit… »,
  profil, fichier d'une photo ou d'un message arrivé, appel), le serveur envoie « synchronise-toi » aux membres de mes
  groupes, aux participants de mes sorties et à mes autres appareils ; l'événement ne porte pas la donnée, elle
  arrive par la synchro. L'appareil qui envoie n'est pas réveillé par son propre envoi. Deux écarts avec AppBase : le
  flux est recréé avec un jeton neuf quand le jeton d'une heure a expiré, et il est fermé en arrière-plan (batterie).
  Restent en filet : le passage toutes les 2 minutes, les 5 s en conversation, le push Firebase.
  Choix validés par Seb (27/11) : **dépenses en suppression douce** (`depenses.supprime_le` : une dépense retirée,
  ou un « J'ai payé » refusé, reste en base, cachée ; modifiée ou renvoyée ensuite par un téléphone resté hors ligne,
  elle ne ressuscite pas, l'opération est refusée) ; **heure du serveur** (la synchro rend `maintenant`, le téléphone
  garde son décalage d'horloge et compare les heures des voitures, épingles et positions à l'heure du serveur, aussi
  hors ligne) ; **« Suis ma carte » : 15 s sans message de celui qui montre vaut fin** (il renvoie tout toutes les
  4 s ; s'il montre toujours, son prochain message fait resuivre).
  **Copie locale dans IndexedDB** (Seb, 27/11) : groupes, sorties, messages et traces y vivent en un seul objet, lu
  une fois avant le premier écran ; l'ancienne copie de localStorage (plafonnée vers 5 Mo, écriture qui échouait sans
  bruit) est reprise une fois puis retirée. La file d'attente et la liste des photos et fichiers pas encore partis
  restent en plus dans une petite clé de localStorage, écrite tout de suite : appli tuée juste après une action, rien
  de ce qu'on a fait n'est perdu. Sans IndexedDB, tout reste dans localStorage.

### 7.2 Bloc 2 : ce qui est construit (23 novembre 2026)

- **Écran 2** : en haut, la grande image de la sortie en cours, sinon du prochain (« Dans 5 jours »),
  puis la partie sorties (à venir, du plus proche au plus lointain), puis les groupes.
  En bas, « ＋ Sortie » et « ＋ Groupe ».
- **Écran 3** : un groupe montre aussi ses sorties à venir, ses souvenirs (Sorties
  passés, en vignettes) et les traces partagées dans le groupe, plus « ＋ Sortie ».
- **Écran 21** : photo, nom, date de début et de fin (fin = début si vide), lieu ; dans une bande,
  on coche qui part (le créateur part toujours) ; dans Me Time, on invite des copains à la sortie
  (Contacts, Partager, SMS, QR) : le lien les ajoute à la sortie, pas à un groupe.
- **Écran 4** : toucher une sortie ouvre la carte, cadrée sur ses traces. En haut nom, dates,
  lieu ; en bas un bandeau qu'on replie (« Dans N jours », « En cours » ou « Souvenir », qui part,
  km du parcours, jours avant). Les traces partagées s'ajoutent à Mes traces affichées (« Partagée
  par Julie ») : profil, Y aller, Commencer et Hors ligne marchent comme pour les siennes.
  Météo, rendez-vous et dénivelé du bandeau : plus tard.
- **Écran 22** : l'icône de partage d'une trace ouvre le panneau commun : vignettes des sorties
  à venir, puis des groupes, un petit mot, « Partager » ; « Ou ailleurs » garde le partage du
  téléphone (fichier GPX). Partager à un buddy seul attendra la messagerie (bloc 9).
- **Serveur** : tables `sorties`, `participants`, `traces` ; la synchro renvoie aussi les sorties
  et traces changés. Une sortie se voit par les membres de son groupe et ses participants ;
  une trace par ceux qui voient son groupe ou sa sortie. Une trace : 2 à 20 000 points,
  arrondis à 5 décimales (environ 1 m).

### 7.3 Bloc 3 : ce qui est construit (23 novembre 2026)

- **Accès** : 📅 de la colonne ouvre les plannings du groupe ouvert, sinon de toutes mes bandes,
  avec « ＋ Planning » en bas. Un planning à remplir s'annonce en haut de la liste Buddies et du
  groupe (« 🔔 Saison ski : 3 week-ends à remplir · Remplir › ») et compte dans la pastille de 👥.
- **Écran 18** : nom, bande (pas de planning dans Me Time), période de mois à mois, « Week-ends »
  (samedi-dimanche), « Tous les jours » (tout coché) ou « À la carte » (tous les jours, rien de coché),
  dates en pastilles à décocher, date limite (dans 7 jours par défaut), « Publier le planning ». Sans nom tapé, le
  nom grisé proposé (« Saison ski 2026-27 ») est pris ; s'il manque une bande ou une date, l'écran le dit au-dessus
  du bouton (corrigé le 23 novembre : le bouton restait grisé sans raison quand on gardait le nom proposé).
- **Écran 16** : une ligne par date, regroupées par mois ; une colonne par buddy, moi en premier et
  encadré ; ✓ ? ✗ ou · (pas répondu), 💬 quand il y a un petit mot ; le nombre de ✓ au bout. Toucher
  ma case fait tourner ✓ → ? → ✗ → rien ; toucher la case d'un autre montre son petit mot.
- **Écran 17** : mes dates pas encore passées, trois grosses touches ✓ ? ✗ (toucher à nouveau efface) ;
  appui long : phrases toutes prêtes ou un petit mot (la dictée passe par le clavier du téléphone).
- **Écran 19** : toucher une date montre qui est dispo, peut-être, pas dispo, pas encore répondu ;
  « Où ? » facultatif ; « Créer la sortie » (les ✓ partent, nom = le lieu, sinon le nom du
  planning) ou « Pas encore ». Une ligne devient un lien vers la sortie de la bande qui part ce
  jour-là (même date de début), même s'il a été créé à la main. La météo prévue : plus tard.
- **Serveur** : tables `plannings` (dates en JSON) et `dispos` (planning, buddy, date : oui, peut, non
  et un mot) ; opérations `creer_planning` et `dispo` (rejouable : la dernière réponse compte, une
  réponse vide efface). Seuls les membres de la bande voient et remplissent le planning. 200 dates au plus.

### 7.4 Bloc 4 : ce qui est construit (23 novembre 2026)

- **Accès** : 📸 de la colonne ouvre les albums (un par sortie commencée, du groupe ouvert ou de
  tous) ; sur la carte d'une sortie, le bandeau montre les 4 premières photos (« +38 »),
  « 📷 Ajouter » et « 📸 Album ».
- **Écran 11** : photos rangées par jour (« Jour 1 · sam. 18 oct. »), 3 par rangée, visage de
  l'auteur, ⭐ ; vues Toutes, Sur la carte, ⭐ Carnet (les photos choisies pour le carnet, bloc 5).
  « 📷 Déposer mes photos » : plusieurs d'un coup, depuis la galerie. Toucher une photo : en grand,
  ‹ ›, « ☆ Pour le carnet » (n'importe quel participant), « Retirer » (l'auteur seulement).
- **Écran 7** : sur la carte, chaque photo là où elle a été prise (vignette bordée de blanc) ; un
  toucher l'ouvre en grand. Sans trace partagée, la carte se cadre sur les photos.
- **En grand** (Seb, 25/11 : « chaque fois la photo doit être à son mieux ») : la photo prend tout
  l'écran, les barres sont posées dessus et un toucher les cache ; deux doigts l'agrandissent
  (jusqu'à ×6), deux touchers rapides : ×2,5 ; on glisse vers la suivante. Les photos du carnet
  (mosaïque, fiches des jours) s'ouvrent pareil. Bouton « Partager » (WhatsApp, mail…).
- **Appui long** sur une vignette de l'album : Partager, garder pour le carnet, retirer.
- **📍 Placer une photo** (Seb, 25/11 : les photos passées par WhatsApp n'ont plus de position) : sur
  l'écran 7, « 📍 n photos à placer » ouvre les photos sans position ; on en choisit une, elle
  s'ouvre en grand pour voir ce que c'est, un toucher la réduit (la vignette la rouvre), puis on
  touche la carte. Une photo déjà placée se déplace depuis sa vue en grand (« 📍 Déplacer »). Tout
  buddy de la sortie peut le faire (op `placer_photo`).
- **Depuis WhatsApp ou la galerie** (Seb, 25/11) : sur Android, « Partager » des photos propose
  Mountain Buddies ; l'appli demande dans quel album les ranger (50 photos au plus par partage),
  puis ouvre l'album. WhatsApp retire la position : on les place avec 📍.
- **Avec le bouton 📷** (Seb, 25/11) : il ouvre toujours l'appareil photo du téléphone ; au retour
  dans l'appli, les photos prises depuis vont seules dans l'album de la sortie du jour (bandeau
  « n photos dans … · Annuler », 8 s), ou l'appli demande l'album s'il y en a plusieurs ou aucun
  (« Ne pas ranger »). Heure lue dans la photo ; lieu lu dans la photo, sinon position du téléphone.
  Android : accès aux photos demandé une fois (30 photos au plus par retour).
- **Consultation comme WhatsApp** (Seb, 25/11 : « exactement comme ils font ») : dans le carnet, toucher une photo ouvre les photos choisies à la suite, en pleine largeur, avec l'heure, qu'on fait défiler de bas en haut (titre de la sortie, « n photos · jour » en haut). Une photo touchée (là, dans l'album ou sur la carte) s'ouvre en plein écran, entière ; on glisse à gauche ou à droite pour changer, deux doigts ou deux touchers pour zoomer, on la tire vers le bas pour fermer. Les gestes viennent de la bibliothèque PhotoSwipe (MIT), pas de code maison ; nos barres (auteur, Partager, ⭐, Retirer) sont posées dessus, un toucher les cache.
- **Photo en grand, téléphone couché** (Seb, 25/11) : flèches et boutons sont rentrés de 72 px au moins, pour ne pas tomber sous les touches du téléphone.
- **Films en premier** (Seb, 25/11) : dans l'album, les films (celui du parcours surtout) forment un groupe « Film » avant les jours ; dans le carnet ils sont toujours là, en tête de la mosaïque, sans avoir besoin de ⭐.
- **Dans le film du survol** (25/11) : les photos prises à moins de 150 m de la trace (8 au plus,
  les ⭐ d'abord) s'ouvrent dans le film là où elles ont été prises, 3 s chacune ; on les décoche
  avant de filmer (📷 dans le panneau du survol).
  Les ombres du film sont celles du jour de la sortie de la trace (au jour de sa première photo sur
  la trace s'il dure plusieurs jours), sinon celles d'aujourd'hui. Le film 🧗 se règle en « → Aller »
  (la trace du début à la fin), « ← Retour » (de la fin au début) ou « ⇄ Aller-retour » (au bout, la
  caméra tourne puis revient par le même chemin), quel que soit le relief (Seb, 25/11 : « un film a
  un début et une fin »). Vitesses : 200, 400 ou 800 km/h.
  Le film se fabrique sur une **carte cachée** (Seb, 25/11, « un écran virtuel ») : une deuxième carte de
  la taille de l'écran, hors de vue. On peut fermer le panneau et continuer à se servir de l'appli ;
  un bandeau « Film en cours · n % · Ne ferme pas l'appli » reste en haut et rouvre le panneau, puis
  dit « Ton film est prêt ». L'écran reste allumé pendant la fabrication. Un seul film à la fois ;
  l'appli doit rester ouverte au premier plan (en arrière-plan le film attend).
- **Hors ligne** : la photo est réduite sur le téléphone (400 px pour la grille ; pour la voir, 2560 px au plus, et une photo JPEG déjà à cette taille est gardée telle quelle, sans la recompresser : Seb, 25/11, « la même qualité que WhatsApp » ;
  JPEG), gardée et montrée tout de suite avec 🕓 ; elle part au retour du réseau. Les photos des
  autres, une fois vues, restent sur le téléphone : l'album s'ouvre sans réseau.
- **🎥 Films de survol 3D** (Seb, 25/11) : le film tourné depuis la caméra du menu d'une trace se range
  dans l'album de la sortie ouverte sur la carte (sinon on choisit l'album). Il y est une « photo »
  marquée vidéo (colonne `photos.video`) : petite et grande = image de couverture, le film (MP4 ou
  WebM, 100 Mo au plus) part en plus (`PUT /buddies/photos/<id>/video`). Vignette avec ▶ ; en grand,
  le film se lit. Il compte comme arrivé quand le film est arrivé.
- **Nom d'un film** (Seb, 26/11) : « Filmer » lance le film tout de suite ; pendant qu'il se fabrique (temps masqué),
  le panneau propose « Nom du film (si tu veux) » (sans nom : celui de la trace) ; dans 📁 les derniers films, un
  crayon change le nom d'un film.
- **Heure et lieu** : lus dans la photo (EXIF). Sans heure, celle du fichier ; sans lieu (le choix de
  photos d'Android retire parfois la position), la photo n'est pas sur la carte. Vidéos : plus tard.
- **Serveur** : table `photos` (Sortie, auteur, heure, lieu, ⭐, arrivée) et opérations
  `ajouter_photo`, `etoile`, `retirer_photo` dans la synchro ; les fichiers passent à part,
  `PUT`/`GET /buddies/photos/<id>/<petite|grande>` (auteur seul pour envoyer, participants pour lire),
  rangés dans `COMPTES_DOSSIER/photos` (le volume `comptes-data` du VPS). 300 ko et 4 Mo au plus.

### 7.5 Bloc 5 : ce qui est construit (23 novembre 2026)

- **Accès** : une sortie terminé s'ouvre directement sur son carnet (la carte reste à un toucher de la
  trace) ; sur la carte d'une sortie commencée, « 📖 Carnet » à côté de « 📷 Ajouter » et « 📸 Album ».
- **Écran 12** : couverture (la photo de la sortie, sinon la première photo choisie), nom, dates, qui est
  venu. « ⭐ 12 photos choisies sur 42 » : les ⭐ de l'album ; sans ⭐, un choix automatique fait sur le
  téléphone (au plus 12, réparties sur toute la sortie, signalé ✨). « Choisir les photos pour le carnet » (sous la mosaïque ; « Changer » n'était pas compris, Seb 25/11) ouvre l'album sur la vue
  ⭐ Carnet. Puis les récits, chacun signé du visage de son auteur, puis « 〰 La trace » : un petit plan,
  une couleur par jour ; un toucher ouvre la sortie sur la carte.
- **Une couleur par jour** : quand il y a autant de traces partagées que de jours, la 1re trace partagée
  est le jour 1, la 2e le jour 2… ; sinon une couleur et le nom par trace.
- **Écran 13** : le profil de toute la sortie (jours séparés d'un pointillé) et les chiffres connus :
  distance, montée, descente, durée, point haut, jours et nuits, buddies, difficulté, météo, « + conditions »
  en pointillé tant qu'elles manquent. Puis une fiche par jour (nom, départ, durée, distance, montée, trois
  photos du jour), « Le pratique » replié (lieu, qui est venu, traces ; hébergement, comptes et messages
  viendront avec leurs blocs), « ✏️ Modifier » et « Partager ».
- **Chiffres depuis la trace** : distance tirée des traces ; montée, descente, point haut et profil tirés
  du relief IGN (une fois en ligne, puis gardés sur le téléphone). Les traces partagées n'ont pas d'heures :
  départ et durée se tapent dans la fiche ; « temps en marche » et « vitesse de montée » attendront des
  traces partagées avec leurs heures.
- **Écran 14** : mon récit (un texte par buddy ; le dernier envoyé gagne), le gros micro 🎤 (la dictée
  d'Android, hors ligne quand le téléphone le permet ; dans un navigateur, la sienne ; sinon le micro du
  clavier) ; les mots sont écrits tels quels, puis se corrigent au clavier. Une fiche par jour (nom, départ,
  durée « 5 h 20 », distance en km, montée en m ; vide = pris dans la trace, montré en grisé), difficulté,
  météo, conditions. « Enregistrer le carnet » n'envoie que ce qui a changé ; sans réseau, 🕓.
- **Partager** : le carnet en texte (récits, chiffres, fiches) vers l'appli choisie. Le lien et le PDF :
  plus tard.
- **Serveur** : tables `recits` (Sortie, buddy, texte), `fiches_jour` (Sortie, jour, nom, départ,
  durée, distance, dénivelé) et `carnets` (difficulté, météo, conditions) ; opérations `recit`, `fiche`,
  `carnet` dans la synchro, envoyées avec la sortie (`carnet` dans sa vue). Tout participant de la
  sortie peut écrire ; chacun ne touche qu'à son propre récit.

### 7.6 Bloc 6 : ce qui est construit (23 novembre 2026)

- **Accès** : 💶 de la colonne ouvre le Buddy count de la sortie ouverte (carnet, album), sinon la liste des
  Buddy counts (un par sortie, du groupe ouvert ou de tous) ; sur la carte d'une sortie, une case
  « 💶 412 € · à 4 » à côté des chiffres ; dans le carnet, une ligne dans « Le pratique ». L'ancien partage
  des frais (menu Voyage, sur le téléphone seulement) reste accessible en bas de la liste : « Mes partages
  de frais hors sortie ».
- **Écran 8** : « Équilibres » et la part de chacun ; une barre par buddy (verte : on lui doit, orange : il
  doit) ; « Nico doit à Seb 106 € » avec les deux visages ; les dépenses (icône devinée depuis le titre :
  gîte 🏨, essence ⛽, courses 🧀, forfaits 🎿…, payé par qui) ; « ＋ Dépense ».
- **Une dépense** : quoi, combien (en €), payé par (un visage), pour qui (les visages cochés, tous par
  défaut), le jour (dans les dates de la sortie par défaut). Toucher une dépense la corrige ou la retire :
  n'importe quel participant peut le faire ; la dernière version envoyée gagne. Sans réseau : 🕓.
- **Calculs** : ceux du partage des frais existant (centimes restants aux premiers, remboursements en peu
  de virements).
- **Serveur** : table `depenses` (Sortie, titre, montant en centimes, payé par, pour qui en JSON, jour) ;
  opérations `depense` (ajoute ou corrige) et `retirer_depense` ; payeur et bénéficiaires doivent être des
  participants de la sortie.

### 7.7 Bloc 7 : ce qui est construit (23 novembre 2026)

- **Accès** : sur la carte d'une sortie, pendant ses dates, une ligne « 📍 Position des buddies · 2 visibles ·
  tu es visible » dans le bandeau ouvre l'écran 15 à la place du bandeau (« Retour » revient au bandeau). Les visages
  des buddies visibles sont sur la carte dès qu'on l'ouvre. 📍 dans la colonne de Buddies : §7.14.
- **Écran 15** : en haut « 📍 2 buddies visibles » ; sur la carte, chaque buddy est une tête d'épingle ronde à ses
  initiales (« MD »), piquée sur son aiguille, avec au-dessus l'heure de sa dernière position (« 10 h 42 », l'heure
  de prise du téléphone qui émet, envoyée avec la position ; « toi » pour soi) (Seb, 26/11) ; il grise en vieillissant (plus de 20 min, plus d'une heure) et pâlit quand l'épingle est
  relevée. En bas, chaque buddy avec « à 1,2 km de toi · 2 310 m », « plus de réseau ? » (épingle enfoncée, rien
  depuis 20 min) ou « a relevé l'épingle » ; puis l'épingle : « 📍 Mes buddies peuvent me voir » (bouton principal),
  ou, enfoncée, « Mes buddies me voient · depuis 9 h 10 · s'arrête seul à 19 h » et « Arrêter ».
- **L'épingle** : enfoncée, elle se relève seule ce soir à 19 h (Seb, 26/11 ; à minuit si on l'enfonce après 18 h). Une seule à la
  fois : l'enfoncer dans une sortie la relève ailleurs. Relevée par soi ou le soir, la dernière position reste
  visible, grisée, jusqu'à 48 h, puis le serveur l'oublie. Pas encore de lieu nommé (« au col ») : l'altitude à la place.
- **Envoi** : Android, un service (notification « 📍 Mes buddies me voient ») prend une position toutes les 5 minutes,
  écran éteint compris, en GPS précis le temps du point puis endormi ; il s'arrête seul à l'heure prévue. Sans réseau,
  seule la dernière position attend (avec son heure) et part au retour ; appli tuée, le service la garde et l'appli
  l'envoie à sa réouverture. Dans un navigateur : toutes les 5 minutes tant que la page est ouverte. iPhone : à faire.
- **Réception** : à chaque synchro (toutes les minutes quand Buddies est ouvert, à chaque envoi de position, au retour
  de l'appli au premier plan).
- **Serveur** : table `positions` (Sortie, buddy, épingle `depuis`/`jusqu` en ms, dernière position et altitude,
  heure de prise) ; opérations `epingle {sortie, enfoncee, quand, jusqu}` (un jour au plus) et `position {sortie,
  lat, lon, alt, prise_le}` : une position hors du temps de l'épingle, ou plus ancienne que la dernière, est ignorée
  sans bruit. Seuls les participants de la sortie s'épinglent et voient les positions ; elles reviennent entières à
  chaque synchro.

### 7.8 Bloc 8 : ce qui est construit (23 novembre 2026)

- **Proposer (écran 23)** : dans la recherche d'hébergement existante, chaque résultat a « 👥 Proposer à mes
  buddies ». Le panneau de partage s'ouvre sur « Dans une sortie » : seulement les sorties à venir ou en cours
  où je pars (pas de groupe : un hébergement appartient à une sortie) ; « Ou ailleurs » envoie le nom, l'adresse et
  le lien. L'hébergement est placé sur la carte par son adresse (géocodage IGN) quand on la trouve ; sans réseau, il
  est proposé sans épingle.
- **Où on dort ? (écran 9)** : 🏨 de la colonne dans une sortie (carnet, album, Buddy count), ou la ligne « 🏨 Où on
  dort ? » du bandeau de la carte (avant et pendant la sortie ; une fois retenu : « Gîte Les Baladins ✅ · 60 € /
  nuit »). Chaque idée : image selon la nature (refuge, gîte, chalet…), prix par nuit, nature, adresse, résumé ; un
  toucher ouvre son site. ♥ (un par buddy, avec les visages de ceux qui aiment), « On le prend » (✅, un seul retenu par
  sortie ; n'importe quel participant peut changer), « Retirer l'idée ». Le retenu en haut, puis les plus aimés,
  puis les moins chers. Un seul bouton principal : « 🔍 Chercher d'autres hébergements ».
- **Sur la carte** : les épingles 🏨 des idées placées, la retenue en vert.
- **Liens tout prêts (24 novembre 2026, accord de Seb)** : au-dessus de « 🔍 Chercher », trois boutons Booking, Airbnb,
  Abritel ouvrent le site déjà réglé sur le lieu de la sortie, ses dates (une nuit au moins) et le nombre de
  participants ; même chose dans l'écran de recherche (ville, arrivée, nuits, personnes). Gratuit, prix et dispos en
  direct. Pourquoi : aucune API de ces sites n'est ouverte à une appli entre copains (Booking réserve la sienne aux
  affiliés sous contrat, Airbnb n'en a pas, Abritel passe par une certification Expedia), et la recherche web lit mal
  leurs prix. Capacitor seulement (Kotlin arrêté).
- **Hébergements trouvés sur la carte (24 novembre 2026, demande de Seb)** : sous les résultats de « 🔍 Chercher »,
  « 🗺 Voir sur la carte » place chacun par son adresse (sinon son nom, géocodage IGN gratuit ; ceux qu'on ne trouve
  pas restent hors carte), ferme la recherche et pose des épingles 🏨 avec le prix. Un toucher ouvre la fiche en bas :
  « Voir le site », « 👥 Proposer à mes buddies » ; ✕ retire les épingles. Pas de disponibilités : gites-refuges.com
  est un annuaire (téléphone, mail), on réserve ailleurs.
- **Directement sur la carte (24 novembre 2026, accord de Seb)** : dès que la recherche a fini, les résultats vont sur
  la carte (la recherche se ferme) ; « ☰ Liste » de la fiche du bas rouvre la liste avec les mêmes résultats.
- **Ville + distance (choix de Seb, 25 novembre 2026)** : « Distance autour de la ville » 5, 10 ou 20 km (10 par
  défaut, retenu). Le relais reçoit `rayon_km` et ne cherche que dans ce cercle ; l'appli place chaque résultat et
  écarte ceux placés à plus de la distance + 25 % du centre de la ville (géocodage approché) ; ceux qu'on ne peut pas
  placer restent dans la liste, pas sur la carte.
- **Refuges : la page de réservation** : pour un refuge ou un gîte réservable en ligne (centrale CAF/FFCAM, Tour du
  Queyras, refuges des Écrins…), la recherche et Bud donnent le lien de sa page de réservation (le calendrier des
  places). Ils ne lisent pas les places libres : ces calendriers demandent un compte (et une salle d'attente à
  l'ouverture).
- **Sites à regarder en priorité (26 novembre 2026, demande de Seb)** : les cases de la recherche proposent
  gites-refuges.com, capverb.org et refuges.info (refuges, cabanes, gîtes d'étape), cochées par défaut ; on peut en
  ajouter. Cochés, la recherche les regarde d'abord puis complète avec le reste du web (avant : seulement eux). Bud
  reçoit les mêmes sites cochés et les regarde aussi en priorité quand on lui demande où dormir.
- **Pas encore** : la ligne automatique dans le Buddy Count (le prix trouvé n'est pas toujours celui payé : on ajoute
  la dépense à la main). La recherche elle-même est l'écran existant, non retouché (voir point ouvert 6).
- **Serveur** : tables `hebergements` (Sortie, nom, nature, prix par nuit en euros, adresse, lien http(s), résumé,
  position, retenu) et `coeurs` ; opérations `proposer_hebergement`, `coeur`, `retenir_hebergement` (un seul retenu),
  `retirer_hebergement` ; réservées aux participants de la sortie.

### 7.9 Bloc 9 : ce qui est construit (23 novembre 2026)

- **Une conversation par groupe et par sortie** (§5.6), reprise en léger de la messagerie d'AppBase : chaque
  message porte un identifiant choisi par le téléphone, il part dans la même file d'attente que le reste (§3.1) et
  n'arrive qu'une fois même s'il est renvoyé. Sans réseau : « 🕓 partira au retour du réseau » sous le message.
- **Écran 6** : la conversation d'une sortie s'ouvre sur sa carte, dans le bandeau du bas (ligne « 💬 Messagerie ·
  2 nouveaux » du bandeau). Mes messages à droite en
  vert, ceux des autres à gauche avec leur prénom en couleur. En bas : [📷] [📍] [Message] [🎤], 🎤 devient ➤ dès
  qu'on écrit. Ouverte, elle regarde les nouveaux messages toutes les 10 s.
- **Écran 24** : on replie le bandeau (poignée) ou on touche « voir sur la carte » : il ne reste que les deux derniers
  mots et la saisie, la carte au-dessus.
- **Dans le fil**, en plus des messages et en cartes cliquables : les traces partagées dans cette sortie ou ce
  groupe (« Col Girardin · Julie · 14 km · voir sur la carte ») et les hébergements proposés (« Gîte Les Baladins ·
  Seb · 60 € / nuit »). On les retrouve donc plus tard dans la conversation.
- **Envoyer d'un geste** : 📍 envoie ma position du moment (« Nico est ici · voir sur la carte » : un toucher centre
  la carte sur le point, montré par une épingle piquée au sol, aux initiales, comme les positions des buddies ; Seb
  27/11 : l'ancienne bulle semblait glisser quand on bougeait la carte). La précision du téléphone voyage avec le
  message (texte « ±3000 m ») : au-delà de 100 m, la bulle dit « à 3 km près » et la carte montre un cercle en
  pointillés ; au-delà de 500 m, celui qui envoie est prévenu (un ordinateur se repère par le réseau) ; 📷 (dans une sortie) dépose les photos dans l'album et les envoie aussi en message ;
  🎤 dicte le texte dans le champ (on relit avant d'envoyer). Appui long (ou toucher) sur un de mes messages :
  « Retirer ce message ».
- **💬 de la colonne** : toujours la liste de mes conversations, même depuis un groupe ou une sortie (Seb, 27/11),
  la plus récente en haut, avec le dernier mot et le nombre de non lus.
- **Pas encore** : le vrai message vocal (🎤 dicte pour l'instant), « Julie te montre… » en direct sur la carte de
  l'autre pendant un appel (avec le bloc 10), le partage à un buddy seul (une conversation à deux) et les
  notifications.
- **Serveur** : table `messages_buddies` (Groupe ou sortie, auteur, nature texte, point ou photo, texte de
  2 000 caractères au plus, position, photo de l'album de la même sortie) ; opérations `message` et
  `retirer_message` (seulement les siens) ; la synchro rend les messages des 90 derniers jours.

### 7.10 Bloc 10 : ce qui est construit (23 novembre 2026)

- **Choix de Seb (23 novembre)** : le son passe par LiveKit installé sur le VPS (`appels.silvaplana.cloud`), et le
  téléphone **sonne même appli fermée** grâce à Firebase (projet « Mountain Buddies », un message prioritaire par
  téléphone). Sans Firebase, les appels marchent quand même, ils ne sonnent que l'appli ouverte.
- **📞 de la colonne** : appelle toute la sortie ouverte, sinon tout le groupe ouvert (pas d'appel dans Me
  Time). Si un appel est déjà en cours dans la bande, on le rejoint sans refaire sonner. Ligne « 📞 Appel en cours ·
  rejoindre » dans le groupe et sur la carte de la sortie, pour qui n'a pas sonné (iPhone, appli fermée sans
  Firebase).
- **Écran 10** : plein écran « Mountain Buddies · appel de groupe », le nom de la sortie, « Julie t'appelle… »,
  les visages (cercle vert : déjà en ligne), ✕ Refuser et 📞 Répondre. Appli fermée : notification d'appel plein
  écran (par-dessus l'écran verrouillé) avec Refuser / Répondre, sonnerie du téléphone 45 s au plus ; elle s'arrête
  si l'appelant raccroche.
- **Écran 24** : la carte reste à l'écran, barre verte en haut « En ligne · 3:12 / Julie parle… · Luc », 🎙/🔇 et
  ✕ raccrocher. Celui qui appelle et que personne ne rejoint raccroche seul au bout d'une minute.
- **Ce que l'appelant entend** (Seb, 27 novembre) : tant que personne n'a décroché, la tonalité de retour d'appel à la
  française (440 Hz, 1,5 s toutes les 5 s, coupée dès que quelqu'un est dans l'appel) et la barre « Appel pour <groupe> » (Seb, 27/11). Dessous, les petits visages de ceux qu'on appelle (maquette
  `maquettes/qui-decroche/`, choix B) : en couleur avec un point vert = en ligne, grisé en pointillé = ça sonne,
  barré = pas répondu (après une minute, ou parti) ; en ligne d'abord, 6 au plus puis « +N », et la durée. Quand quelqu'un décroche : deux bips montants (une seule fois par buddy et par appel ; un départ n'est annoncé que s'il dure 5 s, pour une connexion qui saute),
  une vibration et la barre passe au vert « Julie a décroché » 4 s ; quand quelqu'un raccroche : deux bips
  descendants et « Luc a raccroché ». Celui qui rejoint un appel déjà en cours ne se fait pas annoncer ceux déjà là.
- **🗺 Suis ma carte** (Seb, 27 novembre, maquette `maquettes/partage-carte-appel/`, option A choisie ; ni vidéo de
  l'écran ni prise de contrôle) : en ligne, une icône carte au trait dans la barre d'appel. Allumée (fond blanc),
  « Tu montres ta carte » : les autres suivent ma vue (centre, zoom, orientation, inclinaison, 4 fois par seconde
  au plus) et mon fond de carte (SCAN 25, Plan IGN… s'ils y ont droit). Mes traces affichées partent aussi, allégées
  (500 points en tout), et arrivent chez eux en invitées « nom (de Julie) », sans aller dans Mes traces. Chez eux :
  l'icône carte de la barre d'appel (juste avant micro et raccrocher) est exclusive : elle devient le badge de Julie avec la petite icône carte dessus, barre verte ; un appui sur le badge arrête de suivre (Seb, 27 novembre : pas de Stop à part, pas d'encart, la barre garde sa forme). Pas
  d'acceptation au départ ; c'est chacun qui arrête de suivre avec Stop (Seb, 27 novembre). Quand on arrête (ou que Julie
  arrête, ou fin d'appel), si des traces sont arrivées : « Garder les traces de Julie ? » avec leurs noms, Non merci /
  Garder (toutes rangées dans Mes traces). La même icône est en haut de chaque conversation (groupe et duo) : en appel, elle allume ma carte ;
  hors appel, voir ci-dessous.
  Ce qui suit aussi (Seb, 27 novembre) : les calques pentes, ombres, drones et météo (mêmes cases chez eux) ; le
  trait que je dessine au doigt, en direct (4 fois par seconde, orange) ; le profil de la trace que j'ouvre (le
  même profil s'ouvre chez eux, et se ferme quand je le ferme). Les forêts ne suivent pas (recherche à la demande). Une seule personne montre à la fois : si Luc
  allume la sienne, celle de Julie s'éteint. Un buddy qui arrive en cours reçoit tout de suite la vue et les traces.
  Envoi (Seb, 27/11 : le suivi se figeait au bout de quelques secondes) : pas de file qui grossit ; par nature
  (traces, trait, profil) seul le dernier état attend, un seul envoi en route à la fois ; la vue part en rapide
  (perte acceptée) ; tout l'état repart toutes les 4 s pour rattraper un message perdu.
  Les tuiles ne voyagent pas : chacun charge la même zone (un appel demande du réseau). Messages de données LiveKit
  `carte`, `traces`, `carteFin` (`capacitor/src/buddies/CarteSuivie.tsx`).
- **🗺 Montrer sa carte en s'écrivant, sans appel** (Seb, 27 novembre, maquette `messagerie.png`) : hors appel, l'icône
  carte en haut de la conversation envoie un message « carte » dans le fil (nature `carte`, notification comme un
  message, phrase entière : « Seb a partagé sa carte dans <groupe> », « … avec toi » à deux ; Seb, 27/11). Quand Seb
  arrête (ou qu'un appel prend la place), un message `carte_fin` part aussi : « Seb a arrêté de partager sa carte
  dans <groupe> », et la bulle de départ n'offre plus Suivre. En appel aussi (Seb, 27/11), ceux qui sont en ligne reçoivent
  « Seb a partagé sa carte dans <groupe> » quand j'allume ma carte, et « … a arrêté de partager sa carte » quand je
  l'éteins ou raccroche (`POST /appels/{id}/carte`, notification seule, rien dans le fil). L'icône carte est dans la
  barre dès « Appel pour <groupe>… » (Seb, 27/11) : touchée avant qu'ils décrochent, elle s'allume et ma carte part dès que
  quelqu'un décroche (un 2e appui annule). Chez les autres, la bulle dit « Seb partage sa carte » avec
  Non merci / Suivre (la demande vaut 4 h). Suivre : la conversation descend et la carte suit celle de Seb, comme
  en appel (vue, fond, traces, calques, trait, profil) ; on continue de s'écrire, on ne se parle pas. L'icône du haut
  devient le badge de Seb avec la petite carte, un appui arrête ; Seb arrête en touchant l'icône (allumée) ou
  « Arrêter » sur sa bulle, et le suivi s'arrête chez tous. À l'arrêt : « Garder les traces de Seb ? ». Une pastille
  verte en haut de la carte reprend l'icône ou le badge quand la messagerie est fermée. Un vrai appel (passé ou
  reçu) remplace la carte montrée. Technique : une salle LiveKit muette par message (`carte-<id>`, sans micro, 4 h),
  jeton par `POST /cartes/{message}` (seulement les membres de la conversation).
- **📞 « Appeler qui ? »** (Seb, 27 novembre, maquette `maquettes/appeler-qui/`) : le 📞 de la colonne, quand aucun
  groupe ni sortie n'est ouvert, ouvre une feuille par-dessus la carte : « Chercher un nom » en haut (sans accents ni
  majuscules), puis les groupes et sorties en cours ou à venir (derniers appelés d'abord, gardés sur le téléphone,
  puis dernière activité), puis les buddies un par un (l'appel passe par la discussion à deux). Un appui = appel.
- **Ce qui part chez ceux qui suivent** (Seb, 27 novembre : « tout ce qui est dans mon écran ») : toutes mes traces
  affichées, puis les autres traces (randos…) qui passent dans l'écran, 15 au plus, allégées à 500 points en tout
  (30 au moins par trace). Le contenu part, pas seulement l'identifiant : l'autre ne les a pas.
- **🗺 Partager ma carte : une icône sous la loupe** (Seb, 27 novembre ; remplace l'icône de la barre d'appel et du
  haut de la messagerie, et le « Suivre » du fil). Le partage est indépendant de l'appel et des messages. Un appui :
  « Partager ma carte avec qui ? » (groupes et sorties, puis buddies ; derniers choisis d'abord ; même feuille que
  « Appeler qui ? »). En appel, il partage directement avec l'appel (ou dès qu'ils décrochent). Verte pendant le
  partage ; un appui arrête. Chez les autres, une seule proposition : une fenêtre dans l'appli, par-dessus l'écran en
  cours, sans rien fermer, « Sébastien partage sa carte » **Non merci** / **Suivre** (la carte suivie s'affiche) ;
  pendant un appel, ceux qui n'y sont pas ont **Rejoindre**. Appli fermée : une notification simple qui ouvre l'appli
  sur cette fenêtre. Technique inchangée : message `carte` (caché du fil et des non-lus), salle muette, push `carte`
  et `carte_appel`.
- **Trait en direct** (Seb, 27 novembre : « ça s'écroule quand on trace ») : chez celui qui suit, le trait a son
  propre petit calque (seule sa ligne est redessinée) ; les traces reçues ne sont redessinées que si elles changent.
  Chez celui qui dessine, seul le nouveau point est converti à chaque mouvement.
- **📓 Journal** (Seb, 27 novembre) : les appareils notent en mémoire (4 000 lignes, gardées sur le téléphone) les
  messages de carte envoyés et reçus (nature, taille, délai), les blocages, les reconnexions, et toutes les 15 s la
  route réseau (UDP direct ou TCP / relais), l'aller-retour, les paquets de voix perdus et la gigue. « Envoyer le
  journal », sous « Partager ma carte avec qui ? », le partage en fichier texte.
- **Montrer du doigt** (Seb, 27 novembre) : pendant l'appel ou la carte partagée, un appui long sur la carte pose MON
  repère : une épingle fine, de ma couleur, dont la pointe est l'endroit exact, sous « ✋ Sébastien montre » (même
  texte chez tous). Un seul repère par buddy : un nouvel appui long le déplace. Appui long sur mon repère puis glisser : il
  bouge, et les autres le voient bouger en direct. Appui bref dessus : une ✕ pour l'enlever. Chez les autres, la carte
  se centre sur un nouveau repère. Tout s'efface quand on quitte l'appel. Technique : état écrasable par buddy
  (`{doigt, dn}`, numéro croissant ; glissé en « rapide », position lâchée en « sûr »), renvoyé à qui arrive.
- **iPhone** : pas encore de sonnerie (il faudra CallKit et un compte Apple Developer) ; on rejoint par la ligne
  « Appel en cours ».
- **Serveur** : tables `appareils` (jeton Firebase de chaque téléphone) et `appels` (Groupe ou sortie, qui
  a appelé, qui est en ligne, début, fin) ; routes `POST /appareils`, `POST /appels` (appeler ou rejoindre l'appel
  en cours), `POST /appels/{id}/rejoindre`, `POST /appels/{id}/presence`. Un appel finit quand plus personne n'est en
  ligne (ou au bout de 4 h) ; la synchro rend les appels en cours. Installation : `deploy/comptes/installer-appels.sh`.

### 7.11 Bloc 11 : ce qui est construit (23 novembre 2026)

- **Bud parle seulement si on l'appelle** : un message qui contient « Bud, … » (ou « Bud : … », écrit ou dicté ; « Buds » aussi, souvent entendu par la dictée)
  part comme les autres, puis le téléphone pose la question à Bud. Pendant qu'il cherche : une bulle « 🐻 Bud … ».
- **Sa réponse est un message de la conversation**, vu de tous, dans sa bulle à part (sombre, « 🐻 Bud », toujours à
  gauche) : il ne se fait jamais passer pour un buddy. Le message est enregistré au nom de celui qui a demandé, avec
  la marque Bud (colonne `bud` de `messages_buddies`).
- **Il propose, les buddies décident** : les hébergements qu'il trouve (recherche web) sont proposés dans « Où on
  dort ? » de la sortie et posés sur la carte (♥ et ✅ comme les autres) ; un endroit précis (col, parking…) arrive
  en carte « 📍 … · voir sur la carte ». Il ne réserve, ne paie et ne décide rien.
- **Ce qu'il sait** : ce que le téléphone connaît de la conversation, envoyé avec la question : la sortie (dates,
  lieu, qui vient, invités), les traces partagées (longueur, départ, arrivée), les hébergements proposés et leurs ♥,
  le Buddy count (qui doit quoi), les plannings de la bande et les 30 derniers messages.
- **Pas encore** : la pente ou l'altitude d'une trace (les traces partagées n'ont pas l'altitude : Bud le dit), le
  tronçon « montré en rouge » de la maquette. Les actions de Bud : §7.12.
- **Réseau et coût** : besoin de réseau ; passe par le relais (`deploy/ia/relais.py`, route `/bud`, même mot de passe
  et même limite par jour que les recherches) ; son coût s'ajoute à l'écran 📊 (ligne « Bud »).

### 7.12 Bud peut aussi agir (choix de Seb, 23 novembre 2026)

- Sur demande claire de celui qui lui parle (« Bud, ajoute le gîte, 120 €, payé par Julie », « Bud, crée une
  sortie samedi 6 février à Belledonne », « Bud, mets-moi oui pour le 10 janvier »), Bud fait **trois choses, en son
  nom** : une dépense du Buddy count de cette sortie (qui paie et pour qui : des participants), une sortie dans
  cette bande, sa propre dispo à un planning de la bande (jamais celle d'un autre). Trois actions au plus par réponse.
- Sous la bulle de Bud : la liste de ce qui est fait (« ✓ 💶 Gîte · 120 € ») et **« Annuler »** (sur le téléphone de
  celui qui a demandé) : la dépense est retirée, la dispo revient comme avant, la sortie est retirée si elle n'a pas
  encore servi (opération `retirer_sortie` : seulement son créateur, et seulement sans trace, photo, dépense, message
  ni hébergement).
- **Changer le nom d'une sortie** (Seb, 25 novembre 2026) : « Bud, renomme ce BT en Raquettes au Queyras » ;
  « Annuler » remet l'ancien nom.
- **Appeler Bud à la voix** (Seb, 25 novembre 2026) : la dictée écrit souvent « bad », « budd », « bod »… En tête
  de message, ces variantes appellent Bud aussi, avec ou sans « OK », « hey », « dis » devant (« OK Bud » marche sans
  être obligatoire). « Buddy » n'appelle pas Bud.
- **Abréviations** (Seb, 25 novembre 2026) : Bud comprend « BT » (sortie), « BG » (groupe) et « BC » (Buddy
  count, les comptes communs). Depuis le 26 novembre il comprend aussi les anciens noms « Buddy Time » et
  « Buddy Group », et répond avec « sortie » et « groupe ».
- **Supprimer une sortie** (Seb, 25 novembre 2026 : « Bud doit pouvoir supprimer des sorties ») : « Bud,
  supprime cette sortie » (dans sa conversation) ou « Bud, supprime la sortie Queyras » (dans celle de la bande,
  où Bud voit la liste de ses sorties). Seulement **celui qui l'a créé ou un admin du groupe**. Même s'il a
  déjà servi : rien n'est effacé, il est caché de tous (colonne `sorties.supprime_le`, opération `supprimer_sortie`) et
  plus rien ne s'y ajoute ; « Annuler » le remet chez tous avec ses traces, photos, dépenses et messages (opération
  `remettre_sortie`).
- Ce qui sort de ces règles (un buddy hors de la sortie, une date hors du planning…) n'est pas fait : un message le dit.

### 7.13 La messagerie d'AppBase reprise telle quelle (Seb, 24 novembre 2026)

Seb : « il faut vraiment reprendre ma messagerie telle quelle » (`silvaplana/contretemps`, `backend/src/messagerie/`,
`screens/messagerie/`). On garde ce qui est propre aux Buddies : Bud, traces et hébergements en cartes, carte au-dessus,
envoi sans réseau. Quatre étapes, une PR chacune :

1. **La discussion** (fait) : appui long (ou clic droit) sur un message, la barre du haut montre le nombre choisi,
   toucher d'autres bulles les ajoute. **Répondre** (un message ; rappel au-dessus de la saisie, ✕ pour renoncer ;
   toucher le rappel dans la bulle remonte au message), **Copier**, **Modifier** (son message texte, 15 minutes après
   l'envoi, « modifié » à côté de l'heure), **Supprimer** (ses messages, ou tous pour un admin du groupe, aussi
   dans ses sorties ; « Annuler » 10 secondes ; chez tous : « Ce message a été supprimé »), **réagir** (rangée
   👍 ❤️ 😊 😂 😮 🙏 et + au-dessus du message choisi ; une par buddy, toucher la sienne la retire ; sous la bulle les
   émojis et leur nombre, les toucher : qui a réagi). Coches sous mes messages : 🕓 pas parti, ✓ envoyé, ✓✓ reçu
   (tous ont synchronisé depuis), ✓✓ bleues lu (tous l'ont lu). 🙂 : émojis à insérer (ceux d'AppBase, montagne au
   lieu de danse). Liens cliquables, séparateurs « Aujourd'hui », « Hier », date. Entrée va à la ligne sur téléphone.
   Serveur : colonnes `repond_a`, `edite_le`, `supprime` de `messages_buddies` ; tables `reactions_buddies` et
   `lectures_buddies` (jusqu'où chacun a lu chaque conversation) ; opérations `modifier_message`, `reagir`, `lu` ;
   `retirer_message` garde la bulle (supprimée). « Reçu » = dernière synchro du buddy (`utilisateurs.vu_le`).
   **🎤 Dictée dans l'appli** (choix de Seb : « Dictée dans l'appli, gratuite ») : plus de fenêtre Google ; l'onde
   bouge dans la saisie, les mots s'écrivent pendant qu'on parle, ■ pour arrêter (ou deux silences). Android :
   SpeechRecognizer, hors ligne quand le téléphone a le français. Même dictée pour le récit du carnet.
2. **Discussions à deux et liste des discussions** (fait) : 💬 Messages liste toutes les discussions (Groupes,
   sorties, discussions à deux), la plus récente en haut (une vide se classe à sa création), avec non lus et
   « Julie écrit… ». Recherche : « Discussions » puis « Contacts » (toucher un buddy ouvre la discussion à deux). Gros
   ＋ orange : « Nouvelle discussion » (« Nouveau groupe » en tête, puis mes buddies par ordre alphabétique avec
   leurs bandes). Une discussion à deux est toujours la même pour deux buddies : un groupe de nature « duo »
   (identifiant uuid5 des deux comptes, le même calculé par le téléphone, donc possible hors ligne), seulement entre
   buddies d'une même bande ; il n'apparaît pas dans la liste des groupes. En haut d'une discussion : « écrit… »,
   puis « en ligne » (synchro il y a moins de 30 s) ou « vu aujourd'hui à 10 h 42 » ; dans un groupe « Julie en
   ligne » / « 2 en ligne ». Conversation ouverte : synchro toutes les 5 s. « écrit… » passe par `POST /buddies/ecrit`
   (gardé 12 s en mémoire du serveur, jamais en file d'attente).
3. **Sondages, fichiers et vidéos, Transférer** (fait) : saisie dans une seule bulle [🙂 Message 📎 🎤 / ➤], icônes au trait, 📎 s'efface quand on écrit (Seb 27/11, maquettes/saisie-message version B) ; 📎 ouvre 📷 Photo, vidéo
   (dans une sortie : photo de l'album, comme avant), 📍 Ma position, 📄 Fichier, 📊 Sondage. Une photo jointe est
   réduite à 1600 px et s'ouvre en plein écran ; une vidéo se lit dans la bulle (▶) ; un document (nom, taille)
   s'ouvre avec l'appli du téléphone. Limites d'AppBase : 25 Mo par fichier, 100 Mo par vidéo. Sans réseau, le
   fichier attend sur le téléphone (🕓) et part avec le message. **Sondage** : une question, 2 à 10 réponses,
   « Plusieurs réponses possibles » (coché par défaut) ; toucher une réponse vote, la retoucher retire le vote ; barre
   et nombre par réponse, « Voir les votes » dit qui. **Transférer** (barre de sélection) : « Envoyer à… » une ou
   plusieurs conversations ; la bulle porte « ↪️ Transféré » (pas pour un sondage, une photo d'album ou Bud ; un
   fichier transféré n'est pas renvoyé, le serveur vérifie qu'on peut le lire). Serveur : colonnes `fichier_id`,
   `sondage` (JSON), `transfere` de `messages_buddies` ; tables `fichiers_buddies` et `votes_buddies` ; opération
   `voter` ; `PUT`/`GET /buddies/fichiers/<id>` (lisible par qui peut lire un message qui le montre).
4. **Notifications des nouveaux messages** (fait, Android) : chaque nouveau message prévient les autres buddies de la
   conversation (pas son auteur, une seule fois même renvoyé) par Firebase, comme la sonnerie des appels (même clé,
   gardé un jour si le téléphone est hors réseau). Appli fermée : une notification par conversation (titre : le
   groupe, la sortie, ou le buddy pour une discussion à deux ; ses 6 derniers messages « Julie : … ») ; la
   toucher ouvre la conversation (celle d'une sortie sur sa carte) ; elle s'efface quand on ouvre la conversation.
   Appli ouverte : pas de notification, le message arrive tout de suite. Android 13 : l'autorisation est demandée
   une fois. Sans clé Firebase sur le VPS, rien ne part (la messagerie marche quand même). iPhone : à faire (APNs).

Pas de message vocal : la messagerie d'AppBase n'en a pas.

### 7.14 📍 Ma position depuis la colonne de Buddies (Seb, 25 novembre 2026)

- **Demande de Seb** : « dès qu'on est dans Buddies, il faut dans le menu à droite pouvoir partager pareillement,
  même si on n'est pas dans une sortie ».
- **Colonne, un interrupteur (Seb, 26/11)** : juste sous 📞, un point et des ondes au trait, immobiles : grisées
  éteint, en gras allumé (rond plein ardoise). Un appui allume : partage avec la sortie ouverte, sinon le groupe
  ouvert, sinon tous mes groupes ; un appui éteint partout. Un message de 3 secondes : « Ta position est partagée :
  les buddies de La Ciotat ski club (ou « de tous tes groupes ») te voient jusqu'à 19 h, s'il y a du réseau. » ou
  « Ta position n'est plus partagée : plus personne ne te voit. ».
- **Appui long : écran « Ma position »** (simplifié le 26/11, Seb ne comprenait pas l'écran de choix) : en haut, ma
  position partagée ou non (avec qui, jusqu'à quelle heure) ; « Qui me montre sa position » : les buddies visibles,
  un toucher montre la carte centrée sur lui ; un seul bouton « Partager ma position » / « Arrêter de partager »,
  qui fait comme l'icône. Plus de choix des groupes un par un.
- **Même mécanique** que §7.7 : toutes les 5 minutes, écran éteint compris, jusqu'à 19 h, sans réseau la dernière
  attend. Toujours une seule épingle : l'enfoncer ici relève celle d'une sortie, et inversement ; une même
  position part vers chaque groupe choisi.
- **Serveur** : table `positions_groupes` (Groupe, buddy, mêmes colonnes que `positions`) ; les opérations
  `epingle` et `position` prennent `groupe` à la place de `sortie`. Seuls les membres du groupe s'y épinglent et
  voient ces positions (pas le Me Time) ; oubliées après 48 h comme les autres.
- **Sur la carte principale, toujours** (Seb, 27/11 : la position partagée depuis le PC ne se voyait pas sur le
  téléphone) : les buddies qui me montrent leur position en ce moment y ont une simple épingle rouge (même dessin
  que les épingles des traces, Seb 27/11 : pas de gros rond aux initiales), avec l'étiquette « pseudo · heure »
  précédée d'une petite photo, sinon des initiales « SR » (Seb, 27/11), comme
  les voitures, sans passer par la liste. Rien ne se superpose (Seb, 27/11) : épingles et voitures au même endroit
  s'écartent juste autour de leur endroit (cercles de plus en plus grands), reliées à leur vrai point par un fin trait
  terminé par un rond, sans couvrir mon point bleu, à chaque image du zoom ; la voiture a une aiguille dont le rond
  touche l'endroit exact, et plus d'heure au-dessus (l'appui la montre), et leurs étiquettes s'empilent vers le haut, au-dessus des
  icônes ; refait à chaque zoom. Synchro toutes les 2 minutes, appli ouverte, pour recevoir positions et voitures garées.
- **Push silencieux** (Seb, 27/11) : garer ou enlever sa voiture, allumer ou éteindre sa position envoie aux membres
  de mes groupes un message Firebase `type: synchro`, sans rien afficher ; appli à l'écran, elle se synchronise
  tout de suite. Pas pour chaque position (toutes les 5 min). La synchro de 2 minutes reste en filet (et pour
  l'iPhone, sans push).

### 7.15 👥 Associer une trace à une sortie (Seb, 25 novembre 2026)

- **Demande de Seb** : « il faut pouvoir associer une trace à un buddy group et plutôt même un buddy time » ; proposer
  d'abord le groupe ou la sortie ouverts, puis les derniers ouverts. Et l'autre sens : depuis une sortie, voir
  ses traces associées et en associer une en regardant dans le répertoire des traces. Maquette :
  `maquettes/trace-buddy-time/`.
- **Depuis la trace** : tout en bas de son menu (Seb, 25/11), une ligne « 👥 Associer à une sortie » (pointillés), puis, une fois associée,
  la vignette de la sortie, son nom et « Groupe · changer ». Le panneau : « Proposés » (la sortie ouverte sur
  la carte, déjà choisi, marqué « ouvert », puis les derniers ouverts, puis ceux à venir), puis « Ou chercher dans un
  groupe » (les derniers ouverts d'abord, Me Time compris) ; un groupe montre ses sorties (à venir puis
  souvenirs) et « Le groupe seulement ». « Enlever » défait le lien.
- La même ligne est aussi en bas du panneau ✏ « Modifier » (Seb l'y cherchait, 25/11), tant qu'aucun outil n'est choisi.
- **Depuis la sortie** : dans son bandeau sur la carte et dans son carnet, « 〰 Traces associées » (toucher = la
  voir sur la carte) et « ＋ Associer une de mes traces », qui ouvre 📂 Mes traces (celles enregistrées).
- **Ce que fait le lien** : la trace est partagée dans la sortie (op `partager_trace`, rien de neuf au serveur)
  et apparaît sur sa carte chez tous ; le lien est gardé avec la trace (`lien` : Groupe + Sortie, dans
  `tracesAffichees` et `tracesEnregistrees`) ; le film 🎥 prend les photos de l'album de cette sortie même s'il n'est
  pas ouvert. Une trace ouverte depuis une sortie arrive déjà associée.
- **Petit plan « La trace » du carnet** : la trace est posée sur un fond Plan IGN (Seb, 25/11), tuiles gardées sur le
  téléphone d'abord (hors ligne), sinon le réseau ; sans rien, le fond beige reste.
- **Derniers ouverts** : gardés sur le téléphone (`localStorage` « buddiesOuverts ») quand on ouvre un groupe,
  la carte d'une sortie, son album, son carnet, son Buddy count ou son hébergement.
- **Pas encore** : une trace modifiée après l'association n'est pas renvoyée (on l'associe à nouveau) ; une trace
  associée depuis la sortie ne change pas le lien de sa copie déjà affichée sur la carte.


### 7.16 🐻 Bud choisit les photos du carnet (Seb, 25 novembre 2026)

- **Demande de Seb** : « quand on est dans tout l'album et qu'il faut sélectionner pour le carnet, est-ce que tu peux
  utiliser un appel à l'IA pour qu'il sélectionne les 8 meilleurs et sans doublon ? » Décision (Seb, « Ok ») : les 8
  sont mises directement en ⭐, donc dans le carnet, et restent retouchables ; « Annuler » remet les ⭐ d'avant.
- **À l'écran** (album d'une sortie, dès qu'il a plus de 8 photos) : un bouton « 🐻 Bud choisit les 8 meilleures »
  au-dessus de « Déposer mes photos ». Pendant qu'il regarde : « Bud regarde les photos… ». Ensuite l'album passe sur
  « ⭐ Carnet » avec la ligne « Bud a gardé 8 photos pour le carnet. Tu peux en changer avec ⭐. · Annuler ».
  Jamais le mot « IA » : c'est Bud.
- **Nombre réglable et photos non retenues** (Seb, 26/11) : « − » et « ＋ » de part et d'autre du bouton changent le
  nombre (8 par défaut, de 1 à 12, toujours moins que le nombre de photos ; bouton dès 3 photos). Après le choix,
  l'album reste sur « Toutes » : les photos sans ⭐ restent visibles, en plus pâle, avec la ligne « Bud a gardé n
  photos ⭐ pour le carnet de la sortie. Les autres restent dans l'album, mais ne seront pas dans le carnet de la
  sortie. Tu peux changer avec ⭐. · Annuler ».
- **Comment** : le téléphone envoie les petites images (400 px) des photos, pas les films, avec leur date ; au-delà
  de 90 photos, une sur n répartie sur la sortie. Le relais (`POST /photos-choix`, `deploy/ia/relais.py`) les montre
  en une seule demande et rend les numéros retenus : nettes, bien cadrées, variées, jamais deux presque pareilles.
  Le choix remplace les ⭐ d'avant (op `etoile` existante, rien de neuf au serveur des comptes) : tout le groupe le voit.
- **Coût** : compté dans la limite du jour du relais et dans 📊 (ligne « Bud choisit les photos du carnet ») ;
  environ 1 à 2 centimes pour 15 photos, 5 à 8 centimes pour 60.
- **Pas encore** : il faut du réseau ; Bud ne voit que les petites images (un léger flou peut lui échapper).

### 7.17 Rôles, club et Groupe perso, comme AppBase (Seb, 26 novembre 2026)

- **Demande de Seb** : les mêmes rôles qu'AppBase (Super User, Administrateur principal, Admin, Membre ; « élève »
  devient « membre »), même si certains ne servent pas encore, pour qu'AppBase puisse un jour passer sur Logto avec
  la même structure.
- **Trois étages.** L'**appli** : tout le monde y a un seul profil, et le Super User (Seb) est au-dessus de tout. Le
  **club** (`organisations`, facultatif) : l'organisation d'AppBase, qui regroupe des Groupes-sections (ski de rando,
  escalade…). Le **Groupe** : une bande de copains sans club, ou une section d'un club. Une Sortie est toujours dans un
  Groupe. Différence avec AppBase : **rien n'est étanche**, on est dans plusieurs Groupes et clubs avec le même
  profil, et des espaces communs viendront (forum matériel, messages entre membres). Le club dit seulement quels
  Groupes sont à lui et qui l'administre. **Aujourd'hui aucun club n'existe** et il n'y a pas d'écran de club :
  tous les Groupes ont `organisation_id` vide.
- **Où vivent les rôles** : dans la base du serveur des comptes, pas dans Logto (Logto ne garde que l'identité).
  `deploy/comptes/droits.py` est le seul endroit qui les lit, comme `comptes/roles.py` d'AppBase ;
  `estAdmin`, `estAdminPrincipal` et `peutRetirer` dans `capacitor/src/buddies/store.ts` côté appli.
- **Ce que fait chaque rôle dans un Groupe** (règle de Seb : « le membre peut tout créer, seul l'admin peut
  supprimer ce qu'ont fait les autres ») :
  - **Membre** : tout créer (Groupe, sortie, trace, photo, dépense, hébergement, planning, message), inviter,
    renommer le Groupe, retenir l'hébergement ✅ ; il ne retire que ce qu'il a apporté lui-même.
  - **Admin** : en plus, retirer un membre, supprimer la sortie, le message, la photo, la dépense ou l'hébergement
    d'un autre. Retirer (Seb, 27 novembre) : dans « Dans le groupe », un appui (ou un appui long, comme WhatsApp)
    sur le buddy → « Retirer du groupe » → confirmation « Retirer X du groupe ? » ; le retiré ne voit plus le
    Groupe ni ses sorties à sa synchro suivante. L'appli ne propose jamais de retirer l'admin principal. Chacun
    peut aussi partir seul avec « Quitter le groupe ».
  - **Admin principal** (un seul : le créateur) : en plus, nommer un admin, retirer le rôle d'admin, retirer un
    admin du Groupe, passer son rôle à un autre (il reste admin). Personne ne le retire, sauf le Super User. S'il
    quitte le Groupe, le rôle passe à l'admin le plus ancien, sinon au membre le plus ancien.
  - **Super User** : tout, dans tous les Groupes, même sans en être membre (il ne les voit pas pour autant).
  - Les mêmes rôles existent dans un club (`roles_organisation`, cumulables comme dans AppBase) : un admin du club
    agit comme un admin dans les Groupes du club, son admin principal comme leur admin principal.
- **Super User** : `docker exec mb-api python super_user.py <e-mail>` sur le VPS (`--retirer` pour l'enlever),
  jamais depuis l'appli. La personne doit s'être connectée une fois. La synchro le dit à l'appli
  (`roles.super_user`), sans écran pour l'instant.
- **Groupe perso « Seul »** (Seb : « je ne vais pas me créer un groupe de moi seul ») : dans ＋ Sortie, la ligne
  « Seul » en haut. La première fois, l'appli envoie la sortie vers `seul` et le serveur crée le Groupe perso,
  sans nom, dont on est l'admin principal ; ensuite il resservira. Tant qu'on n'est pas sorti seul, il n'existe pas.
  Il s'affiche « Seul · Mes sorties à moi », sans crayon. Les anciens Me Time (créés avant le 26 novembre) restent
  effacés à la synchro comme décidé le 25.
- **Reprise des Groupes existants** (au démarrage du serveur) : la colonne des rôles s'élargit, et chaque Groupe sans
  admin principal en reçoit un : son créateur s'il en est encore admin, sinon l'admin le plus ancien.
- **Pas encore** : écran de club, écran du Super User, suppression d'un Groupe entier.

### 7.18 👤 Profil comme AppBase (Seb, 26 novembre 2026)

- **Demande de Seb** (capture du Profil d'AppBase) : pastille aux initiales, nom, e-mail, rôle, puis des rubriques ;
  dans la fiche, comme le cœur d'AppBase : prénom, nom, téléphone, e-mail, IBAN, le téléphone et l'IBAN facultatifs.
- **À l'écran** (👤, titre « Profil ») : pastille (photo, sinon initiales « SR »), « Prénom Nom » (sinon le pseudo),
  l'e-mail, le rôle (« Super User » ou « Membre »). Rubriques : **Mes infos** (Prénom, Nom, Pseudo vu par les amis,
  Téléphone facultatif), **Remboursements** (« Mon IBAN (facultatif, pour les remboursements) », « J'ai Wero »),
  **Paramètres** (synchro, point décalé du doigt, côté des icônes), puis Se déconnecter.
- **Ma photo** (Seb, 27/11) : un appui sur la pastille pour prendre une photo ou la choisir (réduite à 256 px),
  « Retirer ma photo » dessous. Par défaut, la photo du compte Google ; celle choisie prime, et une photo retirée
  ne revient pas (`""` en base). **Initiales partout** (ronds du planning, groupes, messagerie, voitures, étiquettes
  des positions) : prénom + nom du profil (« SR » pour Sébastien Richard), sinon une lettre par mot du pseudo ; le
  serveur envoie seulement `initiales` aux buddies, pas le prénom ni le nom.
- **Hors ligne** : chaque champ s'enregistre quand on le quitte, tout de suite sur le téléphone, et part au serveur au
  retour du réseau (même file que le pseudo, `attente` de `compte/auth.ts`). L'e-mail vient de la connexion (Logto).
- **Serveur** : colonnes `prenom`, `nom`, `telephone`, `iban` de `utilisateurs`, `GET/PUT /moi`. L'IBAN est vérifié
  comme dans AppBase (forme et clé, ISO 13616), aussi sur le téléphone avant l'envoi ; vide = effacé. Téléphone et
  IBAN ne sont envoyés qu'aux buddies qui leur doivent de l'argent (ci-dessous).
- **Wero et remboursement (Seb, 26 novembre)** : sous l'IBAN, case « J'ai Wero » (par défaut le portable du profil)
  et « Numéro Wero, si différent » (numéro ou mail). Phrase sous les champs : « Seuls les buddies d'une sortie qui te
  doivent de l'argent les voient, pour te rembourser. » Le serveur calcule les soldes de chaque sortie et envoie, dans
  la synchro (`paiements`), l'IBAN et le Wero de ceux à qui je dois, seulement si je leur dois. Dans le Buddy count,
  sous « qui doit à qui » : « Rembourser Julie », « par Wero : 06… » et/ou « par virement : FR76 … », chacun avec
  Copier, seulement ce qu'elle a renseigné ; sinon « Julie n'a pas renseigné son Wero ni son IBAN ».

## 8. Hors périmètre pour l'instant

- Le calcul des péages et la comparaison avec ViaMichelin : laissé de côté. **(Seb)**
- Le vote de dates. **(Seb)**
- Un annuaire des utilisateurs. **(Seb)**
- ~~Le détail de la messagerie.~~ Repris d'AppBase (§7.13).

## 9. Points ouverts

1. ~~Le nom « Me Time »~~ : Me Time retiré (25 novembre 2026).
2. La portée de la colonne dans la liste (tous mes buddies à la fois) : à confirmer.
3. ~~📍 dans la colonne~~ : faite pour tout Buddies (§7.14). L'icône 📖 en plus dans une sortie, et la prochaine sortie en grand en
   haut de la liste : à confirmer.
4. Ce que montre 📅 à l'intérieur d'une sortie (ses dates et qui vient ?).
5. Bud : les règles du §5.12 sont construites telles quelles (bloc 11, §7.11), visage 🐻 ; ce qu'il a le droit de
   faire : sur demande, une dépense, une sortie, sa propre dispo, avec « Annuler » (choix de Seb le 23 novembre, §7.12).
6. ~~La recherche d'hébergement affiche « Chercher (IA) » et « Claude cherche… »~~ : reformulée (« 🔍 Chercher »,
   « Je cherche les meilleurs prix… »), accord de Seb le 23 novembre. Même chose pour la recherche de randos sur le web, le coût du
   voyage (carburant, péages), la lecture de facture et l'aide des icônes. Seul l'écran 📊 du menu (usage et coûts,
   pour Seb) garde ses mots techniques.
### 7.19 🚗 Retrouver ma voiture (Seb, 26 novembre 2026)

- **Appui long sur 🚗** (colonne) : la voiture est garée là où est le téléphone ; l'icône devient la voiture avec une
  épingle posée dessus, sur fond ardoise. Message : « Ta voiture est garée ici. Tes buddies la voient aussi, jusqu'à
  minuit. ». Un nouvel appui long l'enlève (« Ta voiture n'est plus sur la carte. ») ; l'appui court ouvre toujours le
  voyage en voiture.
- **Sur la carte** (la mienne et celles des buddies de mes groupes) : la petite voiture rouge 🚗 en gros, posée là
  où elle est garée, avec un badge aux initiales du propriétaire (rouge pour la mienne, ardoise pour un buddy) et
  l'heure au-dessus (Seb, 27 novembre, version A de maquettes/voiture-carte/).
- **Une journée** : elle s'efface seule à minuit (heure du téléphone).
- **Serveur** : table `voitures` (une par buddy : lat, lon, `garee_le`, `jusqu` en ms) ; opération `voiture`
  `{garee: true, lat, lon, garee_le, jusqu}` ou `{garee: false, quand}` ; la synchro rend `voitures` (la mienne et
  celles des membres de mes groupes, oubliées après 48 h).
- **Chacun sa voiture** (Seb, 27 novembre, maquettes/voiture-modele/, style A) : Profil › « Ma voiture » ouvre une
  feuille : marque et modèle (texte libre, la liste propose les modèles connus avec leur silhouette), la silhouette
  (citadine, berline, break, SUV, van, camping-car, pick-up, cabriolet), proposée d'après le modèle et modifiable, et
  la couleur (8 au choix). Sur la carte, la voiture garée prend cette silhouette et cette couleur, contour blanc,
  badge des initiales et heure comme avant ; un appui montre « Julie · garée à 9 h 05 » et « Dacia Duster bleue ».
  Sans silhouette choisie : la voiture rouge d'avant. Pas de photo ni d'IA : les silhouettes sont dessinées dans
  l'appli (`buddies/voitureDessin.ts`, avec la table modèle → silhouette), tout marche hors ligne.
  Serveur : colonnes `utilisateurs.voiture_modele`, `voiture_forme`, `voiture_couleur` (PUT /moi, vide = effacé) ;
  chaque voiture de la synchro porte `modele`, `forme`, `couleur` de son propriétaire.
- **Voitures en 3D** (Seb, 27 novembre) : carte inclinée (relief allumé), chaque voiture garée devient une petite
  maquette posée sur le relief à sa position, de la silhouette et de la couleur du profil (citadine rouge si rien
  n'est choisi). Huit maquettes stylisées faites de blocs (roues, caisse, vitres, toit) extrudés par la carte
  (`buddies/voitures3d.ts`) : rien à télécharger, hors ligne. Toujours vue de profil, l'avant à droite comme en 2D,
  à taille fixe à l'écran (~90 px). Le dessin à plat s'efface ; initiales, heure et appui pour le détail restent.

### 7.20 Buddy counts de groupe et de sortie (Seb, 26 novembre 2026)

- **L'icône Buddy count** (colonne) ouvre la liste : « Buddy counts de groupe » d'abord, puis « Buddy counts de
  sortie » ; dans chaque partie, les ouverts en tête. Un cadenas au trait dit « Ouvert » (pastille ardoise) ou
  « Fermé » (pâle, la ligne pâlie). Dans une sortie, l'icône ouvre directement le Buddy count de la sortie.
  **Retouches (Seb, 26 novembre)** : deux parties, comme ailleurs, « Groupe » puis « Sortie », toujours montrées
  (vide : « Pas encore de Buddy count de groupe », « Pas encore de sortie ») ; dans la liste, la pastille « Ouvert »
  devient un petit cadenas seul (ouvert, pâle ; fermé, foncé), en attendant que Seb regarde Tricount ; le bouton
  « Mes partages de frais hors sortie » est retiré (l'ancien partage local n'est plus atteint de là).
  **Plus d'ouvert/fermé (Seb, 26 novembre, peu après : « ils existent tout le temps »)** : ni cadenas, ni « Fermer » /
  « Rouvrir », ni tri par état ; tout Buddy count prend des dépenses. Le serveur garde la colonne `ferme` et l'opération
  (vieux téléphones) mais ne refuse plus rien pour un Buddy count fermé. Ce qui suit sur Fermer ne vaut plus.
- **＋ Buddy count** (liste ouverte depuis un groupe) : un nom, « Créer » ; c'est un Buddy count de groupe, plusieurs
  par groupe, partagé entre les membres. Une sortie a toujours un seul Buddy count, à son nom.
  **Deux boutons (Seb, 26 novembre, plus tard)** : en bas de la liste, « ＋ Buddy count pour <groupe> » et « ＋ Buddy
  count de sortie » (hors d'un groupe : « de groupe », qui fait choisir le groupe, et « de sortie »). Depuis un groupe,
  le premier crée tout de suite un Buddy count au nom du groupe, puis « <groupe> 2 », « 3 »… (crayon pour renommer).
  Le second demande « Pour quelle sortie ? » parmi les sorties qui n'en ont pas encore. Dans la liste, la partie
  « Sortie » ne montre que les sorties dont le Buddy count a été créé ou a déjà une dépense (vide : « Pas encore de
  Buddy count de sortie ») ; l'icône Buddy count dans une sortie l'ouvre toujours directement.
- **Un Buddy count** : « Buddy count de groupe » ou « de sortie » sous le titre ; crayon (renommer, de groupe),
  poubelle (seulement un admin du groupe ; caché chez tous, rien n'est effacé) ; « Fermer » (tout membre) : on voit
  tout, plus de « ＋ Dépense » ni de changement ; « Rouvrir ».
- **Serveur** : table `buddy_counts` (groupe ou sortie, nom, `ferme`, `supprime_le`) ; la ligne d'une sortie ne naît
  qu'à son premier changement (une seule par sortie). `depenses.count_id` pour les dépenses d'un Buddy count de groupe
  (`sortie_id` devient facultatif). Opération `buddy_count {count, groupe, nom}` (créer) ou `{count | sortie, nom?,
  ferme?, supprime?}` ; `depense` accepte `count` à la place de `sortie` ; la synchro rend `counts`.


- **« J'ai payé » / « OK, reçu » (Seb, 26 novembre, maquette maquettes/buddy-count-paye/)** : sous « X doit à Y »,
  X a un bouton « J'ai payé Y » → « Comment as-tu payé ? » (Virement, Wero, Espèces, Autre ; montant pré-rempli,
  on peut payer une partie) → « C'est payé ». La ligne passe en pointillés « en attente » (X peut « Annuler ») ; rien
  ne bouge dans les équilibres. Y reçoit une notification et voit « X dit t'avoir payé » avec « Pas reçu » / « OK,
  reçu » ; X est prévenu de la réponse. Confirmé, le paiement devient une ligne verte « Remboursement · X → Y · moyen ·
  reçu ✓ » dans les dépenses, comptée dans les équilibres mais pas dans le total. Serveur : opérations `paye`, `recu`
  (seul Y confirme), colonnes `depenses.remb` (annonce/recu) et `depenses.moyen` ; un remboursement ne se modifie pas.
- **Équilibré** : un Buddy count avec des dépenses où plus personne ne doit rien porte « · équilibré » et un signe égal
  dans un rond, vert (version D), au bout de sa ligne dans la liste.

### 7.21 Notifications : seulement ce que les buddies m'envoient (Seb, 26 novembre 2026)

- **Notifications (et chiffre sur l'icône de l'appli)** seulement pour : un message d'un buddy (pas de Bud) ; « J'ai
  payé », « OK, reçu », « Pas reçu » (à l'autre personne) ; une trace partagée ; des photos ajoutées à un album (une
  notification par envoi : « a ajouté 3 photos à l'album »). Serveur : `buddies.prevenir`, même forme qu'un message.
- **Plus de notification « Nouvelle version »** : la fenêtre de l'appli suffit.
- **Voyants imposés par Android** (GPS en arrière-plan : partage de position, suivi de sortie, suivi de trace) : muets,
  sans chiffre sur l'icône. Le partage de position : « Partage de position actif jusqu'à 19 h », priorité minimale
  (nouveaux canaux, les anciens sont effacés). Batterie : une position toutes les 5 minutes, le GPS dort entre deux.
- **« Pendant ton absence »** : à l'ouverture (ou au retour dans l'appli) qui suit des notifications arrivées appli
  fermée, une fenêtre liste qui a écrit, payé ou partagé quoi (8 au plus), avec « OK » ; les notifications s'effacent.
- **Pastille de 👥 sur la carte** : même règle ; elle compte les messages de buddies non lus, les « J'ai payé » qui
  attendent ma réponse, les traces partagées et les albums où un buddy a ajouté des photos depuis ma dernière visite de
  Buddies. Avant, elle comptait tout groupe, sortie ou planning modifié depuis la dernière ouverture, même par moi.

### 7.22 Écrire au support, espace Super User (Seb, 26 novembre 2026)

- **Profil** : rubrique « Aide » tout en bas du profil, sous « Se déconnecter » (Seb, 26/11), ligne « Écrire au support » (pas pour le Super User lui-même). Elle ouvre une
  discussion à deux avec le Super User, toujours la même, comme avec un buddy : réponses, photos, dictée, notifications
  (un message de buddy), coches « lu ». La version de l'appli et le téléphone sont joints (nom de la discussion, vu par
  le Super User sous le pseudo). Ligne lisible (Seb, 27/11) : « Ordinateur Windows · version web »,
  « Android 14 · Samsung SM-S911B · version 1.2.3 » ; les anciennes lignes brutes sont relues pareil à l'affichage.
  Une photo de profil qui ne se charge pas laisse place à l'initiale dans le rond.
- **🔑 Clé d'or** (Seb : « comme je suis modeste, mettons la clé ») : en bas de la colonne, sous 👤, pour le Super User
  seul, avec une pastille rouge des messages de support non lus. Elle ouvre « Super User » : la partie « Support »
  (une ligne par personne, dernier message, non lus) ; plus tard la place serveur de chacun, les comptes…
  Les demandes arrivent aussi dans 💬 Messages.
- **Serveur** : opération `support {groupe, infos}` ; groupe de nature `support`, identifiant uuid5 « support:<id> »,
  membres = la personne + les Super Users. Refusée tant qu'aucun Super User n'existe (« Le support n'est pas encore
  ouvert »).
- **Onglet Utilisateurs** (Seb, 27/11) : l'espace Super User a deux onglets, « Support » (demandes et signalements)
  et « Utilisateurs ». En haut, deux cases : téléchargements de l'APK (total, cette semaine) et comptes (total, venus
  cette semaine). Puis un compte par ligne, le dernier venu en tête : pseudo, dernière venue, Android / Play Store /
  navigateur, jours d'utilisation. Toucher une ligne : mail, inscription, dernière fois, jours, ouvertures, version,
  groupes, barres des ouvertures des 30 derniers jours.
  - Un téléchargement est anonyme : le bouton « Télécharger » de la page publique (et de /app/apk/) passe par
    `GET /telecharger`, qui ajoute 1 au jour (table `telechargements`) puis renvoie vers l'APK. Un compte naît à la
    première connexion.
  - Ouverture = lancement de l'appli, ou retour à l'écran après 30 min ailleurs, connecté (`POST /ouverture
    {plateforme, version}`, table `usages` : une ligne par personne et par jour). Compté à partir du 27/11.
  - `GET /super/utilisateurs` : Super User seul (403 sinon), comptes supprimés exclus.
  - **Journal** (Seb, 27/11), sous la liste et dans la fiche d'une personne, le plus récent en haut : « Toto a créé
    son compte », « s'est connecté (Android) », « a ouvert l'appli », « a rejoint « groupe » », « s'est déconnecté ».
    Rien d'anonyme (pas de « un visiteur a téléchargé » : on ne sait pas qui), rien pour le Super User lui-même.
    Table `journal`, gardée 90 jours, 500 lignes renvoyées. Connexion et déconnexion : `POST /ouverture` avec
    `evenement` (la déconnexion attend 2 s au plus la réponse avant d'oublier le jeton).

### Accueil et aide (Seb, 26/11)

- **Panneau d'accueil** (Accueil.tsx) à la première ouverture : « Mountain Buddies, c'est la carte magique dans ta
  poche, même sans réseau, pour préparer, vivre et revivre tes sorties outdoor. Et c'est collaboratif : traces, topos, photos,
  vidéos, vidéos 3D, dépenses communes, positions et messagerie, partagées avec ta bande. » Puis l'aide : appui long
  sur la flèche, sur la carte comme dans le second écran (👥), celui des « buddies ». Un bouton « C'est parti ».
- Case « Afficher l'aide à l'ouverture » dans Mon compte : le panneau revient à chaque ouverture.
- **Ordre à la première ouverture** (Seb, 27/11) : écran de connexion d'abord, puis le panneau d'accueil (jamais
  par-dessus la connexion). Une connexion réussie ferme l'écran du compte : on n'arrive plus sur le profil. Après
  « C'est parti », la première fois seulement : la carte vue de haut (zoom 6), centrée sur ma position, aucun panneau ouvert.
- **Aide** : appui long sur la flèche, une bulle par bouton, sur la carte et dans la colonne des buddies. Une seule
  bulle pour les calques et pour l'activité (sous-icônes cachées) ; pas de bulle pour les 4 réglages du suivi de
  trace ni pour la clé du Super User. « Touche n'importe où pour fermer l'aide » en haut, côté opposé aux icônes.

### 7.23 Invitations par mail, envoyées par le serveur (Seb, 26 novembre 2026)

- Écran 20 : le bouton « Partager » est remplacé par « ✉️ Mail », sur le modèle de Téléphone : prénom, adresse,
  « Envoyer l'invitation ». Pas de 5e bouton (Seb : « partager ne sert à rien »). L'appui long sur un groupe garde
  son Partager (§3, appui long).
- Le serveur comptes envoie le mail par Brevo (SMTP, comme AppBase : `deploy/comptes/mails.py`), après
  l'opération `inviter` de canal « mail », en arrière-plan. Expéditeur « Mountain Buddies »
  `SMTP_FROM_EMAIL` (mountainbuddies@silvaplana.cloud) ; réponses à l'adresse de celui qui invite.
  Configuration : `SMTP_*` de `~/mountaintest/comptes.env` (copiée de contretemps par l'installeur des comptes,
  la même que pour les codes de connexion Logto).
- Le mail (maquette maquettes/mail-invitation/) : « Seb t'invite dans « groupe » sur Mountain Buddies », texte
  qui finit par « … positions, messages et bien plus encore. », lien écrit en clair (Brevo réécrit les liens
  cliquables), valable 30 jours. On dit « groupe », jamais « bande » (Seb).
- Colonne `invitations.mail` : « envoye », « erreur », vide tant que pas envoyé. Sous l'invitation : « 🕓 mail en
  attente de réseau », « ✉️ mail envoyé », ou « ⚠ mail non parti · Renvoyer » (opération `renvoyer_mail`).
- Profil › « Inviter un ami » (Seb, 26/11) : prénom et adresse, sans groupe ; le serveur (`POST /inviter-appli`)
  envoie tout de suite un mail avec le lien de la page de téléchargement (…/mountaintest/apk/, qui envoie les
  iPhone vers la version web). Demande le réseau (bouton grisé sinon), « Le mail n'est pas parti » en cas d'échec.

### 7.24 Play Store : supprimer mon compte, signaler, bloquer (Seb, 27 novembre 2026)

Exigés par Google pour une appli avec comptes et messagerie (maquettes maquettes/play-store-compte-signaler/,
validées par Seb le 27/11).

- **Supprimer mon compte** : Profil, sous « Se déconnecter ». Un écran dit ce qui est effacé (profil, photo, e-mail,
  photos partagées, positions, voiture, dispos, place dans les groupes et sorties), ce qui reste pour les buddies
  (messages signés « Ancien buddy », dépenses des Buddy counts) et ce qui reste sur le téléphone (traces, cartes).
  Bouton rouge, puis déconnexion. Serveur : `DELETE /moi` anonymise la fiche (`utilisateurs.supprime_le`,
  `logto_id = "supprime:<id>"`) et supprime l'utilisateur chez Logto ; se reconnecter donne un compte neuf.
  Sur le web (pour qui n'a plus l'appli) : page `compte.html`, qui ouvre la version web sur `?compte=supprimer`.
- **Signaler** : appui long sur le message d'un autre (ou de Bud) › drapeau ; ou un membre dans la liste des membres
  d'un groupe. Un motif (insultant, choquant, pub ou arnaque, autre), un mot facultatif, « Bloquer X aussi » coché
  d'office. Opération `signaler`, table `signalements` (extrait du message et lieu gardés). Les Super Users sont
  prévenus ; ils traitent dans l'espace 🔑 › Signalements : Ignorer, Effacer le message, Retirer X du groupe
  (opération `traiter_signalement`).
- **Bloquer** : depuis Signaler ou la liste des membres ; Profil › Personnes bloquées pour débloquer. Table
  `blocages`. La personne bloquée reste dans les groupes, n'est pas prévenue ; ses messages se replient
  (« Message d'une personne bloquée · Afficher »), elle ne voit plus ma position ni ma voiture, et ses messages ne
  me notifient plus.
- **Pages publiques** (`capacitor/public/`) : `conditions.html` et `confidentialite.html` (liens dans Profil › Mon
  compte) ; responsable Sébastien Richard, contact mountainbuddies@silvaplana.cloud (renvoi vers son Gmail).

### 7.25 La messagerie coulisse sur la carte (Seb, 27 novembre 2026)

« Chatter tout en regardant la carte » (maquette `maquettes/buddies-coulisse/`, validée par Seb ; seulement la
messagerie pour l'instant, Seb 27/11).

- La liste des messages et une conversation (groupe, à deux, support) s'ouvrent toujours tout en haut, avec une poignée
  en haut au milieu (la liste aussi : Seb, 27/11).
- On tire la poignée vers le bas : la conversation devient un panneau du bas et la carte apparaît au-dessus, utilisable
  (bouger, zoomer). Elle reste à la hauteur où on la lâche (au moins le titre, le dernier message et la case Écrire),
  et s'y rouvre la fois suivante ; lâchée tout près du haut, elle remonte en plein écran. Un appui sur la poignée passe
  de l'un à l'autre. Les derniers messages restent en vue.
- Descendue, toucher un point (« Nico est ici ») ou une trace dans le fil la montre sur la carte au-dessus, sans fermer
  la conversation ; la carte se cadre dans la partie visible.
- Code : `capacitor/src/buddies/coulisse.ts` (clé `buddies:coulisse`), champ `cache` de `CarteBuddies`.

### 7.26 Mes traces sauvegardées sur le serveur (Seb, 27 novembre 2026)

Seb a désinstallé puis réinstallé l'appli : Mes traces et les tuiles, gardées seulement sur le téléphone, ont disparu.
Le reste (groupes, sorties, albums et photos envoyées, carnets, Buddy counts, conversations) était sur le serveur et est revenu.

- **Mes traces** (nom, forme, épingles 📍, lien avec un groupe ou une sortie) sont copiées sur le serveur à chaque changement,
  au démarrage et à la connexion (`PUT /mes-traces`, table `mes_traces`). Sans réseau : au prochain réseau.
- Au démarrage et à la connexion, il reprend celles du serveur qui lui manquent (`GET /mes-traces`) : après une réinstallation,
  elles reviennent seules dès qu'on se reconnecte.
- Une trace absente du téléphone n'est jamais effacée du serveur : seul un effacement fait sur le téléphone l'efface
  (gardé en attente hors ligne). Chacun ne voit que les siennes ; « Supprimer mon compte » les efface.
- **📥 Ouvrir des fichiers** : plusieurs fichiers d'un coup, rangés directement dans Mes traces (même nom et même forme : pas en double).
- **📁 Reprendre tout le dossier** (Android, caché : appui long sur « Mes traces ») : on choisit le dossier une fois, tous ses GPX/KML/GeoJSON vont dans Mes traces.
- **Restent sur le téléphone seulement** : les tuiles (à retélécharger), les films de survol 🎥, les réglages.

### 7.27 « Je récupère tes affaires » après une installation (Seb, 27 novembre 2026)

Maquette : `maquettes/restauration/` (variante B choisie par Seb ; A notification et C fenêtre écartées).

- À la **première synchro sur ce téléphone** (appli installée ou réinstallée, première connexion), un encart en verre
  dépoli s'affiche en haut de la carte : « Je récupère tes affaires », une ligne au trait par chose qui revient :
  Traces, Groupes, Sorties, Albums, Conversations, avec leur nombre. Chaque ligne se coche quand elle arrive (roue avant),
  la barre avance, puis le titre devient « Tes affaires sont revenues » et l'encart s'efface seul 5 s après. Un toucher le ferme.
  Il attend que l'écran de connexion et le panneau d'accueil soient fermés (sinon il passait dessous, invisible) :
  il se montre après « C'est parti ».
- Traces : seulement si Mes traces était vide sur le téléphone. Groupes : sans les discussions à deux. Albums : sorties
  qui ont des photos. Conversations : groupes et sorties qui ont des messages. Une ligne à 0 ne s'affiche pas ; rien
  revenu, pas d'encart.
- Les **photos** des albums ne sont pas retéléchargées d'un coup : seule leur liste revient, chaque photo se charge
  quand on ouvre l'album ou qu'on la touche, puis reste sur le téléphone (comme WhatsApp).
- Pas de notification Android : à la première ouverture, l'appli n'a pas encore le droit d'en envoyer.

### 7.28 Partager un planning dans la messagerie (Seb, 27 novembre 2026)

Maquette : `maquettes/planning-messagerie/` (validée par Seb) ; captures `captures/planning-messagerie/`.

- **📎 → Planning** : 5ᵉ bouton du menu 📎 (icône calendrier coché, au trait), dans la conversation d'un groupe ou
  d'une de ses sorties (pas dans une discussion à deux : un planning appartient à un groupe). On choisit un planning du
  groupe, ou « Nouveau planning » (l'écran habituel ; une fois créé, il part dans le fil).
- **La carte dans le fil** : nom, nombre de week-ends et date limite, mes réponses en pastilles (vert ✓, jaune ?, rouge ✗,
  vide = à remplir) pour les 4 prochaines dates puis « +N », gros bouton « Remplir mes dispos · N restantes » (ou « Voir le
  planning » quand tout est rempli), « 3 buddies sur 5 ont répondu ». Toucher la carte ouvre le planning ; ‹ revient au fil.
- **Partager depuis le planning** (icône Partager en haut) : « Dans la messagerie » (le fil du groupe ou d'une sortie à
  venir du groupe) ou « Envoyer un lien » (WhatsApp, SMS… par la feuille de partage). Le lien est celui, réutilisable,
  d'invitation au groupe plus `&p=<planning>` : il ouvre l'appli sur le planning ; quelqu'un qui n'est pas dans le groupe
  y entre d'abord (comme une invitation). Sans l'appli (ordinateur, iPhone), la version web (`?rejoindre=…&planning=…`).
- Serveur : message de nature `planning`, colonne `messages_buddies.planning_id` (planning du groupe de la conversation,
  sinon refusé) ; son texte = nom du planning (notification « 📅 Planning : … »). On ne transfère pas une carte de planning.

### 7.26 Allumer ma position ramène sur la carte (Seb, 27 novembre 2026)

Dans Buddies, un appui sur l'icône de ma position qui l'allume ferme Buddies et centre la carte sur moi (le message
« Ta position est partagée… » reste affiché). L'éteindre ne change pas d'écran.
Tant que ma position est partagée, mon point bleu sur la carte a des ondes de chaque côté à la place de la pulsation
(maquette A de `maquettes/position-partagee/`, Seb 27/11).

### 7.29 Inviter par la page principale, deux liens de groupe (Seb, 27 novembre 2026)

Le lien d'invitation (SMS, mail, QR, WhatsApp) est `https://mountainbuddies.silvaplana.cloud/api/i?c=CODE` (`&p=` pour un
planning). Le serveur y sert l'aperçu que lit WhatsApp (« Seb t'invite dans « groupe » », logo) et renvoie aussitôt sur
la page principale `/?c=CODE` : les copains découvrent le site, avec en haut un bandeau « Seb t'invite dans … » et un
bouton « Rejoindre le groupe » (« Rejoindre la sortie », « Donner mes dispos »).
- Android : le bouton ouvre l'appli sur l'invitation ; sans l'appli, on la télécharge avec le bouton de la page, puis
  on revient toucher « Rejoindre le groupe ».
- iPhone, ordinateur : la version web s'ouvre (`/app/?rejoindre=CODE`), on se connecte et on entre ; sur iPhone, on met
  ensuite l'appli sur l'écran d'accueil (il faut s'y reconnecter une fois).
- Les anciens liens `…/app/rejoindre.html?c=` mènent à la même page.

« Inviter mes copains » › « Lien, QR » : un seul lien pour tout le monde (même un groupe WhatsApp entier), au choix :
- **Entrée directe** : on entre tout de suite ; le lien vaut 30 jours.
- **Un admin accepte** : le lien ne périme pas ; celui qui le touche fait une demande (table `demandes_entree`), les
  admins sont prévenus et répondent dans les buddies du groupe (Accepter, ✕) ; le demandeur voit « Demande envoyée ».

Boutons « Envoyer dans WhatsApp » (message tout prêt) et « Partager ailleurs ». Les invitations à une personne (SMS,
contacts, mail) ne changent pas. Toucher le lien quand on est déjà dans le groupe (réinstallation) ne fait rien de plus :
on retrouve son groupe.
🔔 Notifications (Seb, 27/11) : quand quelqu'un entre par une invitation, ceux qui y sont déjà reçoivent « Julie a
rejoint le groupe » (ou « la sortie ») ; une demande par le lien « un admin accepte » prévient les admins ; l'admin qui
accepte prévient le demandeur (« t'a fait entrer dans le groupe »).
Lien touché par quelqu'un qui est déjà dans le groupe (Seb, 27/11) : l'appli ne dit pas « tu entres » mais
« Sébastien, tu es déjà dans « groupe » » (après la synchro, réinstallation comprise). Sinon « Bienvenue dans « groupe » »,
ou « Demande envoyée » pour un lien « un admin accepte ». La page web ne peut pas le savoir avant la connexion : elle
garde son bouton.
Page d'invitation sur Android (Seb, 27/11) : deux étapes dans l'ordre, 1 « Télécharger l'appli » (le bouton est dans le
bandeau), 2 « Rejoindre le groupe », qui ouvre l'appli par `fr.assomoutain.rando://rejoindre` (l'`intent://` avec retour
au navigateur ne réagissait pas dans Samsung Internet). Une page web ne peut pas savoir de façon sûre si l'appli est
installée : d'où les deux étapes.
Après une installation depuis la page (Seb, 27/11, « l'appli le propose seule ») : « Télécharger l'appli » copie le lien
d'invitation dans le presse-papiers ; à sa toute première ouverture, l'appli le lit (une seule fois) et fait entrer dans
le groupe (« Bienvenue dans … », ou après la connexion). Le bouton ② « Rejoindre le groupe » reste en secours.
🔗 Lien d'application (Seb, 27/11) : sur Android, le lien d'invitation `…/api/i?c=` ouvre directement l'appli quand elle
est installée (intent-filter `autoVerify`, fichier `deploy/vitrine/.well-known/assetlinks.json` avec l'empreinte de la clé
des APK). Sans l'appli, ou si Android n'a pas pu vérifier, le lien ouvre la page comme avant.

### 7.30 Mes dispos : voir les autres, une seule case (Seb, 27 novembre 2026)

Maquette : `maquettes/mes-dispos-autres/` (validée par Seb) ; captures `captures/mes-dispos-autres/`.

- À côté de chaque date, les réponses déjà données par les autres buddies du groupe : une pastille avec l'initiale
  (couleur du buddy) et ✓ (vert), ? (jaune) ou ✗ (rouge), 💬 s'il a laissé un mot. Pas de pastille = pas encore répondu.
  Un nouveau venu voit ainsi tout de suite ce qui a été dit.
- Une seule grande case par date (au lieu de trois boutons) : un toucher = ✓, deux = ?, trois = ✗, quatre = vide
  (même ordre que la grille du planning). L'appui long garde le petit mot.
