---
updated: 2026-11-17
---
# Session log

Newest first. Back to [[index]].

## 2026-11-17 — stage 6 applied to dev
- `shop_roles` and `office_names` applied to dev via the connector (re-created bodies checked against their latest
  sources first). SQL 010–200 all pass on dev (realtime blocks forced to raise instead of skip; partitions present).
- Advisors: health clean; security only the accepted kinds; performance → L114 (no index on `shop_members.user_id`).
- Still open: «Confirm email» setting, browser/real-device invite round trip, deployed client must be this branch.

## 2026-11-17 — stage 6: shop roles (built, reviewed, final fix wave; NOT applied)
- `stage-6-roles`: manager/accountant roles per shop, email-bound invite links, role guards in every owner function/policy,
  office names from SQL (`private.office_name`). Migrations `…000003_shop_roles` + `…000004_office_names` written, NOT applied.
- Fix wave: history shows the server author name, office lines «Διαχείριση»; pending invite resumes after any sign-in;
  «Σύνδεση με άλλο λογαριασμό»; per-person queue tests; SQL 190/200 additions (not run). Vitest 1020/1020.
- Next: apply both migrations together, run SQL 190/200 + re-run 010–180, check «Confirm email» is on, real invite round trip.

## 2026-11-17 — stage 5 bug check (read-only review, nothing changed)
- Read both stage-5 migrations, the sync engine, register, «Σήμερα» and history code. No data-loss or locking bug found;
  typecheck clean, Vitest 954/954.
- Four low-severity UI findings, not fixed: SubmitSheet follows the new closing after `wrong_closing`; StartNextSheet
  stays open and retitles when the closing changes under it; the phone shows a cached earlier closing of the same day
  until the load lands (`staleDay` compares the date only); `TodayScreen.saveBlocked` filters pending by date, not closing.
- Next: decide which of the four to fix; the real-phone and two-session checks are still open.

## 2026-11-17 — stage 5: multiple closings per day (built, reviewed, applied to dev)
- `stage-5-multi-closing`: migrations `20261117000001_multi_closing` + `…0002_multi_closing_history` built, reviewed, applied to dev;
  SQL tests 170/180/080/090/100/110/130/160 pass. Vitest 954/954, typecheck clean. Nothing seen in a browser/phone.
- Next: deploy this branch's client together with the applied schema; real-phone check with two phones in both cash modes;
  two-session concurrency check (M45).
- Gotcha: history payload shapes changed, an older deployed client cannot read «Ιστορικό».

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
