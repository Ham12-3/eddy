---
name: milestone-review
description: Close out an Eddy milestone. Runs every check, collects evidence and screenshots, compares the result with the milestone's definition of done in PLAN.md, and writes the evidence block. Use when a milestone's work looks finished, before asking the user to sign it off.
---

# Milestone review

1. Identify the milestone from the branch name (`m0-foundations` is M0) and read its section in PLAN.md.
2. Run, and keep the output summary of each:
   - `pnpm check`
   - `pnpm e2e` (screenshots land in `e2e-artifacts/screenshots/`)
   - `pnpm --filter @eddy/infra synth`
   - anything else the milestone's definition of done names (benchmarks, evals, simulations).
3. Open every new or changed screenshot and look at it. Compare it with the design rules in `.claude/rules/web.md` and SPEC.md section 11. Fix what you see, then rerun.
4. Run the `reviewer` subagent on the milestone diff (plus `security-reviewer` or `pedagogy-critic` where relevant). Fix the findings, or record why one is not being fixed.
5. Tick each PLAN.md checkbox that the evidence supports. Leave unticked anything not done or not proven, and say why.
6. Append an evidence block to the "Evidence log" in PLAN.md: date, commands run, output summary (pass counts, timings), screenshot paths, review findings and their outcome, and anything skipped or still open.
7. Update CHANGELOG.md.
8. Report to the user honestly: what is done, what is not, what needs their sign-off. Never claim a check passed without having run it.
