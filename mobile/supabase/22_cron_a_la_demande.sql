-- 22 : le cron des pendules ne tourne que s'il y a un défi ou une partie ouverte (21/10/2026,
-- idée de Thomas). Un défi (insert dans p4_parties ou echecs_parties) le démarre ; il s'arrête
-- de lui-même au premier passage où il ne reste plus rien d'ouvert.
-- Le verrou commun évite qu'un défi lancé pendant l'arrêt se retrouve sans cron.
-- Ré-exécutable.

create or replace function public._duel_cron_demarrer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('duel-pendules'));
  if not exists (select 1 from cron.job where jobname = 'duel-pendules') then
    perform cron.schedule('duel-pendules', '* * * * *', 'select public._duel_verifier_tout()');
  end if;
  return null;
end;
$$;

drop trigger if exists p4_parties_cron on public.p4_parties;
create trigger p4_parties_cron after insert on public.p4_parties
  for each statement execute function public._duel_cron_demarrer();
drop trigger if exists echecs_parties_cron on public.echecs_parties;
create trigger echecs_parties_cron after insert on public.echecs_parties
  for each statement execute function public._duel_cron_demarrer();

create or replace function public._duel_verifier_tout()
returns void language plpgsql security definer set search_path = public as $$
declare
  pid uuid;
begin
  for pid in select id from public.p4_parties where statut = 'en_cours' and tour_depuis is not null loop
    perform public._duel_verifier('puissance4', pid);
  end loop;
  for pid in select id from public.echecs_parties where statut = 'en_cours' and tour_depuis is not null loop
    perform public._duel_verifier('echecs', pid);
  end loop;
  update public.p4_parties set statut = 'refusee', fin = 'expire', updated_at = now()
  where statut = 'invitation' and created_at < now() - interval '10 minutes';
  update public.echecs_parties set statut = 'refusee', fin = 'expire', updated_at = now()
  where statut = 'invitation' and created_at < now() - interval '10 minutes';

  -- Plus rien d'ouvert : le cron s'arrête, le prochain défi le relancera
  perform pg_advisory_xact_lock(hashtext('duel-pendules'));
  if not exists (select 1 from public.p4_parties where statut in ('invitation', 'en_cours'))
    and not exists (select 1 from public.echecs_parties where statut in ('invitation', 'en_cours')) then
    perform cron.unschedule('duel-pendules');
  end if;
end;
$$;
revoke execute on function public._duel_verifier_tout from public, anon, authenticated;
