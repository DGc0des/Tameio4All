# Database security tests

Each `*.sql` file here is one self-contained transaction: it creates throwaway users and data,
impersonates owners and paired phones (`request.jwt.claims` + `set local role authenticated`),
checks what they can and cannot do, and ends in `ROLLBACK` — nothing is left in the database.

Run a file against the **dev** project only:
- Supabase dashboard → SQL editor → paste the whole file → Run, or
- Claude via the Supabase connector (`execute_sql`).

A pass finishes without error. A failure raises an exception whose message starts with the test id
(`T3 owner B can read shop A`).

Test user ids: owner A `…a1`, owner B `…b1`, stranger `…51` (regular users); phones `…d1`, `…d2`
(anonymous users). All use the `@test.local` domain.

Files: `010` table access/RLS, `020` owner functions, `030` store join and phone functions, `040` closings and
suggestions, `050` owner app support, `060` staff sessions, business date and day-change time, `070` session
submit and inputs schema 2, `080` open closing (per-field writes, realtime topic auth; needs `…d2`/`…d3` phones too), `090` live submit (revision check, pinned config, `last_submit`; uses `…d2` too), `100` history (closings version log `seq`, `owner_list_closings`, `owner_get_closing_day`, suggestions on the current version), `110` owner corrections (`owner_save_closing`: new version rows, guard on the current version, authorship, unsubmitted days), `120` store link entry (`shop_join_keys`, `owner_get_join_key`/`owner_rotate_join_key`, `join_shop` incl. `other_shop`/`p_switch` and the 30-day prune, `owner_remove_device`, `owner_list_devices`, `staff_sign_in` last-use stamp, the old token failing after rotation, grants; uses phones `…d1`–`…d5`). `130` suggestions need a staff session (`expense_suggestion_data(p_token)`: no rows without a live session, for another phone's token, after sign-out; grants; the zero-argument form is gone; uses phones `…d1`, `…d2`). `140` PIN lockout (H24/M39/L93: the cashier track vs the trusted-phone track,
`staff_locked`/`device_locked`, escalation 15 m → 30 m and the 7-day restart, a trusted phone signing in while the
cashier is locked, per-cashier trust counters, `unlock_staff`/`set_staff_pin` resetting the level, trust rows going
with `owner_remove_device` and a shop switch, `private.lock_duration`, `verify_staff_pin` gone, grants, the
back-fill statement; T4/T11 write as the migration owner; uses phones `…d1`–`…d4`). Since that migration `030` T5
runs the lock sequence before the phone is trusted and T7 checks the phone-track counter, and `060` T4 drops d1's
trust row first so it still tests the cashier track. `150` 6-digit PINs, hard cutover (H24: `create_staff`/
`set_staff_pin` refuse 4- and 5-digit PINs as `bad_pin_format`; a cashier with `pin_hash` null gets `pin_not_set` on
any phone and nothing is counted, locked or trusted; `device_locked` comes first; the owner's `has_pin` column and its
grants; the migration's cutover statements run verbatim — on every staff row, rolled back, so it is the last block;
T2/T4/T6 write as the migration owner; uses phones `…d1`, `…d2`). Since that migration every file uses 6-digit PINs;
the bad-format cases (020 T4, 030 T7, 150 T1–T3) use 4- and 5-digit strings. `060`/`070` also create a throwaway phone `…d1`; `060` uses `…d2` as an unpaired phone. `20261114000007_max_expenses_clamp` (final review I1): `020` T2d/T3c (`create_shop`/`publish_config` refuse a
`maxExpenses` that is not a JSON integer 0..30 as `bad_config`) and T13 (0 and 30 accepted, owner B); `080` T-M42-5 (a
junk/huge stored `maxExpenses` → cap 0, `too_many_expenses`, no exception; config written as the migration owner),
T-M42-6 (a stored 100 behaves as 30) and T-M42-7 (`private.max_expenses` values and grants). Written, not yet run.

`160` erasure and deletion (`20261115000001_erasure`, LG2/L81): `owner_erase_staff` (tombstone row, the old name in no
row of the shop incl. `last_submit`, a pre-erase token dead, the erased author's line still submittable, the erased row
not updatable/re-PINable/unlockable), `owner_delete_shop` (typed-name confirmation, every table empty for the shop, its
anonymous phone users kept and able to join another store), `owner_delete_account`, `private.purge_stale` (90-day sessions, 30-day unused anonymous
users; writes `auth.sessions` as the migration owner), grants and the `purge_stale` cron job; T9 deletes owner A, so it
is the last block; uses phones `…d1`–`…d3`, `…d5`, `…d6`. **Written, not yet applied or run** (the migration needs the
privilege probe of plan `2026-11-14-legal-fixes` Task 3 Step 1 first). After applying, also re-run `020`, `060`, `110`,
`140`, `150` (they touch `staff`).

`080` and `090` also assert the Realtime side: `realtime.send` swallows insert errors (it only logs a
WARNING) and, on a project whose `realtime.messages` has no partitions (the Realtime service creates the daily
partitions once it is used), the broadcast/policy assertions cannot run. In that case the tests raise a
`NOTICE ... SKIPPED: realtime.messages has no partitions here` and skip those blocks (080 T2 message count +
payload, 080 I2 presence-only insert policy, 090 T8 `submitted` payload); everything else still runs. A skipped
block is not a pass: check `select count(*) from pg_inherits where inhparent = 'realtime.messages'::regclass`
and re-run once it is > 0. Last full run (2026-11-10, dev) had partitions, so nothing skipped; 080 and 090 were
re-run whole on 2026-11-11 after `20261108000003_live_fixes` (owner writes take the business date; acks carry the
stored value), partitions present, nothing skipped.

Stage 3 (`closing_versions`, `owner_save_closing`, `owner_save_closing_relock`): `100` and `110` were run whole on dev
after their migrations (together with 040, 070 and 090 after the first, 090 after the second, and 110 + 100 after the
relock fix). On 2026-11-11 the whole 010–110 series was run in the dashboard SQL editor against dev after all
three stage-3 migrations, every file passing. `110` cannot test concurrency: a file is one transaction, so the
same-key race and the owner-vs-staff-submit locking in `owner_save_closing` are written but never interleaved.
`100`/`110` do not touch `realtime.messages` (past-day owner saves broadcast nothing).

`20261111000003_today_save_and_submit_revision`: `last_submit` carries `revision` (090 T1/T8 updated); a save of
today needs the live revision and records `last_submit` (110 T1/T3/T9 updated, T13–T16 added). Applied to dev on
2026-11-11 (just before stage 4); see the stage-4 run below.

Stage 4 (`20261112000001_store_join_keys`): the pairing code is gone, so every file that paired a phone now does it
with the store key — the owner fetches it with `owner_get_join_key`, the phone calls `join_shop` (010 T8 checks
`shop_join_keys` instead of `pairing_codes`; 020's pairing tests were removed and T7 uses `owner_get_join_key`; 030 was
rewritten for joining; 050 T9 was deleted; 060 T7 sets `revoked_at` as the migration owner, since `authenticated` no
longer has that column grant). Run on dev on 2026-11-11 after both migrations: 010–120 all pass on dev (2026-11-11, after both migrations; 010 via the connector, 020–120 in the dashboard SQL editor, run by the user).

