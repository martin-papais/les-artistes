-- Mini-jeux de l'appli (19/10/2026) : une ligne par partie terminée.
-- Classement = meilleur score de chacun par jeu (le plus petit pour Réflexes, en ms).
-- Pas de modification ni de suppression côté appli : une partie jouée reste jouée.
-- Les parties partent avec le compte (cascade sur profiles, cf. 08_suppression_compte).

create table if not exists public.minijeux_scores (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  jeu text not null check (jeu in ('reflexes', 'flappy', 'basket')),
  score integer not null,
  created_at timestamptz not null default now(),
  -- Garde-fous contre une valeur envoyée à la main : bornes humainement possibles
  constraint minijeux_scores_plausible check (
    (jeu = 'reflexes' and score between 80 and 5000)
    or (jeu = 'flappy' and score between 0 and 10000)
    or (jeu = 'basket' and score between 0 and 200)
  )
);

create index if not exists minijeux_scores_jeu_idx on public.minijeux_scores (jeu, score);

alter table public.minijeux_scores enable row level security;

drop policy if exists minijeux_scores_select on public.minijeux_scores;
create policy minijeux_scores_select on public.minijeux_scores
  for select to authenticated using (true);

drop policy if exists minijeux_scores_insert on public.minijeux_scores;
create policy minijeux_scores_insert on public.minijeux_scores
  for insert to authenticated with check (user_id = auth.uid());

-- Record de chacun par jeu ; security_invoker : la vue applique la RLS de celui qui lit
create or replace view public.minijeux_records
with (security_invoker = true) as
select
  jeu,
  user_id,
  case when jeu = 'reflexes' then min(score) else max(score) end as best,
  count(*)::int as parties,
  max(created_at) as last_played
from public.minijeux_scores
group by jeu, user_id;

grant select on public.minijeux_records to authenticated;
