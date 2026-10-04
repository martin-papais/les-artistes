# Backend Supabase — Notifications push

Tout ce dossier contient des fichiers à **copier-coller manuellement** dans ton dashboard Supabase. Rien ne se déploie automatiquement.

## Prérequis (1 fois)

Dans le dashboard Supabase de `ldchxxkmvepvbvhdokot` :

1. **Database > Extensions** — activer `pg_net` et `pg_cron` (toggle ON pour chacune).
2. **Edge Functions > Secrets** — ajouter ces 3 secrets :
   - `SUPABASE_URL` = `https://ldchxxkmvepvbvhdokot.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = (ta service_role key, dans Settings > API)
   - `PUSH_INTERNAL_SECRET` = un long string random que tu génères (ex: `openssl rand -hex 32`)

## Étape 1 — Créer la table `push_tokens`

Dans **SQL Editor**, copier-coller `01_push_tokens.sql` et run.

## Étape 2 — Créer la fonction `notify_push` + la table `_app_config`

Dans **SQL Editor**, copier-coller `02_notify_function.sql` et run.

Puis insère la config (1 seule ligne) :

```sql
insert into public._app_config (id, edge_url, push_internal_secret) values (
  1,
  'https://ldchxxkmvepvbvhdokot.supabase.co/functions/v1/send-push',
  '<MÊME VALEUR que PUSH_INTERNAL_SECRET ci-dessus>'
)
on conflict (id) do update
  set edge_url = excluded.edge_url,
      push_internal_secret = excluded.push_internal_secret;
```

## Étape 3 — Déployer l'Edge Function `send-push`

Deux options :

### Option A — via le dashboard (le plus simple)
1. **Edge Functions > Create a new function**
2. Nom : `send-push`
3. Coller le contenu de `functions/send-push/index.ts`
4. Save & Deploy
5. **Désactiver « Enforce JWT Verification »** dans les réglages de la fonction. Sinon la passerelle
   Supabase rejette l'appel (`401 Invalid JWT`) avant même d'exécuter le code, car on envoie
   `PUSH_INTERNAL_SECRET` et pas un JWT. La fonction vérifie elle-même ce secret.

### Option B — via Supabase CLI (si tu l'as installé)
```bash
cd mobile
supabase functions deploy send-push --project-ref ldchxxkmvepvbvhdokot --no-verify-jwt
```

## Étape 4 — Créer les triggers

Dans **SQL Editor**, copier-coller `03_triggers.sql` et run.

À partir de là, à chaque INSERT sur `events`, `news`, `photos`, `event_comments`, `news_comments`, `note_reactions`, une push est envoyée.

## Étape 5 — Activer les crons

Dans **SQL Editor**, copier-coller `04_cron.sql` et run.

À partir de là, tous les jours à 9h UTC :
- Anniversaires J-7 / J-1 / jour J
- Rappels vote présence pour les events à J+3 sans vote
- Rappels deadline boutique/sondage à J-3 et J-1

Pour vérifier que les crons sont actifs :
```sql
select * from cron.job;
```

## Tester manuellement

```sql
-- Envoie une push de test à toi-même
select public.notify_push(
  'Test',
  'Si tu vois ça, ça marche',
  '{"route": "/(tabs)/events"}'::jsonb,
  null,
  null
);
```

Tu peux aussi appeler directement l'Edge Function :

```bash
curl -X POST 'https://ldchxxkmvepvbvhdokot.supabase.co/functions/v1/send-push' \
  -H 'Authorization: Bearer <PUSH_INTERNAL_SECRET>' \
  -H 'Content-Type: application/json' \
  -d '{"title":"Test","body":"Hello world","data":{"route":"/(tabs)/events"}}'
```

## Désactiver / nettoyer (si besoin)

```sql
-- Stop les crons
select cron.unschedule('daily-birthday-reminders');
select cron.unschedule('daily-event-vote-reminders');
select cron.unschedule('daily-shop-deadline-reminders');

-- Drop les triggers (les tables d'origine sont préservées)
drop trigger if exists trg_events_notify on public.events;
drop trigger if exists trg_news_notify on public.news;
drop trigger if exists trg_photos_notify on public.photos;
drop trigger if exists trg_event_comments_notify on public.event_comments;
drop trigger if exists trg_news_comments_notify on public.news_comments;
drop trigger if exists trg_note_reactions_notify on public.note_reactions;

-- Drop la table de tokens (si tu veux tout enlever)
drop table if exists public.push_tokens;
drop table if exists public._app_config;
```

Aucun de ces fichiers ne touche aux tables existantes (`events`, `news`, `profiles`, etc.) — tout est ajouté à côté.
