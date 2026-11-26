# Eddy desktop

The desktop app (ADR-0036): one window, and every service on this computer. No internet, no
accounts, no AI model. Windows only for now.

## What runs

| Part        | What it is                                      | Built by            |
| ----------- | ----------------------------------------------- | ------------------- |
| Shell       | Electron: one locked-down window                | `src/main.mjs`      |
| Web         | `apps/web` as a standalone Next.js server       | `build:web`         |
| API, worker | `services/api` as `eddy-api.exe`                | `build:python`      |
| Maths       | `services/maths-core` as `eddy-maths.exe`       | `build:python`      |
| Scenes      | `workers/scene-check` as one file, no browser   | `build:scene-check` |
| Database    | PostgreSQL 16.15, a private copy                | `build:postgres`    |
| Data        | `config/`, `prompts/`, `curriculum/`, migrations | `build:python`      |

Everything listens on `127.0.0.1` only, on ports chosen at each start. Each install makes its own
database passwords, token key pair and cookie secret on first run (`src/secrets.mjs`); nothing
secret is in the build.

## Commands

| Task                         | Command                                 |
| ---------------------------- | --------------------------------------- |
| Build every part             | `pnpm --filter @eddy/desktop build`     |
| Run the app                  | `pnpm --filter @eddy/desktop start`     |
| Test the built parts         | `pnpm --filter @eddy/desktop test`      |
| Test the whole app, no window | `pnpm --filter @eddy/desktop test:app`  |

The build writes to `resources/` (about 280 MB) and keeps downloads in `.cache/`; both are
git-ignored. `build:postgres` downloads the official Windows binaries (317 MB) once and checks
them against a SHA-256 fixed in `scripts/fetch-postgres.mjs`. The tests skip any part that has
not been built, so `pnpm check` passes on a fresh clone. `test:app` starts a database and every
service, so it is not part of `pnpm check`: run it by itself, on a quiet machine.

## Where a student's data lives

`%APPDATA%\Eddy\data`: the database (`postgres/`), this install's secrets (`secrets.json`) and
logs (`logs/`). Deleting that folder removes everything Eddy holds on the computer. Set
`EDDY_DESKTOP_DATA` to use another folder (the tests do).

## Things to know

- **Preview builds.** `PREVIEW` in `src/main.mjs` runs the API in its development environment.
  With it off the tutor refuses to start until the safeguarding help script is approved
  (`SCRIPT_APPROVED` in `services/api`). Do not ship a build to students by leaving it on.
- **Typed chat is off.** A lesson takes answers and hint requests only. No model is shipped.
- **Build check.** `EDDY_DESKTOP_SMOKE=<file.png>` opens the app, saves one picture of the
  window and closes it.
- **Not done yet:** the installer (phase 3), code signing, and Mac and Linux builds.
