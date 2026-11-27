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

Everything listens on `127.0.0.1` only, on ports chosen at each start. Nothing secret is in the
build (`src/secrets.mjs`): each install makes its own database passwords on first run and keeps
them sealed by Windows, and every launch makes a new token key pair, cookie secret and window
secret that are never written down. The web server answers only requests that carry the window
secret, so another program or Windows account on the computer gets nothing from it.

## Commands

| Task                         | Command                                 |
| ---------------------------- | --------------------------------------- |
| Build every part             | `pnpm --filter @eddy/desktop build`     |
| Run the app                  | `pnpm --filter @eddy/desktop start`     |
| Test the built parts         | `pnpm --filter @eddy/desktop test`      |
| Test the whole app, no window | `pnpm --filter @eddy/desktop test:app`  |
| Make the set-up program      | `pnpm --filter @eddy/desktop dist`      |
| The same, as a preview       | `pnpm --filter @eddy/desktop dist:preview` |

The build writes to `resources/` (about 250 MB) and keeps downloads in `.cache/`; both are
git-ignored. `build:postgres` downloads the official Windows binaries (317 MB) once and checks
them against a SHA-256 fixed in `scripts/fetch-postgres.mjs`. The tests skip any part that has
not been built, so `pnpm check` passes on a fresh clone. `test:app` starts a database and every
service, so it is not part of `pnpm check`: run it by itself, on a quiet machine.

## The set-up program

`dist` packs the shell and `resources/` into `release/Eddy-Setup-<version>.exe` (about 203 MB;
`dist:preview` makes `Eddy-Preview-Setup-<version>.exe`;
`release/` is git-ignored). Build every part first. It installs to
`%LOCALAPPDATA%\Programs\eddy` for the Windows account that runs it, with no administrator
password, and adds Start menu and desktop shortcuts. `Eddy-Setup-<version>.exe /S` installs
without showing anything. Removing Eddy leaves the data folder below.

- **It is not code-signed,** so Windows warns of an unknown publisher before it runs.
- **`dist` makes a build for students,** whatever `package.json` says: the tutor stays locked
  until the safeguarding help script is approved. `dist:preview` makes a preview (see below).
- **The installed program is locked to being Eddy** (`electronFuses` in
  `electron-builder.config.mjs`): no running as a bare Node, no `NODE_OPTIONS`, no debugger, and
  the shell's own code only from the packed archive. The services under `resources/eddy` are
  plain files and are not checked. `scripts/release.test.mjs` reads the fuses back.
- **To try the installed copy, start it from the Start menu.** A copy started from a Claude
  session's shell keeps its data in that app's private folder, not in the folder below.

## Where a student's data lives

`%LOCALAPPDATA%\Eddy\data`: the database (`postgres/`), its sealed passwords (`secrets.json`)
and logs (`logs/`, begun again at each start). Deleting that folder removes everything Eddy holds
on the computer. Outside an installed copy, `EDDY_DESKTOP_DATA` names another folder (the build
check uses it).

## Things to know

- **Preview builds.** `"eddy": { "preview": true }` in `package.json` (for `start`; a set-up
  program carries the flag only from `dist:preview`) runs the API in its development environment. Without it the tutor refuses to start until the safeguarding help
  script is approved (`SCRIPT_APPROVED` in `services/api`). A build for students must not carry
  the flag.
- **Typed chat is off.** A lesson takes answers and hint requests only. No model is shipped.
- **Build check.** `EDDY_DESKTOP_SMOKE=<file.png>` opens the app, saves one picture of the
  window and closes it. An installed copy ignores it.
- **Ended, not closed.** If the shell is ended from outside (Task Manager, a crash), Windows ends
  the services with it and a small watcher (`eddy-api watch-database`) stops the database
  cleanly. If the watcher is ended too, the database can be left running from
  `resources/postgres`, and the next build cannot replace those files. Stop it with
  `resources/postgres/bin/pg_ctl stop -D <its data folder>`.
- **Not done yet:** code signing, an icon, a trial on a computer without the development tools,
  and Mac and Linux builds.
