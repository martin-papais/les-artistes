-- Sondages de date + rappel la veille aux présents (11/10/2026).
-- À coller dans le SQL Editor. Ré-exécutable.

-- ─── 1. SONDAGES DE DATE ────────────────────────────────────────────────────
-- Quelqu'un propose plusieurs dates, chacun dit s'il est dispo, puis l'auteur
-- crée l'événement sur la date retenue (event_id renseigné, sondage clos).

create table if not exists public.date_sondages (
  id uuid primary key default gen_random_uuid(),
  titre text not null check (length(trim(titre)) between 1 and 120),
  categorie text,
  note text,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  closed boolean not null default false,
  event_id uuid references public.events(id) on delete set null  -- événement créé à partir du sondage
);

create table if not exists public.date_sondage_options (
  id uuid primary key default gen_random_uuid(),
  sondage_id uuid not null references public.date_sondages(id) on delete cascade,
  date_option date not null,
  unique (sondage_id, date_option)
);

create table if not exists public.date_sondage_votes (
  option_id uuid not null references public.date_sondage_options(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  dispo boolean not null,
  created_at timestamptz not null default now(),
  primary key (option_id, user_id)
);

create index if not exists date_sondage_options_sondage_idx on public.date_sondage_options (sondage_id);

alter table public.date_sondages enable row level security;
alter table public.date_sondage_options enable row level security;
alter table public.date_sondage_votes enable row level security;

-- Lecture : tous les connectés. Écriture : l'auteur du sondage, ou soi-même pour un vote.
drop policy if exists "date_sondages select" on public.date_sondages;
create policy "date_sondages select" on public.date_sondages
  for select to authenticated using (true);
drop policy if exists "date_sondages insert" on public.date_sondages;
create policy "date_sondages insert" on public.date_sondages
  for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "date_sondages update" on public.date_sondages;
create policy "date_sondages update" on public.date_sondages
  for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());
drop policy if exists "date_sondages delete" on public.date_sondages;
create policy "date_sondages delete" on public.date_sondages
  for delete to authenticated using (created_by = auth.uid());

drop policy if exists "date_sondage_options select" on public.date_sondage_options;
create policy "date_sondage_options select" on public.date_sondage_options
  for select to authenticated using (true);
drop policy if exists "date_sondage_options insert" on public.date_sondage_options;
create policy "date_sondage_options insert" on public.date_sondage_options
  for insert to authenticated with check (
    exists (select 1 from public.date_sondages s where s.id = sondage_id and s.created_by = auth.uid())
  );
drop policy if exists "date_sondage_options delete" on public.date_sondage_options;
create policy "date_sondage_options delete" on public.date_sondage_options
  for delete to authenticated using (
    exists (select 1 from public.date_sondages s where s.id = sondage_id and s.created_by = auth.uid())
  );

drop policy if exists "date_sondage_votes select" on public.date_sondage_votes;
create policy "date_sondage_votes select" on public.date_sondage_votes
  for select to authenticated using (true);
drop policy if exists "date_sondage_votes insert" on public.date_sondage_votes;
create policy "date_sondage_votes insert" on public.date_sondage_votes
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "date_sondage_votes update" on public.date_sondage_votes;
create policy "date_sondage_votes update" on public.date_sondage_votes
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "date_sondage_votes delete" on public.date_sondage_votes;
create policy "date_sondage_votes delete" on public.date_sondage_votes
  for delete to authenticated using (user_id = auth.uid());

