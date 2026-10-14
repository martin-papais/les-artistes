-- Photo de profil et couleur du rond (appli, 14/10/2026).
-- avatar_url : URL publique d'un fichier du bucket media (<uid>/avatar/…).
-- avatar_color : couleur choisie pour le rond à l'initiale, sinon couleur automatique.
-- La policy d'update de profiles (chacun sa ligne) couvre ces colonnes.
alter table public.profiles
  add column if not exists avatar_url text,
  add column if not exists avatar_color text;

alter table public.profiles drop constraint if exists profiles_avatar_color_check;
alter table public.profiles
  add constraint profiles_avatar_color_check
  check (avatar_color is null or avatar_color in ('teal', 'yellow', 'pink', 'violet', 'coral'));
