-- Échecs en direct (20/10/2026), classés à l'Elo comme Puissance 4.
-- Les règles des échecs ne s'écrivent pas en SQL : chaque coup passe par la fonction Edge
-- `echecs-jouer` (supabase/functions/echecs-jouer), qui rejoue la partie avec chess.js,
-- refuse les coups illégaux et détecte la fin. Elle appelle ensuite echecs_appliquer,
-- réservée au service_role. Le reste (défi, réponse, nulle, abandon) passe par des fonctions
-- SECURITY DEFINER appelées par l'appli, comme pour Puissance 4.

-- ─── Elo : un classement par jeu ───
alter table public.minijeux_elo drop constraint if exists minijeux_elo_jeu_check;
alter table public.minijeux_elo add constraint minijeux_elo_jeu_check check (jeu in ('puissance4', 'echecs'));

-- Elo après une partie : score_a = 1 (a gagne), 0,5 (nul), 0 (a perd). Renvoie le gain de a.
create or replace function public._elo(jeu_ text, a uuid, b uuid, score_a numeric)
returns integer language plpgsql security definer set search_path = public as $$
declare
  ea integer;
  eb integer;
  delta integer;
begin
  insert into public.minijeux_elo (user_id, jeu) values (a, jeu_), (b, jeu_) on conflict do nothing;
  select elo into ea from public.minijeux_elo where user_id = a and jeu = jeu_ for update;
  select elo into eb from public.minijeux_elo where user_id = b and jeu = jeu_ for update;
  delta := round(32 * (score_a - 1 / (1 + power(10, (eb - ea) / 400.0))));
  update public.minijeux_elo set
    elo = elo + delta, parties = parties + 1,
    victoires = victoires + (score_a = 1)::int, nuls = nuls + (score_a = 0.5)::int, updated_at = now()
  where user_id = a and jeu = jeu_;
  update public.minijeux_elo set
    elo = elo - delta, parties = parties + 1,
    victoires = victoires + (score_a = 0)::int, nuls = nuls + (score_a = 0.5)::int, updated_at = now()
  where user_id = b and jeu = jeu_;
  return delta;
end;
$$;
revoke execute on function public._elo from public, anon, authenticated;

-- ─── Parties ───
create table if not exists public.echecs_parties (
  id uuid primary key default gen_random_uuid(),
  joueur1 uuid not null references public.profiles (id) on delete cascade, -- celui qui défie, joue les blancs
  joueur2 uuid not null references public.profiles (id) on delete cascade, -- les noirs
  statut text not null default 'invitation' check (statut in ('invitation', 'en_cours', 'finie', 'refusee', 'abandon')),
  fen text not null default 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  historique text[] not null default '{}', -- coups joués, en notation e2e4 / e7e8q
  tour smallint not null default 1 check (tour in (1, 2)), -- 1 : blancs, 2 : noirs
  coups integer not null default 0, -- demi-coups joués
  dernier_coup text,
  gagnant smallint check (gagnant in (0, 1, 2)), -- 0 : nulle
  fin text check (fin in ('mat', 'pat', 'repetition', 'materiel', '50coups', 'accord', 'abandon')),
  nulle_proposee smallint check (nulle_proposee in (1, 2)), -- qui propose la nulle
  elo_delta integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (joueur1 <> joueur2)
);

create index if not exists echecs_parties_j1_idx on public.echecs_parties (joueur1, updated_at desc);
create index if not exists echecs_parties_j2_idx on public.echecs_parties (joueur2, updated_at desc);

alter table public.echecs_parties enable row level security;
drop policy if exists echecs_parties_select on public.echecs_parties;
create policy echecs_parties_select on public.echecs_parties
  for select to authenticated using (auth.uid() in (joueur1, joueur2));

do $$
begin
  alter publication supabase_realtime add table public.echecs_parties;
exception when duplicate_object then null;
end $$;

create or replace function public._echecs_push(corps text, partie uuid, dest uuid)
returns void language sql security definer set search_path = public as $$
  select public.notify_push('Échecs', corps, jsonb_build_object('route', '/minijeux/echiquier/' || partie), null, array[dest]);
$$;
revoke execute on function public._echecs_push from public, anon, authenticated;

