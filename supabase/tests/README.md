# Database security tests

Each `*.sql` file here is one self-contained transaction: it creates throwaway users and data,
impersonates owners and paired phones (`request.jwt.claims` + `set local role authenticated`),
checks what they can and cannot do, and ends in `ROLLBACK` — nothing is left in the database.

Run a file against the **dev** project only:
- Supabase dashboard → SQL editor → paste the whole file → Run, or
- Claude via the Supabase connector (`execute_sql`).

A pass finishes without error. A failure raises an exception whose message starts with the test id
(`T3 owner B can read shop A`).

Test user ids: owner A `…a1`, owner B `…b1`, stranger `…51`, shop members M `…c1`, N `…c2` (regular users); phones
`…d1`, `…d2` (anonymous users). All use the `@test.local` domain.

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
T-M42-6 (a stored 100 behaves as 30) and T-M42-7 (`private.max_expenses` values and grants). `080` (including these)
passed on dev 2026-11-17; the `020` cases were not run in that session.

`160` erasure and deletion (`20261115000001_erasure`, LG2/L81): `owner_erase_staff` (tombstone row, the old name in no
row of the shop incl. `last_submit`, a pre-erase token dead, the erased author's line still submittable, the erased row
not updatable/re-PINable/unlockable), `owner_delete_shop` (typed-name confirmation, every table empty for the shop, its
anonymous phone users kept and able to join another store), `owner_delete_account`, `private.purge_stale` (90-day sessions, 30-day unused anonymous
users; writes `auth.sessions` as the migration owner), grants and the `purge_stale` cron job; T9 deletes owner A, so it
is the last block; uses phones `…d1`–`…d3`, `…d5`, `…d6`. The migration is applied on dev; the file **passed on dev
2026-11-17** (run after the stage-5 migrations, with the stage-5 T5 adjustment). After applying, also re-run `020`, `060`, `110`,
`140`, `150` (they touch `staff`).

`170` several closings per day (`20261117000001_multi_closing`, stage 5 part 1): shop defaults (1 closing,
`'separate'`) and the snapshot's `closing_no`/`closings_planned`/`cash_mode`; `set_closing_plan` (`bad_closing_plan` for
0, 7, an unknown mode or nulls; `not_owner` for owner B) and the plan pinned on the day's closing 1 (re-created after a
delete as the migration owner); `start_next_closing` refusals (`not_submitted` before a submit and after a change since
it, `wrong_day`, `wrong_closing` for 2/0/null while 1 is live, `no_more_closings` after the last planned one), a start in
`'separate'` mode (empty closing 2, same config, revision 0), a repeat start from the second phone, `wrong_closing` for
phone/owner writes and submits naming closing 1 (closing 1 unchanged), the same submit key re-sent naming another
closing (`idempotency_conflict`; the same closing is a repeat), `closings.closing_no`; `'running'` mode (shop C:
only the visible expense lines and their `:d`/`:a` fields are copied, version 1, same authors; the second cashier
submits them); the config pin across closings; a new day starting at closing 1 (the stored dates are shifted back as
the migration owner, like 060 T8); grants and dropped overloads; T11 the `field`/`submitted` `closing_no` and the
`closing_started` broadcast (skipped without `realtime.messages` partitions, like 090 T8). Uses phones `…d1`–`…d4`.
That migration changes two `090` checks, already adjusted (see below): T0 (7-argument `submit_closing`) and T1 (5
`last_submit` keys with `closing_no`). **Run on dev 2026-11-17, passes** (after both stage-5 migrations were applied;
realtime partitions present, T11 not skipped).

