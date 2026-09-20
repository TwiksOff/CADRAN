# Cadran — PWA d'emploi du temps

Application autonome, sans dépendance, sans serveur. Les données restent sur l'appareil (localStorage).

## Fichiers
| Fichier | Rôle |
|---|---|
| `index.html` | Structure : barre de mois, colonne du jour, modèles, inspecteur, barre d'état |
| `styles.css` | Thème PC : noir / filets blancs, mise en page plein écran (aucun défilement de page) |
| `styles-mobile.css` | Thème iPhone : chargé automatiquement sous 767 px via `<link media="…">`, refond tactile complète |
| `app.js` | État, rendu, gestes, clavier, import/export, réglages |
| `sw.js` | Service worker : fonctionnement hors ligne |
| `manifest.webmanifest` | Installation sur l'écran d'accueil |
| `icon.svg`, `icon-192.png`, `icon-512.png` | Icônes |

## Interface iPhone

`styles-mobile.css` est un fichier séparé, chargé uniquement sur petit écran ou pointeur tactile
(`<link rel="stylesheet" href="styles-mobile.css" media="(max-width: 767px), …">`). Sur PC,
ce fichier n'est même pas appliqué par le navigateur ; sur iPhone, il prend le dessus sur
`styles.css` grâce à l'ordre de chargement. Rien à activer, rien à configurer.

Ce qui change concrètement :

- **Cibles tactiles ≥ 44 px** partout (boutons, cases à cocher, couleurs, jours du mois), au sens
  des recommandations d'accessibilité tactile d'Apple.
- **Aucun champ ne force le zoom Safari** : tous les champs de saisie sont à 16 px minimum.
- **Bouton + flottant** en bas à droite : crée un bloc d'une heure au prochain créneau libre en un
  tap, sans nécessiter le geste de glisser-déposer — important pour une prise en main immédiate et
  pour les personnes ayant des difficultés de motricité fine.
- **Zones de préhension des blocs agrandies** (les poignées de redimensionnement débordent
  discrètement au-delà du bloc visible, sans changer son apparence) pour un ajustement au doigt
  plus fiable que la version souris.
- **Panneau de propriétés en tiroir** : il glisse depuis le bas quand un bloc est sélectionné, avec
  une poignée « Fermer » et un voile qu'il suffit de toucher pour refermer — le geste classique des
  apps iOS plutôt qu'une colonne fixe qui n'aurait pas eu la place.
- **Modèles en étagère basse**, toujours à portée du pouce, plutôt qu'une colonne latérale.
- **Barre du haut allégée** : Envoyer, Synchronisation et Aujourd'hui passent dans le menu ⋯ pour
  ne garder à l'écran que la recherche et la navigation — moins de choix visibles à la fois.
- **En-tête fixe** pendant le défilement, **dialogues quasi plein écran** avec boutons empilés
  pleine largeur, **support de l'encoche et de la barre d'accueil** (`env(safe-area-inset-*)`).

## Lancer en local

## Lancer en local
Un service worker exige http(s), pas `file://` :

    cd cadran-pwa
    python3 -m http.server 8080
    # puis http://localhost:8080

## Mettre en ligne
Déposer le dossier tel quel sur GitHub Pages, Netlify, Vercel ou n'importe quel hébergement statique en HTTPS.
Le navigateur proposera alors « Installer l'application ».

## Raccourcis
Glisser = créer · bords haut/bas = durée · `Suppr` supprimer · `↑↓` déplacer · `⇧↑↓` durée ·
`←→` changer de jour · `Entrée` renommer · `N` nouveau · `D` terminé · `1–8` couleur ·
`Ctrl+D` dupliquer · `Ctrl+C/V` copier-coller · `Ctrl+Z` annuler · répétition par jours choisis · `T` aujourd'hui · `/` rechercher · `?` aide

## Format des données
```json
{ "events":[{"id":"","date":"2026-02-25","s":540,"e":600,"title":"","desc":"","place":"","color":"#ff1f14","done":false}],
  "templates":[{"id":"","title":"","mins":60,"color":"#ff1f14","desc":""}],
  "settings":{"dayStart":8,"dayEnd":20,"snap":15,"half":true} }
```
`s` et `e` sont des minutes depuis minuit.

## Synchronisation GitHub (entre PC et iPhone)

