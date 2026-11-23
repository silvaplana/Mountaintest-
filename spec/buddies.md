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
| **Buddies** | L'espace entier, ouvert par 👥 dans la 2e barre de la carte. |
| **Buddy Group** | Une bande de copains (comme une conversation de groupe). |
| **Buddy Time** | Une sortie ou un week-end passé ensemble. |
| **Me Time** | Le Buddy Group par défaut de chacun : ses sorties à lui, où il peut inviter des copains à une sortie. Nom accepté du bout des lèvres, modifiable. |
| **Buddy count** | Le partage des frais (l'actuel « partage des frais » du menu Voyage). |
| **Carnet** | Le compte rendu final d'un Buddy Time. |
| **buddy** | Une personne d'un de mes Buddy Groups ou Buddy Times. |

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
- Un Buddy Time à venir se télécharge en entier : trace, fonds de carte du couloir,
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

- Verticale, à droite, toujours visible **(Seb)** : 📞 appel, 📅 planning, 💬 messagerie,
  📸 album, 💶 Buddy count, 🏨 hébergement.
- Elle ne change pas ; sa portée suit ce qui est ouvert à gauche **(proposé)** : dans la
  liste elle regarde tous mes buddies, dans un Buddy Group ce groupe, dans un Buddy Time
  cette sortie.
- Dans un Buddy Time, deux icônes s'ajoutent sous un trait **(proposé)** : 📍 position des
  buddies, 📖 carnet.
- Une icône ouvre un panneau par-dessus la carte ; le panneau se tire vers le haut ou se
  baisse. L'icône active est verte.

### 3.4 Le panneau de partage, le même partout **(Seb pour trace et hébergement)**

Depuis une trace (Mes traces), un hébergement, un itinéraire voiture, un point ou une photo,
le partage ouvre toujours les mêmes rangées, dans cet ordre (écrans 22, 23) :

1. « Dans un Buddy Time » : les Buddy Times où il y a de l'activité, en image avec leur date.
   L'objet s'y range et apparaît sur leur carte.
2. « Ou à mes buddies » : les copains et Buddy Groups avec qui j'échange le plus (cinq au
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
| 2 | `2-buddies.png` | Liste : prochain Buddy Time en grand, Buddy Groups, derniers Buddy Times, deux « ＋ ». |
| 3 | `3-buddy-group.png` | Un Buddy Group : ses Buddy Times à venir puis ses souvenirs. |
| 4 | `4-buddy-time-carte.png` | Un Buddy Time : la carte d'abord, bandeau rabattable. |
| 6 | `6-messagerie.png` | Messagerie du Buddy Time, carte au-dessus. |
| 7 | `7-album-sur-la-carte.png` | Album, vue « Sur la carte ». |
| 8 | `8-buddy-count.png` | Buddy count. |
| 9 | `9-hebergement.png` | Hébergements proposés au groupe. |
| 10 | `10-appel.png` | Appel entrant. |
| 11 | `11-album-depot.png` | Album : chacun dépose ses photos. |
| 12 | `12-carnet-souvenir.png` | Carnet : photos, récit, trace. |
| 13 | `13-carnet-chiffres-jours.png` | Carnet : chiffres, fiches par jour, « Le pratique » replié. |
| 14 | `14-carnet-dicter.png` | Écrire le carnet à la voix. |
| 15 | `15-position-buddies.png` | Position des buddies (épingle). |
| 16 | `16-planning-saison.png` | Planning de saison d'un Buddy Group. |
| 17 | `17-planning-mes-dispos.png` | Remplir mes dispos. |
| 18 | `18-planning-nouveau.png` | Nouveau planning. |
| 19 | `19-planning-valider.png` | Une ligne du planning devient un Buddy Time. |
| 20 | `20-nouveau-buddy-group.png` | Nouveau Buddy Group, invitations. |
| 21 | `21-nouveau-buddy-time.png` | Nouveau Buddy Time. |
| 22 | `22-trace-partager.png` | Partager une trace. |
| 23 | `23-hebergement-partager.png` | Partager un hébergement. |
| 24 | `24-parler-ecrire-carte.png` | Parler ou écrire en regardant la carte. |
| 25 | `25-bud.png` | Bud, le buddy qui connaît l'appli. |

Il n'y a pas d'écran 5 : le vote de dates a été retiré (§5.4).

## 5. Les blocs

### 5.1 Accès (écran 1)

Dans la 2e barre de la carte, 👥 ouvre Buddies (pastille = du nouveau) et 👤 ouvre Moi
(profil, compte, réglages, état hors ligne). 👤 reprend l'écran « Mon compte » existant. **(Seb)**

### 5.2 La liste Buddies (écran 2)

- Façon WhatsApp : les Buddy Groups au-dessus, puis les Buddy Times ; dans chaque partie le
  plus récemment actif en haut. **(Seb)**
- Rond = Buddy Group, carré avec le jour = Buddy Time **(proposé)**.
- Tout en haut, en grande image : le Buddy Time en cours ou le prochain **(proposé)**.
- Me Time figure parmi les Buddy Groups, avec ma photo.
- En bas, deux boutons en image **(Seb : deux « ＋ », en image si possible)** :
  « ＋ Buddy Group » (visages qui se chevauchent) et « ＋ Buddy Time » (photo datée).

### 5.3 Buddy Group (écrans 3, 20)

- Création : une photo, un nom, des invitations par contacts, mail, téléphone (SMS) ou QR
  code. L'invité reçoit un lien qui installe l'appli et le fait entrer. Réutilise les
  comptes et invitations existants (`deploy/comptes/`, `capacitor/src/compte/`). **(Seb)**
- Ouvert, il montre ses Buddy Times : à venir d'abord, puis les souvenirs en images.
- Toucher les visages en haut ouvre les membres : inviter, nommer admin, retirer. Pas
  d'icône d'administration. **(proposé)**
- « ＋ Buddy Time » dans un groupe ne demande pas quel groupe. **(Seb)**

### 5.4 Buddy Time (écrans 4, 21)

- **Il naît quand on est sûr de partir**, jamais automatiquement. **(Seb)** Deux chemins :
  depuis une ligne du planning (§5.5), ou par « ＋ Buddy Time ». La préparation peut donc se
  faire hors du Buddy Time (dans le planning du groupe) ou dedans. **(Seb)**
- Créé dans un Buddy Group, il appartient à ce groupe ; on décoche ceux qui ne viennent pas.
  Créé depuis la liste, sans groupe choisi, il va dans Me Time. **(Seb)**
- Dans Me Time, on peut inviter un ou plusieurs copains à une sortie sans créer de Buddy
  Group. **(Seb)**
- Création : photo, nom, dates, lieu facultatif.
- Ouvrir un Buddy Time ouvre sa carte : traces, rendez-vous, hébergement, puis photos. Un
  bandeau en bas (dans combien de jours, qui vient, chiffres du parcours) se baisse pour ne
  laisser que la carte. **(proposé)**
- Une fois terminé, il s'ouvre directement sur son carnet (§5.8). **(proposé)**
- Pas de vote de dates. **(Seb)**

### 5.5 Planning de saison (écrans 16 à 19) **(Seb)**

- Sert à une bande où chacun a une famille et où il est dur de se coordonner sur une saison.
- Un planning est publié par quelqu'un, avec le « ＋ » en bas de l'écran planning : un nom,
  pour quel Buddy Group, une période de quelques mois, « week-ends » ou « tous les jours »
  (ou à la carte), les dates proposées cochées d'avance, une date limite de réponse.
- Publié, il apparaît dans le planning de chaque membre, qui est prévenu et doit le remplir.
- Remplir : un toucher par date (✓ dispo, ? peut-être, ✗ non). Un appui long ajoute un petit
  mot : phrases toutes prêtes (« Samedi seulement », « Dimanche seulement », « À confirmer »,
  « Avec les enfants », « Je peux conduire ») ou texte libre, dictable.
- La grille montre une ligne par date, une colonne par buddy, le nombre de dispos au bout.
- Ensuite on s'arrange de vive voix. Toucher une ligne montre qui est dispo et propose
  « Créer le Buddy Time » ou « Pas encore ». La ligne d'un Buddy Time créé devient un lien
  vers lui.

### 5.6 Messagerie (écrans 6, 24)

- Pour l'instant la spec dit seulement qu'il y a une messagerie par Buddy Group et par Buddy
  Time ; le détail se fera au moment de la développer, en reprenant celle d'AppBase
  (`silvaplana/contretemps`, `backend/src/messagerie/`). **(Seb)**
- Ce qu'elle doit porter **(Seb)** : écrire ou parler tout en regardant la carte. Elle se
  réduit à un bandeau en bas. Une trace ou un hébergement partagé apparaît sur la carte de
  l'autre (« Julie te montre… ») et reste dans la conversation en carte cliquable, pour la
  retrouver plus tard.
- Envoi d'un geste : photo, point sur la carte, trace, vocal.
- Hors ligne : file d'attente d'envoi (§3.1).

### 5.7 Appels (écrans 10, 24)

- 📞 fait sonner tout le Buddy Time ou le Buddy Group, comme un vrai appel. On voit qui a
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
- Partager le carnet : un lien ou un PDF **(proposé)**.

### 5.9 Position des buddies (écran 15) **(Seb)**

- 📍 est une épingle qu'on enfonce : « j'accepte que mes buddies me voient ». La position
  part alors seule, régulièrement, jusqu'à ce qu'on relève l'épingle.
- Qui n'a pas enfoncé l'épingle n'apparaît ni sur la carte ni dans la liste.
- Chaque position est affichée avec l'heure de la dernière reçue ; elle grise en vieillissant.
- Arrêt automatique le soir ou à la fin du Buddy Time ; un envoi toutes les cinq minutes
  environ avec le GPS économe existant ; visible seulement par les buddies de ce Buddy Time.
- Sans réseau, les positions sont gardées avec leur heure et partent au retour.

### 5.10 Buddy count (écran 8)

Le partage des frais existant (`capacitor/src/expenses/`, `Expenses.kt`), rangé dans chaque
Buddy Time et partagé entre téléphones : équilibres, « qui doit à qui », dépenses, « ＋ Dépense ».

### 5.11 Hébergement (écrans 9, 23)

La recherche existante (`Lodging.tsx`, `LodgingPanel.kt`), pour le groupe : les propositions
sont des épingles sur la carte, chacun met un ♥, on en retient une. Elle devient l'épingle 🏨
du Buddy Time et une ligne du Buddy count **(proposé)**. Un hébergement se partage avec le
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
liée, hébergement proposé, dépense, position. Chaque objet porte l'identifiant de son Buddy
Group ou de son Buddy Time, qui décide qui peut le voir. À détailler bloc par bloc.

## 7. Ordre de construction

Seb laisse le choix de l'ordre. **(Seb)**

Un bloc = une PR, dans les deux applis (Capacitor et Kotlin), chacun utilisable seul.

1. Socle : serveur, copie locale et file d'attente ; liste Buddies, Buddy Groups, Me Time,
   invitations (écrans 1, 2, 3, 20).
2. Buddy Time : création, carte, traces associées, panneau de partage (4, 21, 22).
3. Planning de saison (16 à 19).
4. Album (7, 11).
5. Carnet (12, 13, 14).
6. Buddy count partagé (8).
7. Position des buddies (15).
8. Hébergement partagé (9, 23).
9. Messagerie, reprise d'AppBase (6, 24).
10. Appels, puis montrer du doigt (10, 24).
11. Bud (25).

## 8. Hors périmètre pour l'instant

- Le calcul des péages et la comparaison avec ViaMichelin : laissé de côté. **(Seb)**
- Le vote de dates. **(Seb)**
- Un annuaire des utilisateurs. **(Seb)**
- Le détail de la messagerie. **(Seb)**

## 9. Points ouverts

1. Le nom « Me Time » : accepté « pourquoi pas », à confirmer.
2. La portée de la colonne dans la liste (tous mes buddies à la fois) : à confirmer.
3. Les icônes 📍 et 📖 en plus dans un Buddy Time, et le prochain Buddy Time en grand en
   haut de la liste : à confirmer.
4. Ce que montre 📅 à l'intérieur d'un Buddy Time (ses dates et qui vient ?).
5. Bud : les règles du §5.12, son visage, et ce qu'il a le droit de faire seul (rien, par défaut).
