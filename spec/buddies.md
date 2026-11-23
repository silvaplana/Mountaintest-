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
- Une fois terminé, il s'ouvre directement sur son carnet (§5.8). **(proposé, construit au bloc 5)**
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
- Partager le carnet : un lien ou un PDF **(proposé)** ; d'abord en texte (§7.5).

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

### 7.1 Bloc 1 : ce qui est construit (23 novembre 2026)

- **Écran 1** : 👥 ouvre Buddies, 👤 ouvre Mon compte (pastille verte ou orange). La pastille de 👥
  compte les Buddy Groups qui ont bougé depuis la dernière ouverture.
- **Écran 2** : la liste des Buddy Groups (Me Time compris), le plus récemment actif en haut,
  « à jour à 8 h 12 » et 🕓 pour ce qui attend le réseau. Les Buddy Times arrivent avec le
  bloc 2 (§7.2).
- **Écran 3** : un Buddy Group, ses visages (toucher : inviter, nommer admin, retirer, quitter).
  Le dernier admin qui part passe la main au plus ancien membre ; un groupe vide disparaît.
- **Écran 20** : photo, nom, invitations par Contacts (sélecteur d'Android, sans permission
  « contacts »), Mail, Téléphone (SMS) ou QR code.
- **Colonne d'icônes** : visible partout ; 💶 ouvre le partage des frais et 🏨 l'hébergement
  existants ; 📞 📅 💬 📸 disent « Bientôt » jusqu'à leur bloc.
- **Me Time** : créé par le serveur à la première synchro, le même sur tous les téléphones de la
  personne ; on ne le quitte pas et on n'y invite pas de groupe (inviter à une sortie : bloc 2).
- **Invitations** : le code est tiré au hasard par le téléphone, donc le SMS part même sans réseau.
  Le lien `silvaplana.cloud/mountaintest/rejoindre.html?c=…` montre le groupe et qui invite, ouvre
  l'appli (`…://rejoindre?c=…`) ou propose de l'installer ; il sert 30 jours. Un lien SMS ou mail
  sert à une personne ; un QR code sert à toute la bande.
- **Synchro** : une seule route, `POST /buddies/sync` (deploy/comptes/buddies.py) : le téléphone
  envoie ses opérations en attente et reçoit les Buddy Groups changés depuis la fois d'avant.
  Une opération refusée (droits, lien expiré) est montrée puis oubliée. Synchro à l'ouverture de
  l'appli, au retour du réseau, après chaque action et chaque minute quand Buddies est ouvert.

### 7.2 Bloc 2 : ce qui est construit (23 novembre 2026)

- **Écran 2** : en haut, la grande image du Buddy Time en cours, sinon du prochain (« Dans 5 jours »),
  puis la partie Buddy Times (à venir, du plus proche au plus lointain), puis les Buddy Groups.
  En bas, « ＋ Buddy Time » et « ＋ Buddy Group ».
- **Écran 3** : un Buddy Group montre aussi ses Buddy Times à venir, ses souvenirs (Buddy Times
  passés, en vignettes) et les traces partagées dans le groupe, plus « ＋ Buddy Time ».
- **Écran 21** : photo, nom, date de début et de fin (fin = début si vide), lieu ; dans une bande,
  on coche qui part (le créateur part toujours) ; dans Me Time, on invite des copains à la sortie
  (Contacts, Mail, SMS, QR) : le lien les ajoute au Buddy Time, pas à un groupe.
- **Écran 4** : toucher un Buddy Time ouvre la carte, cadrée sur ses traces. En haut ‹ nom, dates,
  lieu ; en bas un bandeau qu'on replie (« Dans N jours », « En cours » ou « Souvenir », qui part,
  km du parcours, jours avant). Les traces partagées s'ajoutent à Mes traces affichées (« Partagée
  par Julie ») : profil, Y aller, Commencer et Hors ligne marchent comme pour les siennes.
  Météo, rendez-vous et dénivelé du bandeau : plus tard.
- **Écran 22** : l'icône de partage d'une trace ouvre le panneau commun : vignettes des Buddy Times
  à venir, puis des Buddy Groups, un petit mot, « Partager » ; « Ou ailleurs » garde le partage du
  téléphone (fichier GPX). Partager à un buddy seul attendra la messagerie (bloc 9).
