# Eddy

An adaptive GCSE Maths tutor. When a student gets something wrong, Eddy works out which misconception caused it and plays a short animation that starts from their own answer, shows why it fails and builds the right idea.

- [SPEC.md](SPEC.md): what we are building
- [PLAN.md](PLAN.md): milestones and definitions of done
- [DECISIONS.md](DECISIONS.md): architecture decision records
- [CLAUDE.md](CLAUDE.md): every command, port and gotcha

## Quick start

Needs Node 22, pnpm 10, uv and Docker.

```bash
pnpm install
uv sync
pnpm keys:dev
pnpm dev
```

Then open http://127.0.0.1:3300. Run `pnpm check` for every lint, typecheck and unit test, and `pnpm e2e` for the browser tests (after `pnpm e2e:install` once).
