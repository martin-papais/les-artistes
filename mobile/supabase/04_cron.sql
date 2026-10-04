-- Crons quotidiens via pg_cron : anniversaires, rappels d'action.
-- Pré-requis : extensions pg_cron + pg_net activées
--   (Dashboard Supabase > Database > Extensions)

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ─── 1. ANNIVERSAIRES : J-7, J-1, jour J ─────────────────────────────────────

-- Date d'anniversaire dans l'année donnée (29 février → 28 février hors année bissextile)
create or replace function public.birthday_in_year(p_dob date, p_year int)
returns date
language sql
immutable
set search_path = public
as $$
  select make_date(
    p_year,
    extract(month from p_dob)::int,
    least(
      extract(day from p_dob)::int,
      extract(day from (make_date(p_year, extract(month from p_dob)::int, 1)
                        + interval '1 month - 1 day'))::int
    )
  );
$$;

create or replace function public.daily_birthday_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  days_until int;
  age int;
  next_bday date;
begin
  for r in
    select id, prenom, nom, pseudo, dob
    from public.profiles
    where dob is not null
  loop
    -- Prochain anniversaire (cette année ou l'an prochain). Un 29 février devient
    -- le 28 les années non bissextiles : make_date(…, 2, 29) lèverait une erreur
    -- et ferait échouer toute la boucle.
    next_bday := public.birthday_in_year(r.dob, extract(year from current_date)::int);
    if next_bday < current_date then
      next_bday := public.birthday_in_year(r.dob, extract(year from current_date)::int + 1);
    end if;
    days_until := next_bday - current_date;

    if days_until not in (0, 1, 7) then
      continue;
    end if;

    -- Âge atteint le jour de l'anniversaire (l'ancien calcul ajoutait 1 an de trop à J-1/J-7)
    age := extract(year from next_bday)::int - extract(year from r.dob)::int;

    perform public.notify_push(
      case days_until
        when 0 then 'Joyeux anniversaire !'
        when 1 then 'Anniversaire demain'
        else 'Anniversaire dans 7 jours'
      end,
      coalesce(r.pseudo, r.prenom, 'Quelqu''un') ||
        case days_until
          when 0 then ' fête ses ' || age || ' ans aujourd''hui'
          when 1 then ' aura ' || age || ' ans demain'
          else ' aura ' || age || ' ans dans une semaine'
        end,
      jsonb_build_object('route', '/(tabs)/events', 'birthdayUserId', r.id::text),
      r.id,                  -- exclude la personne dont c'est l'anniv
      null
    );
  end loop;
end;
$$;

-- ─── 2. RAPPELS VOTE PRÉSENCE : event dans 3j et pas voté ────────────────────

create or replace function public.daily_event_vote_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ev record;
  uid uuid;
  ev_label text;
begin
  for ev in
    select id, categorie, anniversaire_qui, chez_qui, lieu, date_event,
           feria_ville, sport_type, raison
    from public.events
    where date_event::date = (current_date + interval '3 days')::date
  loop
    ev_label := coalesce(
      case ev.categorie
        when 'Anniversaire' then 'Anniv' ||
          case when ev.anniversaire_qui is not null then ' de ' || ev.anniversaire_qui else '' end
        when 'Vacances' then 'Vacances' || case when ev.lieu is not null then ' — ' || ev.lieu else '' end
        when 'Féria' then 'Féria' || case when ev.feria_ville is not null then ' de ' || ev.feria_ville else '' end
        when 'Sport' then coalesce(ev.sport_type, 'Sport')
        when 'Barathon' then 'Barathon'
        when 'Autre' then coalesce(ev.raison, 'Autre')
        else ev.categorie
      end,
      'Événement'
    );

    -- Tous les users qui n'ont PAS voté pour cet event
    for uid in
      select p.id from public.profiles p
      where not exists (
        select 1 from public.event_votes v where v.event_id = ev.id and v.user_id = p.id
      )
    loop
      perform public.notify_push(
        'Réponds à ' || ev_label,
        'C''est dans 3 jours, dis si tu viens ou pas',
        jsonb_build_object('route', '/(tabs)/events', 'eventId', ev.id::text),
        null,
        array[uid]
      );
    end loop;
  end loop;
end;
$$;

-- ─── 3. RAPPELS DEADLINE BOUTIQUE / SONDAGE ─────────────────────────────────

create or replace function public.daily_shop_deadline_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  shop_dl timestamptz;
  sondage_dl timestamptz;
  days_until_shop int;
  days_until_sondage int;
  uid uuid;
begin
  -- Boutique
  select value::timestamptz into shop_dl from public.shop_config where key = 'deadline';
  if shop_dl is not null then
    days_until_shop := (shop_dl::date - current_date);
    if days_until_shop in (1, 3) then
      -- Users qui n'ont rien commandé
      for uid in
        select p.id from public.profiles p
        where not exists (select 1 from public.shop_orders o where o.user_id = p.id)
      loop
        perform public.notify_push(
          'La boutique ferme bientôt',
          case days_until_shop
            when 1 then 'Dernier jour pour commander tes articles !'
            else 'Plus que 3 jours pour passer ta commande'
          end,
          jsonb_build_object('route', '/shop'),
          null,
          array[uid]
        );
      end loop;
    end if;
  end if;

  -- Sondage candidats
  select value::timestamptz into sondage_dl from public.shop_config where key = 'sondage_deadline';
  if sondage_dl is not null then
    days_until_sondage := (sondage_dl::date - current_date);
    if days_until_sondage in (1, 3) then
      for uid in
        select p.id from public.profiles p
        where not exists (select 1 from public.sondage_votes v where v.user_id = p.id)
      loop
        perform public.notify_push(
          'Le sondage ferme bientôt',
          case days_until_sondage
            when 1 then 'Dernier jour pour voter sur les futurs articles'
            else 'Plus que 3 jours pour voter dans le sondage'
          end,
          jsonb_build_object('route', '/shop'),
          null,
          array[uid]
        );
      end loop;
    end if;
  end if;
end;
$$;

-- ─── PLANIFICATION DES CRONS ────────────────────────────────────────────────
-- Tous les jours à 9h (heure UTC du serveur Supabase = ~11h Paris l'été, 10h l'hiver).
-- Si tu veux décaler, change le cron pattern (format cron standard).

select cron.schedule(
  'daily-birthday-reminders',
  '0 9 * * *',
  $$ select public.daily_birthday_reminders(); $$
);

select cron.schedule(
  'daily-event-vote-reminders',
  '0 9 * * *',
  $$ select public.daily_event_vote_reminders(); $$
);

select cron.schedule(
  'daily-shop-deadline-reminders',
  '0 9 * * *',
  $$ select public.daily_shop_deadline_reminders(); $$
);

-- Pour lister les crons actifs :   select * from cron.job;
-- Pour supprimer un cron :          select cron.unschedule('daily-birthday-reminders');
