# LIVE ID TAKATAK — Journal (notes avant / pendant / après)

Règle nº 12 du fichier maître (Matt, 2026-10-31 02:32) : notes AVANT, PENDANT, APRÈS, signées. Une ligne par étape, la plus récente en bas de chaque section. Aucun secret ici.

Signature : **Claude (cloud session LIVE ID 01CXwoss)** — dépôt `takatakca/LIVEID-TAKATAK`, branche `claude/liveid-system`.

---

## AVANT — 2026-11-01 05:48 EST (10:48 UTC)

**Demande de Matt (mot pour mot, résumé)** : notre propre système de vérification d'identité en direct, pour prouver que ce n'est pas un robot. Comme Facebook : se connecter, autoriser, accepter. Ordre des étapes :
1. vérifier le numéro de téléphone ;
2. vérifier le courriel ;
3. vérification en direct : dire des chiffres à voix haute (« un, deux, trois »), puis tourner la tête gauche, droite, haut, bas (ordre au hasard) ;
4. pièce d'identité : **le recto seulement** ; on compare le visage de la pièce avec le visage en direct.
Sécurité premium contre la fraude. Site principal takatak.ca, aussi les restaurants (fenêtres pop-up). Le plus sécuritaire possible, testé, fonctionnel, poussé.

