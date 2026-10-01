# Storage full

Two things can fill: the **Supabase Storage** buckets (`recordings`, `voice`, `thumbs`, `captions`, from
`api/twisters/media/storage_policies.sql`) and the **Postgres database**. Per-user quota is a separate, normal
condition (error `quota_exceeded`, HTTP 402) and is not an incident.

## Symptom
- Uploads fail at the storage step (the browser's signed PUT/TUS returns 4xx/5xx) or `complete` answers
  `upload_rejected`.
- Supabase shows a quota warning or the project went read-only.
- API 5xx on writes with `database ... disk full` / `could not extend file`.

## Check
1. Supabase dashboard → Storage / Reports: usage per bucket and egress; Database → size.
2. Where the bytes are: Django admin → **Storage ledger** (read-only; usage per user is `SUM(delta_bytes)`),
   or `GET /me/storage/` as a given user. Per-user caps live in `Plan.limits` (`recordings_max`,
   `storage_bytes_max`, `retention_days`; defaults in `PLAN_LIMIT_DEFAULTS`).
3. Is cleanup running? GitHub Actions → "Management command": `expire_recordings` hourly (`23 * * * *`) and
   `orphan_sweeper` daily (`41 4 * * *`). A red or missing run means no automatic cleanup.
4. Abandoned uploads: recordings stuck `uploading` older than `MEDIA_ORPHAN_HOURS` (24) are swept by `orphan_sweeper`.

## Fix
Order: cheapest and most reversible first.
1. Run the cleanups now: Actions → "Management command" → `expire_recordings`, then `orphan_sweeper`. Output
   in the job summary lists expired / hard-deleted / swept counts. Both are safe to re-run.
2. Stop the inflow while you work: Django admin → Feature flags → `record_cloud` → untick *enabled*.
   `uploads.require_cloud` then answers `feature_disabled` (403) for new cloud recordings; local recording and
   download keep working. (Allow ~2 min for the 60 s flags cache.)
3. Shorten retention for everyone: edit the `free` row in admin → Plans → `limits.retention_days` (applies to new
   uploads; existing recordings keep their `expires_at`). Lower `storage_bytes_max` / `recordings_max` to cap growth.
4. Delete the largest abusers' media only through the app's own paths (a takedown, `takedown-sla.md`, or
   the user's delete). Do not delete objects by hand in the Supabase UI: the ledger and `MediaAsset` rows would
   drift. If you must, write the object paths in the incident file and tell the owner so the rows can be reconciled.
5. Upgrade the Supabase plan (cloud recording was always planned to need Supabase Pro, decision D7). Then
   re-enable `record_cloud`.
6. Database full (not storage): the largest tables are `Attempt`, `AttemptWord`, `AttemptPhoneme`; see the owner
   decision on pruning before deleting anything, nothing prunes them automatically.

## Verify
- Dashboard usage dropped, or the upgrade applied.
- Test account: create, upload and complete a small recording (flag back on); `GET /me/storage/` is consistent.

## Follow-up
- Alert threshold at 80 % in Supabase.
- Check that ledger totals still match objects after any manual cleanup.
- Consider tighter `MEDIA_MAX_BYTES` (default 100 MiB per object) if one object size dominated.
