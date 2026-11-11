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

Files: `010` table access/RLS, `020` owner functions, `030` pairing and phone functions, `040` closings and
suggestions, `050` owner app support, `060` staff sessions, business date and day-change time, `070` session
submit and inputs schema 2, `080` open closing (per-field writes, realtime topic auth; needs `…d2`/`…d3` phones too), `090` live submit (revision check, pinned config, `last_submit`; uses `…d2` too), `100` history (closings version log `seq`, `owner_list_closings`, `owner_get_closing_day`, suggestions on the current version), `110` owner corrections (`owner_save_closing`: new version rows, guard on the current version, authorship, unsubmitted days). `060`/`070` also create a throwaway phone `…d1`; `060` uses `…d2` as an unpaired phone.

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
`100`/`110` do not touch `realtime.messages` (owner saves broadcast nothing).

