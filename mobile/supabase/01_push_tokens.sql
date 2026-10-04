-- Table de stockage des push tokens Expo, 1 ligne par device par user.
-- Un user peut avoir plusieurs tokens (iPhone + iPad + Android).
-- À déployer dans le SQL Editor du dashboard Supabase.

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null,
  platform text not null,                            -- 'ios' | 'android' | 'web'
  device_name text,                                  -- ex: "iPhone de Tom"
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, token)
);

create index if not exists push_tokens_user_id_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

-- Un user lit/insère/update/delete uniquement ses propres tokens.
drop policy if exists "users manage own tokens select" on public.push_tokens;
create policy "users manage own tokens select"
  on public.push_tokens for select
  using (auth.uid() = user_id);

drop policy if exists "users manage own tokens insert" on public.push_tokens;
create policy "users manage own tokens insert"
  on public.push_tokens for insert
  with check (auth.uid() = user_id);

drop policy if exists "users manage own tokens update" on public.push_tokens;
create policy "users manage own tokens update"
  on public.push_tokens for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "users manage own tokens delete" on public.push_tokens;
create policy "users manage own tokens delete"
  on public.push_tokens for delete
  using (auth.uid() = user_id);

-- Trigger updated_at automatique
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_push_tokens_updated_at on public.push_tokens;
create trigger trg_push_tokens_updated_at
  before update on public.push_tokens
  for each row execute function public.touch_updated_at();
