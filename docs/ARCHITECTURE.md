# Architecture & Deployment

```
Browser (TanStack Start, React 19, Tailwind 4, Motion, Lottie)
   │  Web Speech API (mic → text, on device)
   │  supabase-js  ── sign in/up ──►  Supabase Auth
   │  fetch + Bearer JWT
   ▼
Django 5.2 + DRF  (Vercel Python serverless)  ── verifies JWT (JWKS/HS256) ──
   ▼
Supabase Postgres (pooler, port 6543)
```

## Repo layout
| Path | What |
|---|---|
| `web/` | TanStack Start app (SSR, file-based routes in `src/routes`) |
| `api/` | Django project `config/` + app `twisters/` |
| `docs/` | PRD, ERD, this file |

## Key decisions
1. **Supabase for Auth + Postgres only.** Django owns all business logic (scoring, XP, streaks) so it can't be bypassed from the browser.
2. **Server-side scoring** for signed-in users; the same algorithm is mirrored in `web/src/lib/scoring.ts` for guest mode and live highlighting.
3. **Guest-first:** no signup wall before the Aha moment.
4. **Free assets:** animations are small hand-authored Lottie JSONs in `web/src/assets/lottie`; swap in any free file from LottieFiles (check licence) by replacing the JSON.

## Local development
```bash
# API  (terminal 1)
cd api && uv venv --python 3.12 && uv pip install -r requirements-dev.txt
cp .env.example .env            # DJANGO_DEBUG=1 uses SQLite if DATABASE_URL is blank
.venv/bin/python manage.py migrate && .venv/bin/python manage.py seed_twisters
.venv/bin/python manage.py createsuperuser
.venv/bin/python manage.py runserver 8000
.venv/bin/python -m pytest                # tests

# Web  (terminal 2)
cd web && npm install && cp .env.example .env.local   # fill Supabase values (optional for guest mode)
npm run dev                               # http://localhost:3000
```

## Supabase setup
1. Create a project (free tier). Note **Project URL**, **anon/publishable key**.
2. *Settings → Database → Connection string → Transaction pooler* → use as `DATABASE_URL` (port 6543).
3. *Settings → API → JWT*: if the project uses asymmetric signing keys, just set `SUPABASE_URL` (JWKS is fetched automatically); if it uses the legacy shared secret, set `SUPABASE_JWT_SECRET`.
4. *Authentication → Providers*: enable Email and (optionally) Google. Add redirect URLs: `http://localhost:3000` and your production domain.
5. Run `python manage.py migrate` and `seed_twisters` against the Supabase `DATABASE_URL`, then run the RLS SQL in `docs/ERD.md`.

## Deploying on Vercel (two projects, one repo)
**Yes — the Django backend can run on Vercel** via the Python runtime (serverless functions). It suits an MVP; trade-offs are cold starts, a request-time limit, and no local disk (use Supabase for all state — we do).

| Project | Root Directory | Framework | Env vars |
|---|---|---|---|
| `twister-web` | `web` | TanStack Start (auto) | `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| `twister-api` | `api` | Other (uses `api/vercel.json` + `index.py`) | `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=0`, `DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`, `DATABASE_URL`, `DATABASE_SSL_REQUIRE=1`, `SUPABASE_URL` / `SUPABASE_JWT_SECRET` |

Run migrations from your laptop (or CI) against the production `DATABASE_URL`; don't run them in the serverless function.

**If Vercel-hosted Django becomes limiting** (long cold starts, background jobs), move `api/` unchanged to Render, Railway or Fly.io — `gunicorn config.wsgi` is already in requirements.

## Domain
Any domain you own works with Vercel — no need to buy another. Recommended layout:
- `yourdomain.com` (and `www`) → `twister-web`
- `api.yourdomain.com` → `twister-api`

Add both in each Vercel project's *Settings → Domains*, then create the DNS records Vercel shows at your registrar (A record for apex, CNAME for subdomains). Then set `CORS_ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com`, `DJANGO_ALLOWED_HOSTS=api.yourdomain.com`. Use a subdomain like `twister.yourdomain.com` instead if the apex is already used for something else.
