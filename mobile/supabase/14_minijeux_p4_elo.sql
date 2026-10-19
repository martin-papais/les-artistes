-- Mini-jeux, suite (20/10/2026) : Stack et Stop à 10 secondes au meilleur score,
-- Puissance 4 en direct avec un classement Elo.
-- Toutes les écritures de Puissance 4 passent par des fonctions SECURITY DEFINER :
-- le serveur vérifie le tour, pose le jeton, détecte la victoire et calcule l'Elo.

-- ─── Nouveaux jeux au meilleur score ───
alter table public.minijeux_scores drop constraint if exists minijeux_scores_jeu_check;
alter table public.minijeux_scores
  add constraint minijeux_scores_jeu_check check (jeu in ('reflexes', 'flappy', 'basket', 'stack', 'stop10'));

alter table public.minijeux_scores drop constraint if exists minijeux_scores_plausible;
alter table public.minijeux_scores add constraint minijeux_scores_plausible check (
  (jeu = 'reflexes' and score between 80 and 5000)
  or (jeu = 'flappy' and score between 0 and 10000)
  or (jeu = 'basket' and score between 0 and 200)
  or (jeu = 'stack' and score between 0 and 2000)
  -- Écart en millisecondes avec 10,00 s
  or (jeu = 'stop10' and score between 0 and 10000)
);

-- Réflexes et Stop à 10 s : le plus petit gagne
create or replace view public.minijeux_records
with (security_invoker = true) as
select
  jeu,
  user_id,
  case when jeu in ('reflexes', 'stop10') then min(score) else max(score) end as best,
  count(*)::int as parties,
  max(created_at) as last_played
from public.minijeux_scores
group by jeu, user_id;

grant select on public.minijeux_records to authenticated;

-- ─── Elo (jeux en direct) ───
create table if not exists public.minijeux_elo (
  user_id uuid not null references public.profiles (id) on delete cascade,
  jeu text not null check (jeu in ('puissance4')),
  elo integer not null default 1000,
  parties integer not null default 0,
  victoires integer not null default 0,
  nuls integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, jeu)
);

alter table public.minijeux_elo enable row level security;
drop policy if exists minijeux_elo_select on public.minijeux_elo;
create policy minijeux_elo_select on public.minijeux_elo for select to authenticated using (true);
-- Pas de policy d'écriture : seul le serveur (fonctions ci-dessous) modifie l'Elo

