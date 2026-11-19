# Deploying Eddy: Vercel, Supabase and Fly.io

Runbook for ADR-0035, 19 November 2026. Every step that opens an account, costs money or deploys needs the product owner's explicit go-ahead first (CLAUDE.md). Secrets are typed by the product owner into each provider's dashboard or terminal: they are never pasted into chat, committed, or read by an agent. Costs are estimated in `docs/staging-plan.md`.

Deploy **staging** first. Real students only use **production** once every line of `docs/launch-checklist.md` is ticked.

## What runs where (all in London)

| Part | Provider | Name (staging) | Reachable from |
|---|---|---|---|
| apps/web | Vercel, functions in `lhr1` (`apps/web/vercel.json`) | Vercel project `eddy-staging` | The internet |
| services/api | Fly.io app, process group `app` | `eddy-staging-api` | The internet over HTTPS, for the web app (service tokens only) |
| worker | Same Fly app and image, process group `worker` | `eddy-staging-api` | Nothing (it calls out) |
| services/maths-core | Fly.io app | `eddy-staging-maths` | Fly's private network only |
| workers/scene-check | Fly.io app | `eddy-staging-scenes` | Fly's private network only |
| Redis | Fly.io app | `eddy-staging-redis` | Fly's private network only |
| Postgres 17 | Supabase project in `eu-west-2` | `eddy-staging` | The API and worker (and the operator, for migrations) |
| Email | An SMTP provider (Resend in the estimate) | | |

Fly app names are global. If one is taken, change it in `deploy/fly/*.toml`, including the `.internal` addresses in `deploy/fly/api.toml`.

## 1. Accounts (product owner)

1. **Vercel Pro** for team "ham12-3's projects" (Hobby is not for commercial use).
2. **Supabase**: the organisation needs a paid plan to run more than two active projects. Create the project `eddy-staging` in **London (eu-west-2)** with a strong database password, kept in a password manager.
3. **Fly.io**: an organisation with billing set up. Install `flyctl` and run `fly auth login` in your own terminal.
4. **Email**: an SMTP provider with a verified sending domain (DKIM and SPF), and its SMTP credentials.
5. A **domain** for the web app, for example `staging.<your domain>`.
6. Data processing agreements with Vercel, Supabase, Fly.io and the email provider; then name them in the DPIA and the full privacy notice (`apps/web/src/content/privacy.tsx`, which raises the notice version).

## 2. Supabase

In the project dashboard:

1. **Settings, API (Data API): turn the Data API off.** Eddy never uses it. Do not use Supabase Auth or Storage either.
2. **SQL editor:** run `deploy/supabase/lockdown.sql`. It stops Supabase's public roles (`anon`, `authenticated`) getting access to Eddy's tables.
3. **Connection strings** (Connect button):
   - **Direct connection** (`db.<ref>.supabase.co:5432`, IPv6): for the API and worker on Fly, which has IPv6.
   - **Session pooler** (port 5432 on the pooler host; the user name is `postgres.<ref>`): for migrations from your own machine if your network has no IPv6.
   - Never the transaction pooler (port 6543): psycopg's prepared statements do not work through it.
   - Write them for SQLAlchemy with `?sslmode=require`, for example `postgresql+psycopg://postgres:<password>@db.<ref>.supabase.co:5432/postgres?sslmode=require`.
4. **Backups:** daily backups come with Pro. Point-in-time recovery is a paid add-on: decide before production.

## 3. Database schema and seed (product owner's terminal, at the repository root)

The owner's password stays on your machine: it is not given to Fly or Vercel. In PowerShell:

```powershell
$env:DATABASE_URL = "<owner connection string, session pooler>"
pnpm db:migrate
pnpm db:seed -- --allow-remote
Remove-Item Env:DATABASE_URL
```

Then in the Supabase SQL editor:

1. Run `deploy/supabase/lockdown.sql` again (new tables).
2. Give the runtime role a login, with a new strong password of its own: `ALTER ROLE eddy_app WITH LOGIN PASSWORD '<new password>';`

The runtime connection string is the owner's with `eddy_app` and that password: `postgresql+psycopg://eddy_app:<password>@db.<ref>.supabase.co:5432/postgres?sslmode=require`.

Repeat steps 3 and 4 of this section for every release that adds a migration, before deploying the API.

## 4. Keys (product owner's terminal)

Generate the staging service-token key pair and shared tokens fresh, never reusing local ones. `node scripts/dev-keys.mjs` shows how the local ones are made: an ES256 (P-256) key pair, base64 of the PEM; and random 32-byte tokens for maths-core, scene-check and `AUTH_SECRET`. Keep them in a password manager.

