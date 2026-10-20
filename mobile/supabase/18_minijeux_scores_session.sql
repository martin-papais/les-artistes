-- Mini-jeux au meilleur score (20/10/2026) : un score ne s'enregistre plus en direct.
-- L'appli ouvre une session au début de la partie (minijeux_commencer) et envoie le score
-- à la fin (minijeux_enregistrer). Le serveur mesure lui-même la durée de la partie et refuse
-- un score impossible dans ce temps. Une session ne sert qu'une fois : un renvoi après une
-- réponse perdue ne crée pas de doublon.
-- Le record de chacun porte aussi sa date d'obtention (record_at), qui départage les égalités.

-- ─── Sessions de partie ───
create table if not exists public.minijeux_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  jeu text not null check (jeu in ('reflexes', 'flappy', 'basket', 'stack', 'stop10')),
  debut timestamptz not null default now(),
  utilisee boolean not null default false
);

create index if not exists minijeux_sessions_user_idx on public.minijeux_sessions (user_id, debut);

alter table public.minijeux_sessions enable row level security;
-- Aucune policy : seules les fonctions ci-dessous lisent et écrivent les sessions

-- ─── Plus d'insertion directe des scores ───
drop policy if exists minijeux_scores_insert on public.minijeux_scores;
revoke insert on public.minijeux_scores from anon, authenticated;

-- Ouvre une partie et rend son identifiant
create or replace function public.minijeux_commencer(jeu text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  sid uuid;
begin
  if me is null then raise exception 'Connexion requise' using errcode = '28000'; end if;
  if jeu is null or jeu not in ('reflexes', 'flappy', 'basket', 'stack', 'stop10') then
    raise exception 'Jeu inconnu';
  end if;
  -- Les sessions de la veille ne servent plus à rien
  delete from public.minijeux_sessions where user_id = me and debut < now() - interval '1 day';
  -- Garde-fou contre une boucle d'appels
  if (select count(*) from public.minijeux_sessions where user_id = me and debut > now() - interval '1 minute') >= 30 then
    raise exception 'Trop de parties d''un coup';
  end if;
  insert into public.minijeux_sessions (user_id, jeu) values (me, jeu) returning id into sid;
  return sid;
end;
$$;

-- Enregistre le score d'une partie ouverte par minijeux_commencer.
-- Rend true si le score est enregistré, false s'il l'était déjà (renvoi).
-- Un refus (partie inconnue, trop ancienne, score impossible) lève une erreur P0001 :
-- l'appli ne le renvoie pas.
create or replace function public.minijeux_enregistrer(session uuid, score integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  s public.minijeux_sessions;
  ecoule bigint; -- millisecondes depuis l'ouverture de la partie, mesurées par le serveur
  plausible boolean;
begin
  if me is null then raise exception 'Connexion requise' using errcode = '28000'; end if;
  select * into s from public.minijeux_sessions where id = session for update;
  if s.id is null or s.user_id <> me then raise exception 'Partie inconnue'; end if;
  if s.utilisee then return false; end if;
  ecoule := floor(extract(epoch from now() - s.debut) * 1000);
  -- Une journée : la session s'ouvre dès l'écran d'intro, et un score fait hors ligne repart plus tard
  if ecoule > 24 * 3600 * 1000 then raise exception 'Partie trop ancienne'; end if;
  -- Durée minimale pour obtenir ce score (cf. le code de chaque jeu dans l'appli)
  plausible := case s.jeu
    -- 5 essais : au moins 1,2 s d'attente, le temps de réaction, 0,9 s d'affichage chacun
    -- (10,5 s + 5 × moyenne), moins 2 s de marge ; sous 100 ms personne ne réagit
    when 'reflexes' then score between 100 and 5000 and ecoule >= 8500 + 5 * score
    -- Un tuyau franchi toutes les 1,1 s au plus vite, le premier après 2 s
    when 'flappy' then score between 0 and 10000 and ecoule >= 1000 * score
    -- 30 s de chrono à partir du premier lancer, 2 points par lancer au plus
    when 'basket' then score between 0 and 90 and ecoule >= 28000
    -- Le bloc doit glisser jusqu'à la tour : pas plus de 3 étages par seconde
    when 'stack' then score between 0 and 2000 and ecoule >= 300 * score
    -- Écart avec 10,00 s (l'essai s'arrête seul à 20 s) ; le résultat reste affiché 1,8 s
    when 'stop10' then score between 0 and 10000 and ecoule >= 9500 - score
    else false
  end;
  if not plausible then raise exception 'Score impossible pour la durée de la partie'; end if;
  insert into public.minijeux_scores (user_id, jeu, score) values (me, s.jeu, score);
  update public.minijeux_sessions set utilisee = true where id = s.id;
  return true;
end;
$$;

revoke execute on function public.minijeux_commencer, public.minijeux_enregistrer from public, anon;
grant execute on function public.minijeux_commencer, public.minijeux_enregistrer to authenticated;

-- ─── Records : date d'obtention du record ───
-- record_at : première partie où le record a été atteint. À égalité, le premier à l'avoir
-- obtenu passe devant ; rejouer moins bien ne change rien.
create or replace view public.minijeux_records
with (security_invoker = true) as
with b as (
  select
    jeu,
    user_id,
    case when jeu in ('reflexes', 'stop10') then min(score) else max(score) end as best,
    count(*)::int as parties,
    max(created_at) as last_played
  from public.minijeux_scores
  group by jeu, user_id
)
select
  b.jeu,
  b.user_id,
  b.best,
  b.parties,
  b.last_played,
  (
    select min(s.created_at) from public.minijeux_scores s
    where s.jeu = b.jeu and s.user_id = b.user_id and s.score = b.best
  ) as record_at
from b;

grant select on public.minijeux_records to authenticated;
