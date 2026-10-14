-- Qui a répondu « Absent » à un événement ne reçoit plus les notifications de
-- cet événement (nouveaux commentaires). S'il change d'avis et passe « Présent »
-- ou retire son vote, il les reçoit de nouveau.
-- À coller dans le SQL Editor (remplace la fonction de 03_triggers.sql).

create or replace function public.tg_event_comments_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ev_creator uuid;
  participant_ids uuid[];
  author_name text;
begin
  select created_by into ev_creator from public.events where id = new.event_id;

  -- Tous ceux qui ont participé : voté ou commenté avant, sauf les absents
  select array_agg(distinct uid) into participant_ids
  from (
    select user_id as uid from public.event_votes where event_id = new.event_id
    union
    select user_id from public.event_comments where event_id = new.event_id
    union select ev_creator
  ) s
  where uid is not null
    and not exists (
      select 1 from public.event_votes v
      where v.event_id = new.event_id and v.user_id = s.uid and v.present = 'non'
    );

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
