-- Sécurité (04/10/2026) — à lancer dans le SQL Editor. Ré-exécutable.
--
-- 1. Les visiteurs non connectés (clé anon, publique) ne lisent plus rien.
-- 2. La connexion par pseudo passe par une fonction qui ne renvoie qu'un e-mail.
-- 3. Le mot de passe du groupe est vérifié côté serveur à l'inscription.
--    Sa valeur vit dans public._app_config.group_code (jamais dans le dépôt) :
--      update public._app_config set group_code = '<mot de passe>' where id = 1;

-- ─── 1. Toutes les policies du schéma public : réservées aux connectés ───────
-- Les policies existantes visent le rôle « public », qui inclut anon. Leurs
-- conditions (auth.uid() = user_id, etc.) restent identiques.
do $$
declare p record;
begin
  for p in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and roles @> '{public}'
  loop
    execute format('alter policy %I on public.%I to authenticated', p.policyname, p.tablename);
  end loop;
end $$;

-- ─── 2. Pseudo → e-mail, sans exposer la table profiles ─────────────────────
-- Renvoie l'e-mail seulement si le pseudo correspond à exactement un membre.
create or replace function public.email_for_pseudo(p_pseudo text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when count(*) = 1 then min(email) end
  from public.profiles
  where lower(trim(pseudo)) = lower(trim(p_pseudo)) and trim(p_pseudo) <> '';
$$;
revoke execute on function public.email_for_pseudo from public;
grant execute on function public.email_for_pseudo to anon, authenticated;

-- ─── 3. Code du groupe vérifié à l'inscription ──────────────────────────────
alter table public._app_config add column if not exists group_code text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  expected text;
begin
  -- Les comptes invités depuis le dashboard n'ont pas de code : on les laisse passer.
  if new.invited_at is null then
    select group_code into expected from public._app_config where id = 1;
    if expected is null
       or lower(trim(coalesce(new.raw_user_meta_data->>'group_code', ''))) <> lower(trim(expected)) then
      raise exception 'group_code invalide';
    end if;
  end if;

  insert into public.profiles (id, pseudo, prenom, nom, email, tel, dob)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'pseudo', ''),
    coalesce(new.raw_user_meta_data->>'prenom', ''),
    coalesce(new.raw_user_meta_data->>'nom', ''),
    new.email,
    nullif(new.raw_user_meta_data->>'tel', ''),
    nullif(new.raw_user_meta_data->>'dob', '')::date
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Les téléphones vides enregistrés avant ce correctif : '' → null.
update public.profiles set tel = null where tel = '';
