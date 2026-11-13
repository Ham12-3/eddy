# Staging deployment plan

Draft, 12 November 2026, revised 13 November 2026. Nothing here has been deployed. Every step that opens an account, creates resources or costs money needs the product owner's explicit go-ahead first (CLAUDE.md).

There are two plans:

- **Plan A (proposed, ADR-0035):** Vercel for the web app, Supabase for Postgres, and Fly.io for the API, worker, maths-core and scene-check. Everything runs in London.
- **Plan B:** AWS in eu-west-2 through CDK (ADR-0014). It is the plan of record until ADR-0035 is accepted.

## What the code needs (both plans)

| Part | Runs as | Notes |
|---|---|---|
| apps/web | Next.js | The only part the browser talks to |
| services/api | FastAPI | Accepts only signed service tokens from web |
| worker | `python -m eddy_api.worker`, always running | Polls Postgres every 5 s for scene jobs; privacy and safeguarding jobs every 15 minutes (ADR-0034) |
| services/maths-core | FastAPI with SymPy | Stateless, no database |
| workers/scene-check | Node with Playwright (headless Chromium) | Stateless |
| Postgres 16 | Owner role for migrations, `eddy_app` at runtime | Migration 0006 creates `eddy_app` |
| Redis | Rate limits | Each process counts on its own if Redis is down |
| Email | SMTP | Sign-in links and notices |

No S3 and no SQS are used by the code today; they exist only in `compose.yaml`.

## Plan A: Vercel, Supabase and Fly.io (proposed)

### Accounts and settings

1. **Vercel, Pro plan.** Set the function region to London (`lhr1`) in `vercel.json`; the default is Washington, D.C. Root directory `apps/web`; the workspace packages compile through `transpilePackages`, so no extra build step.
2. **Supabase, a project in London (`eu-west-2`).**
   - Switch the Data API off before any table exists. Do not use Supabase Auth or Storage.
   - Connect directly or through the session-mode pooler; psycopg's prepared statements do not work through the transaction-mode pooler.
   - Turn on backups. Point-in-time recovery is a paid add-on: decide with the product owner.
3. **Fly.io, region London (`lhr`).** One app each for api, worker (the api image with the worker command), maths-core and scene-check.
   - maths-core and scene-check get no public address: the API and worker reach them on Fly's private network (`.internal` addresses).
   - The API gets a public HTTPS address for the web app only.
   - A small Redis app on the private network, or Upstash if London can be its primary region.
4. **An SMTP email provider** that processes mail in the UK or EU, with a verified sending domain, DKIM and SPF.

### Still to build (needs the go-ahead)

1. **Dockerfiles:** services/api (also the worker), services/maths-core and workers/scene-check (with Playwright's Chromium). Web needs none on Vercel.
2. **`fly.toml` for each service and `vercel.json`,** in the repository.
3. **A release step** that runs `alembic upgrade head` and the seed as the owner before each deploy (Fly's release command on the api app), then sets the `eddy_app` password once.
4. **Secrets:**
   - **Vercel:** `AUTH_SECRET`, `AUTH_URL`, `SERVICE_TOKEN_PRIVATE_KEY_B64`, the API's address, `EMAIL_SERVER`, `EMAIL_FROM`.
   - **Fly:** `SERVICE_TOKEN_PUBLIC_KEY_B64`, the maths-core and scene-check tokens, `DATABASE_URL` (release step only), `RUNTIME_DATABASE_URL`, `REDIS_URL`, `ANTHROPIC_API_KEY`, `SAFEGUARDING_ALERT_EMAIL`, the SMTP settings.
5. **`TRUSTED_PROXY_HOPS`** set to match Vercel's proxy, checked by reading the forwarded headers on staging.
6. **Logs:** a retention period agreed in the DPIA on each platform, and the query string stripped from `/api/auth/callback/*` in any request logs (sign-in links carry the address).
7. **Alerts:** on the worker stopping, on 5xx rates, and a spending limit on each account.

### Order of a first deploy

1. The product owner accepts ADR-0035, including the public API, and approves the accounts and a monthly budget.
2. Data processing agreements signed with Vercel, Supabase, Fly.io and the email provider; the DPIA and full privacy notice updated to name them.
3. Create the Supabase project and turn the Data API off.
4. Deploy maths-core, scene-check and Redis; then the api app, whose release step migrates and seeds; then the worker.
5. Deploy web to Vercel; point a staging domain at it; verify the email domain.
6. Smoke test: sign-up through a real email, a lesson with Claude off (templated), the parent journey, download and deletion.
7. Run `pnpm e2e` against staging (a change to the base URL), then the load test, and compare latency with the local run.

### Costs to price before approval

Not yet priced. To price: Vercel Pro, a Supabase plan with backups, five Fly machines (one with Chromium needs more memory), Redis, the email provider, and Claude (about £0.33 a lesson session measured in M7, shown on `/admin/costs`).

## Plan B: AWS in eu-west-2 (ADR-0014)

`infra/` is a CDK app (`pnpm --filter @eddy/infra synth`, checked in CI) for one stage, `Eddy-<stage>`:

| Stack | Has | Notes |
|---|---|---|
| Network | A VPC over 2 availability zones, 1 NAT gateway, public, private and isolated subnets | The default security group is locked down |
| Data | Postgres 16 on RDS (t4g.micro, encrypted, 7-day backups, deletion protection, private), an S3 asset bucket (encrypted, no public access, TLS only, old versions expire after 30 days), two SQS queues with dead-letter queues | The database credentials live in a generated Secrets Manager secret |
| Services | An empty ECS cluster | No services yet |

Still needed:

1. The same Dockerfiles, pushed to ECR from CI.
2. ECS Fargate services in the private subnets for web, api, maths-core, scene-check and the worker; only web is public (SPEC.md section 5.3).
3. An Application Load Balancer with HTTPS (ACM) in front of web, and `TRUSTED_PROXY_HOPS` to match.
4. ElastiCache Redis; Secrets Manager entries as listed for Plan A; a one-off migration task.
5. Amazon SES with a verified domain, DKIM and SPF, and SES production access.
6. CloudWatch logs with a DPIA retention period, alarms and an AWS Budgets alarm; the query string stripped from `/api/auth/callback/*` in access logs.

Order: approve the account and budget; `cdk deploy` Network and Data; push images and deploy services; migrate; domain and SES; then the same smoke test, `pnpm e2e` and load test as Plan A.

Costs to price: the NAT gateway (the largest fixed cost of a small VPC), RDS, five Fargate tasks, the load balancer, ElastiCache, SES, CloudWatch and Claude.

## Settings for any real environment

- `EDDY_ENVIRONMENT=production` (the default).
- `ANTHROPIC_ZDR_CONFIRMED` left false until zero data retention with Anthropic is confirmed in writing. Until then, the tutor and Tier L scenes do not call Claude against a non-local database.
- `SAFEGUARDING_ALERT_EMAIL` set to the named safeguarding lead.
- `AUTH_URL` set to the staging address.

## Approvals needed

- Which plan: ADR-0035 (A) or ADR-0014 (B).
- The accounts and a monthly budget.
- Every deploy.
- The email sending domain (and SES production access under Plan B).
- Zero data retention with Anthropic, before any real student data reaches Claude.
