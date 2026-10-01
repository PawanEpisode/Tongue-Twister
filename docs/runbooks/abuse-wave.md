# Abuse wave

Covers: report spikes on shared links, spam or farmed attempts, scraping/credential-stuffing against the API,
abusive display names, and inappropriate shared recordings.

## Symptom
Reports flood the admin queue, many links auto-hide, a leaderboard looks wrong, or request volume/429s spike.

## Check
1. Reports: Django admin → **Moderation reports** (open first). A link auto-holds (resolves 410) when
   `REPORT_AUTOHIDE_THRESHOLD` (3) *distinct* reporters have un-dismissed reports. One report per (link,
   reporter); anonymous reporters are keyed by a salted IP hash (`IP_HASH_SALT`).
2. Links: admin → **Share links**; sort by `view_count` and `created_at`.
3. Attempts: admin → **Attempts**; look for identical transcripts and implausible speed. Built-in guards:
   identical transcripts per twister `SPAM_TRANSCRIPT_LIMIT` (5) in `SPAM_WINDOW_MIN` (10) minutes,
   `MAX_PLAUSIBLE_WPM` (320) is flagged and never ranked, `LEADERBOARD_REQUIRE_VERIFIED`.
4. Traffic: Vercel dashboard (requests, 429s by path). Throttle rates (`REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]`):
   anon 120/min, user 300/min, attempts 30/10min, attempts_sync 10/1min, word_feedback 60/60min,
   recordings 10/h, voice_uploads 30/h, share_resolve 60/min, share_create 30/h, share_report 10/h.

## Fix
Kill switches first (Django admin → Feature flags; unticking *enabled* beats allow-lists and rollout; takes
effect within about 2 min because `GET /flags/` is cached 60 s and the web app polls every 60 s):
| Problem | Flag |
|---|---|
| Abusive shared recordings | `share_links` (public recording pages and creation answer `feature_disabled`) |
| Abusive uploads | `record_cloud` |
| Abusive score cards | `score_cards` (JSON and image endpoints answer `feature_disabled`) |
| Leaderboard farming | `weekly_boards` |
| Gaming achievements/XP | `achievements` |

Targeted actions:
- **One link:** admin → Share links → select → *Revoke selected links* (permanent, 410) or *Hide (moderation
  hold)* (reversible with *Release moderation hold*).
- **One recording and all its links:** admin → Recordings → *Hide selected recordings (and hold their share links)*.
- **Triage reports:** admin → Moderation reports → *Action selected reports* (hides the link and the recording,
  holds every link to that target) or *Dismiss selected reports* (the link returns if under the threshold).
  Each resolution records the staff user and time.
- **A user's boards/achievements:** admin → User achievements → *Revoke selected achievements*. Attempts are
  flagged, not deleted; leave evidence.
- **Rate limits:** the rates are in `config/settings.py` (`DEFAULT_THROTTLE_RATES`), not environment variables,
  so tuning needs a code change and deploy. Throttle counters live in Django's default cache, which is
  per-process memory (no `CACHES` is configured), so on Vercel each warm instance counts separately: effective
  limits are looser than the numbers above and a determined scraper is not stopped by them. For a real
  volumetric attack use Vercel's firewall (rate limit by path/IP) rather than code.
- **Block an IP/UA:** Vercel Firewall rule on the API project.
- **Credential stuffing:** auth is Supabase; use Supabase's rate limits/CAPTCHA settings.

## Verify
- Reported links answer 410 on `GET /public/r/<token>/` / `GET /public/s/<token>/` (use the token the reporter
  sent; never paste tokens into tickets or chat).
- 429 and request volume return to baseline on the Vercel dashboard.
- Reports queue drained; no open report older than the 24 h takedown target (`takedown-sla.md`).

## Follow-up
- Re-enable flags one at a time; keep a note of the time off in the incident file.
- If a pattern repeats, tighten the relevant limit in settings and add a test.
- Consider adding a durable cache backend so throttles are shared across instances (not done today).
