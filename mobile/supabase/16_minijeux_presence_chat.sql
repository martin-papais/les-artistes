-- 16 : « vu il y a » des membres et chat des parties en direct (Puissance 4, échecs).
-- Qui est en ligne à l'instant passe par la présence du temps réel (rien en base) ;
-- vu_le sert seulement à dire depuis quand quelqu'un ne s'est pas connecté.

-- La policy d'update de profiles (chacun sa ligne) couvre cette colonne
alter table public.profiles add column if not exists vu_le timestamptz;

-- Joueurs d'une partie, quel que soit le jeu. Un jeu en équipes ajoutera sa table ici.
create or replace function public._minijeux_joueurs(p_jeu text, p_partie uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select case p_jeu
    when 'puissance4' then (select array[joueur1, joueur2] from public.p4_parties where id = p_partie)
    when 'echecs' then (select array[joueur1, joueur2] from public.echecs_parties where id = p_partie)
  end;
$$;
revoke execute on function public._minijeux_joueurs from public, anon, authenticated;

-- Pour la RLS : est-ce que je joue cette partie ? (ne dit rien des autres joueurs)
create or replace function public.minijeux_je_joue(p_jeu text, p_partie uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth.uid() = any(public._minijeux_joueurs(p_jeu, p_partie)), false);
$$;
revoke execute on function public.minijeux_je_joue from public, anon;
grant execute on function public.minijeux_je_joue to authenticated;

create table if not exists public.minijeux_messages (
  id bigint generated always as identity primary key,
  jeu text not null check (jeu in ('puissance4', 'echecs')),
  partie uuid not null,
  auteur uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  texte text not null check (char_length(btrim(texte)) between 1 and 300),
  created_at timestamptz not null default now()
);
create index if not exists minijeux_messages_partie_idx on public.minijeux_messages (partie, created_at);

alter table public.minijeux_messages enable row level security;
drop policy if exists minijeux_messages_select on public.minijeux_messages;
create policy minijeux_messages_select on public.minijeux_messages
  for select to authenticated using (public.minijeux_je_joue(jeu, partie));
drop policy if exists minijeux_messages_insert on public.minijeux_messages;
create policy minijeux_messages_insert on public.minijeux_messages
  for insert to authenticated with check (auteur = auth.uid() and public.minijeux_je_joue(jeu, partie));
-- Ni modification ni suppression : ce qui est dit est dit

-- Temps réel : le message apparaît chez l'adversaire sans recharger
do $$
begin
  alter publication supabase_realtime add table public.minijeux_messages;
exception when duplicate_object then null;
end $$;

-- Notification aux autres joueurs ; l'appli la masque si la partie est déjà ouverte
create or replace function public._minijeux_message_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  autres uuid[];
begin
  select array_agg(u) into autres
  from unnest(public._minijeux_joueurs(new.jeu, new.partie)) u
  where u <> new.auteur;
  if autres is null then return new; end if;
  perform public.notify_push(
    public._prenom(new.auteur) || case new.jeu when 'echecs' then ' · Échecs' else ' · Puissance 4' end,
    left(new.texte, 140),
    jsonb_build_object(
      'route', case new.jeu when 'echecs' then '/minijeux/echiquier/' else '/minijeux/partie/' end || new.partie
    ),
    null,
    autres
  );
  return new;
end;
$$;
revoke execute on function public._minijeux_message_push from public, anon, authenticated;

drop trigger if exists minijeux_message_push on public.minijeux_messages;
create trigger minijeux_message_push after insert on public.minijeux_messages
  for each row execute function public._minijeux_message_push();