- **Serveur** : tables `sorties`, `participants`, `traces` ; la synchro renvoie aussi les Buddy Times
  et traces changés. Un Buddy Time se voit par les membres de son groupe et ses participants ;
  une trace par ceux qui voient son groupe ou son Buddy Time. Une trace : 2 à 20 000 points,
  arrondis à 5 décimales (environ 1 m).

### 7.3 Bloc 3 : ce qui est construit (23 novembre 2026)

- **Accès** : 📅 de la colonne ouvre les plannings du Buddy Group ouvert, sinon de toutes mes bandes,
  avec « ＋ Planning » en bas. Un planning à remplir s'annonce en haut de la liste Buddies et du
  Buddy Group (« 🔔 Saison ski : 3 week-ends à remplir · Remplir › ») et compte dans la pastille de 👥.
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
  « Où ? » facultatif ; « Créer le Buddy Time » (les ✓ partent, nom = le lieu, sinon le nom du
  planning) ou « Pas encore ». Une ligne devient un lien vers le Buddy Time de la bande qui part ce
  jour-là (même date de début), même s'il a été créé à la main. La météo prévue : plus tard.
- **Serveur** : tables `plannings` (dates en JSON) et `dispos` (planning, buddy, date : oui, peut, non
  et un mot) ; opérations `creer_planning` et `dispo` (rejouable : la dernière réponse compte, une
  réponse vide efface). Seuls les membres de la bande voient et remplissent le planning. 200 dates au plus.

### 7.4 Bloc 4 : ce qui est construit (23 novembre 2026)

- **Accès** : 📸 de la colonne ouvre les albums (un par Buddy Time commencé, du groupe ouvert ou de
  tous) ; sur la carte d'un Buddy Time, le bandeau montre les 4 premières photos (« +38 »),
  « 📷 Ajouter » et « 📸 Album ».
- **Écran 11** : photos rangées par jour (« Jour 1 · sam. 18 oct. »), 3 par rangée, visage de
  l'auteur, ⭐ ; vues Toutes, Sur la carte, ⭐ Carnet (les photos choisies pour le carnet, bloc 5).
  « 📷 Déposer mes photos » : plusieurs d'un coup, depuis la galerie. Toucher une photo : en grand,
  ‹ ›, « ☆ Pour le carnet » (n'importe quel participant), « Retirer » (l'auteur seulement).
- **Écran 7** : sur la carte, chaque photo là où elle a été prise (vignette bordée de blanc) ; un
  toucher l'ouvre en grand. Sans trace partagée, la carte se cadre sur les photos.
- **Hors ligne** : la photo est réduite sur le téléphone (400 px pour la grille, 1600 px pour la voir,
  JPEG), gardée et montrée tout de suite avec 🕓 ; elle part au retour du réseau. Les photos des
  autres, une fois vues, restent sur le téléphone : l'album s'ouvre sans réseau.
- **Heure et lieu** : lus dans la photo (EXIF). Sans heure, celle du fichier ; sans lieu (le choix de
  photos d'Android retire parfois la position), la photo n'est pas sur la carte. Vidéos : plus tard.
- **Serveur** : table `photos` (Buddy Time, auteur, heure, lieu, ⭐, arrivée) et opérations
  `ajouter_photo`, `etoile`, `retirer_photo` dans la synchro ; les fichiers passent à part,
  `PUT`/`GET /buddies/photos/<id>/<petite|grande>` (auteur seul pour envoyer, participants pour lire),
  rangés dans `COMPTES_DOSSIER/photos` (le volume `comptes-data` du VPS). 300 ko et 4 Mo au plus.

### 7.5 Bloc 5 : ce qui est construit (23 novembre 2026)

- **Accès** : un Buddy Time terminé s'ouvre directement sur son carnet (la carte reste à un toucher de la
  trace) ; sur la carte d'un Buddy Time commencé, « 📖 Carnet » à côté de « 📷 Ajouter » et « 📸 Album ».
