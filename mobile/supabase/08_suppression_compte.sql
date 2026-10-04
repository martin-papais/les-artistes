-- Suppression de son propre compte (exigée par l'App Store, guideline 5.1.1(v)) — 04/10/2026.
-- L'appli efface d'abord les fichiers Storage de l'utilisateur (dossier <uid>/), que le
-- SQL ne peut pas supprimer, puis appelle cette fonction.
-- Ordre imposé par les clés étrangères sans cascade : events.created_by et profiles.id
-- pointent vers auth.users en « no action ». Tout le reste (votes, commentaires, likes,
-- photos, notes, commandes, jetons push…) part en cascade avec auth.users / profiles.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'non connecté';
  end if;
  delete from public.events   where created_by = uid;
  delete from public.profiles where id = uid;
  delete from auth.users      where id = uid;
end;
$$;

revoke execute on function public.delete_my_account from public, anon;
grant execute on function public.delete_my_account to authenticated;
