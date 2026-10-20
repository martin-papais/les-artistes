-- 19 : échéances vérifiées avant toute action (relecture du 21/10/2026).
-- Un joueur revenu après sa minute d'absence, ou dont la pendule est tombée, perd avant que
-- son signe de vie, son coup ou son accord de nulle ne soit pris en compte.
-- Nulle au temps seulement si le camp restant ne peut mater d'aucune façon : roi seul, ou roi
-- et une pièce mineure face à un roi seul (sinon un mat aidé reste possible : la chute perd).

create or replace function public._echecs_sans_mat(fen text, camp smallint)
returns boolean language sql immutable as $$
  with p as (
    select
      regexp_replace(split_part(fen, ' ', 1), case when camp = 1 then '[^PNBRQ]' else '[^pnbrq]' end, '', 'g') as moi,
      regexp_replace(split_part(fen, ' ', 1), case when camp = 1 then '[^pnbrq]' else '[^PNBRQ]' end, '', 'g') as autre
  )
  select moi = '' or (moi ~ '^[NBnb]$' and autre = '') from p;
$$;

-- Signe de vie : l'échéance d'abord, la présence ensuite
create or replace function public.duel_present(jeu text, partie uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if public._duel_table(jeu) is null then raise exception 'Jeu inconnu'; end if;
  perform public._duel_verifier(jeu, partie);
  execute format(
    'update public.%I set vu1 = case when joueur1 = $2 then now() else vu1 end,
       vu2 = case when joueur2 = $2 then now() else vu2 end
     where id = $1 and statut = ''en_cours'' and $2 in (joueur1, joueur2)',
    public._duel_table(jeu))
  using partie, me;
  return now();
end;
$$;

-- Les actions de partie vérifient les échéances avant d'agir : on enveloppe les fonctions
-- existantes (le verrou de _duel_verifier est repris par la fonction appelée, même transaction)
alter function public.p4_jouer(uuid, integer) rename to _p4_jouer;
create or replace function public.p4_jouer(partie uuid, colonne integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._duel_verifier('puissance4', partie);
  if not exists (select 1 from public.p4_parties where id = partie and statut = 'en_cours') then return; end if;
  perform public._p4_jouer(partie, colonne);
end;
$$;
revoke execute on function public._p4_jouer from public, anon, authenticated;
revoke execute on function public.p4_jouer from public, anon;
grant execute on function public.p4_jouer to authenticated;

alter function public.echecs_appliquer(uuid, uuid, integer, text, text, text) rename to _echecs_appliquer;
create or replace function public.echecs_appliquer(partie uuid, joueur uuid, avant integer, uci text, fen_ text, fin_ text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._duel_verifier('echecs', partie);
  if not exists (select 1 from public.echecs_parties where id = partie and statut = 'en_cours') then return; end if;
  perform public._echecs_appliquer(partie, joueur, avant, uci, fen_, fin_);
end;
$$;
revoke execute on function public._echecs_appliquer from public, anon, authenticated;
revoke execute on function public.echecs_appliquer from public, anon, authenticated;
grant execute on function public.echecs_appliquer to service_role;

alter function public.echecs_nulle(uuid, text) rename to _echecs_nulle;
create or replace function public.echecs_nulle(partie uuid, action text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._duel_verifier('echecs', partie);
  if not exists (select 1 from public.echecs_parties where id = partie and statut = 'en_cours') then return; end if;
  perform public._echecs_nulle(partie, action);
end;
$$;
revoke execute on function public._echecs_nulle from public, anon, authenticated;
revoke execute on function public.echecs_nulle from public, anon;
grant execute on function public.echecs_nulle to authenticated;
