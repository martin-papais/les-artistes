-- Purge quotidienne des événements de plus d'un an (04/10/2026).
-- Remplace autoCleanOldEvents(), qui tournait dans le navigateur à chaque ouverture
-- de events.html (5 requêtes par vieil événement, chez chaque membre).
-- Même critère : date_event < aujourd'hui - 1 an. Ré-exécutable.

create or replace function public.purge_old_events()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  old_ids uuid[];
begin
  select array_agg(id) into old_ids
  from public.events
  where date_event < (current_date - interval '1 year');

  if old_ids is null then
    return;
  end if;

  delete from public.event_comments      where event_id = any(old_ids);
  delete from public.event_votes         where event_id = any(old_ids);
  delete from public.event_food_votes    where event_id = any(old_ids);
  delete from public.event_courses_votes where event_id = any(old_ids);
  delete from public.events              where id = any(old_ids);
end;
$$;

revoke execute on function public.purge_old_events from public, anon, authenticated;

select cron.schedule('daily-purge-old-events', '30 3 * * *', $$ select public.purge_old_events(); $$);
