# Twister 🌀

Practice classic and modern tongue twisters with live speech feedback, scores, streaks and levels.

- **Frontend:** TanStack Start (React 19, Tailwind 4, Motion, Lottie, TanStack Query) → `web/`
- **Backend:** Django 5.2 + DRF, Supabase Postgres + Auth → `api/`
- **Docs:** [PRD](docs/PRD.md) · [ERD](docs/ERD.md) · [Architecture & deployment](docs/ARCHITECTURE.md)
- **Practice Suite (Read-along · Speak & Score · Record):** [Roadmap](docs/features/00-overview-and-roadmap.md) · [ERD master](docs/features/06-erd-practice-features.md) (slices `06a`–`06d`) · [Pronunciation engine design](docs/features/10-in-house-pronunciation-engine.md) · [Decisions](docs/features/11-decisions-log.md) · [Implementation status](docs/features/12-implementation-status.md)

Quick start: see *Local development* in `docs/ARCHITECTURE.md`.

## Checks

From the repo root, `npm install` installs Husky. Commits then format and lint staged web files (Prettier, ESLint) and staged API files (Ruff). That API half needs [uv](https://docs.astral.sh/uv/) and `api/.venv` from the local-dev steps.

```bash
npm run lint      # web eslint, prettier, tsc, and api ruff
npm run format    # write web and api formatting
```

API docs (when running): http://localhost:8000/api/docs/