`180` history, corrections and suggestions per closing (`20261117000002_multi_closing_history`, stage 5 part 2):
`owner_list_closings` days with `cash_mode`/`closings_planned`/`closings:[entry…]` (an old-style day without an open
closing reads `'separate'`, plan 1; three closings of a plan-3 day with a correction on closing 2; an unsubmitted
closing 3 after two submitted ones; newest day first); `owner_get_closing_day` per closing (`versions` each, `open`
only for the unsubmitted one, `live_closing_no` null for a past day and 2 for today with closing 2 live, an empty day);
`private.current_closing(shop, date, closing_no)`; `owner_save_closing(…, p_closing_no)` for a past closing
(`corrects_closing_id`, `closing_changed` when guarded on another closing's current, the same key naming another
closing is `idempotency_conflict`, closing numbers 0/7/null are `bad_inputs`), for an earlier closing of today (no
revision needed, no open closing changed) and for the live closing (`draft_changed`, then `last_submit` with
`closing_no` on that closing only); suggestions for a `'separate'` day (every closing) and a `'running'` day (only the
last closing); grants and the dropped 7-argument `owner_save_closing` / 2-argument `current_closing`. Past days are
written as the migration owner (back-dated `closings`/`open_closings` rows, like 100). Uses phone `…d1`. T4 assumes
nothing creates today's closing 1 before its `set_closing_plan` call (held on its first run). **Run on dev 2026-11-17,
passes.** Both stage-5 migrations were applied to dev together on 2026-11-17. 010–070, 120, 140, 150 were not re-run
after them. Neither file can test the `start_next_closing` races (one transaction each): those need two sessions.
Older files adjusted to the two stage-5 migrations (assertions changed only as far as the new contract requires):
`090` T0 (7-argument `submit_closing`; the 6-argument one is gone) and T1 (5 `last_submit` keys incl. `closing_no`);
`100` T0/T1 (3-argument `current_closing`), T2–T4 (a list day's entry is `closings[0]`), T6 (the detail's
`closings[0].versions`/`open`; an empty day has `closings: []`); `110` T0 (8-argument `owner_save_closing`), T3/T6
(detail `closings[0].versions`), T11 (list `closings[0]`), T15 (3-argument `current_closing`); `160` T5 (detail
`closings[0].versions`). **Run on dev 2026-11-17 after both stage-5 migrations: 080, 090, 100, 110, 130 and 160 pass
unchanged.**

`190` shop roles (`20261117000003_shop_roles`, stage 6 part 1): `owner_invite_member` (32-character token, one row per
shop sharing one `invite_id` and token hash, the raw token in no column, a foreign shop in the array → `not_owner` with
nothing created, `bad_member`, `already_member`, `already_owner`, the 20-row cap per shop `too_many_members`),
`invite_info` (a phone → `not_owner`, a random token → `invite_invalid`), `accept_shop_invite` (`invite_unconfirmed` is
checked before `invite_wrong_email`, a reused token → `invite_invalid`), `private.shop_role`, `my_shops`; the manager's
allowed calls and table writes on A1 (staff, store link, devices, «Σήμερα», history, a past-day correction recorded as
the manager's) and every owner-only call refused (`not_owner` / 0 rows / no `closings` rows read); the accountant on A2
(only `owner_list_closings`, `owner_get_closing_day` and the `shops` row; everything else refused; no realtime topic);
expiry, `owner_list_members` statuses and `owner_reissue_invite`; removal cutting access at once and a re-invite making
a new row; grants (T9); M's `owner_delete_account` tombstoning every row of M (T8, the last block). Back-dating, email
confirmation changes and row checks run as postgres. Uses member M `…c1` (confirmed), N `…c2` (confirmed in T3 for one
call, then from T6), stranger `…51`, phones `…d1` (A1), `…d2` (A2). **Written 2026-11-17, not yet run anywhere**
(no local database); after applying the migration also re-run 020, 050, 080, 100, 110, 120, 160, 170, 180 (owner
functions and policies were re-created).

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

`200` office names (`20261117000004_office_names`, stage 6): `private.office_name` (no client execute; the member's
`display_name`, latest `accepted_at`, else «Ιδιοκτήτης»); a manager's live field, the owner's and a cashier's each named
in `owner_get_open_closing` (`updated_by_name`), the `current` of a stale answer, `last_submit.staff_name` after the
manager's live `owner_save_closing`, `author_name` of the manager's, the cashier's and an owner correction in
`owner_get_closing_day`; the `field` and `submitted` broadcasts (T5, read from `realtime.messages`, skipped without a
partition); removal keeping the name, a re-invite as «Νίκος Π.» renaming the earlier rows (the old row is back-dated:
a transaction shares one `now()`), and account deletion showing `Διαγραμμένος συνεργάτης <8 hex>`. Written, **not run**
(no local database; to be applied and run on dev with the migration).