-- Création en une transaction : le sondage et ses dates, ou rien (le push du
-- trigger ci-dessous ne part qu'au commit, jamais pour un sondage sans dates).
-- security invoker : les policies ci-dessus s'appliquent comme pour un insert direct.
create or replace function public.create_date_sondage(
  p_titre text,
  p_categorie text,
  p_note text,
  p_dates date[]
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_id uuid;
begin
  if (select count(distinct d) from unnest(p_dates) d where d is not null) not between 2 and 8 then
    raise exception 'Entre deux et huit dates';
  end if;
  if exists (select 1 from unnest(p_dates) d where d < current_date) then
    raise exception 'Date passée';
  end if;
  insert into public.date_sondages (titre, categorie, note)
  values (trim(p_titre), nullif(p_categorie, ''), nullif(trim(p_note), ''))
  returning id into new_id;
  insert into public.date_sondage_options (sondage_id, date_option)
  select new_id, d from (select distinct unnest(p_dates) as d) x where d is not null;
  return new_id;
end;
$$;
revoke execute on function public.create_date_sondage from public, anon;
grant execute on function public.create_date_sondage to authenticated;

-- Push à tout le groupe (sauf l'auteur) quand un sondage est créé
create or replace function public.tg_date_sondages_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  author_name text;
begin
  select coalesce(nullif(pseudo, ''), prenom, '?') into author_name
  from public.profiles where id = new.created_by;

  perform public.notify_push(
    'Quelle date ?',
    coalesce(author_name, 'Quelqu''un') || ' propose des dates : ' || left(new.titre, 80),
    -- ?sondage= : l'appli ouvre directement le sondage au tap
    jsonb_build_object('route', '/(tabs)/events?sondage=' || new.id::text),
    new.created_by,
    null
  );
  return new;
end;
$$;

drop trigger if exists trg_date_sondages_notify on public.date_sondages;
create trigger trg_date_sondages_notify
  after insert on public.date_sondages
  for each row execute function public.tg_date_sondages_notify();

-- ─── 2. RAPPEL LA VEILLE AUX PRÉSENTS ───────────────────────────────────────
-- Tous les jours à 17 h UTC (19 h Paris l'été, 18 h l'hiver) : un push aux
-- membres qui ont répondu « Présent » à un événement du lendemain.

create or replace function public.daily_event_eve_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ev record;
  ev_label text;
  present_ids uuid[];
begin
  for ev in
    select id, categorie, anniversaire_qui, chez_qui, lieu, heure,
           feria_ville, sport_type, raison
    from public.events
    where date_event::date = current_date + 1
  loop
    select array_agg(user_id) into present_ids
    from public.event_votes
    where event_id = ev.id and present = 'oui';

    if present_ids is null then
      continue;
    end if;

    ev_label := coalesce(
      case ev.categorie
        when 'Anniversaire' then 'Anniv' ||
          case when ev.anniversaire_qui is not null then ' de ' || ev.anniversaire_qui else '' end
        when 'Vacances' then 'Vacances' || case when ev.lieu is not null then ' — ' || ev.lieu else '' end
        when 'Féria' then 'Féria' || case when ev.feria_ville is not null then ' de ' || ev.feria_ville else '' end
        when 'Sport' then coalesce(ev.sport_type, 'Sport')
        when 'Barathon' then 'Barathon'
        when 'Autre' then coalesce(ev.raison, 'Autre')
        else ev.categorie || case when ev.chez_qui is not null then ' chez ' || ev.chez_qui else '' end
      end,
      'Événement'
    );

    perform public.notify_push(
      'C''est demain : ' || ev_label,
      coalesce(
        nullif(concat_ws(' · ',
          'à ' || nullif(left(ev.heure::text, 5), ''),
          nullif(ev.lieu, ''),
          'chez ' || nullif(ev.chez_qui, '')
        ), ''),
        'Tu as dit que tu venais, à demain !'
      ),
      jsonb_build_object('route', '/(tabs)/events?event=' || ev.id::text, 'eventId', ev.id::text),
      null,
      present_ids
    );
  end loop;
end;
$$;

revoke execute on function public.daily_event_eve_reminders from public, anon, authenticated;

create extension if not exists pg_cron;

-- (Re)planification idempotente
do $$
begin
  if exists (select 1 from cron.job where jobname = 'daily-event-eve-reminders') then
    perform cron.unschedule('daily-event-eve-reminders');
  end if;
end $$;
select cron.schedule(
  'daily-event-eve-reminders',
  '0 17 * * *',
  $$ select public.daily_event_eve_reminders(); $$
);
