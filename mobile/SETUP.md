# Setup complet — De A à Z

Guide pas-à-pas pour passer l'app mobile en prod avec push notifications fonctionnelles.

**Temps total estimé** : 30-45 min (dont 10-20 min d'attente passive pendant le build EAS).

---

## Prérequis (à avoir avant de commencer)

- [ ] Un Mac avec Node.js installé (déjà fait)
- [ ] Un compte Expo (https://expo.dev/signup, gratuit, 30 sec) → **fait**, login `chaoumet1`
- [ ] Un compte Apple ID (iCloud) — gratuit suffit pour la dev
- [ ] Accès au dashboard Supabase du projet `ldchxxkmvepvbvhdokot`
- [ ] Un iPhone pour installer le dev build et tester
- [ ] (Optionnel) Compte Apple Developer payant ($99/an) — pas nécessaire pour la dev, juste pour TestFlight/App Store

---

## Étape 0 — État actuel

Ce qui est déjà fait dans le repo :
- ✅ EAS CLI installé globalement (`eas-cli` v18+)
- ✅ Projet Expo créé : `@chaoumet1/les-artistes` (projectId déjà dans `app.json`)
- ✅ `eas.json` configuré (3 profils : development / preview / production)
- ✅ Code mobile complet et testé TS
- ✅ Fichiers Supabase préparés dans `mobile/supabase/` (pas encore déployés)

Ce qu'il reste à faire :
1. Régénérer ton token EAS (sécurité)
2. Lancer le premier build iOS
3. Déployer le backend Supabase
4. Installer le build sur ton iPhone
5. Tester end-to-end

---

## Étape 1 — Régénérer ton token EAS (1 min)

Le token précédent a été partagé en chat → il est compromis.

1. Va sur https://expo.dev/settings/access-tokens
2. Trouve le token actuel → clique sur les `...` → **Delete**
3. Clique **Create token** → nom : "Mac local Thomas" → **Create**
4. **Copie le nouveau token** (`exp_xxxxxxx`) — il ne sera plus affiché après

Mets-le dans ton shell pour les commandes suivantes :

```bash
export EXPO_TOKEN="exp_TON_NOUVEAU_TOKEN"
```

Pour le rendre permanent (recommandé) :

```bash
echo 'export EXPO_TOKEN="exp_TON_NOUVEAU_TOKEN"' >> ~/.zshrc
source ~/.zshrc
```

Vérifier :

```bash
eas whoami
# Doit afficher : chaoumet1 (authenticated using EXPO_TOKEN)
```

---

## Étape 2 — Lancer le premier build iOS (5 min interactif + 10-20 min en cloud)

Depuis le dossier `mobile/` :

```bash
cd mobile
eas build --profile development --platform ios
```

Il va te poser ces questions interactives au début :

| Question | Réponse |
|---|---|
| `What would you like your iOS bundle identifier to be?` | Laisse `fr.lesartistes.app` (Entrée) |
| `Generate a new Apple Distribution Certificate?` | **Y** |
| `Apple ID:` | Ton email iCloud (ex: `thomas.calmettes01@gmail.com`) |
| `Apple password:` | Ton mot de passe Apple ID |
| `Apple Two-Factor Authentication Code:` | Code à 6 chiffres reçu sur ton iPhone |
| `Which Apple Team would you like to use?` | **Personal Team** (compte gratuit) ou ton équipe payante |
| `Generate a new Apple Provisioning Profile?` | **Y** |
| `Register a new device for ad hoc distribution?` | **Y** |

**Étape device registration** : EAS te donne un lien comme `https://expo.dev/register-device/...`.
1. Ouvre ce lien sur ton **iPhone, dans Safari** (pas Chrome)
2. Tap **"Download Profile"**
3. Va dans **Réglages > Profil téléchargé** → **Installer**
4. Reviens dans le terminal, appuie Entrée pour continuer

Une fois passé : message **"Build started"**, et un lien type `https://expo.dev/accounts/chaoumet1/projects/les-artistes/builds/[id]`.

**À ce point, le build tourne en cloud (10-20 min).** Tu peux fermer le terminal et passer à l'étape 3 pendant que ça build. Tu recevras un email quand c'est prêt.

---

## Étape 3 — Déployer le backend Supabase (15-20 min, à faire pendant que EAS build)

Va sur https://supabase.com/dashboard/project/ldchxxkmvepvbvhdokot

### 3.1 — Activer les extensions Postgres

**Database > Extensions** :
- Cherche `pg_net` → toggle ON
- Cherche `pg_cron` → toggle ON

### 3.2 — Générer le secret partagé

Dans ton terminal :

```bash
openssl rand -hex 32
```

Copie la chaîne hexadécimale (ex: `7a3f9b2c8e...`). Tu vas la coller à 2 endroits — **garde-la dans un fichier temporaire**.

### 3.3 — Récupérer ta service_role key

**Settings > API** → section "Project API keys" → copie la valeur de **`service_role`** (clic sur "Reveal"). Garde-la dans le même fichier temporaire.

### 3.4 — Configurer les secrets de l'Edge Function

**Edge Functions > Secrets** (ou **Settings > Edge Functions** selon la version du dashboard).
Ajoute 3 secrets :

| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://ldchxxkmvepvbvhdokot.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | la service_role copiée à l'étape 3.3 |
| `PUSH_INTERNAL_SECRET` | la chaîne hex de l'étape 3.2 |

> ⚠️ Note : `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont peut-être déjà présents par défaut. Si oui, ne touche pas. Ajoute juste `PUSH_INTERNAL_SECRET`.

> ✅ **Fait le 04/10/2026, sans cette étape** : le compte utilisé n'avait pas le droit de gérer les secrets. `send-push` lit alors le secret dans `public._app_config` (même ligne que `notify_push`), et ce secret a été généré dans la base avec `encode(extensions.gen_random_bytes(32), 'hex')` : il n'est jamais sorti de Supabase. `PUSH_INTERNAL_SECRET` reste optionnel. Backend installé ce jour-là : extensions, 01 à 04, fonction déployée sans vérification JWT, test `notify_push` → `200 {"sent":0}`.

### 3.5 — Créer la table `push_tokens`

**SQL Editor > New query** → copie-colle le contenu de `mobile/supabase/01_push_tokens.sql` → **Run**.

Vérifie : **Table Editor** doit afficher la table `push_tokens` avec ses RLS policies.

### 3.6 — Déployer l'Edge Function `send-push`

**Edge Functions > Create a new function** :
- Name : `send-push`
- Content : copie-colle `mobile/supabase/functions/send-push/index.ts`
- **Save and Deploy**
- Dans les réglages de la fonction, **désactive « Enforce JWT Verification »**. On appelle la
  fonction avec `PUSH_INTERNAL_SECRET`, pas avec un JWT : laissée activée, la passerelle Supabase
  répond `401 Invalid JWT` sans exécuter le code, et aucune push ne part.
  En CLI : `supabase functions deploy send-push --project-ref ldchxxkmvepvbvhdokot --no-verify-jwt`.

Vérifie : la fonction apparaît avec status "Active" et URL `https://ldchxxkmvepvbvhdokot.supabase.co/functions/v1/send-push`.

### 3.7 — Créer la fonction Postgres `notify_push`

**SQL Editor > New query** → copie-colle `mobile/supabase/02_notify_function.sql` → **Run**.

### 3.8 — Insérer la config runtime

**SQL Editor > New query** → colle (remplace `<TON_SECRET>` par la chaîne hex de l'étape 3.2) :

```sql
insert into public._app_config (id, edge_url, push_internal_secret) values (
  1,
  'https://ldchxxkmvepvbvhdokot.supabase.co/functions/v1/send-push',
  '<TON_SECRET>'
)
on conflict (id) do update
  set edge_url = excluded.edge_url,
      push_internal_secret = excluded.push_internal_secret;
```

→ **Run**.

### 3.9 — Tester l'envoi de push (depuis le terminal, sans iPhone encore)

Pour valider que la chaîne marche, on appelle directement l'Edge Function. Évidemment ça n'enverra rien tant qu'il n'y a pas de token enregistré, mais ça vérifie que l'Edge Function répond.

```bash
curl -X POST 'https://ldchxxkmvepvbvhdokot.supabase.co/functions/v1/send-push' \
  -H 'Authorization: Bearer <TON_SECRET>' \
  -H 'Content-Type: application/json' \
  -d '{"title":"Test","body":"OK","data":{"route":"/(tabs)/events"}}'
```

Réponse attendue : `{"sent":0,"results":[]}` — c'est normal, aucun token enregistré pour l'instant.

Si tu reçois `{"msg":"Invalid JWT"}` → la vérification JWT est encore activée sur la fonction (voir 3.6).

Si tu reçois `Unauthorized` (texte brut) → le secret est mauvais (vérifie qu'il est identique entre `Edge Functions > Secrets` et `_app_config`).

> 🛑 **STOP ICI**. N'enchaîne pas avec les triggers ni le cron tant que l'app iPhone n'a pas enregistré son token (étape 5).

---

## Étape 4 — Installer le dev build sur ton iPhone (5 min)

Le build EAS de l'étape 2 doit être terminé maintenant. Tu as reçu un email "Build completed".

1. Ouvre l'email sur ton iPhone (ou ouvre le lien Expo dans Safari sur iPhone)
2. Tap sur le bouton **Install**
3. iOS va dire "Voulez-vous installer Les Artistes ?" → **Installer**
4. L'icône apparaît sur ton home screen

**Premier lancement** : iOS bloque avec "Developer non vérifié".

5. Va dans **Réglages > Général > VPN et gestion de l'appareil**
6. Tap sur ton Apple ID (en bas)
7. Tap **"Faire confiance"** → confirme

Tu peux maintenant ouvrir l'app.

---

## Étape 5 — Première ouverture + autoriser les notifs

1. Lance **Les Artistes** depuis le home screen
2. Connecte-toi avec ton compte (email/password Supabase, comme sur le site)
3. iOS te demande **"Les Artistes veut envoyer des notifications"** → **Autoriser**

### Vérifier que le token est enregistré

Va dans le dashboard Supabase → **Table Editor > push_tokens**.

Tu dois voir une ligne avec :
- `user_id` : ton ID
- `token` : commence par `ExponentPushToken[...]`
- `platform` : `ios`
- `device_name` : nom de ton iPhone

Si pas de ligne → vérifie que `extra.eas.projectId` est présent dans `app.json` et qu'il n'y a pas d'erreur dans les logs Expo (terminal Metro).

---

## Étape 6 — Test push end-to-end (sans triggers)

Dans ton terminal (remplace `<TON_SECRET>` par la chaîne hex) :

```bash
curl -X POST 'https://ldchxxkmvepvbvhdokot.supabase.co/functions/v1/send-push' \
  -H 'Authorization: Bearer <TON_SECRET>' \
  -H 'Content-Type: application/json' \
  -d '{"title":"Hello iPhone","body":"Si tu vois ça, ça marche","data":{"route":"/(tabs)/events"}}'
```

Réponse attendue : `{"sent":1,"results":[{"data":[{"status":"ok","id":"..."}]}]}`

→ Tu dois recevoir une notification sur ton iPhone en 2-5 secondes.
→ Tap dessus → ouvre l'app sur l'écran Événements.

---

## Étape 7 — Activer les triggers DB

Maintenant que tu sais que la chaîne marche, on connecte les triggers automatiques.

**SQL Editor > New query** → copie-colle `mobile/supabase/03_triggers.sql` → **Run**.

À partir de là, à chaque INSERT sur :
- `events` → push "Nouvel événement" à tous (sauf l'auteur)
- `news` → push "Nouvelle actu" à tous
- `photos` → push "Nouvelle photo de [auteur]" à tous
- `event_comments` → push "Nouveau commentaire" aux participants de l'event
- `news_comments` → push "Nouveau commentaire" aux participants de la news
- `note_reactions` → push "Réaction à ta note" à l'auteur de la note

### Test trigger

Depuis ton iPhone (ou depuis le site web), crée un nouvel événement → tu devrais recevoir une push sur tout autre device avec un token enregistré.

> ⚠️ Note : si tu testes seul depuis ton iPhone, tu ne recevras PAS la push de ton propre event (`excludeUserId` te filtre). Pour tester, utilise le site web pour créer (un autre user) et l'app pour recevoir.

---

## Étape 8 — Activer les crons quotidiens

**SQL Editor > New query** → copie-colle `mobile/supabase/04_cron.sql` → **Run**.

Trois crons sont planifiés à 9h UTC tous les jours :
- `daily-birthday-reminders` → anniversaires J-7, J-1, jour J
- `daily-event-vote-reminders` → events à J+3 dont tu n'as pas voté la présence
- `daily-shop-deadline-reminders` → deadline boutique/sondage à J-3 et J-1

Vérifie :

```sql
select * from cron.job;
```

Tu dois voir 3 lignes avec ces 3 jobs actifs.

### Test manuel d'un cron (sans attendre 9h le lendemain)

```sql
-- Lance les rappels d'anniversaires maintenant
select public.daily_birthday_reminders();

-- Lance les rappels de vote
select public.daily_event_vote_reminders();

-- Lance les rappels deadline
select public.daily_shop_deadline_reminders();
```

---

## Étape 9 — Workflow quotidien (après setup)

Une fois tout en place, ton workflow dev devient :

### Pour développer du nouveau code mobile

```bash
cd mobile
npx expo start --dev-client
```

(Le `--dev-client` au lieu de juste `start` car tu utilises le dev build, plus Expo Go.)

Scan le QR code depuis ton iPhone (l'app dev build va automatiquement le détecter et se connecter à Metro).

### Pour ajouter un nouveau module natif

Si tu fais `npx expo install expo-quelquechose-de-natif`, tu dois rebuild :

```bash
eas build --profile development --platform ios
```

Pour les changements de code JS/TS (UI, logique métier, supabase calls), **pas besoin de rebuild** — le HMR via Metro suffit.

### Pour pusher en prod (App Store) — plus tard

```bash
eas build --profile production --platform ios
eas submit --platform ios
```

---

## Android — notifications push (FCM V1)

Sur Android, Expo passe par Firebase Cloud Messaging. Sans cette config,
`getExpoPushTokenAsync` échoue (« FirebaseApp is not initialized ») et le téléphone
n'enregistre jamais de token.

1. **Firebase** (console.firebase.google.com) : créer un projet, puis *Ajouter une app Android*
   avec le package `fr.lesartistes.app`.
2. Télécharger **`google-services.json`** et le poser dans `mobile/` (à côté de `app.json`).
3. Dans `app.json`, sous `expo.android`, ajouter :
   ```json
   "googleServicesFile": "./google-services.json"
   ```
   (À ne faire qu'une fois le fichier présent : le build échoue s'il manque.)
4. Firebase > *Paramètres du projet > Comptes de service* > **Générer une nouvelle clé privée**
   (fichier JSON). Ne pas le committer.
5. Envoyer cette clé à EAS :
   ```bash
   cd mobile
   eas credentials   # Android > production > Google Service Account > FCM V1 > upload du JSON
   ```
6. Relancer un build Android (`eas build --platform android --profile development`).

Vérifier ensuite qu'une ligne `platform = 'android'` apparaît dans `push_tokens`.

## Troubleshooting

### Build EAS échoue avec "Apple ID locked"
Va sur https://appleid.apple.com → débloque ton compte (souvent un email envoyé pour confirmer).

### Build EAS échoue avec "No bundle identifier"
Vérifie `app.json` → `ios.bundleIdentifier` doit être défini (`fr.lesartistes.app`).

### Token enregistré mais push ne reçu pas
- Vérifie les logs Edge Function : **Edge Functions > send-push > Logs**
- Vérifie que le token n'est pas expiré (les tokens Expo expirent quand l'user désinstalle l'app)
- Vérifie les notifs sont activées dans **Réglages iOS > Les Artistes > Notifications**

### Trigger envoie pas de push après INSERT
- Check que `pg_net` est bien activé : `select * from pg_extension where extname = 'pg_net';`
- Check `_app_config` est bien rempli : `select * from public._app_config;`
- Check les logs Postgres : **Logs > Postgres Logs** → filtre par "notify_push"

### Comment désactiver les notifs (panic button)
```sql
-- Stop tout
drop trigger if exists trg_events_notify on public.events;
drop trigger if exists trg_news_notify on public.news;
drop trigger if exists trg_photos_notify on public.photos;
drop trigger if exists trg_event_comments_notify on public.event_comments;
drop trigger if exists trg_news_comments_notify on public.news_comments;
drop trigger if exists trg_note_reactions_notify on public.note_reactions;

select cron.unschedule('daily-birthday-reminders');
select cron.unschedule('daily-event-vote-reminders');
select cron.unschedule('daily-shop-deadline-reminders');
```

Aucune table existante n'est touchée par ce rollback. Tu peux tout réactiver après en re-runnant `03_triggers.sql` + `04_cron.sql`.

---

## Récap final

Une fois toutes les étapes faites :

| Composant | Où c'est |
|---|---|
| Code mobile | Repo `mobile/` (this repo) |
| Build dev iOS | Sur ton iPhone (icône Les Artistes) |
| Push tokens | Supabase table `push_tokens` |
| Système d'envoi | Supabase Edge Function `send-push` |
| Triggers DB | Sur tables `events`, `news`, `photos`, `event_comments`, `news_comments`, `note_reactions` |
| Crons | Supabase `cron.job` (3 jobs quotidiens à 9h UTC) |
| Logs push | Edge Functions > send-push > Logs |

**Effort de maintenance attendu** : ~zéro. Tu rebuild l'app uniquement quand tu ajoutes un nouveau module natif, et le système de push tourne tout seul.

---

## Liens utiles

- Dashboard Expo : https://expo.dev/accounts/chaoumet1/projects/les-artistes
- Dashboard Supabase : https://supabase.com/dashboard/project/ldchxxkmvepvbvhdokot
- Apple Developer : https://developer.apple.com/account
- Doc Expo Notifications : https://docs.expo.dev/push-notifications/overview/
- Doc EAS Build : https://docs.expo.dev/build/introduction/