-- Défier un membre (une seule partie ouverte à la fois entre deux personnes)
create or replace function public.echecs_defier(adversaire uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  pid uuid;
begin
  if me is null then raise exception 'Connexion requise'; end if;
  if adversaire is null or adversaire = me then raise exception 'Adversaire invalide'; end if;
  if not exists (select 1 from public.profiles where id = adversaire) then raise exception 'Adversaire inconnu'; end if;
  select id into pid from public.echecs_parties
  where statut in ('invitation', 'en_cours')
    and ((joueur1 = me and joueur2 = adversaire) or (joueur1 = adversaire and joueur2 = me))
  limit 1;
  if pid is not null then return pid; end if;
  insert into public.echecs_parties (joueur1, joueur2) values (me, adversaire) returning id into pid;
  perform public._echecs_push(public._prenom(me) || ' te défie aux échecs', pid, adversaire);
  return pid;
end;
$$;

create or replace function public.echecs_repondre(partie uuid, accepte boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  p public.echecs_parties;
begin
  select * into p from public.echecs_parties where id = partie for update;
  if p.id is null or p.joueur2 <> me or p.statut <> 'invitation' then raise exception 'Invitation introuvable'; end if;
  update public.echecs_parties
  set statut = case when accepte then 'en_cours' else 'refusee' end, updated_at = now()
  where id = partie;
  perform public._echecs_push(
    public._prenom(me) || case when accepte then ' accepte ton défi : à toi, tu as les blancs' else ' refuse ton défi' end,
    partie, p.joueur1);
end;
$$;

-- Appelée par la fonction Edge après vérification du coup. `avant` = demi-coups au moment
-- de la vérification : si un autre coup est passé entre-temps, celui-ci est refusé.
create or replace function public.echecs_appliquer(
  partie uuid, joueur uuid, avant integer, uci text, fen_ text, fin_ text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  p public.echecs_parties;
  moi smallint;
  adversaire uuid;
  score numeric;
  delta integer;
begin
  select * into p from public.echecs_parties where id = partie for update;
  if p.id is null or p.statut <> 'en_cours' then raise exception 'Partie terminée ou introuvable'; end if;
  moi := case when joueur = p.joueur1 then 1 when joueur = p.joueur2 then 2 end;
  if moi is null then raise exception 'Tu ne joues pas cette partie'; end if;
  if p.tour <> moi or p.coups <> avant then raise exception 'Ce n''est pas ton tour'; end if;
  adversaire := case when moi = 1 then p.joueur2 else p.joueur1 end;

  update public.echecs_parties set
    fen = fen_, historique = historique || uci, dernier_coup = uci, coups = coups + 1,
    tour = case when moi = 1 then 2 else 1 end,
    -- Le coup de l'adversaire vaut refus ; sa propre offre reste valable
    nulle_proposee = case when nulle_proposee = moi then moi end, updated_at = now()
  where id = partie;

  if fin_ is null then
    -- Notification seulement si l'adversaire n'est sans doute pas devant la partie
    if p.updated_at < now() - interval '90 seconds' then
      perform public._echecs_push(public._prenom(joueur) || ' a joué : à toi', partie, adversaire);
    end if;
    return;
  end if;

  score := case when fin_ = 'mat' then 1 else 0.5 end;
  delta := public._elo('echecs', joueur, adversaire, score);
  update public.echecs_parties set statut = 'finie', gagnant = case when score = 1 then moi else 0 end,
    fin = fin_, elo_delta = delta
  where id = partie;
  perform public._echecs_push(
    case when score = 1 then public._prenom(joueur) || ' te met échec et mat (' || delta || ' Elo)'
         else 'Partie nulle contre ' || public._prenom(joueur) end,
    partie, adversaire);
end;
$$;
revoke execute on function public.echecs_appliquer from public, anon, authenticated;
grant execute on function public.echecs_appliquer to service_role;

-- Proposer la nulle, ou répondre à celle de l'adversaire : action = 'proposer', 'accepter' ou 'refuser'.
-- Une action qui ne correspond plus à l'état (offre retirée entre-temps) ne fait rien.
drop function if exists public.echecs_nulle(uuid, boolean);
create or replace function public.echecs_nulle(partie uuid, action text)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  p public.echecs_parties;
  moi smallint;
  adversaire uuid;
  delta integer;
begin
  select * into p from public.echecs_parties where id = partie for update;
  if p.id is null or p.statut <> 'en_cours' then raise exception 'Partie terminée ou introuvable'; end if;
  moi := case when me = p.joueur1 then 1 when me = p.joueur2 then 2 end;
  if moi is null then raise exception 'Tu ne joues pas cette partie'; end if;
  adversaire := case when moi = 1 then p.joueur2 else p.joueur1 end;

  if action = 'proposer' and p.nulle_proposee is null then
    update public.echecs_parties set nulle_proposee = moi, updated_at = now() where id = partie;
    perform public._echecs_push(public._prenom(me) || ' propose la nulle', partie, adversaire);
  elsif action = 'accepter' and p.nulle_proposee <> moi then
    delta := public._elo('echecs', me, adversaire, 0.5);
    update public.echecs_parties set statut = 'finie', gagnant = 0, fin = 'accord', elo_delta = delta,
      nulle_proposee = null, updated_at = now()
    where id = partie;
    perform public._echecs_push(public._prenom(me) || ' accepte la nulle', partie, adversaire);
  elsif action = 'refuser' and p.nulle_proposee <> moi then
    update public.echecs_parties set nulle_proposee = null, updated_at = now() where id = partie;
    perform public._echecs_push(public._prenom(me) || ' refuse la nulle', partie, adversaire);
  end if;
end;
$$;

create or replace function public.echecs_abandonner(partie uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  p public.echecs_parties;
  adversaire uuid;
  delta integer;
begin
  select * into p from public.echecs_parties where id = partie for update;
  if p.id is null or me not in (p.joueur1, p.joueur2) then raise exception 'Partie introuvable'; end if;
  if p.statut = 'invitation' then
    update public.echecs_parties set statut = 'refusee', updated_at = now() where id = partie;
    return;
  end if;
  if p.statut <> 'en_cours' then return; end if;
  adversaire := case when me = p.joueur1 then p.joueur2 else p.joueur1 end;
  delta := public._elo('echecs', adversaire, me, 1);
  update public.echecs_parties set statut = 'abandon', fin = 'abandon',
    gagnant = case when me = p.joueur1 then 2 else 1 end, elo_delta = delta, nulle_proposee = null, updated_at = now()
  where id = partie;
  perform public._echecs_push(public._prenom(me) || ' abandonne : tu gagnes (' || delta || ' Elo)', partie, adversaire);
end;
$$;

revoke execute on function public.echecs_defier, public.echecs_repondre, public.echecs_nulle, public.echecs_abandonner
  from public, anon;
grant execute on function public.echecs_defier, public.echecs_repondre, public.echecs_nulle, public.echecs_abandonner
  to authenticated;
