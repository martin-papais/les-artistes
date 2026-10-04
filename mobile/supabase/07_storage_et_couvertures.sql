-- 04/10/2026 — après la migration des couvertures des news vers Storage.
-- 1. La colonne du jeton temporaire de migrate-covers est supprimée : la fonction répond 401.
-- 2. Lister les fichiers du bucket `media` est réservé aux membres connectés.
--    Les fichiers restent servis par leur URL publique (bucket public), comme avant.

alter table public._app_config drop column if exists migration_token;

alter policy "Public read"       on storage.objects to authenticated;
alter policy "Public read media" on storage.objects to authenticated;
alter policy "Auth upload"       on storage.objects to authenticated;
alter policy "Auth upload media" on storage.objects to authenticated;
alter policy "Owner delete"       on storage.objects to authenticated;
alter policy "Owner delete media" on storage.objects to authenticated;
