-- Fonction utilitaire qui appelle l'Edge Function send-push de manière asynchrone
-- via pg_net. Si l'appel échoue, ça ne fait PAS échouer la transaction qui l'a appelé.
--
-- Pré-requis :
--   1. L'extension pg_net doit être activée :
--      Dashboard Supabase > Database > Extensions > pg_net (toggle ON)
--   2. La table _app_config doit contenir l'URL de la fonction et le secret partagé
--      (voir ci-dessous).

create extension if not exists pg_net;

-- Petite table de configuration runtime (1 seule ligne attendue).
create table if not exists public._app_config (
  id int primary key default 1,
  edge_url text not null,                   -- ex: 'https://ldchxxkmvepvbvhdokot.supabase.co/functions/v1/send-push'
  push_internal_secret text not null,       -- même valeur que la variable d'env PUSH_INTERNAL_SECRET de l'Edge Function
  constraint single_row check (id = 1)
);

alter table public._app_config enable row level security;
-- Aucune policy → seul service_role peut lire/modifier (par défaut côté Supabase).

-- Fonction qui post à l'Edge Function. Marquée SECURITY DEFINER pour pouvoir lire _app_config.
create or replace function public.notify_push(
  p_title text,
  p_body text,
  p_data jsonb default '{}'::jsonb,
  p_exclude_user_id uuid default null,
  p_user_ids uuid[] default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg record;
  payload jsonb;
begin
  select edge_url, push_internal_secret into cfg from public._app_config where id = 1;
  if cfg.edge_url is null then
    raise notice 'notify_push: _app_config not configured, skipping';
    return;
  end if;

  payload := jsonb_build_object(
    'title', p_title,
    'body', p_body,
    'data', p_data
  );
  if p_exclude_user_id is not null then
    payload := payload || jsonb_build_object('excludeUserId', p_exclude_user_id::text);
  end if;
  if p_user_ids is not null then
    payload := payload || jsonb_build_object('userIds', to_jsonb(p_user_ids));
  end if;

  perform net.http_post(
    url := cfg.edge_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer ' || cfg.push_internal_secret
    ),
    body := payload
  );
exception when others then
  raise notice 'notify_push failed: %', sqlerrm;
end;
$$;
