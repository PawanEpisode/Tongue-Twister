-- Supabase Storage setup for cloud recordings, voice clips, thumbnails, captions and analysis audio
-- (ERD 06 §5, spec 13 A2.5). Run once in the Supabase SQL editor (the project needs the Pro plan
-- before enabling record_cloud, D7). Safe to re-run.
--
-- Model: every bucket is PRIVATE and **clients have no direct access at all**. The API authorises the
-- caller and then mints short-lived, single-object signed URLs with the service-role key:
--   * uploads  - a signed upload token (works for the TUS/resumable endpoint too), minted by
--                `StorageBackend.create_upload`; the browser and the media worker never hold a user JWT
--                that could touch storage;
--   * playback - signed GET URLs from `signed_url(s)`, valid PLAYBACK_URL_TTL_S (15 min) and minted for
--                the owner or, on a public share page, for whoever holds a live share token.
-- The service role bypasses RLS, so none of that needs a policy.
--
-- Object paths are `{owner_folder}/{yyyy}/{mm}/{asset_id}.{ext}` where owner_folder is
-- HMAC-SHA256(MEDIA_PATH_SECRET, profile_id)[:16] (api/twisters/media/uploads.py). It is deliberately NOT
-- the user's auth id, so the path leaks nothing (signed URLs are shared on public pages) and a
-- policy like `foldername(name)[1] = auth.uid()` could never match. Assets created before this change
-- keep their old `{profile_id}/...` path (the path is stored per asset); the deny policy below covers both.

-- Buckets. file_size_limit matches MEDIA_MAX_BYTES (100 MiB); thumbnails/captions are tiny. The voice
-- bucket also holds the worker's 16 kHz analysis WAVs (server-made, larger than a client clip), so its
-- limit is the global object ceiling; the per-clip cap for clients is enforced by the API.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('recordings', 'recordings', false, 104857600, array['video/webm', 'video/mp4']),
  ('voice',      'voice',      false, 104857600, array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav']),
  ('thumbs',     'thumbs',     false,    204800, array['image/jpeg']),
  ('captions',   'captions',   false,    262144, array['text/vtt'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Acoustic models (tools/export_model, docs/features/13 section 3.1). The one PUBLIC bucket: model files are
-- not personal data, are cached by sha-256 in browsers and workers, and are fetched straight from the CDN. Nobody
-- but the service role (or you, in the dashboard) can write to it: there is no permissive policy for it below.
-- Needs the Supabase Pro plan: the int8 model is ~300 MB, over the free plan's 50 MB object limit.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('models', 'models', true, 629145600, array['application/octet-stream', 'application/json'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Remove the owner-folder policies of the earlier design (they keyed on auth.uid()).
drop policy if exists "own upload" on storage.objects;
drop policy if exists "own read" on storage.objects;
drop policy if exists "own delete" on storage.objects;
drop policy if exists "no client access to media" on storage.objects;

-- Deny-all for clients. RLS on storage.objects is on by default and, with no permissive policy for
-- these buckets, already denies anon/authenticated; this RESTRICTIVE policy makes that explicit and
-- keeps it true even if someone later adds a broad permissive policy to the table.
create policy "no client access to media" on storage.objects
  as restrictive
  for all
  to anon, authenticated
  using (bucket_id not in ('recordings', 'voice', 'thumbs', 'captions'))
  with check (bucket_id not in ('recordings', 'voice', 'thumbs', 'captions'));

-- No update policy and no anon policy exist on purpose. Objects are immutable once uploaded except
-- for the worker's retries, which overwrite the same deterministic path through an upsert upload token.
