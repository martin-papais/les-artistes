-- 20 : moins de notifications de coup (21/10/2026, retour de Thomas : une par coup, c'était trop).
-- « X a joué : à toi » ne part que si l'adversaire n'a plus l'écran de la partie ouvert
-- (pas de signe de vie depuis 20 s), et une seule fois tant qu'il n'y est pas revenu.
-- Défi, acceptation et fin de partie gardent leur notification.

alter table public.p4_parties add column if not exists alerte_le timestamptz;
alter table public.echecs_parties add column if not exists alerte_le timestamptz;

-- Notification de tour au joueur `siege` (1 ou 2) de la partie, selon la règle ci-dessus
create or replace function public._duel_push_tour(jeu text, partie uuid, siege smallint, corps text, dest uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  vu timestamptz;
  alerte timestamptz;
begin
  execute format('select case when $2 = 1 then vu1 else vu2 end, alerte_le from public.%I where id = $1', public._duel_table(jeu))
    into vu, alerte using partie, siege;
  -- Devant la partie : il voit le coup arriver
  if vu is not null and vu > now() - interval '20 seconds' then return; end if;
  -- Déjà prévenu depuis qu'il est parti
  if alerte is not null and (vu is null or alerte > vu) then return; end if;
  execute format('update public.%I set alerte_le = now() where id = $1', public._duel_table(jeu)) using partie;
  perform public._duel_push(jeu, corps, partie, dest);
end;
$$;
revoke execute on function public._duel_push_tour from public, anon, authenticated;

-- Fonctions de coup (version 17, enveloppées par 19) : seule la notification de tour change
create or replace function public._p4_jouer(partie uuid, colonne integer)
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
    perform public._duel_push_tour('puissance4', partie, case when moi = 1 then 2 else 1 end::smallint,
      public._prenom(me) || ' a joué : à toi', adversaire);
  end if;
end;
$$;

revoke execute on function public._p4_jouer from public, anon, authenticated;

create or replace function public._echecs_appliquer(
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
    perform public._duel_push_tour('echecs', partie, case when moi = 1 then 2 else 1 end::smallint,
      public._prenom(joueur) || ' a joué : à toi', adversaire);
    return;
  end if;
  d1 := public._duel_finir('echecs', partie, case when fin_ = 'mat' then moi else 0 end::smallint, fin_);
  perform public._duel_push('echecs',
    case when fin_ = 'mat' then public._prenom(joueur) || ' te met échec et mat (−' || abs(d1) || ' Elo)'
         else 'Partie nulle contre ' || public._prenom(joueur) end,
    partie, adversaire);
end;
$$;

revoke execute on function public._echecs_appliquer from public, anon, authenticated;
