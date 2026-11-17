---
updated: 2026-11-17
---
# Session log

Newest first. Back to [[index]].

## 2026-11-17 — stage 5 built: multiple closings per day (not applied)
- Tasks 1–8 + final-review fix wave on `stage-5-multi-closing` (to `affc2d6`): migrations `20261117000001_multi_closing`,
  `…0002_multi_closing_history`, SQL tests 170/180 (+090/100/110/160 adjusted), phone start-next, owner plan card, history per closing.
- Vitest 954/954, typecheck clean. Migrations NOT applied, SQL NOT run, nothing seen in a browser/phone.
- Next: apply both migrations together on dev, run 170/180/090/100/110/160, two-session start race, two-phone check.
- Gotcha: ship the stage-5 client with the migrations (history payload shapes changed).

## 2026-11-16 — erasure migration applied to dev
- Privilege probe passed (security definer can delete `auth.users`), `auth.sessions` columns checked, then
  `20261115000001_erasure` applied; `160` passes whole (T1–T12); `purge_stale` cron job active.
- Next: re-run `020`, `060`, `110`, `140`, `150`; manual owner check (plan Task 4 Step 5); check the first
  `purge_stale` run in `cron.job_run_details`.
- Gotcha: advisors now flag pg_cron's own policies on `cron.job*` — unreachable (no `cron` schema usage), accepted.

## 2026-11-16 — bootstrap project notes
- Created `project-notes/` (index, architecture, decisions, session-log) from README, package.json, CLAUDE.md,
  PROJECT_STATUS.md, CI config and git log. Branch `legal-fixes`, last commit `53a1a83` (2026-11-14).
- Next: apply migration `20261115000001_erasure` to dev (after the `auth.users` delete privilege probe), run
  SQL test `160` then `020/060/110/140/150`; LG1/LG3/LG5/LG6 legal pages (Task 5) wait on provider details.
- Gotcha: don't deploy the `legal-fixes` client before the erasure migration is applied.
