-- Triggers qui appellent notify_push() à chaque INSERT sur les tables d'intérêt.
-- Tous les triggers utilisent fire-and-forget (pg_net est asynchrone), donc ils ne
-- ralentissent pas l'INSERT et ne le font PAS échouer si l'Edge Function plante.

-- ─── EVENTS ──────────────────────────────────────────────────────────────────

create or replace function public.tg_events_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  title_label text;
begin
  title_label := coalesce(
    case new.categorie
      when 'Anniversaire' then 'Anniversaire' ||
        case when new.anniversaire_qui is not null then ' de ' || new.anniversaire_qui else '' end ||
        case when new.chez_qui is not null then ' chez ' || new.chez_qui else '' end
      when 'Vacances' then 'Vacances' || case when new.lieu is not null then ' — ' || new.lieu else '' end
      when 'Féria' then 'Féria' || case when new.feria_ville is not null then ' de ' || new.feria_ville else '' end
      when 'Sport' then coalesce(new.sport_type, 'Sport')
      when 'Barathon' then 'Barathon' || case when new.lieu is not null then ' — ' || new.lieu else '' end
      when 'Autre' then coalesce(new.raison, 'Autre')
      else new.categorie || case when new.chez_qui is not null then ' chez ' || new.chez_qui else '' end
    end,
    'Nouvel événement'
  );

  perform public.notify_push(
    'Nouvel événement',
    title_label || ' · ' || to_char(new.date_event, 'DD/MM'),
    jsonb_build_object('route', '/(tabs)/events', 'eventId', new.id),
    new.created_by,
    null
  );
  return new;
end;
$$;

drop trigger if exists trg_events_notify on public.events;
create trigger trg_events_notify
  after insert on public.events
  for each row execute function public.tg_events_notify();

-- ─── NEWS ────────────────────────────────────────────────────────────────────

create or replace function public.tg_news_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_push(
    'Nouvelle actu',
    coalesce(new.titre, 'Sans titre'),
    jsonb_build_object('route', '/(tabs)/news', 'newsId', new.id),
    new.created_by,
    null
  );
  return new;
end;
$$;

drop trigger if exists trg_news_notify on public.news;
create trigger trg_news_notify
  after insert on public.news
  for each row execute function public.tg_news_notify();

-- ─── PHOTOS ──────────────────────────────────────────────────────────────────

create or replace function public.tg_photos_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  author_name text;
begin
  select coalesce(pseudo, prenom, '?') into author_name
  from public.profiles where id = new.created_by;

  perform public.notify_push(
    'Nouvelle photo',
    coalesce(author_name, 'Quelqu''un') || ' a partagé une photo',
    jsonb_build_object('route', '/(tabs)/photos', 'photoId', new.id),
    new.created_by,
    null
  );
  return new;
end;
$$;

drop trigger if exists trg_photos_notify on public.photos;
create trigger trg_photos_notify
  after insert on public.photos
  for each row execute function public.tg_photos_notify();

-- ─── COMMENTAIRES EVENT (cibles : créateur + autres commentateurs + voteurs) ─

create or replace function public.tg_event_comments_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ev_creator uuid;
  participant_ids uuid[];
  author_name text;
begin
  select created_by into ev_creator from public.events where id = new.event_id;

  -- Tous ceux qui ont participé : voté ou commenté avant
  select array_agg(distinct uid) into participant_ids
  from (
    select user_id as uid from public.event_votes where event_id = new.event_id
    union
    select user_id from public.event_comments where event_id = new.event_id
    union select ev_creator
  ) s
  where uid is not null;

  if participant_ids is null or array_length(participant_ids, 1) is null then
    return new;
  end if;

  select coalesce(pseudo, prenom, '?') into author_name
  from public.profiles where id = new.user_id;

  perform public.notify_push(
    'Nouveau commentaire',
    coalesce(author_name, 'Quelqu''un') || ' : ' || left(new.contenu, 100),
    jsonb_build_object('route', '/(tabs)/events', 'eventId', new.event_id),
    new.user_id,
    participant_ids
  );
  return new;
end;
$$;

drop trigger if exists trg_event_comments_notify on public.event_comments;
create trigger trg_event_comments_notify
  after insert on public.event_comments
  for each row execute function public.tg_event_comments_notify();

-- ─── COMMENTAIRES NEWS (cibles : créateur + autres commentateurs + likers) ──

create or replace function public.tg_news_comments_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  news_creator uuid;
  participant_ids uuid[];
  author_name text;
begin
  select created_by into news_creator from public.news where id = new.news_id;

  select array_agg(distinct uid) into participant_ids
  from (
    select user_id as uid from public.news_likes where news_id = new.news_id
    union
    select user_id from public.news_comments where news_id = new.news_id
    union select news_creator
  ) s
  where uid is not null;

  if participant_ids is null or array_length(participant_ids, 1) is null then
    return new;
  end if;

  select coalesce(pseudo, prenom, '?') into author_name
  from public.profiles where id = new.user_id;

  perform public.notify_push(
    'Nouveau commentaire',
    coalesce(author_name, 'Quelqu''un') || ' : ' || left(new.contenu, 100),
    jsonb_build_object('route', '/(tabs)/news', 'newsId', new.news_id),
    new.user_id,
    participant_ids
  );
  return new;
end;
$$;

drop trigger if exists trg_news_comments_notify on public.news_comments;
create trigger trg_news_comments_notify
  after insert on public.news_comments
  for each row execute function public.tg_news_comments_notify();

-- ─── RÉACTIONS NOTES (cibles : auteur de la note) ───────────────────────────

create or replace function public.tg_note_reactions_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  note_author uuid;
  author_name text;
begin
  select user_id into note_author from public.notes where id = new.note_id;
  if note_author is null or note_author = new.user_id then
    return new;
  end if;

  select coalesce(pseudo, prenom, '?') into author_name
  from public.profiles where id = new.user_id;

  perform public.notify_push(
    'Réaction à ta note',
    coalesce(author_name, 'Quelqu''un') || ' a réagi avec ' || new.emoji,
    jsonb_build_object('route', '/notes'),
    new.user_id,
    array[note_author]
  );
  return new;
end;
$$;

drop trigger if exists trg_note_reactions_notify on public.note_reactions;
create trigger trg_note_reactions_notify
  after insert on public.note_reactions
  for each row execute function public.tg_note_reactions_notify();