Le dépôt GitHub devient le coffre-fort central : `data/schedule.json` contient
`{ "events": [], "templates": [], "settings": {} }`, et chaque appareil garde une copie locale
(`localStorage`) qu'il synchronise avec ce fichier. Les préférences propres à un appareil
(plage horaire affichée, réglages d'envoi mail) restent locales et ne sont pas synchronisées.

### 1. Créer le dépôt et activer GitHub Pages

```
mon-emploi-du-temps/
├── index.html
├── styles.css
├── app.js
├── sw.js
├── manifest.webmanifest
├── icon.svg, icon-192.png, icon-512.png
└── data/
    └── schedule.json      ← { "events": [], "templates": [], "settings": {} }
```

Déposez ces fichiers sur GitHub (dépôt public ou privé), puis **Settings → Pages → Deploy from a
branch → main**. L'URL fournie (`https://votre-compte.github.io/mon-emploi-du-temps/`) est celle à
ouvrir sur PC et sur iPhone.

### 2. Créer un jeton d'accès limité à ce seul dépôt

**github.com → avatar → Settings → Developer settings → Personal access tokens → Fine-grained
tokens → Generate new token.**

- *Repository access* : **Only select repositories** → choisir uniquement ce dépôt.
- *Permissions* → **Contents : Read and write**. Rien d'autre n'est nécessaire.
- Copier le jeton (`github_pat_…`) — il ne sera plus jamais affiché en clair.

Ce jeton ne quitte jamais l'appareil : il est stocké dans le `localStorage` du navigateur, séparé
des autres données, et n'est jamais inclus dans l'export `.json` de Cadran.

### 3. Configurer Cadran sur chaque appareil

Menu (⋯) → **Synchronisation GitHub…** → renseigner propriétaire, dépôt, branche (`main`),
chemin (`data/schedule.json`), coller le jeton, cocher **Synchronisation automatique** →
**Tester la connexion**, puis **Synchroniser maintenant**.

À répéter une fois sur le PC et une fois sur l'iPhone (chacun avec son propre jeton, ou le même
jeton copié — au choix).

### 4. Fonctionnement au quotidien

- Au démarrage, à la reconnexion et au retour au premier plan, Cadran synchronise automatiquement
  si *Synchronisation automatique* est cochée.
- Toute modification locale est envoyée vers GitHub environ 2,5 secondes après la dernière
  frappe ou le dernier geste, pour éviter une requête par caractère tapé.
- Hors connexion, les modifications restent en attente localement (pastille orange) et partent
  dès le retour du réseau.
- GitHub conserve l'historique complet des versions du fichier (onglet *History* sur
  `data/schedule.json`), donc rien n'est jamais perdu même en cas d'erreur.

### 5. Conflits (modification simultanée sur deux appareils)

Avant chaque envoi, Cadran vérifie que la version distante n'a pas changé depuis la dernière
synchronisation de cet appareil. Si elle a changé — l'autre appareil a synchronisé entre-temps —
la pastille passe au rouge et une boîte de dialogue propose :

- **Recharger depuis GitHub** : reprend la version distante (la plus récente), les changements
  locaux non envoyés sont perdus.
- **Forcer l'envoi** : remplace la version distante par celle de cet appareil.

Pour un usage personnel à deux appareils, la pastille de statut (verte = à jour, orange = envoi en
attente, rouge = conflit) suffit à savoir s'il faut relancer une synchronisation avant de modifier
l'emploi du temps.

## Envoyer vers l'iPhone (mailto)

Bouton **Envoyer** (ou touche `E`). Le fichier `.ics` produit utilise un `UID` stable par bloc
(`<id>@cadran`) et un `SEQUENCE` qui s'incrémente : un renvoi **met à jour** les événements déjà
importés sur l'iPhone au lieu de les dupliquer.

**Ouvrir le brouillon mail** construit un lien `mailto:` dont le corps contient le fichier `.ics`
brut, en clair — rien n'est envoyé à un serveur tiers, tout reste entre le navigateur et
l'application mail par défaut. Le brouillon s'ouvre déjà rempli ; il ne reste qu'à l'envoyer.

Si la période choisie produit un `.ics` trop volumineux pour tenir dans une URL `mailto:`
(au-delà d'environ 1800 caractères, certains clients tronquent silencieusement), Cadran copie
automatiquement le contenu dans le presse-papiers et vous invite à le coller dans le message —
préférez alors une période plus courte (le jour ou la semaine plutôt que tout le calendrier).

Les autres méthodes restent disponibles : **Partager…** (feuille de partage iOS, si le navigateur
le permet), **Télécharger** et **Copier le .ics**.

### Automatisation iPhone (Raccourcis)

1. Raccourcis → **Automatisation** → *Courrier électronique* → expéditeur = votre propre adresse,
   objet contient « Cadran ».
2. Action : *Obtenir le texte du courriel* → *Enregistrer le fichier* sous `cadran.ics` →
   *Ouvrir* (ou *Ajouter au calendrier* si vous préférez importer directement).
3. Désactiver « Demander avant d'exécuter ».

Le corps du mail contenant le `.ics` en texte brut (pas en pièce jointe), l'automatisation lit le
texte du message plutôt que ses pièces jointes.

### Variante sans courriel

Si un jour vous hébergez la PWA quelque part, un abonnement `webcal://votre-domaine/cadran.ics`
(Réglages → Calendrier → Comptes → Abonnement) synchroniserait l'iPhone tout seul, sans
automatisation. Ce n'est pas nécessaire pour le fonctionnement actuel par mailto.
