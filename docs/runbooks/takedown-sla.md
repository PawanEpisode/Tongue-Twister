# Takedown SLA

**Target: content reported as unlawful, abusive or involving a child is made inaccessible within 24 hours of
the report reaching us; the owner decides afterwards whether it is restored.** Everything else: respond within
72 hours. This is the project's own target, not legal advice; the owner confirms the legal basis (decision D21 in `11`, notes on retention).

## Symptom
An e-mail, a share-page "Report" (stored as a `ModerationReport`), or a message asking for something to be removed.

## Who and how
- Owner/operator of the project is the single responsible person; they hold Django admin access.
- Reports from the public page arrive in admin → **Moderation reports** (`reason`, `details`; reporter identity
  is a profile or a salted IP hash only). E-mail requests: the operator opens the incident file
  (`incident-template.md`) and files the equivalent action by hand.

## Check
1. Identify the content: the link's token is **not** stored (only its sha256), so work from the report row, the
   recording owner, or the URL's token pasted *only* into the admin search of the operator's own session.
   Do not forward tokens.
2. Is it a minor, a non-consenting person, a threat or illegal content? Then act first (step Fix 1), assess after.

## Fix
1. **Make it inaccessible now** (reversible): admin → Moderation reports → select → *Action selected reports* (only works on reports still `open`).
   This holds every link to the target and hides the recording (`hidden_at`), so public pages answer 410.
   For an e-mail request with no report row: admin → Recordings (find by owner or twister) → *Hide selected
   recordings (and hold their share links)*.
2. **Remove permanently** if confirmed: admin → Share links → *Revoke selected links*; ask the owner to delete
   the recording from the app, or use the account deletion path. Soft-deleted recordings are hard-deleted
   (objects removed from storage) after `RESTORE_WINDOW_HOURS` (24) by the hourly `expire_recordings`; run it from
   Actions → "Management command" to do it sooner.
3. **Repeat offenders:** revoke the creator's links, consider disabling cloud for them (flag allow-lists are
   additive only, so use account deletion/hold per the owner's decision).
4. **Wrong report:** *Dismiss selected reports*; the link returns if under `REPORT_AUTOHIDE_THRESHOLD`.
5. Reply to the requester (template in the incident file): what was done and when. No personal data of others.

## Verify
- The public URL answers 410 (`GET /public/r/<token>/`).
- The report row shows status and the staff user who resolved it.
- Storage object removal confirmed in `expire_recordings` output (hard_deleted count) if deletion was requested.

## Audit trail
What the system records: a resolved report keeps `status`, `resolved_by` (staff username) and `resolved_at`.
What it does **not** record: the Recording *Hide* and Share link *Revoke/Hold/Release* admin actions only change
the row (`hidden_at`, `revoked_at`), and Django does not write an admin log entry for bulk actions. So the
operator writes the audit trail by hand in the incident file: report received (time), action taken (time, which
admin action, which rows by id), requester notified (time). The SLA clock is report received to action taken.
Suggested retention for these notes is 12 months; the owner sets the real policy. If a child-safety or
legal-process report may need preservation, hold (reversible) rather than hard-delete, and ask the owner first.

## Follow-up
Count reports per month; a rising count is the signal to use `abuse-wave.md`.