## 5. Fly.io (product owner's terminal, at the repository root)

Create the apps once:

```bash
fly apps create eddy-staging-api
```

```bash
fly apps create eddy-staging-maths
```

```bash
fly apps create eddy-staging-scenes
```

```bash
fly apps create eddy-staging-redis
```

Set the secrets with `fly secrets set --app <app> NAME=value ...` (or in the Fly dashboard):

| App | Secrets |
|---|---|
| `eddy-staging-redis` | `REDIS_PASSWORD` |
| `eddy-staging-maths` | `MATHS_CORE_SERVICE_TOKEN` |
| `eddy-staging-scenes` | `SCENE_CHECK_SERVICE_TOKEN` |
| `eddy-staging-api` | `SERVICE_TOKEN_PUBLIC_KEY_B64`, `RUNTIME_DATABASE_URL`, `MATHS_CORE_SERVICE_TOKEN`, `SCENE_CHECK_SERVICE_TOKEN`, `REDIS_URL` (`redis://:<REDIS_PASSWORD>@eddy-staging-redis.internal:6379/0`), `SMTP_URL` (for example `smtps://<user>:<password>@<smtp host>:465`), `MAIL_FROM`, `SAFEGUARDING_ALERT_EMAIL` (the named safeguarding lead) |

Leave `ANTHROPIC_API_KEY` unset and `ANTHROPIC_ZDR_CONFIRMED` false until zero data retention is confirmed in writing: until then the tutor uses templated messages. `DATABASE_URL` (the owner) is never set on Fly.

Deploy, private services first:

```bash
fly deploy --config deploy/fly/redis.toml
```

```bash
fly deploy . --config deploy/fly/maths-core.toml --dockerfile deploy/maths-core.Dockerfile
```

```bash
fly deploy . --config deploy/fly/scene-check.toml --dockerfile deploy/scene-check.Dockerfile
```

```bash
fly deploy . --config deploy/fly/api.toml --dockerfile deploy/api.Dockerfile
```

Check: `fly status --app eddy-staging-api` shows an `app` and a `worker` machine, `https://eddy-staging-api.fly.dev/health` answers `{"status":"ok"}`, and `fly logs --app eddy-staging-api` shows the worker's first privacy tick.

## 6. Vercel

Create the project from the GitHub repository `Ham12-3/eddy` (team "ham12-3's projects"):

- Root directory `apps/web`; framework Next.js. Vercel finds the pnpm workspace and installs from the root.
- Production branch `master`.
- Environment variables:

| Name | Value |
|---|---|
| `API_BASE_URL` | `https://eddy-staging-api.fly.dev` |
| `SERVICE_TOKEN_PRIVATE_KEY_B64` | The private half of the key pair from section 4 |
| `AUTH_SECRET` | From section 4 |
| `AUTH_URL` | The staging address, for example `https://staging.<your domain>` |
| `EMAIL_SERVER` | The SMTP URL, as for the API |
| `EMAIL_FROM` | For example `Eddy <sign-in@<your domain>>` |
| `TRUSTED_PROXY_HOPS` | `0`: Vercel replaces `X-Forwarded-For` with the visitor's address, so its last entry is the one to trust. Confirm on staging (section 7). |

Then add the domain and point its DNS at Vercel.

## 7. Smoke test (staging)

1. Create an invite: with `$env:DATABASE_URL` set to the owner's session-pooler string as in section 3, run `uv run --package eddy-api python -m eddy_api.invites STAGING --uses 10 --allow-remote`, then clear the variable.
2. Join through the real domain with a real email address you own; the sign-in email arrives.
3. Read the notice, set up, take the diagnostic, do a lesson (templated tutor), get a question wrong in a way a misconception predicts, and see its animation.
4. Parent journey: make a code, link a second address, accept, view, unlink.
5. Download my data; delete the account; after the worker's next tick it is gone.
6. Rate limit: ten wrong invite codes in a minute from one address are refused, and a second network (a phone off Wi-Fi) is not.
7. `pnpm e2e` against staging (a base URL change) and `scripts/load/load_test.py`: compare with the local numbers in PLAN.md M10.

## 8. Production

The same steps with `eddy-prod-*` names (copy the four `deploy/fly/*.toml` files and change `app` and the `.internal` addresses), a separate Supabase project, new keys and passwords, and the production domain. Only after `docs/launch-checklist.md` is signed off.

## Rolling back

- **Fly:** `fly releases --app <app>`, then `fly deploy --image <previous image>` for that app.
- **Vercel:** promote the previous deployment in the dashboard.
- **Database:** migrations are forward-only. Restore from a Supabase backup if a migration goes wrong, which loses writes since that backup: take a manual backup before each migration.