**État lu (vérifié en direct)** :
- `takatakca/LIVEID-TAKATAK` : vide (1 commit « Initial commit », README d'une ligne). Rien à reprendre, rien à écraser.
- `takatakca/takatak-v1` `main` 49b6797 : Next.js + Supabase ; P0 = TAKATAK AUTH (téléphone d'abord, Twilio) issue nº 141 ; `BRAND.md` (bleu électrique #1F8BFF sur marine #060D1F, vert = statut seulement) ; règle du journal `WORKLOG.md`.
- Drive « 00 — Opérations TAKATAK » : FICHIER MAÎTRE lu (règles d'or 1–13, dont nº 12 notes avant/pendant/après signées et nº 6 aucun secret) ; JOURNAL — État en direct lu (04:33 EST). Aucune mission LIVE ID existante → pas de doublon.
- Session précédente (Interac/BMO, pppmtl) : `docs/integrations/cash-verified-accounts.md` recommandait un fournisseur externe ; Matt choisit maintenant **notre propre système**. Loi 25 / LCCJTI art. 44–45 : consentement exprès obligatoire pour la biométrie ; une banque de caractéristiques biométriques se déclare à la CAI 60 jours avant sa mise en service.
- Outils vérifiés dans ce conteneur : Node 22, PostgreSQL 16, ffmpeg (voix de synthèse flite pour les tests). Modèles visage `@vladmandic/human` 3.3.6 + `tfjs-node` 4.22 installés (détection, angles de la tête, empreinte faciale, anti-usurpation, vivacité). Reconnaissance des chiffres hors ligne `pocketsphinx` (anglais) : « seven three nine one » reconnu exactement, bruit → rien.
- Tableau des agents `takatakca/foodhubca#105` : **inaccessible** depuis cette session (ajout du dépôt refusé) → CLAIM non publié ; trace laissée ici et dans Drive.

**Plan d'action** :
1. Serveur Node/TypeScript (Fastify) + PostgreSQL, flux de type OAuth/OpenID : le site (takatak.ca, un restaurant) envoie le client vers `/authorize`, écran « Autoriser / Accepter », étapes, retour avec un code, échange serveur à serveur (PKCE + secret), jeton signé Ed25519 (JWKS public).
2. Téléphone puis courriel : codes à 6 chiffres hachés (HMAC), 10 min, 5 essais, limites par IP et par numéro/courriel ; Twilio SMS + SMTP ; fournisseurs « console » pour le développement seulement (bloqués en production).
3. Direct : défi aléatoire du serveur (4 chiffres + 4 mouvements de tête, usage unique, 2 min) ; la caméra et le micro enregistrent ; **le serveur** analyse chaque image (pas le navigateur, qu'un robot peut truquer) : un seul visage, même personne du début à la fin, séquence de mouvements dans le bon ordre, chiffres reconnus dans l'audio, bouche qui bouge quand la voix parle, scores anti-usurpation et vivacité.
4. Recto de la pièce : visage détecté sur la carte, comparé à l'empreinte du visage en direct ; refus si c'est une image du direct réutilisée.
5. Vie privée par défaut : images et son traités en mémoire puis jetés, aucune banque biométrique ; téléphone et courriel chiffrés (AES-256-GCM) ; écran de consentement exprès.
6. Interface FR/EN aux couleurs TAKATAK + petit script pop-up pour les restaurants.
7. Tests (unitaires, intégration avec vrai PostgreSQL, vrais modèles visage et voix, navigateur), CI GitHub, Dockerfile pour Coolify, guide d'intégration. Pousser la branche. Aucun déploiement, aucune clé.

## PENDANT

- 2026-11-01 05:48 EST — branche `claude/liveid-system` créée depuis `main` 67fd8f4. Note AVANT écrite (ce fichier) avant tout code.
- 05:49 EST — note AVANT poussée sur GitHub (commit sur la branche) et déposée dans Drive « 00 — Opérations TAKATAK » (doc 1ggvBcaT…, relue après dépôt : contenu complet). Tableau `foodhubca#105` : ajout du dépôt refusé par la session → CLAIM non publié.
- 05:55 EST — calibration sur de vraies photos (images d'exemple livrées avec la librairie) : même personne 0,40–0,53, personnes différentes 0,09–0,26 → seuil de correspondance du visage **0,40**, zone « réessayer » 0,32–0,40. Rotation de tête ≈ 15° = 0,20 (décalage du nez / écart des yeux). Analyse ≈ 45 ms par image. Le modèle « vivacité » donne 0,94–1,00 même sur des photos → **il ne suffit pas** ; la vraie protection = défi aléatoire (mouvements + chiffres + bouche synchronisée), analysé côté serveur.
- 05:58 EST — reconnaissance vocale hors ligne : « seven three nine one » reconnu exactement ; bruit → rien. Chiffres 1–9 seulement (pas de 0, ambigu « zéro / oh »).
- 06:00 EST — lecture de texte (OCR) hors ligne testée : carte SPÉCIMEN de test lue exactement en 0,9 s ; un selfie → presque aucun texte. Donc l'étape pièce exige du texte de carte (≥ 20 caractères), refuse une carte expirée si la date est lisible, et compare le visage.
- 06:00 EST — carte de test : « SPECIMEN TEST CARD — NOT A REAL ID — LIVE ID TEST FIXTURE », générée pour les tests seulement, aucun emblème officiel.
- 06:20 EST — serveur écrit (avant : dépôt vide → après : code) : configuration avec garde-fous de production (pas de fournisseur « console », clé de signature obligatoire, https), chiffrement AES-256-GCM lié à la ligne, schéma PostgreSQL (aucune image ni son stockés), codes SMS/courriel hachés (6 chiffres, 10 min, 5 essais, 30 s entre deux envois, limites par numéro/courriel et par IP), flux type OAuth (`/authorize` → écran Accepter → étapes → code à usage unique 2 min → `/oauth/token` avec PKCE + secret → jeton signé Ed25519, sujet différent par site), détection robots (webdriver, navigateur sans tête, caméra virtuelle), purge automatique (empreinte du visage effacée dès l'étape pièce finie). Vérification de types : 0 erreur.
- 06:25 EST — écrans écrits (avant : aucun → après : `web/flow.html`, `src/web/app.ts`, `web/styles.css`, `web/liveid.js`) : consentement exprès, téléphone, courriel, direct (chiffres + flèches, caméra + micro), recto de la pièce, fin ; FR par défaut, EN au bouton ; couleurs BRAND.md ; aucun logo redessiné (texte seulement). Script pop-up `liveid.js` pour les restaurants : le code ne part que vers l'origine enregistrée du site.
- 06:30 EST — tests logiques 34/34 ✅ ; tests du flux complet sur vrai PostgreSQL 14/14 ✅ (après 2 corrections : message « numéro invalide » au lieu de « entrée invalide » pour un numéro trop court ; empreinte de test trop identique au direct).
- 06:35 EST — **constat important** sur de vraies photos : le modèle d'empreinte fourni avec la librairie (faceres) donnait 0,56 entre deux femmes différentes, plus que certaines paires de la même personne (0,34). Trop faible pour décider seul. Essais : modèle « deep » (aucun effet), ResNet de face-api sans alignement (chevauchement), fusion (chevauchement). **Retenu : ResNet `@vladmandic/face-api` sur le visage redressé par la ligne des yeux** → même personne pire cas 0,499, personnes différentes meilleur cas 0,421 : séparation nette. Aucun paquet ArcFace inconnu installé (risque de chaîne d'approvisionnement).
- 06:38 EST — nouveaux seuils (avant → après) : correspondance 0,40 → **0,50** ; zone « réessayer » 0,32 → **0,44** ; même personne pendant le direct 0,45 → **0,55** (échelle = 1 − distance ResNet).
- 06:40 EST — tests sur vrais modèles 9/9 ✅ : carte spécimen du même homme acceptée ; carte pour une autre personne refusée ; carte expirée refusée ; visage montré à la place d'une carte refusé ; chiffres dits « seven three nine one » reconnus, mauvais chiffres et bruit refusés ; **attaque photo immobile + bons chiffres joués à côté : refusée** (tête immobile, bouche immobile — la voix, elle, était bien reconnue) ; **attaque photo imprimée inclinée pour imiter les mouvements : refusée** (aucun mouvement détecté). 88 images analysées en ≈ 10 s sur le processeur.
- **Total : 57/57 tests réussis** (58/58 après l'ajout du test photo 3200 px à 07:05).

- 06:45 EST — test navigateur réel (Chromium, caméra simulée) 5/5 ✅ : site partenaire « Resto Démo » → LIVE ID → consentement → codes SMS + courriel → retour sur le site avec résultat signé (signature EdDSA vérifiée par le site) ; caméra qui montre une photo → refusée par le serveur (« Les mouvements de tête ne correspondent pas »), « Essais restants : 2 ». Le résultat signé a aussi signalé le navigateur automatisé (score de risque 100).
- 06:50 EST — mode production vérifié : refuse de démarrer avec les fournisseurs « console » ; démarre avec Twilio/SMTP configurés ; en-têtes HSTS, CSP, X-Frame-Options présents ; boîte de test `/dev/outbox` = 404.
- 06:55 EST — image Docker : construction impossible DANS ce conteneur (serveur Debian bloqué par le réseau du bac à sable) → ajout d'un job CI qui construit l'image, la démarre en production et vérifie la santé.
- 07:00 EST — CI GitHub run 41301840126 : **succès** (job `test` : types, build, 57 tests, navigateur ; job `docker` : image construite, démarrée en production, `/healthz` OK, `/dev/outbox` 404, reconnaissance vocale chargée).
- 07:05 EST — revue de code : 2 risques mémoire corrigés (avant → après) : photo de pièce 12 MP analysée en pleine taille (~140 Mo) → réduite à 1600 px d'abord ; envoi du direct sans plafond total → plafond 24 Mo. Test ajouté : photo de carte 3200 px acceptée. Tests : **58/58**.

## APRÈS — 2026-11-01 07:08 EST

**Résultat vérifié** : LIVE ID fonctionne de bout en bout et est poussé sur `takatakca/LIVEID-TAKATAK`, branche `claude/liveid-system` (pas encore dans `main`). CI GitHub verte (tests + navigateur + image Docker).

Ce qui marche, dans l'ordre demandé par Matt :
1. Écran « TAKATAK LIVE ID — <site> veut vérifier votre identité » : Accepter / Refuser, consentement exprès (Loi 25).
2. Téléphone : code SMS (Twilio), 6 chiffres, 10 min, 5 essais, limites anti-abus.
3. Courriel : code par courriel (SMTP), courriels jetables refusés.
4. Direct : 4 chiffres au hasard à dire à voix haute + 4 mouvements de tête au hasard (gauche/droite/haut/bas) ; le serveur vérifie un seul visage, le même du début à la fin, les mouvements dans l'ordre, les chiffres entendus, la bouche synchronisée avec la voix ; caméras virtuelles et navigateurs automatisés bloqués.
5. Recto de la pièce : visage de la carte comparé au visage en direct (ResNet, seuil 0,50), texte de carte exigé, carte expirée refusée.
6. Le site reçoit un résultat signé (niveau `basic` / `live` / `premium`). Script pop-up prêt pour les restaurants.

**Il reste (gestes humains, aucun secret ici)** :
1. **Matt / coordinateur** : relire et fusionner la branche dans `main` (ou demander la PR).
2. **Matt** : choisir l'adresse (proposé : `liveid.takatak.ca`) et l'ajouter dans Coolify avec le `Dockerfile` ; base PostgreSQL (Supabase ou Coolify) ; secrets dans Coolify : `npm run keys:generate` (3 valeurs), Twilio (déjà prévu pour PPP), SMTP, `TRUST_PROXY=true`.
3. **Développeur** : enregistrer takatak.ca et pppmtl.com (`npm run client:create`) et brancher le bouton (guide `docs/INTEGRATION.md`).
4. **Test terrain obligatoire avant d'ouvrir au public** : 20–30 vraies vérifications sur staging (téléphones, lumières, âges différents) pour ajuster les seuils — aucune caméra dans le conteneur cloud, le succès avec une vraie personne n'a pas pu être testé ici.
5. **Avocat / CAI** : faire relire le texte de consentement et la conservation ; vérifier l'obligation de déclaration à la Commission d'accès à l'information (biométrie).
6. Français parlé hors ligne = expérimental : pour le français fiable, clé OpenAI (`SPEECH_PROVIDER=openai`) ou demander les chiffres en anglais.
7. Faux documents (hologrammes, etc.) non détectés : fournisseur spécialisé si besoin (voir le plan `cash-verified-accounts.md` dans takatak-v1).

Captures d'écran : artefact `e2e-screenshots` de chaque exécution CI GitHub (et `artifacts/e2e/` localement, non versionné car il contient une photo d'exemple d'un tiers).

Signé : **Claude (cloud session LIVE ID 01CXwoss)**

---

# Mission 2 — Parcours premium + capture automatique (2026-11-01)

## AVANT — 2026-11-01 09:20 EST

**Demande de Matt** : capture automatique du visage et de la pièce dès qu'ils sont dans la zone (photo prise et envoyée toute seule) ; plus premium, plus propre ; **courriel d'abord**, puis cellulaire ; bouton « Envoyer le code » sur le même écran, le champ du code apparaît tout de suite, vérification code par code, sans recharger ; ensuite « Accepter toutes les conditions », Suivant, et la vidéo démarre ; vérifier le code pour qu'il n'y ait aucune erreur. Nom : LIVE ID (pas de nouveau dépôt).

**État lu** : branche `claude/liveid-system` a1f08e2 = dernière CI verte ; `main` toujours au commit initial (rien fusionné). Matt dit avoir déployé (depuis la branche).

**Plan** :
1. Ordre des étapes côté serveur : courriel → téléphone → conditions → direct → pièce. Les signaux anti-robot sont vérifiés dès l'envoi du premier code.
2. Écran unique « Coordonnées » : courriel + bouton → 6 cases de code juste en dessous → vérification automatique au 6e chiffre → la section cellulaire s'ouvre en dessous ; aucun rechargement.
3. Conditions : « J'accepte toutes les conditions » + Suivant → caméra + micro s'ouvrent → **détection du visage dans l'ovale dans le navigateur** → départ automatique → enregistrement → envoi automatique.
4. Pièce : caméra arrière → **détection de la carte (visage de la carte + netteté + stabilité)** → photo et envoi automatiques ; bouton manuel de secours après quelques secondes.
5. Finition premium (cases de code, anneau de progression, coches, transitions) ; revue du code ; correction d'un défaut déjà repéré : des styles en ligne bloqués par la politique de sécurité (CSP).
6. Tests (unitaires, flux complet, vrais modèles, navigateur réel avec capture automatique de la carte), CI, push, notes PENDANT/APRÈS.

## PENDANT (mission 2)

- 09:20 EST — note AVANT écrite avant tout changement de code.
- 09:30 EST — serveur (avant → après) : ordre des étapes consentement → téléphone → courriel → … devient **courriel → cellulaire → conditions → vidéo → pièce** ; contrôle anti-robot déplacé au **premier envoi de code** (aucun SMS/courriel envoyé à un robot). Tests du flux mis à jour : 49/49.
- 09:45 EST — écran « Vos coordonnées » : courriel + bouton « Envoyer le code » sur la même ligne → 6 cases de code juste en dessous → vérification automatique au 6e chiffre (coller et remplissage automatique du code SMS gérés) → la section cellulaire s'ouvre en dessous, sans recharger. Écran « Dernière étape avant la vidéo » : une seule case « J'accepte toutes les conditions » + Suivant.
- 10:00 EST — capture automatique : détecteur de visage dans le navigateur (chargé seulement à l'écran des conditions, 1,6 Mo) → la vidéo démarre seule quand le visage est dans l'ovale ; la pièce : photo prise et envoyée seule quand la carte est dans le cadre, nette, éclairée, sans reflet et immobile (bouton de secours après 8 s).
- 10:10 EST — défaut trouvé et corrigé : la taille du visage était mesurée avec la boîte large de la librairie (≈ 1,6 × le visage) → « Reculez un peu » à tort ; remplacée par le contour serré des points du visage. Masque sombre autour de l'ovale vérifié au pixel : (188,212,204) → (77,90,98).
- 10:20 EST — **nouvelle demande de Matt** (flèche verte/rouge) : chaque mouvement de tête devient interactif — grosse flèche qui se remplit en vert pendant que la tête tourne, « Complété ✓ » quand c'est assez loin, rouge « Pas assez — recommencez, allez plus loin » sinon ; on passe au suivant seulement quand c'est vert. Même mesure que le serveur (nez / yeux), avec une marge au-dessus du seuil du serveur. Le serveur revérifie tout.
- 10:35 EST — revue du code, 3 défauts corrigés (avant → après) : enregistrement sans limite de durée avec les reprises → plafond 40 s et 2 essais de 5 s par mouvement ; plus de 8 défis demandés → la session échoue proprement (sinon boucle) ; minuterie « Renvoyer » qui continuait après « Modifier » → arrêtée. Styles en ligne bloqués par la CSP → remplacés par des classes.
- 10:40 EST — tests : **60/60** (logique, flux complet sur PostgreSQL, vrais modèles) ; navigateur réel **13/13** : courriel d'abord puis cellulaire sur le même écran ; vidéo partie seule ; photo immobile → flèche rouge « Pas assez », arrêt sans envoi, aucun essai perdu ; pièce SPÉCIMEN photographiée et envoyée seule → visage correspondant → niveau `premium` reçu par le site ; aucune erreur de page ni de CSP.

## APRÈS (mission 2) — 2026-11-01 10:45 EST

**Résultat vérifié** : le parcours premium est en place et testé dans un vrai navigateur : courriel → cellulaire (codes sur le même écran, vérifiés seuls) → « J'accepte toutes les conditions » → vidéo qui démarre seule → flèches vertes/rouges → photo de la pièce prise et envoyée seule → retour automatique vers le site avec le résultat signé.

**Non testable ici, à faire sur un vrai téléphone** : la flèche qui se remplit en vert pendant qu'une vraie tête tourne (la caméra de test ne peut montrer qu'une photo immobile). Le seuil de la flèche est réglable (`NEED` dans `src/web/app.ts`).

**Reste (inchangé)** : fusion dans `main` et redéploiement de la branche ; 20–30 essais réels sur staging ; relecture juridique (consentement, CAI) ; clé OpenAI si on veut le français parlé fiable.

Signé : **Claude (cloud session LIVE ID 01CXwoss)**
