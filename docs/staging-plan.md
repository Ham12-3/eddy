# Staging deployment plan

Draft, 12 November 2026 (PLAN.md M10). Nothing here has been deployed. Every step that creates AWS resources or costs money needs the product owner's explicit go-ahead first (ADR-0014, CLAUDE.md).

## What exists today

`infra/` is a CDK app (`pnpm --filter @eddy/infra synth`, checked in CI) for one stage, `Eddy-<stage>`, in eu-west-2 (London), so personal data stays in the UK:

| Stack | Has | Notes |
|---|---|---|
| Network | A VPC over 2 availability zones, 1 NAT gateway, public, private and isolated subnets | The default security group is locked down |
| Data | Postgres 16 on RDS (t4g.micro, encrypted, 7-day backups, deletion protection, private), an S3 asset bucket (encrypted, no public access, TLS only, old versions expire after 30 days), two SQS queues with dead-letter queues | The database credentials live in a generated Secrets Manager secret |
| Services | An empty ECS cluster | No services yet |

## What staging still needs

1. **Container images.** There are no Dockerfiles yet. One each for apps/web (Next.js standalone build), services/api (also used for the worker, with a different command), services/maths-core and workers/scene-check. Images go to ECR, built in CI.
2. **ECS Fargate services** in the private subnets: web, api, maths-core and scene-check, plus one worker task (it runs the scene jobs and, every 15 minutes, the privacy and safeguarding jobs, ADR-0034). Only web is reachable from the internet; the others are internal only (SPEC.md section 5).
3. **An Application Load Balancer** in front of web, with HTTPS (an ACM certificate) and `TRUSTED_PROXY_HOPS` set to match (the ALB, plus 1 if CloudFront sits in front).
4. **ElastiCache Redis** for the rate limits (`REDIS_URL`), in the private subnets.
5. **Secrets Manager** entries for: `AUTH_SECRET`, the service-token key pair (`SERVICE_TOKEN_PRIVATE_KEY_B64` for web, `SERVICE_TOKEN_PUBLIC_KEY_B64` for api), the maths-core and scene-check tokens, the two database URLs (`DATABASE_URL` for the schema owner, used only by the migration task; `RUNTIME_DATABASE_URL` for the `eddy_app` role), and `ANTHROPIC_API_KEY`.
6. **A one-off migration task** (`alembic upgrade head` and the seed) run as the owner before each deploy, and the `eddy_app` role given a password from Secrets Manager (`python -m eddy_api.db.local` is for local machines only).
7. **Amazon SES** for sign-in and notice emails (`EMAIL_SERVER`, `EMAIL_FROM`), with a verified sending domain, DKIM and SPF. SES starts in its sandbox: production access must be requested.
8. **Settings for a real environment:** `EDDY_ENVIRONMENT=production` (the default), `ANTHROPIC_ZDR_CONFIRMED` left false until zero data retention with Anthropic is confirmed in writing (until then the tutor and Tier L scenes do not call Claude on a non-local database), `SAFEGUARDING_ALERT_EMAIL` set to the named safeguarding lead, `AUTH_URL` set to the staging address.
9. **Monitoring:** CloudWatch logs for every service with a retention period agreed in the DPIA, alarms on 5xx rates and the worker stopping, and an AWS Budgets alarm.
10. **Access logs:** strip the query string from `/api/auth/callback/*` in load balancer and CloudFront logs: sign-in links carry the address (security review, M8).

## Order of a first deploy

1. Product owner approves the AWS account, a monthly budget and this plan.
2. `cdk deploy Eddy-staging-Network Eddy-staging-Data` (database and bucket first).
3. Build and push the images; deploy the services stack.
4. Run the migration task; set the `eddy_app` password.
5. Point a staging domain at the load balancer; verify SES.
6. Smoke test: sign-up through a real email, a lesson with Claude off (templated), the parent journey, download and deletion.
7. Run `pnpm e2e` against staging (a configuration change to the base URL), and the load test.

## Costs to price before approval

Not yet priced: a figure here would be a guess. To price: the NAT gateway (the largest fixed cost of a small VPC), RDS t4g.micro and its storage and backups, Fargate tasks (5 services), the load balancer, ElastiCache, S3, SQS, SES, CloudWatch, and Claude itself (about £0.33 a lesson session measured in M7, shown on `/admin/costs`).

## Approvals needed

- The AWS account and budget (PLAN.md external dependencies).
- SES production access and the sending domain.
- Every `cdk deploy`.
- Zero data retention with Anthropic, before any real student data reaches Claude.
