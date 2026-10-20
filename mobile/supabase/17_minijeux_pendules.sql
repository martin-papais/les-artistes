-- 17 : parties en direct à la pendule (21/10/2026).
-- Échecs : 10 minutes par joueur. Puissance 4 : 3 minutes par joueur (21 jetons au plus chacun).
-- Le temps du joueur au trait s'écoule ; à zéro il perd. Un joueur qui n'a plus l'écran de la
-- partie ouvert depuis une minute (l'appli envoie un signe de vie toutes les 15 s) est éliminé.
-- Un défi non accepté expire au bout de 10 minutes. Les parties commencées avant cette
-- migration n'ont pas de pendule (temps1_ms null) et continuent comme avant.
-- Toutes les fins de partie passent par _duel_finir : Elo, gain de chaque joueur, statut.

-- ─── Colonnes ───
alter table public.p4_parties
  add column if not exists temps1_ms integer,
  add column if not exists temps2_ms integer,
  add column if not exists tour_depuis timestamptz,
  add column if not exists vu1 timestamptz,
  add column if not exists vu2 timestamptz,
  add column if not exists rev integer not null default 0,
  add column if not exists delta1 integer,
  add column if not exists delta2 integer,
  add column if not exists fin text;
alter table public.p4_parties drop constraint if exists p4_parties_fin_check;
alter table public.p4_parties add constraint p4_parties_fin_check
  check (fin in ('ligne', 'plein', 'abandon', 'temps', 'absence', 'expire'));

alter table public.echecs_parties
  add column if not exists temps1_ms integer,
  add column if not exists temps2_ms integer,
  add column if not exists tour_depuis timestamptz,
  add column if not exists vu1 timestamptz,
  add column if not exists vu2 timestamptz,
  add column if not exists rev integer not null default 0,
  add column if not exists delta1 integer,
  add column if not exists delta2 integer;
alter table public.echecs_parties drop constraint if exists echecs_parties_fin_check;
alter table public.echecs_parties add constraint echecs_parties_fin_check
  check (fin in ('mat', 'pat', 'repetition', 'materiel', '50coups', 'accord', 'abandon', 'temps', 'absence', 'expire'));

-- Chaque changement incrémente rev : l'appli écarte une lecture plus ancienne que ce qu'elle a déjà
create or replace function public._duel_rev()
returns trigger language plpgsql as $$
begin
  new.rev := old.rev + 1;
  return new;
end;
$$;
drop trigger if exists p4_parties_rev on public.p4_parties;
create trigger p4_parties_rev before update on public.p4_parties for each row execute function public._duel_rev();
drop trigger if exists echecs_parties_rev on public.echecs_parties;
create trigger echecs_parties_rev before update on public.echecs_parties for each row execute function public._duel_rev();

-- Une seule partie ouverte par paire de joueurs, même si les deux se défient en même temps
-- (on garde la plus récente si des doublons existent déjà)
update public.p4_parties p set statut = 'refusee', fin = 'expire'
where statut in ('invitation', 'en_cours') and exists (
  select 1 from public.p4_parties q
  where q.statut in ('invitation', 'en_cours') and q.id <> p.id and q.created_at > p.created_at
    and least(q.joueur1, q.joueur2) = least(p.joueur1, p.joueur2)
    and greatest(q.joueur1, q.joueur2) = greatest(p.joueur1, p.joueur2));
update public.echecs_parties p set statut = 'refusee', fin = 'expire'
where statut in ('invitation', 'en_cours') and exists (
  select 1 from public.echecs_parties q
  where q.statut in ('invitation', 'en_cours') and q.id <> p.id and q.created_at > p.created_at
    and least(q.joueur1, q.joueur2) = least(p.joueur1, p.joueur2)
    and greatest(q.joueur1, q.joueur2) = greatest(p.joueur1, p.joueur2));
create unique index if not exists p4_parties_paire_ouverte on public.p4_parties
  (least(joueur1, joueur2), greatest(joueur1, joueur2)) where statut in ('invitation', 'en_cours');
create unique index if not exists echecs_parties_paire_ouverte on public.echecs_parties
  (least(joueur1, joueur2), greatest(joueur1, joueur2)) where statut in ('invitation', 'en_cours');

-- ─── Outils communs ───
create or replace function public._duel_table(jeu text)
returns text language sql immutable as $$
  select case jeu when 'puissance4' then 'p4_parties' when 'echecs' then 'echecs_parties' end;
$$;

create or replace function public._duel_push(jeu text, corps text, partie uuid, dest uuid)
returns void language sql security definer set search_path = public as $$
  select public.notify_push(
    case jeu when 'echecs' then 'Échecs' else 'Puissance 4' end,
    corps,
    jsonb_build_object('route', case jeu when 'echecs' then '/minijeux/echiquier/' else '/minijeux/partie/' end || partie),
    null,
    array[dest]
  );
$$;
revoke execute on function public._duel_push from public, anon, authenticated;

-- Fin de partie : gagnant 1 ou 2, 0 pour une nulle. Met l'Elo à jour et renvoie le gain du
-- joueur 1 (négatif s'il perd). La partie doit être verrouillée par l'appelant.
create or replace function public._duel_finir(jeu text, partie uuid, gagnant_ smallint, fin_ text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  j1 uuid;
  j2 uuid;
  d1 integer;
begin
  execute format('select joueur1, joueur2 from public.%I where id = $1', public._duel_table(jeu))
    into j1, j2 using partie;
  d1 := case gagnant_
    when 1 then public._elo(jeu, j1, j2, 1)
    when 2 then -public._elo(jeu, j2, j1, 1)
    else public._elo(jeu, j1, j2, 0.5) end;
  execute format(
    -- Les pendules s'arrêtent sur le temps qui restait réellement
    'update public.%I set statut = $2, gagnant = $3, fin = $4, delta1 = $5, delta2 = -$5, elo_delta = abs($5),
       temps1_ms = case when tour = 1 and tour_depuis is not null
         then greatest(0, temps1_ms - (extract(epoch from now() - tour_depuis) * 1000)::integer) else temps1_ms end,
       temps2_ms = case when tour = 2 and tour_depuis is not null
         then greatest(0, temps2_ms - (extract(epoch from now() - tour_depuis) * 1000)::integer) else temps2_ms end,
       tour_depuis = null, updated_at = now() where id = $1',
    public._duel_table(jeu))
  using partie, case when fin_ = 'abandon' then 'abandon' else 'finie' end, gagnant_, fin_, d1;
  if jeu = 'echecs' then update public.echecs_parties set nulle_proposee = null where id = partie; end if;
  return d1;
end;
$$;
revoke execute on function public._duel_finir from public, anon, authenticated;

-- Le camp `camp` (1 blancs, 2 noirs) ne peut plus mater : roi seul, ou roi et une pièce mineure
create or replace function public._echecs_sans_mat(fen text, camp smallint)
returns boolean language sql immutable as $$
  with p as (
    select regexp_replace(split_part(fen, ' ', 1), case when camp = 1 then '[^PNBRQ]' else '[^pnbrq]' end, '', 'g') as pieces
  )
  select pieces = '' or pieces ~ '^[NBnb]$' from p;
$$;

-- Temps qu'il reste au joueur au trait, en ms (null sans pendule)
create or replace function public._duel_reste(temps1 integer, temps2 integer, tour smallint, depuis timestamptz)
returns integer language sql stable as $$
  select case when depuis is null then null
    else (case when tour = 1 then temps1 else temps2 end) - (extract(epoch from now() - depuis) * 1000)::integer end;
$$;

-- Temps écoulé ou joueur parti depuis une minute : la partie se termine.
-- Appelée par les signes de vie, par les joueurs eux-mêmes et par la tâche planifiée.
create or replace function public._duel_verifier(jeu text, partie uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
  absent1 boolean;
  absent2 boolean;
  perdant smallint := null;
  fin_ text;
  g smallint;
  d1 integer;
  fen_ text := null;
begin
  execute format(
    'select id, joueur1, joueur2, statut, tour, temps1_ms, temps2_ms, tour_depuis, vu1, vu2 from public.%I where id = $1 for update',
    public._duel_table(jeu))
    into r using partie;
  if r.id is null or r.statut <> 'en_cours' or r.tour_depuis is null then return; end if;

  if public._duel_reste(r.temps1_ms, r.temps2_ms, r.tour, r.tour_depuis) <= 0 then
    perdant := r.tour;
    fin_ := 'temps';
  else
    absent1 := coalesce(r.vu1, r.tour_depuis) < now() - interval '60 seconds';
    absent2 := coalesce(r.vu2, r.tour_depuis) < now() - interval '60 seconds';
    -- Les deux partis : la pendule du joueur au trait tranchera
    if absent1 and not absent2 then perdant := 1; fin_ := 'absence';
    elsif absent2 and not absent1 then perdant := 2; fin_ := 'absence';
    end if;
  end if;
  if perdant is null then return; end if;

  g := case when perdant = 1 then 2 else 1 end;
  -- Aux échecs, tomber au temps face à un adversaire qui ne peut plus mater donne la nulle
  if jeu = 'echecs' and fin_ = 'temps' then
    select fen into fen_ from public.echecs_parties where id = partie;
    if public._echecs_sans_mat(fen_, g) then g := 0; end if;
  end if;
  d1 := public._duel_finir(jeu, partie, g, fin_);

  if g = 0 then
    perform public._duel_push(jeu, 'Temps écoulé : partie nulle', partie, r.joueur1);
    perform public._duel_push(jeu, 'Temps écoulé : partie nulle', partie, r.joueur2);
  else
    perform public._duel_push(jeu,
      case fin_ when 'temps' then 'Temps écoulé : tu gagnes (+' || abs(d1) || ' Elo)'
        else public._prenom(case when perdant = 1 then r.joueur1 else r.joueur2 end) || ' a quitté la partie : tu gagnes (+' || abs(d1) || ' Elo)' end,
      partie, case when g = 1 then r.joueur1 else r.joueur2 end);
    perform public._duel_push(jeu,
      case fin_ when 'temps' then 'Temps écoulé : partie perdue (−' || abs(d1) || ' Elo)'
        else 'Tu as quitté la partie plus d''une minute : partie perdue (−' || abs(d1) || ' Elo)' end,
      partie, case when perdant = 1 then r.joueur1 else r.joueur2 end);
  end if;
end;
$$;
revoke execute on function public._duel_verifier from public, anon, authenticated;

-- Signe de vie de l'écran de partie (toutes les 15 s) ; renvoie l'heure du serveur,
-- qui sert à l'appli pour afficher les pendules sans dépendre de l'heure du téléphone
create or replace function public.duel_present(jeu text, partie uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if public._duel_table(jeu) is null then raise exception 'Jeu inconnu'; end if;
  execute format(
    'update public.%I set vu1 = case when joueur1 = $2 then now() else vu1 end,
       vu2 = case when joueur2 = $2 then now() else vu2 end
     where id = $1 and statut = ''en_cours'' and $2 in (joueur1, joueur2)',
    public._duel_table(jeu))
  using partie, me;
  perform public._duel_verifier(jeu, partie);
  return now();
end;
$$;
revoke execute on function public.duel_present from public, anon;
grant execute on function public.duel_present to authenticated;

-- Toutes les parties à pendule, et les défis de plus de 10 minutes
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
end;
$$;
revoke execute on function public._duel_verifier_tout from public, anon, authenticated;

select cron.unschedule('duel-pendules') where exists (select 1 from cron.job where jobname = 'duel-pendules');
select cron.schedule('duel-pendules', '15 seconds', 'select public._duel_verifier_tout()');

-- ─── Puissance 4 ───
create or replace function public.p4_defier(adversaire uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  pid uuid;
begin
  if me is null then raise exception 'Connexion requise'; end if;
  if adversaire is null or adversaire = me then raise exception 'Adversaire invalide'; end if;
  if not exists (select 1 from public.profiles where id = adversaire) then raise exception 'Adversaire inconnu'; end if;
  select id into pid from public.p4_parties
  where statut in ('invitation', 'en_cours') and least(joueur1, joueur2) = least(me, adversaire)
    and greatest(joueur1, joueur2) = greatest(me, adversaire)
  limit 1;
  if pid is not null then return pid; end if;
  begin
    insert into public.p4_parties (joueur1, joueur2) values (me, adversaire) returning id into pid;
  exception when unique_violation then
    -- L'autre vient de nous défier au même instant : c'est cette partie-là
    select id into pid from public.p4_parties
    where statut in ('invitation', 'en_cours') and least(joueur1, joueur2) = least(me, adversaire)
      and greatest(joueur1, joueur2) = greatest(me, adversaire);
    return pid;
  end;
  perform public._duel_push('puissance4', public._prenom(me) || ' te défie au Puissance 4 (3 min chacun)', pid, adversaire);
  return pid;
end;
$$;

create or replace function public.p4_repondre(partie uuid, accepte boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  p public.p4_parties;
begin
  select * into p from public.p4_parties where id = partie for update;
  if p.id is null or p.joueur2 <> me or p.statut <> 'invitation' then raise exception 'Ce défi n''est plus valable'; end if;
  if p.created_at < now() - interval '10 minutes' then
    update public.p4_parties set statut = 'refusee', fin = 'expire', updated_at = now() where id = partie;
    return;
  end if;
  if accepte then
    -- La pendule démarre : celui qui a défié a une minute pour arriver
    update public.p4_parties set statut = 'en_cours', temps1_ms = 180000, temps2_ms = 180000,
      tour_depuis = now(), vu1 = now(), vu2 = now(), updated_at = now()
    where id = partie;
  else
    update public.p4_parties set statut = 'refusee', updated_at = now() where id = partie;
  end if;
  perform public._duel_push('puissance4',
    public._prenom(me) || case when accepte then ' accepte : rejoins la partie, ta pendule tourne' else ' refuse ton défi' end,
    partie, p.joueur1);
end;
$$;

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
  d1 integer;
  adversaire uuid;
  reste integer;
begin
  select * into p from public.p4_parties where id = partie for update;
  if p.id is null or p.statut <> 'en_cours' then raise exception 'Partie terminée ou introuvable'; end if;
  moi := case when me = p.joueur1 then 1 when me = p.joueur2 then 2 else null end;
  if moi is null then raise exception 'Tu ne joues pas cette partie'; end if;
  if p.tour <> moi then raise exception 'Ce n''est pas ton tour'; end if;
  if colonne is null or colonne < 0 or colonne > 6 then raise exception 'Colonne invalide'; end if;

  -- Temps écoulé avant ce coup : la partie est perdue, le coup ne compte pas
  reste := public._duel_reste(p.temps1_ms, p.temps2_ms, p.tour, p.tour_depuis);
  if reste is not null and reste <= 0 then
    perform public._duel_verifier('puissance4', partie);
    return;
  end if;

  for r in reverse 5..0 loop
    if substr(p.plateau, r * 7 + colonne + 1, 1) = '0' then
      idx := r * 7 + colonne;
      exit;
    end if;
  end loop;
  if idx is null then raise exception 'Colonne pleine'; end if;
  board := overlay(p.plateau placing moi::text from idx + 1 for 1);

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
  update public.p4_parties set plateau = board, coups = coups + 1, dernier_coup = idx,
    tour = case when moi = 1 then 2 else 1 end,
    temps1_ms = case when moi = 1 and reste is not null then reste else temps1_ms end,
    temps2_ms = case when moi = 2 and reste is not null then reste else temps2_ms end,
    tour_depuis = case when reste is not null then now() end,
    vu1 = case when moi = 1 then now() else vu1 end,
    vu2 = case when moi = 2 then now() else vu2 end,
    ligne_gagnante = win, updated_at = now()
  where id = partie;

  if win is not null then
    d1 := public._duel_finir('puissance4', partie, moi, 'ligne');
    perform public._duel_push('puissance4', public._prenom(me) || ' a gagné la partie (−' || abs(d1) || ' Elo)', partie, adversaire);
  elsif position('0' in board) = 0 then
    perform public._duel_finir('puissance4', partie, 0::smallint, 'plein');
    perform public._duel_push('puissance4', 'Match nul contre ' || public._prenom(me), partie, adversaire);
  else
    -- Toujours envoyée : l'appli la masque si la partie est déjà à l'écran
    perform public._duel_push('puissance4', public._prenom(me) || ' a joué : à toi', partie, adversaire);
  end if;
end;
$$;

create or replace function public.p4_abandonner(partie uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  p public.p4_parties;
  adversaire uuid;
  d1 integer;
begin
  select * into p from public.p4_parties where id = partie for update;
  if p.id is null or me not in (p.joueur1, p.joueur2) then raise exception 'Partie introuvable'; end if;
  if p.statut = 'invitation' then
    update public.p4_parties set statut = 'refusee', updated_at = now() where id = partie;
    return;
  end if;
  if p.statut <> 'en_cours' then return; end if;
  adversaire := case when me = p.joueur1 then p.joueur2 else p.joueur1 end;
  d1 := public._duel_finir('puissance4', partie, case when me = p.joueur1 then 2 else 1 end::smallint, 'abandon');
  perform public._duel_push('puissance4', public._prenom(me) || ' abandonne : tu gagnes (+' || abs(d1) || ' Elo)', partie, adversaire);
end;
$$;

-- ─── Échecs ───
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
  where statut in ('invitation', 'en_cours') and least(joueur1, joueur2) = least(me, adversaire)
    and greatest(joueur1, joueur2) = greatest(me, adversaire)
  limit 1;
  if pid is not null then return pid; end if;
  begin
    insert into public.echecs_parties (joueur1, joueur2) values (me, adversaire) returning id into pid;
  exception when unique_violation then
    select id into pid from public.echecs_parties
    where statut in ('invitation', 'en_cours') and least(joueur1, joueur2) = least(me, adversaire)
      and greatest(joueur1, joueur2) = greatest(me, adversaire);
    return pid;
  end;
  perform public._duel_push('echecs', public._prenom(me) || ' te défie aux échecs (10 min chacun)', pid, adversaire);
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
  if p.id is null or p.joueur2 <> me or p.statut <> 'invitation' then raise exception 'Ce défi n''est plus valable'; end if;
  if p.created_at < now() - interval '10 minutes' then
    update public.echecs_parties set statut = 'refusee', fin = 'expire', updated_at = now() where id = partie;
    return;
  end if;
  if accepte then
    update public.echecs_parties set statut = 'en_cours', temps1_ms = 600000, temps2_ms = 600000,
      tour_depuis = now(), vu1 = now(), vu2 = now(), updated_at = now()
    where id = partie;
  else
    update public.echecs_parties set statut = 'refusee', updated_at = now() where id = partie;
  end if;
  perform public._duel_push('echecs',
    public._prenom(me) || case when accepte then ' accepte : rejoins la partie, tu as les blancs et ta pendule tourne' else ' refuse ton défi' end,
    partie, p.joueur1);
end;
$$;

-- Appelée par la fonction Edge après vérification du coup (signature inchangée)
create or replace function public.echecs_appliquer(
  partie uuid, joueur uuid, avant integer, uci text, fen_ text, fin_ text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  p public.echecs_parties;
  moi smallint;
  adversaire uuid;
  d1 integer;
  reste integer;
begin
  select * into p from public.echecs_parties where id = partie for update;
  if p.id is null or p.statut <> 'en_cours' then raise exception 'Partie terminée ou introuvable'; end if;
  moi := case when joueur = p.joueur1 then 1 when joueur = p.joueur2 then 2 end;
  if moi is null then raise exception 'Tu ne joues pas cette partie'; end if;
  if p.tour <> moi or p.coups <> avant then raise exception 'Ce n''est pas ton tour'; end if;
  adversaire := case when moi = 1 then p.joueur2 else p.joueur1 end;

  reste := public._duel_reste(p.temps1_ms, p.temps2_ms, p.tour, p.tour_depuis);
  if reste is not null and reste <= 0 then
    perform public._duel_verifier('echecs', partie);
    return;
  end if;

  update public.echecs_parties set
    fen = fen_, historique = historique || uci, dernier_coup = uci, coups = coups + 1,
    tour = case when moi = 1 then 2 else 1 end,
    temps1_ms = case when moi = 1 and reste is not null then reste else temps1_ms end,
    temps2_ms = case when moi = 2 and reste is not null then reste else temps2_ms end,
    tour_depuis = case when reste is not null then now() end,
    vu1 = case when moi = 1 then now() else vu1 end,
    vu2 = case when moi = 2 then now() else vu2 end,
    nulle_proposee = case when nulle_proposee = moi then moi end, updated_at = now()
  where id = partie;

  if fin_ is null then
    perform public._duel_push('echecs', public._prenom(joueur) || ' a joué : à toi', partie, adversaire);
    return;
  end if;
  d1 := public._duel_finir('echecs', partie, case when fin_ = 'mat' then moi else 0 end::smallint, fin_);
  perform public._duel_push('echecs',
    case when fin_ = 'mat' then public._prenom(joueur) || ' te met échec et mat (−' || abs(d1) || ' Elo)'
         else 'Partie nulle contre ' || public._prenom(joueur) end,
    partie, adversaire);
end;
$$;
revoke execute on function public.echecs_appliquer from public, anon, authenticated;
grant execute on function public.echecs_appliquer to service_role;

create or replace function public.echecs_nulle(partie uuid, action text)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  p public.echecs_parties;
  moi smallint;
  adversaire uuid;
begin
  select * into p from public.echecs_parties where id = partie for update;
  if p.id is null or p.statut <> 'en_cours' then raise exception 'Partie terminée ou introuvable'; end if;
  moi := case when me = p.joueur1 then 1 when me = p.joueur2 then 2 end;
  if moi is null then raise exception 'Tu ne joues pas cette partie'; end if;
  adversaire := case when moi = 1 then p.joueur2 else p.joueur1 end;

  if action = 'proposer' and p.nulle_proposee is null then
    update public.echecs_parties set nulle_proposee = moi, updated_at = now() where id = partie;
    perform public._duel_push('echecs', public._prenom(me) || ' propose la nulle', partie, adversaire);
  elsif action = 'accepter' and p.nulle_proposee <> moi then
    perform public._duel_finir('echecs', partie, 0::smallint, 'accord');
    perform public._duel_push('echecs', public._prenom(me) || ' accepte la nulle', partie, adversaire);
  elsif action = 'refuser' and p.nulle_proposee <> moi then
    update public.echecs_parties set nulle_proposee = null, updated_at = now() where id = partie;
    perform public._duel_push('echecs', public._prenom(me) || ' refuse la nulle', partie, adversaire);
  end if;
end;
$$;

create or replace function public.echecs_abandonner(partie uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  p public.echecs_parties;
  adversaire uuid;
  d1 integer;
begin
  select * into p from public.echecs_parties where id = partie for update;
  if p.id is null or me not in (p.joueur1, p.joueur2) then raise exception 'Partie introuvable'; end if;
  if p.statut = 'invitation' then
    update public.echecs_parties set statut = 'refusee', updated_at = now() where id = partie;
    return;
  end if;
  if p.statut <> 'en_cours' then return; end if;
  adversaire := case when me = p.joueur1 then p.joueur2 else p.joueur1 end;
  d1 := public._duel_finir('echecs', partie, case when me = p.joueur1 then 2 else 1 end::smallint, 'abandon');
  perform public._duel_push('echecs', public._prenom(me) || ' abandonne : tu gagnes (+' || abs(d1) || ' Elo)', partie, adversaire);
end;
$$;

-- ─── Chat : identifiant d'envoi choisi par l'appli, pour qu'un renvoi ne double pas un message ───
alter table public.minijeux_messages add column if not exists client_id uuid;
create unique index if not exists minijeux_messages_client_idx on public.minijeux_messages (auteur, client_id);
