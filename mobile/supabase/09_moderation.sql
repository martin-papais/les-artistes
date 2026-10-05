-- Modération (05/10/2026) — exigée par l'App Store (règle 1.2, contenus publiés
-- par les membres) : signaler un contenu, bloquer un membre. Ré-exécutable.
--
-- Chaque signalement envoie un push aux modérateurs listés dans
-- public._app_config.moderator_ids.

-- ─── Signalements ────────────────────────────────────────────────────────────
create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('news', 'news_comment', 'event_comment', 'photo', 'note')),
  item_id text not null,
  excerpt text,
  created_at timestamptz not null default now()
);

alter table public.content_reports enable row level security;
drop policy if exists "report insert own" on public.content_reports;
create policy "report insert own" on public.content_reports
  for insert to authenticated with check (reporter_id = auth.uid());
-- Pas de policy select : seuls les modérateurs lisent, depuis le dashboard.

-- ─── Blocages ────────────────────────────────────────────────────────────────
create table if not exists public.user_blocks (
  blocker_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.user_blocks enable row level security;
drop policy if exists "blocks own select" on public.user_blocks;
create policy "blocks own select" on public.user_blocks
  for select to authenticated using (blocker_id = auth.uid());
drop policy if exists "blocks own insert" on public.user_blocks;
create policy "blocks own insert" on public.user_blocks
  for insert to authenticated with check (blocker_id = auth.uid());
drop policy if exists "blocks own delete" on public.user_blocks;
create policy "blocks own delete" on public.user_blocks
  for delete to authenticated using (blocker_id = auth.uid());

-- ─── Push aux modérateurs ────────────────────────────────────────────────────
alter table public._app_config add column if not exists moderator_ids uuid[];

update public._app_config
  set moderator_ids = array(select id from auth.users where email = 'thomas.calmettes01@gmail.com')
  where id = 1 and moderator_ids is null;

create or replace function public.tg_reports_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare mods uuid[];
begin
  select moderator_ids into mods from public._app_config where id = 1;
  if mods is not null and cardinality(mods) > 0 then
    perform public.notify_push(
      'Contenu signalé',
      new.kind || ' : ' || left(coalesce(new.excerpt, ''), 80),
      jsonb_build_object('reportId', new.id),
      null,
      mods
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reports_notify on public.content_reports;
create trigger trg_reports_notify
  after insert on public.content_reports
  for each row execute function public.tg_reports_notify();
