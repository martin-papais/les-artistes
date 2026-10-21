-- 21 : moins de charge disque (21/10/2026). Cette nuit, de 00 h 40 à 11 h, l'instance gratuite
-- (t4g.nano) a épuisé son budget Disk IO et la base a été bridée : l'appli chargeait sans fin.
-- Le cron des pendules tournait toutes les 15 s, jour et nuit (un processus Postgres lancé
-- et 4 écritures dans cron.job_run_details à chaque fois).
-- Toutes les minutes suffit : le signe de vie d'un joueur (duel_present, toutes les 15 s),
-- ses coups et ses propositions de nulle vérifient déjà les échéances. Le cron ne tranche
-- seul que les parties où les deux joueurs sont partis, et les défis de plus de 10 minutes.
-- Ré-exécutable.

select cron.unschedule('duel-pendules') where exists (select 1 from cron.job where jobname = 'duel-pendules');
select cron.schedule('duel-pendules', '* * * * *', 'select public._duel_verifier_tout()');

-- Historique des crons : purge quotidienne, on garde un jour
select cron.unschedule('purge-cron-historique') where exists (select 1 from cron.job where jobname = 'purge-cron-historique');
select cron.schedule('purge-cron-historique', '15 4 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '1 day' $$);

delete from cron.job_run_details where end_time < now() - interval '1 day';
