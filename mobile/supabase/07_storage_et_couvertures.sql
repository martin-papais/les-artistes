-- 04/10/2026 — après la migration des couvertures des news vers Storage.
-- 1. Le jeton de la fonction migrate-covers est retiré : elle répond 401 à tout appel.
-- 2. Lister les fichiers du bucket `media` est réservé aux membres connectés.
--    Les fichiers restent servis par leur URL publique (bucket public), comme avant.

update public._app_config set migration_token = null where id = 1;

alter policy "Public read"       on storage.objects to authenticated;
alter policy "Public read media" on storage.objects to authenticated;
alter policy "Auth upload"       on storage.objects to authenticated;
alter policy "Auth upload media" on storage.objects to authenticated;
alter policy "Owner delete"       on storage.objects to authenticated;
alter policy "Owner delete media" on storage.objects to authenticated;