-- ─── Parties de Puissance 4 ───
-- Plateau : 42 caractères, 6 lignes de 7 colonnes, ligne 0 en haut ; '0' vide, '1' et '2' les joueurs.
create table if not exists public.p4_parties (
  id uuid primary key default gen_random_uuid(),
  joueur1 uuid not null references public.profiles (id) on delete cascade, -- celui qui défie, commence
  joueur2 uuid not null references public.profiles (id) on delete cascade,
  statut text not null default 'invitation' check (statut in ('invitation', 'en_cours', 'finie', 'refusee', 'abandon')),
  plateau text not null default repeat('0', 42) check (length(plateau) = 42),
  tour smallint not null default 1 check (tour in (1, 2)),
  coups integer not null default 0,
  dernier_coup integer, -- index de la case jouée en dernier
  gagnant smallint check (gagnant in (0, 1, 2)), -- 0 : match nul
  ligne_gagnante integer[],
  elo_delta integer, -- points gagnés par le vainqueur (perdus par l'autre)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (joueur1 <> joueur2)
);

create index if not exists p4_parties_j1_idx on public.p4_parties (joueur1, updated_at desc);
create index if not exists p4_parties_j2_idx on public.p4_parties (joueur2, updated_at desc);

alter table public.p4_parties enable row level security;
drop policy if exists p4_parties_select on public.p4_parties;
create policy p4_parties_select on public.p4_parties
  for select to authenticated using (auth.uid() in (joueur1, joueur2));
-- Aucune écriture directe : tout passe par les fonctions

-- Temps réel : l'adversaire voit le coup arriver sans recharger
do $$
begin
  alter publication supabase_realtime add table public.p4_parties;
exception when duplicate_object then null;
end $$;

-- Prénom (ou pseudo) pour les notifications
create or replace function public._prenom(p uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(prenom, ''), nullif(pseudo, ''), 'Quelqu''un') from public.profiles where id = p;
$$;
revoke execute on function public._prenom from public, anon, authenticated;

-- Elo après une partie : score_a = 1 (a gagne), 0,5 (nul), 0 (a perd). Renvoie le gain de a.
create or replace function public._p4_elo(a uuid, b uuid, score_a numeric)
returns integer language plpgsql security definer set search_path = public as $$
declare
  ea integer;
  eb integer;
  expected numeric;
  delta integer;
begin
  insert into public.minijeux_elo (user_id, jeu) values (a, 'puissance4'), (b, 'puissance4')
  on conflict do nothing;
  select elo into ea from public.minijeux_elo where user_id = a and jeu = 'puissance4' for update;
  select elo into eb from public.minijeux_elo where user_id = b and jeu = 'puissance4' for update;
  expected := 1 / (1 + power(10, (eb - ea) / 400.0));
  delta := round(32 * (score_a - expected));
  update public.minijeux_elo set
    elo = elo + delta,
    parties = parties + 1,
    victoires = victoires + (score_a = 1)::int,
    nuls = nuls + (score_a = 0.5)::int,
    updated_at = now()
  where user_id = a and jeu = 'puissance4';
  update public.minijeux_elo set
    elo = elo - delta,
    parties = parties + 1,
    victoires = victoires + (score_a = 0)::int,
    nuls = nuls + (score_a = 0.5)::int,
    updated_at = now()
  where user_id = b and jeu = 'puissance4';
  return delta;
end;
$$;
revoke execute on function public._p4_elo from public, anon, authenticated;

-- Défier un membre : crée l'invitation et le prévient
create or replace function public.p4_defier(adversaire uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  pid uuid;
begin
  if me is null then raise exception 'Connexion requise'; end if;
  if adversaire is null or adversaire = me then raise exception 'Adversaire invalide'; end if;
  if not exists (select 1 from public.profiles where id = adversaire) then raise exception 'Adversaire inconnu'; end if;
  -- Une seule invitation ou partie en cours à la fois entre deux personnes
  select id into pid from public.p4_parties
  where statut in ('invitation', 'en_cours')
    and ((joueur1 = me and joueur2 = adversaire) or (joueur1 = adversaire and joueur2 = me))
  limit 1;
  if pid is not null then return pid; end if;
  insert into public.p4_parties (joueur1, joueur2) values (me, adversaire) returning id into pid;
  perform public.notify_push(
    'Puissance 4',
    public._prenom(me) || ' te défie au Puissance 4',
    jsonb_build_object('route', '/minijeux/partie/' || pid),
    null,
    array[adversaire]
  );
  return pid;
end;
$$;

-- Accepter ou refuser une invitation (seul l'invité)
create or replace function public.p4_repondre(partie uuid, accepte boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  p public.p4_parties;
begin
  select * into p from public.p4_parties where id = partie for update;
  if p.id is null or p.joueur2 <> me or p.statut <> 'invitation' then raise exception 'Invitation introuvable'; end if;
  update public.p4_parties
  set statut = case when accepte then 'en_cours' else 'refusee' end, updated_at = now()
  where id = partie;
  perform public.notify_push(
    'Puissance 4',
    public._prenom(me) || case when accepte then ' accepte ton défi : à toi de jouer' else ' refuse ton défi' end,
    jsonb_build_object('route', '/minijeux/partie/' || partie),
    null,
    array[p.joueur1]
  );
end;
$$;

-- Jouer dans une colonne (0 à 6)
create or replace function public.p4_jouer(partie uuid, colonne integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  p public.p4_parties;
  moi smallint;
  r integer;
  idx integer := null;
  board text;
  dirs integer[][] := array[[0, 1], [1, 0], [1, 1], [1, -1]];
  d integer;
  n integer;
  rr integer;
  cc integer;
  cells integer[];
  win integer[] := null;
  delta integer := null;
  adversaire uuid;
  absent boolean;
begin
  select * into p from public.p4_parties where id = partie for update;
  if p.id is null or p.statut <> 'en_cours' then raise exception 'Partie terminée ou introuvable'; end if;
  moi := case when me = p.joueur1 then 1 when me = p.joueur2 then 2 else null end;
  if moi is null then raise exception 'Tu ne joues pas cette partie'; end if;
  if p.tour <> moi then raise exception 'Ce n''est pas ton tour'; end if;
  if colonne is null or colonne < 0 or colonne > 6 then raise exception 'Colonne invalide'; end if;

  -- Le jeton tombe sur la case libre la plus basse
  for r in reverse 5..0 loop
    if substr(p.plateau, r * 7 + colonne + 1, 1) = '0' then
      idx := r * 7 + colonne;
      exit;
    end if;
  end loop;
  if idx is null then raise exception 'Colonne pleine'; end if;
  board := overlay(p.plateau placing moi::text from idx + 1 for 1);

  -- Quatre alignés passant par ce jeton
  for d in 1..4 loop
    cells := array[idx];
    for n in 1..3 loop
      rr := idx / 7 + dirs[d][1] * n; cc := idx % 7 + dirs[d][2] * n;
      exit when rr < 0 or rr > 5 or cc < 0 or cc > 6 or substr(board, rr * 7 + cc + 1, 1) <> moi::text;
      cells := cells || (rr * 7 + cc);
    end loop;
    for n in 1..3 loop
      rr := idx / 7 - dirs[d][1] * n; cc := idx % 7 - dirs[d][2] * n;
      exit when rr < 0 or rr > 5 or cc < 0 or cc > 6 or substr(board, rr * 7 + cc + 1, 1) <> moi::text;
      cells := cells || (rr * 7 + cc);
    end loop;
    if array_length(cells, 1) >= 4 then win := cells; exit; end if;
  end loop;

  adversaire := case when moi = 1 then p.joueur2 else p.joueur1 end;
  -- L'adversaire n'a pas joué depuis 90 s : il n'est sans doute pas devant la partie
  absent := p.updated_at < now() - interval '90 seconds';

  if win is not null then
    delta := public._p4_elo(me, adversaire, 1);
    update public.p4_parties set plateau = board, coups = coups + 1, dernier_coup = idx, statut = 'finie',
      gagnant = moi, ligne_gagnante = win, elo_delta = delta, updated_at = now()
    where id = partie;
    perform public.notify_push('Puissance 4', public._prenom(me) || ' a gagné la partie (' || delta || ' Elo)',
      jsonb_build_object('route', '/minijeux/partie/' || partie), null, array[adversaire]);
  elsif position('0' in board) = 0 then
    delta := public._p4_elo(me, adversaire, 0.5);
    update public.p4_parties set plateau = board, coups = coups + 1, dernier_coup = idx, statut = 'finie',
      gagnant = 0, elo_delta = delta, updated_at = now()
    where id = partie;
    perform public.notify_push('Puissance 4', 'Match nul contre ' || public._prenom(me),
      jsonb_build_object('route', '/minijeux/partie/' || partie), null, array[adversaire]);
  else
    update public.p4_parties set plateau = board, coups = coups + 1, dernier_coup = idx,
      tour = case when moi = 1 then 2 else 1 end, updated_at = now()
    where id = partie;
    if absent then
      perform public.notify_push('Puissance 4', public._prenom(me) || ' a joué : à toi',
        jsonb_build_object('route', '/minijeux/partie/' || partie), null, array[adversaire]);
    end if;
  end if;
end;
$$;

-- Abandonner : la partie est perdue (Elo compris) ; une invitation est simplement annulée
create or replace function public.p4_abandonner(partie uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  p public.p4_parties;
  adversaire uuid;
  delta integer;
begin
  select * into p from public.p4_parties where id = partie for update;
  if p.id is null or me not in (p.joueur1, p.joueur2) then raise exception 'Partie introuvable'; end if;
  if p.statut = 'invitation' then
    update public.p4_parties set statut = 'refusee', updated_at = now() where id = partie;
    return;
  end if;
  if p.statut <> 'en_cours' then return; end if;
  adversaire := case when me = p.joueur1 then p.joueur2 else p.joueur1 end;
  delta := public._p4_elo(adversaire, me, 1);
  update public.p4_parties set statut = 'abandon', gagnant = case when me = p.joueur1 then 2 else 1 end,
    elo_delta = delta, updated_at = now()
  where id = partie;
  perform public.notify_push('Puissance 4', public._prenom(me) || ' abandonne : tu gagnes (' || delta || ' Elo)',
    jsonb_build_object('route', '/minijeux/partie/' || partie), null, array[adversaire]);
end;
$$;

revoke execute on function public.p4_defier, public.p4_repondre, public.p4_jouer, public.p4_abandonner from public, anon;
grant execute on function public.p4_defier, public.p4_repondre, public.p4_jouer, public.p4_abandonner to authenticated;
