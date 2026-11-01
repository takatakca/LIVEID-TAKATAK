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

## APRÈS

_(à venir)_