- **Écran 12** : couverture (la photo du Buddy Time, sinon la première photo choisie), nom, dates, qui est
  venu. « ⭐ 12 photos choisies sur 42 » : les ⭐ de l'album ; sans ⭐, un choix automatique fait sur le
  téléphone (au plus 12, réparties sur tout le Buddy Time, signalé ✨). « Changer » ouvre l'album sur la vue
  ⭐ Carnet. Puis les récits, chacun signé du visage de son auteur, puis « 〰 La trace » : un petit plan,
  une couleur par jour ; un toucher ouvre le Buddy Time sur la carte.
- **Une couleur par jour** : quand il y a autant de traces partagées que de jours, la 1re trace partagée
  est le jour 1, la 2e le jour 2… ; sinon une couleur et le nom par trace.
- **Écran 13** : le profil de tout le Buddy Time (jours séparés d'un pointillé) et les chiffres connus :
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
- **Serveur** : tables `recits` (Buddy Time, buddy, texte), `fiches_jour` (Buddy Time, jour, nom, départ,
  durée, distance, dénivelé) et `carnets` (difficulté, météo, conditions) ; opérations `recit`, `fiche`,
  `carnet` dans la synchro, envoyées avec le Buddy Time (`carnet` dans sa vue). Tout participant du Buddy
  Time peut écrire ; chacun ne touche qu'à son propre récit.

### 7.6 Bloc 6 : ce qui est construit (23 novembre 2026)

- **Accès** : 💶 de la colonne ouvre le Buddy count du Buddy Time ouvert (carnet, album), sinon la liste des
  Buddy counts (un par Buddy Time, du groupe ouvert ou de tous) ; sur la carte d'un Buddy Time, une case
  « 💶 412 € · à 4 » à côté des chiffres ; dans le carnet, une ligne dans « Le pratique ». L'ancien partage
  des frais (menu Voyage, sur le téléphone seulement) reste accessible en bas de la liste : « Mes partages
  de frais hors Buddy Time ».
- **Écran 8** : « Équilibres » et la part de chacun ; une barre par buddy (verte : on lui doit, orange : il
  doit) ; « Nico doit à Seb 106 € » avec les deux visages ; les dépenses (icône devinée depuis le titre :
  gîte 🏨, essence ⛽, courses 🧀, forfaits 🎿…, payé par qui) ; « ＋ Dépense ».
- **Une dépense** : quoi, combien (en €), payé par (un visage), pour qui (les visages cochés, tous par
  défaut), le jour (dans les dates du Buddy Time par défaut). Toucher une dépense la corrige ou la retire :
  n'importe quel participant peut le faire ; la dernière version envoyée gagne. Sans réseau : 🕓.
- **Calculs** : ceux du partage des frais existant (centimes restants aux premiers, remboursements en peu
  de virements).
- **Serveur** : table `depenses` (Buddy Time, titre, montant en centimes, payé par, pour qui en JSON, jour) ;
  opérations `depense` (ajoute ou corrige) et `retirer_depense` ; payeur et bénéficiaires doivent être des
  participants du Buddy Time.

### 7.7 Bloc 7 : ce qui est construit (23 novembre 2026)

- **Accès** : sur la carte d'un Buddy Time, pendant ses dates, une ligne « 📍 Position des buddies · 2 visibles ·
  tu es visible » dans le bandeau ouvre l'écran 15 à la place du bandeau (« Retour » revient au bandeau). Les visages
  des buddies visibles sont sur la carte dès qu'on l'ouvre. Pas encore de 📍 dans la colonne de Buddies (point ouvert 3).
- **Écran 15** : en haut « 📍 2 buddies visibles » ; sur la carte, chaque visage avec « toi », « il y a 4 min » ou
  l'heure (« 10 h 42 ») ; il grise en vieillissant (plus de 20 min, plus d'une heure) et pâlit quand l'épingle est
  relevée. En bas, chaque buddy avec « à 1,2 km de toi · 2 310 m », « plus de réseau ? » (épingle enfoncée, rien
  depuis 20 min) ou « a relevé l'épingle » ; puis l'épingle : « 📍 Mes buddies peuvent me voir » (bouton principal),
  ou, enfoncée, « Mes buddies me voient · depuis 9 h 10 · s'arrête seul à 22 h » et « Arrêter ».
- **L'épingle** : enfoncée, elle se relève seule ce soir à 22 h (à minuit si on l'enfonce après 21 h). Une seule à la
  fois : l'enfoncer dans un Buddy Time la relève ailleurs. Relevée par soi ou le soir, la dernière position reste
  visible, grisée, jusqu'à 48 h, puis le serveur l'oublie. Pas encore de lieu nommé (« au col ») : l'altitude à la place.
- **Envoi** : Android, un service (notification « 📍 Mes buddies me voient ») prend une position toutes les 5 minutes,
  écran éteint compris, en GPS précis le temps du point puis endormi ; il s'arrête seul à l'heure prévue. Sans réseau,
  seule la dernière position attend (avec son heure) et part au retour ; appli tuée, le service la garde et l'appli
  l'envoie à sa réouverture. Dans un navigateur : toutes les 5 minutes tant que la page est ouverte. iPhone : à faire.
- **Réception** : à chaque synchro (toutes les minutes quand Buddies est ouvert, à chaque envoi de position, au retour
  de l'appli au premier plan).
- **Serveur** : table `positions` (Buddy Time, buddy, épingle `depuis`/`jusqu` en ms, dernière position et altitude,
  heure de prise) ; opérations `epingle {sortie, enfoncee, quand, jusqu}` (un jour au plus) et `position {sortie,
  lat, lon, alt, prise_le}` : une position hors du temps de l'épingle, ou plus ancienne que la dernière, est ignorée
  sans bruit. Seuls les participants du Buddy Time s'épinglent et voient les positions ; elles reviennent entières à
  chaque synchro.

### 7.8 Bloc 8 : ce qui est construit (23 novembre 2026)

- **Proposer (écran 23)** : dans la recherche d'hébergement existante, chaque résultat a « 👥 Proposer à mes
  buddies ». Le panneau de partage s'ouvre sur « Dans un Buddy Time » : seulement les Buddy Times à venir ou en cours
  où je pars (pas de groupe : un hébergement appartient à une sortie) ; « Ou ailleurs » envoie le nom, l'adresse et
  le lien. L'hébergement est placé sur la carte par son adresse (géocodage IGN) quand on la trouve ; sans réseau, il
  est proposé sans épingle.
- **Où on dort ? (écran 9)** : 🏨 de la colonne dans un Buddy Time (carnet, album, Buddy count), ou la ligne « 🏨 Où on
  dort ? » du bandeau de la carte (avant et pendant le Buddy Time ; une fois retenu : « Gîte Les Baladins ✅ · 60 € /
  nuit »). Chaque idée : image selon la nature (refuge, gîte, chalet…), prix par nuit, nature, adresse, résumé ; un
  toucher ouvre son site. ♥ (un par buddy, avec les visages de ceux qui aiment), « On le prend » (✅, un seul retenu par
  Buddy Time ; n'importe quel participant peut changer), « Retirer l'idée ». Le retenu en haut, puis les plus aimés,
  puis les moins chers. Un seul bouton principal : « 🔍 Chercher d'autres hébergements ».
- **Sur la carte** : les épingles 🏨 des idées placées, la retenue en vert.
- **Pas encore** : la ligne automatique dans le Buddy Count (le prix trouvé n'est pas toujours celui payé : on ajoute
  la dépense à la main). La recherche elle-même est l'écran existant, non retouché (voir point ouvert 6).
- **Serveur** : tables `hebergements` (Buddy Time, nom, nature, prix par nuit en euros, adresse, lien http(s), résumé,
  position, retenu) et `coeurs` ; opérations `proposer_hebergement`, `coeur`, `retenir_hebergement` (un seul retenu),
  `retirer_hebergement` ; réservées aux participants du Buddy Time.

### 7.9 Bloc 9 : ce qui est construit (23 novembre 2026)

- **Une conversation par Buddy Group et par Buddy Time** (§5.6), reprise en léger de la messagerie d'AppBase : chaque
  message porte un identifiant choisi par le téléphone, il part dans la même file d'attente que le reste (§3.1) et
  n'arrive qu'une fois même s'il est renvoyé. Sans réseau : « 🕓 partira au retour du réseau » sous le message.
- **Écran 6** : la conversation d'un Buddy Time s'ouvre sur sa carte, dans le bandeau du bas (ligne « 💬 Messagerie ·
  2 nouveaux » du bandeau, ou 💬 de la colonne depuis le carnet, l'album, le Buddy count…). Mes messages à droite en
  vert, ceux des autres à gauche avec leur prénom en couleur. En bas : [📷] [📍] [Message] [🎤], 🎤 devient ➤ dès
  qu'on écrit. Ouverte, elle regarde les nouveaux messages toutes les 10 s.
- **Écran 24** : on replie le bandeau (poignée) ou on touche « voir sur la carte » : il ne reste que les deux derniers
  mots et la saisie, la carte au-dessus.
- **Dans le fil**, en plus des messages et en cartes cliquables : les traces partagées dans ce Buddy Time ou ce Buddy
  Group (« Col Girardin · Julie · 14 km · voir sur la carte ») et les hébergements proposés (« Gîte Les Baladins ·
  Seb · 60 € / nuit »). On les retrouve donc plus tard dans la conversation.
- **Envoyer d'un geste** : 📍 envoie ma position du moment (« Nico est ici · voir sur la carte » : un toucher centre
  la carte sur le point) ; 📷 (dans un Buddy Time) dépose les photos dans l'album et les envoie aussi en message ;
  🎤 dicte le texte dans le champ (on relit avant d'envoyer). Appui long (ou toucher) sur un de mes messages :
  « Retirer ce message ».
- **💬 de la colonne** : dans un Buddy Time, sa conversation ; dans un Buddy Group, la sienne (dans le panneau) ;
  ailleurs, la liste de mes conversations, la plus récente en haut, avec le dernier mot et le nombre de non lus.
- **Pas encore** : le vrai message vocal (🎤 dicte pour l'instant), « Julie te montre… » en direct sur la carte de
  l'autre pendant un appel (avec le bloc 10), le partage à un buddy seul (une conversation à deux) et les
  notifications.
- **Serveur** : table `messages_buddies` (Buddy Group ou Buddy Time, auteur, nature texte, point ou photo, texte de
  2 000 caractères au plus, position, photo de l'album du même Buddy Time) ; opérations `message` et
  `retirer_message` (seulement les siens) ; la synchro rend les messages des 90 derniers jours.

### 7.10 Bloc 10 : ce qui est construit (23 novembre 2026)

- **Choix de Seb (23 novembre)** : le son passe par LiveKit installé sur le VPS (`appels.silvaplana.cloud`), et le
  téléphone **sonne même appli fermée** grâce à Firebase (projet « Mountain Buddies », un message prioritaire par
  téléphone). Sans Firebase, les appels marchent quand même, ils ne sonnent que l'appli ouverte.
- **📞 de la colonne** : appelle tout le Buddy Time ouvert, sinon tout le Buddy Group ouvert (pas d'appel dans Me
  Time). Si un appel est déjà en cours dans la bande, on le rejoint sans refaire sonner. Ligne « 📞 Appel en cours ·
  rejoindre » dans le Buddy Group et sur la carte du Buddy Time, pour qui n'a pas sonné (iPhone, appli fermée sans
  Firebase).
- **Écran 10** : plein écran « Mountain Buddies · appel de groupe », le nom du Buddy Time, « Julie t'appelle… »,
  les visages (cercle vert : déjà en ligne), ✕ Refuser et 📞 Répondre. Appli fermée : notification d'appel plein
  écran (par-dessus l'écran verrouillé) avec Refuser / Répondre, sonnerie du téléphone 45 s au plus ; elle s'arrête
  si l'appelant raccroche.
- **Écran 24** : la carte reste à l'écran, barre verte en haut « En ligne · 3:12 / Julie parle… · Luc », 🎙/🔇 et
  ✕ raccrocher. Celui qui appelle et que personne ne rejoint raccroche seul au bout d'une minute.
- **Montrer du doigt** : pendant l'appel, l'appui long sur la carte (qui d'habitude choisit un lieu où aller)
  allume l'endroit chez les autres : « 👉 Julie te montre », la carte s'y centre 10 s.
- **iPhone** : pas encore de sonnerie (il faudra CallKit et un compte Apple Developer) ; on rejoint par la ligne
  « Appel en cours ».
- **Serveur** : tables `appareils` (jeton Firebase de chaque téléphone) et `appels` (Buddy Group ou Buddy Time, qui
  a appelé, qui est en ligne, début, fin) ; routes `POST /appareils`, `POST /appels` (appeler ou rejoindre l'appel
  en cours), `POST /appels/{id}/rejoindre`, `POST /appels/{id}/presence`. Un appel finit quand plus personne n'est en
  ligne (ou au bout de 4 h) ; la synchro rend les appels en cours. Installation : `deploy/comptes/installer-appels.sh`.

### 7.11 Bloc 11 : ce qui est construit (23 novembre 2026)

- **Bud parle seulement si on l'appelle** : un message qui contient « Bud, … » (ou « Bud : … », écrit ou dicté)
  part comme les autres, puis le téléphone pose la question à Bud. Pendant qu'il cherche : une bulle « 🐻 Bud … ».
- **Sa réponse est un message de la conversation**, vu de tous, dans sa bulle à part (sombre, « 🐻 Bud », toujours à
  gauche) : il ne se fait jamais passer pour un buddy. Le message est enregistré au nom de celui qui a demandé, avec
  la marque Bud (colonne `bud` de `messages_buddies`).
- **Il propose, les buddies décident** : les hébergements qu'il trouve (recherche web) sont proposés dans « Où on
  dort ? » du Buddy Time et posés sur la carte (♥ et ✅ comme les autres) ; un endroit précis (col, parking…) arrive
  en carte « 📍 … · voir sur la carte ». Il ne réserve, ne paie et ne décide rien.
- **Ce qu'il sait** : ce que le téléphone connaît de la conversation, envoyé avec la question : le Buddy Time (dates,
  lieu, qui vient, invités), les traces partagées (longueur, départ, arrivée), les hébergements proposés et leurs ♥,
  le Buddy count (qui doit quoi), les plannings de la bande et les 30 derniers messages.
- **Pas encore** : la pente ou l'altitude d'une trace (les traces partagées n'ont pas l'altitude : Bud le dit), le
  tronçon « montré en rouge » de la maquette, et toute action de Bud (dépense, Buddy Time, dispo) : à décider (§9.5).
- **Réseau et coût** : besoin de réseau ; passe par le relais (`deploy/ia/relais.py`, route `/bud`, même mot de passe
  et même limite par jour que les recherches) ; son coût s'ajoute à l'écran 📊 (ligne « Bud »).

## 8. Hors périmètre pour l'instant

- Le calcul des péages et la comparaison avec ViaMichelin : laissé de côté. **(Seb)**
- Le vote de dates. **(Seb)**
- Un annuaire des utilisateurs. **(Seb)**
- Le détail de la messagerie. **(Seb)** Une version légère est faite au bloc 9 (§7.9).

## 9. Points ouverts

1. Le nom « Me Time » : accepté « pourquoi pas », à confirmer.
2. La portée de la colonne dans la liste (tous mes buddies à la fois) : à confirmer.
3. Les icônes 📍 et 📖 en plus dans un Buddy Time, et le prochain Buddy Time en grand en
   haut de la liste : à confirmer.
4. Ce que montre 📅 à l'intérieur d'un Buddy Time (ses dates et qui vient ?).
5. Bud : les règles du §5.12 sont construites telles quelles (bloc 11, §7.11), visage 🐻 ; ce qu'il a le droit de
   faire seul (rien, par défaut) : question posée à Seb le 23 novembre.
6. ~~La recherche d'hébergement affiche « Chercher (IA) » et « Claude cherche… »~~ : reformulée (« 🔍 Chercher »,
   « Je cherche les meilleurs prix… »), accord de Seb le 23 novembre. Même chose pour la recherche de randos sur le web, le coût du
   voyage (carburant, péages), la lecture de facture et l'aide des icônes. Seul l'écran 📊 du menu (usage et coûts,
   pour Seb) garde ses mots techniques.
